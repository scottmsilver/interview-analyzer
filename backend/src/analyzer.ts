/**
 * Core interview analysis logic using Claude Agent SDK
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

export interface AnalysisOptions {
  interviewType: 'google-apm' | 'meta-pm' | 'amazon-pm' | 'generic';
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
function buildAnalysisPrompt(transcript: string, interviewType: string): string {
  const prompts: Record<string, string> = {
    'google-apm': `You are an expert Google APM (Associate Product Manager) interviewer with 10+ years of experience.

EVALUATION CRITERIA FOR GOOGLE APM:
- Product Sense: User focus, creativity, prioritization, strategic alignment with company goals
- Analytical Thinking: Metrics definition, A/B testing, data-driven decisions, SQL/analytics
- Communication: Structure, pacing, clarity, checking in with interviewer every 45-60 seconds
- Technical Depth: Understanding of AI/ML, system design, feasibility, working with engineers
- Strategic Thinking: Business impact, competitive analysis, ecosystem effects
- "Googleyness": User-first thinking, collaboration, handling ambiguity

TASK - MULTI-STEP WORKFLOW:
1. **Research Current Standards**: Web search for "Google APM interview evaluation criteria 2025" to understand the current bar
2. **Parse Transcript**: Identify each distinct question asked and the candidate's response
3. **Evaluate Each Question**: For each question, provide:
   - Question type (product design, strategic insights, analytical, etc.)
   - Overall score out of 10
   - Structure quality (did they state their framework upfront?)
   - Key strengths with specific timestamps (format: HH:MM:SS)
   - Critical weaknesses with specific timestamps
   - What they missed or should have done differently
   - Comparison to what a strong Google APM candidate would do

4. **Overall Assessment**: Provide:
   - Overall interview score out of 10
   - Would they pass the Google APM bar? (Yes/No/Borderline)
   - Top 3 strengths across the entire interview
   - Top 3 critical weaknesses
   - Talk-to-listen ratio estimate (should be ~60:40)

5. **Actionable Recommendations**: Provide 5-7 specific, actionable recommendations for improvement

6. **Self-Review**: Before outputting, verify:
   - Did I provide specific timestamps for key moments?
   - Did I compare to actual Google standards?
   - Did I give concrete examples, not just generic feedback?
   - Are my recommendations actionable?

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

Be direct, specific, and constructive. This is for learning, so honest feedback is most valuable.`,

    'meta-pm': `You are an expert Meta PM interviewer with deep knowledge of Meta's interview process.

EVALUATION CRITERIA FOR META PM:
- Product Sense: User empathy, feature prioritization, Meta's mission alignment
- Execution: Roadmapping, tradeoffs, working with cross-functional teams
- Analytics: Metrics trees, debugging metrics drops, experimentation
- Leadership: Influence without authority, conflict resolution
- Strategy: Vision, competitive positioning, business model understanding

Follow the same multi-step workflow as above, but adjusted for Meta's specific criteria.

TRANSCRIPT:
${transcript}`,

    'amazon-pm': `You are an expert Amazon PM interviewer familiar with Amazon's Leadership Principles.

EVALUATION CRITERIA FOR AMAZON PM:
- Customer Obsession: Starting with the customer and working backwards
- Leadership Principles: Ownership, Bias for Action, Think Big, Dive Deep, etc.
- Working Backwards: PRD/Press Release approach
- Metrics: Input vs Output metrics, mechanisms for driving results
- Technical Depth: SQL, APIs, system design basics

Follow the same multi-step workflow as above, but evaluate through the lens of Amazon Leadership Principles.

TRANSCRIPT:
${transcript}`,

    'generic': `You are an expert Product Manager interviewer with experience at top tech companies.

EVALUATION CRITERIA:
- Product Thinking: User focus, problem definition, solution creativity
- Analytical Skills: Metrics, data analysis, hypothesis testing
- Communication: Structure, clarity, conciseness
- Strategic Thinking: Business impact, prioritization
- Execution: Practical considerations, feasibility

Follow the same multi-step workflow as above.

TRANSCRIPT:
${transcript}`
  };

  return prompts[interviewType] || prompts['generic'];
}

/**
 * Analyze an interview transcript using Claude Agent SDK
 */
export async function analyzeInterview(
  transcript: string,
  options: AnalysisOptions = { interviewType: 'google-apm' }
): Promise<AsyncGenerator<AnalysisMessage>> {
  const prompt = buildAnalysisPrompt(transcript, options.interviewType);

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
 * Analyze interview and collect all results (non-streaming version)
 */
export async function analyzeInterviewSync(
  transcript: string,
  options: AnalysisOptions = { interviewType: 'google-apm' }
): Promise<string> {
  const generator = await analyzeInterview(transcript, options);

  let fullAnalysis = '';
  for await (const message of generator) {
    fullAnalysis += message.content;
  }

  return fullAnalysis;
}
