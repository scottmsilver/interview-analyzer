#!/usr/bin/env npx tsx
/**
 * Compare Agent SDK vs Direct Claude API (with extended thinking and tools)
 *
 * Usage:
 *   npx tsx src/compare-methods.ts <transcript-file> [interview-type]
 *
 * Example:
 *   npx tsx src/compare-methods.ts ../sample-transcript.txt google-apm
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - Required for all methods
 *   BRAVE_API_KEY - Required for Direct API with web search tool
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic();

// Web search tool definition for Anthropic API
const webSearchTool: Anthropic.Tool = {
  name: 'web_search',
  description: 'Search the web for current information. Use this to research interview standards, evaluation criteria, and best practices.',
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
async function braveWebSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return 'Error: BRAVE_API_KEY not set. Cannot perform web search.';
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        }
      }
    );

    if (!response.ok) {
      return `Search failed: ${response.status} ${response.statusText}`;
    }

    const data = await response.json() as {
      web?: {
        results?: Array<{
          title: string;
          url: string;
          description: string;
        }>;
      };
    };

    if (!data.web?.results?.length) {
      return 'No search results found.';
    }

    // Format results for the model
    const results = data.web.results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.description}`
    ).join('\n\n');

    return `Search results for "${query}":\n\n${results}`;
  } catch (error) {
    return `Search error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

interface ComparisonResult {
  method: string;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  resultLength: number;
  result: string;
}

// Build the analysis prompt (same for both methods)
function buildPrompt(transcript: string, interviewType: string, cachedCriteria?: string): string {
  const criteriaSection = cachedCriteria
    ? `\nCURRENT INTERVIEW STANDARDS:\n${cachedCriteria}\n`
    : '';

  return `You are an expert ${interviewType.replace('-', ' ').toUpperCase()} interviewer with 10+ years of experience.

EVALUATION CRITERIA:
- Product Sense: User focus, creativity, prioritization, strategic alignment
- Analytical Thinking: Metrics definition, A/B testing, data-driven decisions
- Communication: Structure, pacing, clarity
- Technical Depth: System design, feasibility, working with engineers
- Strategic Thinking: Business impact, competitive analysis
${criteriaSection}
TASK:
1. Parse the transcript and identify each distinct question and response
2. Evaluate each question:
   - Question type (product design, analytical, strategic, etc.)
   - Score out of 10
   - Key strengths with timestamps (HH:MM:SS format)
   - Critical weaknesses with timestamps
   - What a strong candidate would do differently

3. Overall Assessment:
   - Overall interview score out of 10
   - Pass/Fail/Borderline verdict
   - Top 3 strengths
   - Top 3 weaknesses
   - Talk-to-listen ratio estimate

4. Provide 5-7 specific, actionable recommendations

TRANSCRIPT:
${transcript}

OUTPUT FORMAT:
Use clear markdown formatting with ## for sections, ### for subsections, **bold** for emphasis, \`code\` for timestamps.
Be direct, specific, and constructive.`;
}

// Method 1: Agent SDK (current approach)
async function runAgentSDK(transcript: string, interviewType: string): Promise<ComparisonResult> {
  console.log('\n🤖 Running Agent SDK method...');
  const startTime = Date.now();

  const prompt = `You are an expert interview analyzer. Research current ${interviewType} interview standards, then analyze this transcript:

${transcript}

Provide:
1. Per-question evaluation with scores and timestamps
2. Overall assessment (score, pass/fail, strengths, weaknesses)
3. 5-7 actionable recommendations

Use markdown formatting.`;

  const result = query({
    prompt,
    options: {
      settingSources: [],
      maxTurns: 10,
      permissionMode: 'bypassPermissions',
    }
  });

  let finalResult = '';
  for await (const message of result) {
    if (message.type === 'result' && message.subtype === 'success' && message.result) {
      finalResult = message.result;
      break;
    }
  }

  const duration = Date.now() - startTime;

  return {
    method: 'Agent SDK',
    duration,
    inputTokens: 0, // Agent SDK doesn't expose token counts easily
    outputTokens: 0,
    resultLength: finalResult.length,
    result: finalResult
  };
}

// Method 2: Direct Claude API with extended thinking (using streaming for long operations)
async function runDirectAPI(transcript: string, interviewType: string, thinkingBudget: number = 10000): Promise<ComparisonResult> {
  console.log(`\n🧠 Running Direct API with ${thinkingBudget} thinking tokens...`);
  const startTime = Date.now();

  const prompt = buildPrompt(transcript, interviewType);

  // max_tokens must be greater than thinking budget
  const maxTokens = Math.max(thinkingBudget + 8000, 20000);

  // Use streaming to handle long-running operations
  const stream = anthropic.messages.stream({
    model: 'claude-opus-4-5-20251101',
    max_tokens: maxTokens,
    thinking: {
      type: 'enabled',
      budget_tokens: thinkingBudget
    },
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  // Collect the final message from stream
  const response = await stream.finalMessage();

  const duration = Date.now() - startTime;

  // Extract text and thinking from response
  let resultText = '';
  let thinkingTokens = 0;

  for (const block of response.content) {
    if (block.type === 'text') {
      resultText += block.text;
    } else if (block.type === 'thinking') {
      thinkingTokens = block.thinking?.length || 0; // Approximate
    }
  }

  return {
    method: `Direct API (thinking: ${thinkingBudget})`,
    duration,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    thinkingTokens,
    resultLength: resultText.length,
    result: resultText
  };
}

// Method 3: Direct Claude API without extended thinking (baseline)
async function runDirectAPINoThinking(transcript: string, interviewType: string): Promise<ComparisonResult> {
  console.log('\n📝 Running Direct API without extended thinking...');
  const startTime = Date.now();

  const prompt = buildPrompt(transcript, interviewType);

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const duration = Date.now() - startTime;

  let resultText = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      resultText += block.text;
    }
  }

  return {
    method: 'Direct API (no thinking)',
    duration,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    resultLength: resultText.length,
    result: resultText
  };
}

// Method 4: Direct Claude API with web search tool
async function runDirectAPIWithTools(transcript: string, interviewType: string): Promise<ComparisonResult> {
  console.log('\n🔍 Running Direct API with web search tool...');
  const startTime = Date.now();

  // Prompt that encourages using web search first
  const prompt = `You are an expert ${interviewType.replace('-', ' ').toUpperCase()} interviewer.

IMPORTANT: Before analyzing, use the web_search tool to research current ${interviewType} interview evaluation criteria and standards for 2025/2026.

After researching, analyze this transcript:

TRANSCRIPT:
${transcript}

PROVIDE:
1. Summary of current interview standards (from your research)
2. Per-question evaluation with scores and timestamps (HH:MM:SS format)
3. Overall assessment (score out of 10, Pass/Fail/Borderline verdict)
4. Top 3 strengths and weaknesses
5. 5-7 specific, actionable recommendations

Use markdown formatting.`;

  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt }
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalResult = '';
  let toolCallCount = 0;
  const maxToolCalls = 3; // Limit searches, but always allow final response

  // Tool use loop - continues until model stops using tools
  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 8000,
      tools: [webSearchTool],
      messages
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Check if we're done (no more tool calls)
    if (response.stop_reason === 'end_turn') {
      // Extract final text
      for (const block of response.content) {
        if (block.type === 'text') {
          finalResult += block.text;
        }
      }
      break;
    }

    // Handle tool calls
    if (response.stop_reason === 'tool_use') {
      // Add assistant's response to messages
      messages.push({ role: 'assistant', content: response.content });

      // Process each tool call
      const toolResultContent: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use' && block.name === 'web_search') {
          const searchQuery = (block.input as { query: string }).query;

          // Either perform search or return "enough searches" message
          if (toolCallCount < maxToolCalls) {
            toolCallCount++;
            console.log(`   🔎 Search ${toolCallCount}: "${searchQuery}"`);
            const searchResult = await braveWebSearch(searchQuery);
            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: searchResult
            });
          } else {
            console.log(`   ⏭️  Skipping search (limit reached): "${searchQuery}"`);
            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: 'You have gathered enough information from previous searches. Please proceed with the analysis based on the research you have already done.'
            });
          }
        }
      }

      // Add tool results to messages
      messages.push({ role: 'user', content: toolResultContent });
    } else {
      // Unexpected stop reason, extract any text and break
      for (const block of response.content) {
        if (block.type === 'text') {
          finalResult += block.text;
        }
      }
      break;
    }
  }

  const duration = Date.now() - startTime;

  return {
    method: `Direct API + Web Search (${toolCallCount} searches)`,
    duration,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    resultLength: finalResult.length,
    result: finalResult
  };
}

// Main comparison function
async function compare(transcriptPath: string, interviewType: string = 'google-apm') {
  // Read transcript
  const transcript = fs.readFileSync(transcriptPath, 'utf-8');
  console.log(`\n📄 Loaded transcript: ${transcriptPath} (${transcript.length} chars)`);
  console.log(`📋 Interview type: ${interviewType}`);

  const results: ComparisonResult[] = [];

  // Run all methods
  try {
    // 1. Direct API without thinking (fastest baseline)
    results.push(await runDirectAPINoThinking(transcript, interviewType));
  } catch (e) {
    console.error('Direct API (no thinking) failed:', e);
  }

  try {
    // 2. Direct API with medium thinking budget
    results.push(await runDirectAPI(transcript, interviewType, 5000));
  } catch (e) {
    console.error('Direct API (5k thinking) failed:', e);
  }

  try {
    // 3. Direct API with high thinking budget
    results.push(await runDirectAPI(transcript, interviewType, 16000));
  } catch (e) {
    console.error('Direct API (16k thinking) failed:', e);
  }

  try {
    // 4. Direct API with web search tool (if BRAVE_API_KEY is set)
    if (process.env.BRAVE_API_KEY) {
      results.push(await runDirectAPIWithTools(transcript, interviewType));
    } else {
      console.log('\n⚠️  Skipping Direct API + Web Search (BRAVE_API_KEY not set)');
    }
  } catch (e) {
    console.error('Direct API + Web Search failed:', e);
  }

  try {
    // 5. Agent SDK (with web search capability)
    results.push(await runAgentSDK(transcript, interviewType));
  } catch (e) {
    console.error('Agent SDK failed:', e);
  }

  // Print comparison
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON RESULTS');
  console.log('='.repeat(80));

  console.log('\n📊 Summary:\n');
  console.log('| Method | Duration | Input Tokens | Output Tokens | Result Length |');
  console.log('|--------|----------|--------------|---------------|---------------|');

  for (const r of results) {
    const duration = `${(r.duration / 1000).toFixed(1)}s`;
    const input = r.inputTokens || 'N/A';
    const output = r.outputTokens || 'N/A';
    console.log(`| ${r.method.padEnd(30)} | ${duration.padStart(8)} | ${String(input).padStart(12)} | ${String(output).padStart(13)} | ${String(r.resultLength).padStart(13)} |`);
  }

  // Save results to files for manual comparison
  const outputDir = path.join(path.dirname(transcriptPath), 'comparison-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const r of results) {
    const filename = r.method.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
    const filepath = path.join(outputDir, filename);

    const header = `# ${r.method}\n\n` +
      `- Duration: ${(r.duration / 1000).toFixed(1)}s\n` +
      `- Input tokens: ${r.inputTokens || 'N/A'}\n` +
      `- Output tokens: ${r.outputTokens || 'N/A'}\n` +
      `- Result length: ${r.resultLength} chars\n\n` +
      `---\n\n`;

    fs.writeFileSync(filepath, header + r.result);
    console.log(`\n💾 Saved: ${filepath}`);
  }

  console.log(`\n✅ Results saved to: ${outputDir}`);
  console.log('\nReview the files to compare analysis quality.');
}

// CLI
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: npx tsx src/compare-methods.ts <transcript-file> [interview-type]');
  console.log('');
  console.log('Example:');
  console.log('  npx tsx src/compare-methods.ts ../sample-transcript.txt google-apm');
  process.exit(1);
}

const transcriptPath = args[0];
const interviewType = args[1] || 'google-apm';

if (!fs.existsSync(transcriptPath)) {
  console.error(`Error: File not found: ${transcriptPath}`);
  process.exit(1);
}

compare(transcriptPath, interviewType).catch(console.error);
