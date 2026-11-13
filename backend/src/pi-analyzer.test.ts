import * as http from 'node:http';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { collectAnalysisSync } from './analyzer.js';
import { parseCliArgs, validateBakeoffEnvironment } from './bakeoff.js';
import { analyzeInterviewPi, type PiRunTelemetry } from './pi-analyzer.js';
import {
  createPiModel,
  createPiStreamFn,
  normalizePiBaseUrl,
  resolvePiApiMode,
} from './pi-llm.js';

const ENV_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_BASE_URL',
  'MANIFEST_AUTH_TYPE',
  'PI_LLM_API',
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

const activeServers: http.Server[] = [];

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  while (activeServers.length > 0) {
    const s = activeServers.pop()!;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function makeUsage(input = 100, output = 50) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

describe('pi-llm: Manifest URL normalization, mode resolution, and auth', () => {
  it('resolves apiMode and normalizes baseUrl for anthropic-messages vs openai-completions', () => {
    assert.equal(resolvePiApiMode('claude-opus-5'), 'anthropic-messages');
    assert.equal(resolvePiApiMode('gpt-5.4'), 'openai-completions');
    assert.equal(resolvePiApiMode('o3-mini'), 'openai-completions');
    assert.equal(resolvePiApiMode('o1'), 'openai-completions');
    assert.equal(resolvePiApiMode('o4-mini'), 'openai-completions');
    assert.equal(resolvePiApiMode('claude-opus-5', 'openai-completions'), 'openai-completions');

    assert.equal(
      normalizePiBaseUrl('https://router.example.com/v1/', 'anthropic-messages'),
      'https://router.example.com',
    );
    assert.equal(
      normalizePiBaseUrl('https://router.example.com', 'openai-completions'),
      'https://router.example.com/v1',
    );
    assert.equal(
      normalizePiBaseUrl('https://router.example.com/v1', 'openai-completions'),
      'https://router.example.com/v1',
    );

    const oaModel = createPiModel('https://router.example.com', 'gpt-5.4');
    assert.equal(oaModel.api, 'openai-completions');
    assert.equal(oaModel.baseUrl, 'https://router.example.com/v1');
  });

  it('uses Bearer auth without x-api-key in anthropic-messages mode when ANTHROPIC_AUTH_TOKEN is set and enables summarized thinking', async () => {
    let capturedHeaders: http.IncomingHttpHeaders = {};
    let capturedBody: Record<string, any> = {};

    const srv = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(
          `event: message_start\ndata: ${JSON.stringify({
            type: 'message_start',
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-5',
              content: [],
              stop_reason: null,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          })}\n\n`,
        );
        res.write(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          })}\n\n`,
        );
        res.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'OK' },
          })}\n\n`,
        );
        res.write(
          `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
        );
        res.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 2 },
          })}\n\n`,
        );
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
      });
    });
    activeServers.push(srv);
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as { port: number }).port;

    process.env.ANTHROPIC_AUTH_TOKEN = 'test-manifest-token';
    process.env.ANTHROPIC_API_KEY = 'should-never-be-sent';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.MANIFEST_AUTH_TYPE = 'subscription';

    const model = createPiModel(`http://127.0.0.1:${port}`, 'claude-opus-5', 'anthropic-messages');
    const streamFn = createPiStreamFn({ apiMode: 'anthropic-messages' });
    const stream = await streamFn(model, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }], timestamp: Date.now() }],
    } as Parameters<StreamFn>[1]);
    const finalMsg = await stream.result();
    assert.equal(finalMsg.stopReason, 'stop');
    assert.equal(capturedHeaders.authorization, 'Bearer test-manifest-token');
    assert.equal(capturedHeaders['x-api-key'], undefined);
    assert.equal(capturedHeaders['x-manifest-auth-type'], 'subscription');
    assert.equal(capturedBody.thinking?.display, 'summarized');
    assert.equal(capturedBody.output_config?.effort, 'high');
  });

  it('sends Bearer token and optional x-manifest-auth-type in openai-completions mode', async () => {
    let capturedHeaders: http.IncomingHttpHeaders = {};

    const srv = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      req.resume();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl_1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-5.4',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
    activeServers.push(srv);
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as { port: number }).port;

    process.env.ANTHROPIC_AUTH_TOKEN = 'test-manifest-token';
    process.env.MANIFEST_AUTH_TYPE = 'subscription';

    const model = createPiModel(`http://127.0.0.1:${port}`, 'gpt-5.4', 'openai-completions');
    const streamFn = createPiStreamFn({ apiMode: 'openai-completions' });
    const stream = await streamFn(model, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }], timestamp: Date.now() }],
    } as Parameters<StreamFn>[1]);
    const finalMsg = await stream.result();
    assert.equal(finalMsg.stopReason, 'stop');
    assert.equal(capturedHeaders.authorization, 'Bearer test-manifest-token');
    assert.equal(capturedHeaders['x-manifest-auth-type'], 'subscription');
  });
});

