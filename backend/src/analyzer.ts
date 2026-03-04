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

export interface AnalysisOptions {
  interviewType: string;  // Can be built-in types or custom admin-defined types
  cachedCriteria?: string;  // Pre-fetched interview criteria (from admin or web search)
  method?: AnalysisMethod;  // Which analysis method to use (default: agent-sdk)
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

  // Create the agent query
  const result = query({
    prompt,
    options: {
      // SDK-only mode (no filesystem access)
      settingSources: [],
      // Increase max turns for more complex analysis
      maxTurns: 20,
      // Bypass all permission checks - allow all tools
      permissionMode: 'bypassPermissions',
      // Enable debug logging and stderr capture
      env: {
        ...process.env,
        DEBUG: '1'
      },
      stderr: (data) => {
        console.error('[Claude CLI stderr]:', data.toString());
      }
    }
  });

  // Return an async generator that yields messages
  return (async function* () {
    let messageCount = 0;

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
            if (block.type === 'text' && block.text) {
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
        // Stream events (partial updates)
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event?.delta?.text) {
          // We could accumulate these but they're often noisy
          // For now, just note that streaming is happening
          yield {
            type: 'raw',
            content: `[Streaming...]`,
            timestamp: new Date(),
            raw: { type: 'stream_delta', text: event.delta.text }
          };
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

        const response = await getAnthropicClient().messages.create({
          model: 'claude-opus-4-5-20251101',
          max_tokens: 8000,
          tools: cachedCriteria ? undefined : [webSearchTool], // Only provide tool if no cache
          messages
        });

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

  let fullAnalysis = '';
  for await (const message of generator) {
    fullAnalysis += message.content;
  }

  return fullAnalysis;
}
