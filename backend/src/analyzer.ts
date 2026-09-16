/**
 * Core interview analysis logic using Claude Agent SDK or Direct API
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';

// Lazy initialization to ensure env vars are loaded
let anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic();
  }
  return anthropic;
}

export type AnalysisMethod = 'agent-sdk' | 'direct-api';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/**
 * Models a client is allowed to request via the `model` field on an analyze
 * request. The override arrives from an untrusted HTTP body, so it is checked
 * against this list rather than forwarded to the API as-is: an unchecked value
 * lets an anonymous caller pick the most expensive model available on the
 * operator's API key.
 *
 * The ANTHROPIC_MODEL env var is operator-controlled and is deliberately NOT
 * constrained by this list.
 */
export const ALLOWED_ANTHROPIC_MODELS: ReadonlySet<string> = new Set([
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5'
]);

/**
 * The complete set of built-in tools the analysis agent can use. Passed as the
 * SDK's `tools` option, which defines the base tool list; every other built-in
 * is absent rather than merely unapproved. Analysis is a read-and-reason task
 * over a transcript supplied in the request, so web lookup is all it needs.
 */
export const AGENT_ALLOWED_TOOLS: string[] = ['WebSearch'];

/**
 * Tools explicitly denied to the analysis agent. Anything that can execute a
 * command, read the filesystem, or spawn a subagent is a path from an uploaded
 * transcript to the server's credentials.
 */
export const AGENT_DISALLOWED_TOOLS: string[] = [
  'Bash', 'BashOutput', 'KillShell',
  'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep',
  'WebFetch',
  'Task', 'TodoWrite'
];

/**
 * Minimal environment for the agent subprocess.
 *
 * The server process holds several unrelated secrets (Brave, admin, Firebase).
 * Spreading process.env into the agent puts all of them one tool call away from
 * a prompt an untrusted user wrote, so only the variables the SDK actually
 * needs are forwarded.
 */
export function buildAgentEnv(model: string): Record<string, string> {
  const passthrough = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER'];
  const env: Record<string, string> = {};

  for (const key of passthrough) {
    const value = process.env[key];
    if (value) env[key] = value;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  }

  env.ANTHROPIC_MODEL = model;
  return env;
}

/**
 * Pull complete sentences out of a streaming reasoning buffer.
 *
 * Reasoning arrives as a continuous token stream, so any boundary based on a
 * timer or a fixed character count lands mid-word. Three separate call sites
 * had each grown their own copy of that bug, producing log lines like
 * "Thinking: ief with no timestamps present". The boundary has to come from
 * the text.
 *
 * Returns the text ready to emit and whatever is still incomplete. With
 * `force`, the remainder is flushed as-is, for end-of-stream.
 */
export function takeSentences(buffer: string, force = false): { emit: string; rest: string } {
  if (force) return { emit: buffer, rest: '' };

  const sentences = buffer.match(/[^.!?\n]+[.!?\n]+/g);
  if (sentences) {
    const consumed = sentences.join('');
    // Hold very short fragments back so they merge with what follows. After the
    // safety valve below cuts at a word boundary, the tail can complete into a
    // stub like "d." that is noise on its own line.
    if (consumed.trim().length < 25) return { emit: '', rest: buffer };
    return { emit: consumed, rest: buffer.slice(consumed.length) };
  }
  // Safety valve: a very long stretch with no sentence ending still gets
  // reported rather than sitting invisible in the buffer. Cut at a word
  // boundary and mark it, so the reader can see the line is a continuation
  // rather than a mangled sentence.
  if (buffer.length > 600) {
    const cut = buffer.lastIndexOf(' ');
    if (cut > 0) return { emit: buffer.slice(0, cut) + '…', rest: '…' + buffer.slice(cut + 1) };
  }
  return { emit: '', rest: buffer };
}

/** Trim a complete thought for display without cutting a word in half. */
export function clipAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return text.slice(0, cut > 0 ? cut : max).trimEnd() + '...';
}