describe('pi-analyzer: streaming events, tool calls, intermediate text exclusion, Manifest errors', () => {
  it('excludes intermediate assistant text before tool calls from final result and emits telemetry', async () => {
    let callCount = 0;
    const mockStreamFn: StreamFn = (model) => {
      callCount += 1;
      const stream = new AssistantMessageEventStream();

      queueMicrotask(() => {
        if (callCount === 1) {
          const partial: AssistantMessage = {
            role: 'assistant',
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: makeUsage(120, 40),
            stopReason: 'toolUse',
            timestamp: Date.now(),
          };
          stream.push({ type: 'start', partial });
          partial.content.push({ type: 'thinking', thinking: '' });
          stream.push({ type: 'thinking_start', contentIndex: 0, partial });
          const thought = 'First I will inspect the rubric and transcript metrics carefully.';
          (partial.content[0] as any).thinking = thought;
          stream.push({ type: 'thinking_delta', contentIndex: 0, delta: thought, partial });
          stream.push({ type: 'thinking_end', contentIndex: 0, content: thought, partial });

          const narration = 'Let me inspect the transcript and load the rubric first.';
          partial.content.push({ type: 'text', text: narration });
          stream.push({ type: 'text_start', contentIndex: 1, partial });
          stream.push({ type: 'text_delta', contentIndex: 1, delta: narration, partial });
          stream.push({ type: 'text_end', contentIndex: 1, content: narration, partial });

          partial.content.push({
            type: 'toolCall',
            id: 'tc_1',
            name: 'analyze_transcript_metrics',
            arguments: {},
          });
          stream.push({ type: 'done', reason: 'toolUse', message: partial });
          return;
        }

        const finalMarkdown = '## Final Verified Evaluation\n\n### Question 1\n- Score: 8/10';
        const finalMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: finalMarkdown }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: makeUsage(200, 90),
          stopReason: 'stop',
          timestamp: Date.now(),
        };
        stream.push({ type: 'start', partial: finalMsg });
        stream.push({ type: 'done', reason: 'stop', message: finalMsg });
      });

      return stream;
    };

    const gen = await analyzeInterviewPi(
      'Interviewer: Design a feature.\nCandidate: Sure.',
      { interviewType: 'google-apm', model: 'gpt-5.4', allowUnlistedModel: true },
      mockStreamFn,
    );

    const events = [];
    for await (const ev of gen) {
      events.push(ev);
    }

    assert.equal(callCount, 2);
    assert.ok(events.some((e) => e.type === 'raw' && e.content.startsWith('Thinking: ')));
    assert.ok(events.some((e) => e.type === 'raw' && e.content === 'Using tool: analyze_transcript_metrics'));
    assert.ok(events.some((e) => e.type === 'raw' && e.content.startsWith('Tool completed: analyze_transcript_metrics')));
    assert.ok(
      events.some((e) => e.type === 'raw' && e.raw?.type === 'intermediate_text'),
      'Expected intermediate text to be routed to raw',
    );

    const telemetryEvent = events.find((e) => e.type === 'raw' && e.raw?.type === 'pi_telemetry');
    assert.ok(telemetryEvent);
    const telemetry = telemetryEvent.raw as PiRunTelemetry;
    assert.equal(telemetry.turns, 2);
    assert.equal(telemetry.toolCalls.length, 1);
    assert.equal(telemetry.usage.inputTokens, 320);
    assert.equal(telemetry.usage.outputTokens, 130);
    assert.equal(telemetry.model, 'gpt-5.4');
    assert.equal(telemetry.apiMode, 'openai-completions');

    const resultEvents = events.filter((e) => e.type === 'result');
    assert.equal(resultEvents.length, 1);
    assert.equal(resultEvents[0].content, '## Final Verified Evaluation\n\n### Question 1\n- Score: 8/10');
    assert.equal(resultEvents[0].content.includes('Let me inspect the transcript'), false);
  });

  it('rejects Manifest fake-200 error payloads as error instead of result', async () => {
    const manifestErrorStream: StreamFn = (model) => {
      const stream = new AssistantMessageEventStream();
      queueMicrotask(() => {
        const msg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: '[🦚 Manifest] Provider quota exhausted' }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: makeUsage(10, 5),
          stopReason: 'stop',
          timestamp: Date.now(),
        };
        stream.push({ type: 'start', partial: msg });
        stream.push({ type: 'done', reason: 'stop', message: msg });
      });
      return stream;
    };

    const gen = await analyzeInterviewPi(
      'Interviewer: Hello?\nCandidate: Hi.',
      { interviewType: 'generic' },
      manifestErrorStream,
    );
    await assert.rejects(() => collectAnalysisSync(gen), /Manifest router error:/);
  });
});

describe('bakeoff CLI guards', () => {
  it('refuses raw ANTHROPIC_API_KEY unless --allow-direct-key is passed', () => {
    process.env.ANTHROPIC_API_KEY = 'fake-direct-key';
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;

    assert.throws(() => validateBakeoffEnvironment(false), /--allow-direct-key/);
    assert.doesNotThrow(() => validateBakeoffEnvironment(true));

    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = 'fake-manifest-token';
    process.env.ANTHROPIC_BASE_URL = 'https://router.example.com';
    assert.doesNotThrow(() => validateBakeoffEnvironment(false));
  });

  it('parses --arms, --fixtures, --out-dir, and --allow-direct-key flags', () => {
    const parsed = parseCliArgs([
      '--arms=pi-agent-opus-5,pi-agent-gpt-5-4',
      '--fixtures',
      'fixture-b-realistic-apm',
      '--out-dir',
      '/tmp/bakeoff-out',
      '--allow-direct-key',
    ]);
    assert.deepEqual(parsed.armsFilter, ['pi-agent-opus-5', 'pi-agent-gpt-5-4']);
    assert.deepEqual(parsed.fixturesFilter, ['fixture-b-realistic-apm']);
    assert.equal(parsed.outDir, '/tmp/bakeoff-out');
    assert.equal(parsed.allowDirectKey, true);
  });
});