export function getAnthropicModel(override?: string): string {
  const fallback = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;

  if (!override) return fallback;

  if (!ALLOWED_ANTHROPIC_MODELS.has(override)) {
    console.warn(
      `[analyzer] Ignoring unsupported model override "${override}"; using "${fallback}". ` +
      `Allowed: ${[...ALLOWED_ANTHROPIC_MODELS].join(', ')}`
    );
    return fallback;
  }

  return override;
}

export interface AnalysisOptions {
  interviewType: string;  // Can be built-in types or custom admin-defined types
  cachedCriteria?: string;  // Pre-fetched interview criteria (from admin or web search)
  method?: AnalysisMethod;  // Which analysis method to use (default: agent-sdk)
  model?: string;          // Optional model override (default: ANTHROPIC_MODEL env or claude-opus-5)
}

// Web search tool definition for Direct API method
const webSearchTool: Anthropic.Tool = {
  name: 'web_search',
  description: 'Search the web for current information about interview standards and evaluation criteria.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query'
      }
    },
    required: ['query']
  }
};

// Brave Search API integration
async function braveWebSearch(searchQuery: string): Promise<string> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return 'Web search unavailable (BRAVE_API_KEY not configured).';
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=5`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        }
      }
    );

    if (!response.ok) {
      return `Search failed: ${response.status}`;
    }

    const data = await response.json() as {
      web?: { results?: Array<{ title: string; url: string; description: string }> }
    };

    if (!data.web?.results?.length) {
      return 'No search results found.';
    }

    return data.web.results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.description}\n   Source: ${r.url}`
    ).join('\n\n');
  } catch (error) {
    return `Search error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }
}

export interface AnalysisMessage {
  type: string;
  content: string;
  timestamp: Date;
  raw?: any;
}

/**
 * Build the analysis prompt based on interview type
 */
function buildAnalysisPrompt(transcript: string, interviewType: string, cachedCriteria?: string): string {
  // Build the workflow steps - skip research if we have cached criteria
  const getWorkflowSteps = (researchQuery: string) => {
    if (cachedCriteria) {
      // Use cached criteria, skip web search
      return `
CURRENT INTERVIEW STANDARDS (cached):
${cachedCriteria}

TASK - MULTI-STEP WORKFLOW:
1. **Parse Transcript**: Identify each distinct question asked and the candidate's response
2. **Evaluate Each Question**: For each question, provide:
   - Question type (product design, strategic insights, analytical, etc.)
   - Overall score out of 10
   - Structure quality (did they state their framework upfront?)
   - Key strengths with specific timestamps (format: HH:MM:SS)
   - Critical weaknesses with specific timestamps
   - What they missed or should have done differently
   - Comparison to what a strong candidate would do

3. **Overall Assessment**: Provide:
   - Overall interview score out of 10
   - Would they pass the bar? (Yes/No/Borderline)
   - Top 3 strengths across the entire interview
   - Top 3 critical weaknesses
   - Talk-to-listen ratio estimate (should be ~60:40)

4. **Actionable Recommendations**: Provide 5-7 specific, actionable recommendations for improvement

5. **Self-Review**: Before outputting, verify:
   - Did I provide specific timestamps for key moments?
   - Did I compare to the standards provided?
   - Did I give concrete examples, not just generic feedback?
   - Are my recommendations actionable?`;
    } else {
      // No cache, do web search first
      return `
TASK - MULTI-STEP WORKFLOW:
1. **Research Current Standards**: Web search for "${researchQuery}" to understand the current bar
2. **Parse Transcript**: Identify each distinct question asked and the candidate's response
3. **Evaluate Each Question**: For each question, provide:
   - Question type (product design, strategic insights, analytical, etc.)
   - Overall score out of 10
   - Structure quality (did they state their framework upfront?)
   - Key strengths with specific timestamps (format: HH:MM:SS)
   - Critical weaknesses with specific timestamps
   - What they missed or should have done differently
   - Comparison to what a strong candidate would do

4. **Overall Assessment**: Provide:
   - Overall interview score out of 10
   - Would they pass the bar? (Yes/No/Borderline)
   - Top 3 strengths across the entire interview
   - Top 3 critical weaknesses
   - Talk-to-listen ratio estimate (should be ~60:40)

5. **Actionable Recommendations**: Provide 5-7 specific, actionable recommendations for improvement

6. **Self-Review**: Before outputting, verify:
   - Did I provide specific timestamps for key moments?
   - Did I compare to actual standards?
   - Did I give concrete examples, not just generic feedback?
   - Are my recommendations actionable?`;
    }
  };

  // Build criteria section based on whether we have cached criteria
  const criteriaSection = cachedCriteria
    ? `\nEVALUATION CRITERIA:\n${cachedCriteria}\n`
    : '';

  const researchQuery = `${interviewType} interview evaluation criteria ${new Date().getFullYear()} what they look for`;

  return `You are an expert interviewer evaluating a candidate for a ${interviewType} role. You have 10+ years of experience conducting and evaluating interviews for this type of position.
${criteriaSection}
${getWorkflowSteps(researchQuery)}

TRANSCRIPT:
${transcript}

OUTPUT FORMAT:
Use clear markdown formatting with:
- ## for main sections
- ### for subsections
- **bold** for emphasis
- \`code\` for timestamps (e.g., \`00:15:30\`)
- Bullet points for lists
- Tables where appropriate

Be direct, specific, and constructive. This is for learning, so honest feedback is most valuable.`;
}

/**
 * Analyze an interview transcript using Claude Agent SDK
 */
export async function analyzeInterview(
  transcript: string,
  options: AnalysisOptions = { interviewType: 'generic' }
): Promise<AsyncGenerator<AnalysisMessage>> {
  const prompt = buildAnalysisPrompt(transcript, options.interviewType, options.cachedCriteria);

  // Create the agent query.
  //
  // SECURITY: the transcript is attacker-controlled - anyone who can reach the
  // analyze endpoint supplies it, and it lands in the agent's prompt. Treat
  // everything below as a containment boundary, not as tuning.
  const result = query({
    prompt,
    options: {
      model: getAnthropicModel(options.model),
      includePartialMessages: true,
      // Do not load settings files. NOTE: this does NOT sandbox the filesystem;
      // tool restriction below is what actually prevents file and shell access.
      settingSources: [],
      // Increase max turns for more complex analysis
      maxTurns: 20,

      // THE boundary: `tools` sets the base list of built-in tools that exist
      // at all. `allowedTools` only auto-approves - on its own it restricts
      // nothing - so the restriction has to be expressed here.
      tools: AGENT_ALLOWED_TOOLS,
      // Auto-approve the one tool we do expose, so the run needs no prompt.
      allowedTools: AGENT_ALLOWED_TOOLS,
      // Defense in depth: deny entries are enforced ahead of any allowance, so
      // these stay blocked even if the base list above is ever widened.
      disallowedTools: AGENT_DISALLOWED_TOOLS,

      // No ambient MCP servers. An MCP tool is named mcp__server__tool and would
      // not be matched by the built-in deny names above, so it has to be shut
      // off at the source rather than denied by name.
      mcpServers: {},
      strictMcpConfig: true,

      // Deny anything that unexpectedly asks for permission, rather than
      // blanket-approving it. A server process cannot answer a prompt, and
      // failing closed is the right default for untrusted input.
      permissionMode: 'dontAsk',

      // Pass an explicit allowlist rather than the whole server environment.
      // process.env here holds the Anthropic key, the Brave key, the admin key
      // and the Firebase service account JSON; the agent needs almost none of it.
      env: buildAgentEnv(getAnthropicModel(options.model)),
      stderr: (data) => {
        console.error('[Claude CLI stderr]:', data.toString());
      }
    }
  });

  // Return an async generator that yields messages
  return (async function* () {
    let messageCount = 0;
    let thinkingBuffer = '';
    let lastThoughtYield = Date.now();
    let textBuffer = '';
    let lastTextYield = Date.now();

    for await (const message of result) {
      messageCount++;

      // Log ALL messages for debugging
      const subtype = (message as any).subtype;
      console.log(`[SDK Message ${messageCount}] Type: ${message.type}`,
        subtype ? `Subtype: ${subtype}` : '');

      // Send raw message data for ALL message types
      yield {
        type: 'raw',
        content: `[${message.type}${subtype ? ':' + subtype : ''}]`,
        timestamp: new Date(),
        raw: message
      } as AnalysisMessage;

      // Handle specific message types
      if (message.type === 'result') {
        // Final result contains the full analysis as a string
        if (message.subtype === 'success' && message.result) {
          yield {
            type: 'result',
            content: message.result,
            timestamp: new Date()
          };
        }
      } else if (message.type === 'assistant') {
        // Stream assistant message details
        const assistantMsg = message.message;

        if (assistantMsg.content && Array.isArray(assistantMsg.content)) {
          for (const block of assistantMsg.content) {
            if (block.type === 'thinking' && (block as any).thinking) {
              const thought = ((block as any).thinking as string).replace(/\s+/g, ' ').trim();
              if (thought) {
                yield {
                  type: 'raw',
                  content: `Thinking: ${clipAtWord(thought, 200)}`,
                  timestamp: new Date(),
                  raw: { type: 'thinking_summary', preview: clipAtWord(thought, 400) }
                };
              }
            } else if (block.type === 'text' && block.text) {
              // Send text content
              const text = block.text.trim();
              if (text) {
                yield {
                  type: 'raw',
                  content: text.substring(0, 500), // Limit length
                  timestamp: new Date(),
                  raw: { type: 'text', full: text }
                };
              }
            } else if (block.type === 'tool_use') {
              // Send tool use info
              yield {
                type: 'raw',
                content: `Using tool: ${block.name}`,
                timestamp: new Date(),
                raw: { type: 'tool_use', tool: block.name, input: block.input }
              };
            }
          }
        }
      } else if (message.type === 'tool_progress') {
        // Tool progress with timing
        yield {
          type: 'raw',
          content: `Tool progress: ${message.tool_name} (${message.elapsed_time_seconds.toFixed(1)}s)`,
          timestamp: new Date(),
          raw: message
        };
      } else if (message.type === 'user') {
        // User messages (from the SDK itself)
        const userMsg = (message as any).message;
        if (userMsg?.content) {
          yield {
            type: 'raw',
            content: `[User message from SDK]`,
            timestamp: new Date(),
            raw: message
          };
        }
      } else if (message.type === 'system') {
        // System messages
        yield {
          type: 'raw',
          content: `[System message]`,
          timestamp: new Date(),
          raw: message
        };
      } else if (message.type === 'stream_event') {
        // Stream events (partial live updates)
        const event = (message as any).event;
        const delta = event?.delta;

        if (event?.type === 'content_block_start' && event?.content_block?.type === 'thinking') {
          yield {
            type: 'raw',
            content: 'Thinking through interview evaluation...',
            timestamp: new Date(),
            raw: event
          };
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          thinkingBuffer += delta.thinking;
          const now = Date.now();

          // Emit complete sentences only, and keep the remainder buffered.
          //
          // This previously flushed on a 2.5s timer and then truncated to 120
          // characters, so entries started and ended mid-word and whatever was
          // cut off was silently dropped. Reasoning arrives as a continuous
          // stream, so the boundary has to come from the text, not a clock.
          const { emit, rest } = takeSentences(thinkingBuffer);
          thinkingBuffer = rest;
          const clean = emit.replace(/\s+/g, ' ').trim();
          if (clean.length > 0) {
            yield {
              type: 'raw',
              content: `Thinking: ${clean}`,
              timestamp: new Date(),
              raw: { type: 'thinking_delta', snippet: clean }
            };
            lastThoughtYield = now;
          }
        } else if (delta?.type === 'text_delta' && delta.text) {
          textBuffer += delta.text;
          const now = Date.now();
          if (now - lastTextYield > 3000 || textBuffer.length > 150) {
            const clean = textBuffer.replace(/\s+/g, ' ').trim();
            if (clean.length > 0) {
              // Report that writing is happening, not what is being written.
              // This used to carry the trailing 90 characters of the evaluation,
              // so the UI showed a sliding window of mid-sentence prose. The
              // finished text is delivered as the result; progress only needs
              // to say the model is producing it.
              yield {
                type: 'raw',
                content: `Writing evaluation (${clean.length} characters so far)`,
                timestamp: new Date(),
                raw: { type: 'text_progress', length: textBuffer.length }
              };
            }
            lastTextYield = now;
          }
        } else if (event?.type === 'content_block_stop') {
          if (thinkingBuffer.trim().length > 0) {
            const { emit } = takeSentences(thinkingBuffer, true);
            const clean = emit.replace(/\s+/g, ' ').trim();
            if (clean.length > 0) {
              yield {
                type: 'raw',
                content: `Thinking: ${clean}`,
                timestamp: new Date(),
                raw: { type: 'thinking_delta', snippet: clean }
              };
            }
            thinkingBuffer = '';
          }
        }
      }
    }
  })();
}

/**
 * Analyze interview using Direct API with web search tool (faster method)
 */
export async function analyzeInterviewDirectAPI(
  transcript: string,
  options: AnalysisOptions = { interviewType: 'generic' }
): Promise<AsyncGenerator<AnalysisMessage>> {
  const interviewType = options.interviewType;
  const cachedCriteria = options.cachedCriteria;

  // Build prompt - use cached criteria or encourage web search
  const criteriaSection = cachedCriteria
    ? `\nEVALUATION CRITERIA:\n${cachedCriteria}\n`
    : `\nIMPORTANT: First use the web_search tool to research current ${interviewType} interview evaluation criteria and standards for ${new Date().getFullYear()}.\n`;

  const prompt = `You are an expert interviewer evaluating a candidate for a ${interviewType} role. You have 10+ years of experience conducting and evaluating interviews for this type of position.
${criteriaSection}
TASK:
1. ${cachedCriteria ? '' : 'Research current interview standards (use web_search tool)\n2. '}Parse the transcript and identify each distinct question and response
${cachedCriteria ? '2' : '3'}. Evaluate each question:
   - Question type and category
   - Score out of 10
   - Key strengths with timestamps (HH:MM:SS format)
   - Critical weaknesses with timestamps
   - What a strong candidate would do differently

${cachedCriteria ? '3' : '4'}. Overall Assessment:
   - Overall interview score out of 10
   - Pass/Fail/Borderline verdict
   - Top 3 strengths
   - Top 3 weaknesses
   - Talk-to-listen ratio estimate

${cachedCriteria ? '4' : '5'}. Provide 5-7 specific, actionable recommendations

TRANSCRIPT:
${transcript}

OUTPUT FORMAT:
Use clear markdown formatting with ## for sections, ### for subsections, **bold** for emphasis, \`code\` for timestamps.
Be direct, specific, and constructive.`;

  return (async function* () {
    yield {
      type: 'start',
      content: 'Starting Direct API analysis...',
      timestamp: new Date()
    };

    try {
      let messages: Anthropic.MessageParam[] = [
        { role: 'user', content: prompt }
      ];

      let finalResult = '';
      let toolCallCount = 0;
      const maxToolCalls = 3;

      // Tool use loop
      while (true) {
        yield {
          type: 'raw',
          content: `[API call ${toolCallCount + 1}]`,
          timestamp: new Date()
        };

        const model = getAnthropicModel(options.model);
        const stream = getAnthropicClient().messages.stream({
          model,
          // Thinking is on by default on Opus 5 and max_tokens caps thinking + text
          // together, so this needs far more headroom than the old no-thinking 8000.
          max_tokens: 32000,
          // display: 'summarized' is required for the thinking_delta events below.
          // The API default is 'omitted', which streams empty thinking blocks and
          // would silently kill the live "Thinking:" feed in the UI.
          thinking: { type: 'adaptive', display: 'summarized' },
          tools: cachedCriteria ? undefined : [webSearchTool], // Only provide tool if no cache
          messages
        });

        let directThinking = '';
        let lastDirectYield = Date.now();

        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            const delta = (event as any).delta;
            if (delta?.type === 'thinking_delta' && delta.thinking) {
              directThinking += delta.thinking;
              const now = Date.now();
              const { emit, rest } = takeSentences(directThinking);
              directThinking = rest;
              const clean = emit.replace(/\s+/g, ' ').trim();
              if (clean.length > 0) {
                yield {
                  type: 'raw',
                  content: `Thinking: ${clean}`,
                  timestamp: new Date(),
                  raw: { type: 'thinking_delta', snippet: clean }
                };
                lastDirectYield = now;
              }
            } else if (delta?.type === 'text_delta' && delta.text) {
              const now = Date.now();
              if (now - lastDirectYield > 3000) {
                yield {
                  type: 'raw',
                  content: 'Writing evaluation analysis...',
                  timestamp: new Date()
                };
                lastDirectYield = now;
              }
            }
          }
        }

        const response = await stream.finalMessage();

        // Check if done
        if (response.stop_reason === 'end_turn') {
          for (const block of response.content) {
            if (block.type === 'text') {
              finalResult += block.text;
            }
          }
          break;
        }

        // Handle tool calls
        if (response.stop_reason === 'tool_use') {
          messages.push({ role: 'assistant', content: response.content });
          const toolResultContent: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type === 'tool_use' && block.name === 'web_search') {
              const searchQuery = (block.input as { query: string }).query;

              if (toolCallCount < maxToolCalls) {
                toolCallCount++;
                yield {
                  type: 'raw',
                  content: `Searching: "${searchQuery}"`,
                  timestamp: new Date(),
                  raw: { type: 'tool_use', tool: 'web_search', query: searchQuery }
                };

                const searchResult = await braveWebSearch(searchQuery);
                toolResultContent.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: searchResult
                });
              } else {
                toolResultContent.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: 'Enough research gathered. Please proceed with the analysis.'
                });
              }
            }
          }

          messages.push({ role: 'user', content: toolResultContent });
        } else {
          // Unexpected stop reason
          for (const block of response.content) {
            if (block.type === 'text') {
              finalResult += block.text;
            }
          }
          break;
        }
      }

      // Yield final result
      yield {
        type: 'result',
        content: finalResult,
        timestamp: new Date()
      };
    } catch (error) {
      // Yield error so it's sent to the client
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error during analysis',
        timestamp: new Date(),
        raw: { error: error instanceof Error ? error.stack : String(error) }
      };
    }
  })();
}

/**
 * Analyze interview and collect all results (non-streaming version)
 */
export async function analyzeInterviewSync(
  transcript: string,
  options: AnalysisOptions = { interviewType: 'generic' }
): Promise<string> {
  const generator = await analyzeInterview(transcript, options);

  // Only the result messages carry the evaluation. The generator also yields
  // progress traffic - raw SDK events, tool calls and reasoning summaries -
  // which is useful for the live log but must never be concatenated into the
  // returned analysis. Summing every message is what produced output like
  // "[system:init][stream_event]Thinking through..." in the response body.
  let fullAnalysis = '';
  for await (const message of generator) {
    if (message.type === 'result' || message.type === 'text') {
      fullAnalysis += message.content;
    }
  }

  return fullAnalysis;
}
