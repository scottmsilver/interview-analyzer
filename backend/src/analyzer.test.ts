import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ANTHROPIC_MODELS,
  analyzeInterview,
  analyzeInterviewDirectAPI,
  analyzeInterviewSync,
  buildAgentEnv,
  collectAnalysisSync,
  createAnthropicClient,
  detectManifestError,
  getAnthropicModel,
  hasLlmCredentials,
  isThinkingUnsupportedError
} from './analyzer.js';

const ENV_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'MANIFEST_AUTH_TYPE',
  'BRAVE_API_KEY',
  'ADMIN_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT_JSON'
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

afterEach(() => {
  restoreEnv();
});

describe('analyzer credentials and client setup', () => {
  it('hasLlmCredentials reflects ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY', () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(hasLlmCredentials(), false);

    process.env.ANTHROPIC_AUTH_TOKEN = 'token-placeholder';
    assert.equal(hasLlmCredentials(), true);

    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'key-placeholder';
    assert.equal(hasLlmCredentials(), true);
  });

  it('createAnthropicClient uses bearer auth with apiKey: null when ANTHROPIC_AUTH_TOKEN is set', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'mnfst-test-token';
    process.env.ANTHROPIC_API_KEY = 'should-not-be-used';
    process.env.ANTHROPIC_BASE_URL = 'https://router.example.com';
    process.env.MANIFEST_AUTH_TYPE = 'subscription';

    const client = createAnthropicClient() as any;
    assert.equal(client.authToken, 'mnfst-test-token');
    assert.equal(client.apiKey, null);
    assert.equal(client.baseURL, 'https://router.example.com');
    assert.equal(client._options.defaultHeaders['x-manifest-auth-type'], 'subscription');
  });

  it('createAnthropicClient uses apiKey when ANTHROPIC_AUTH_TOKEN is unset', () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.MANIFEST_AUTH_TYPE;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.com';

    const client = createAnthropicClient() as any;
    assert.equal(client.apiKey, 'sk-ant-test-key');
    assert.equal(client.authToken, null);
    assert.equal(client.baseURL, 'https://api.example.com');
  });
});

describe('buildAgentEnv', () => {
  it('forwards ANTHROPIC_AUTH_TOKEN without ANTHROPIC_API_KEY and strips server secrets', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'mnfst-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    process.env.ANTHROPIC_BASE_URL = 'https://router.example.com';
    process.env.BRAVE_API_KEY = 'brave-secret';
    process.env.ADMIN_API_KEY = 'admin-secret';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"private_key":"secret"}';

    const env = buildAgentEnv('auto');
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'mnfst-token');
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://router.example.com');
    assert.equal(env.ANTHROPIC_MODEL, 'auto');
    assert.equal(env.BRAVE_API_KEY, undefined);
    assert.equal(env.ADMIN_API_KEY, undefined);
    assert.equal(env.FIREBASE_SERVICE_ACCOUNT_JSON, undefined);
  });

  it('forwards ANTHROPIC_API_KEY when ANTHROPIC_AUTH_TOKEN is not set', () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-key';
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.com';

    const env = buildAgentEnv('claude-opus-5');
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-key');
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.example.com');
    assert.equal(env.ANTHROPIC_MODEL, 'claude-opus-5');
  });
});

describe('getAnthropicModel', () => {
  it('defaults to auto when ANTHROPIC_AUTH_TOKEN is set and ANTHROPIC_MODEL is unset', () => {
    delete process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_AUTH_TOKEN = 'mnfst-token';
    assert.equal(getAnthropicModel(), 'auto');
  });

  it('defaults to claude-opus-5 when neither ANTHROPIC_MODEL nor ANTHROPIC_AUTH_TOKEN is set', () => {
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    assert.equal(getAnthropicModel(), 'claude-opus-5');
  });

  it('accepts all expanded ALLOWED_ANTHROPIC_MODELS and rejects unknown overrides', () => {
    const expected = [
      'auto',
      'claude-opus-5',
      'claude-opus-5-5',
      'claude-sonnet-5',
      'claude-sonnet-5-5',
      'claude-haiku-4-5',
      'claude-haiku-5-5'
    ];
    for (const model of expected) {
      assert.equal(ALLOWED_ANTHROPIC_MODELS.has(model), true);
      assert.equal(getAnthropicModel(model), model);
    }

    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    assert.equal(getAnthropicModel('unsupported-expensive-model'), 'claude-opus-5');
  });
});

describe('Manifest error detection and thinking fallback', () => {
  it('detectManifestError detects [🦚 Manifest payloads', () => {
    assert.equal(detectManifestError('## Evaluation\nGreat structure'), null);
    assert.equal(
      detectManifestError('  [🦚 Manifest] No healthy provider available'),
      'Manifest router error: [🦚 Manifest] No healthy provider available'
    );
  });

  it('isThinkingUnsupportedError detects 400 errors mentioning thinking', () => {
    assert.equal(
      isThinkingUnsupportedError({ status: 400, message: 'thinking is not supported by this model' }),
      true
    );
    assert.equal(
      isThinkingUnsupportedError({ status: 500, message: 'thinking failed' }),
      false
    );
    assert.equal(
      isThinkingUnsupportedError({ status: 400, message: 'invalid max_tokens' }),
      false
    );
  });

  it('analyzeInterview treats Manifest payload in result as error instead of result', async () => {
    const fakeQuery = (() =>
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: '[🦚 Manifest] Upstream provider quota exceeded'
        } as any;
      })()) as any;

    const gen = await analyzeInterview('Candidate spoke well.', { interviewType: 'generic' }, fakeQuery);
    const messages = [];
    for await (const msg of gen) {
      messages.push(msg);
    }

    assert.equal(messages.some((m) => m.type === 'result'), false);
    const errMsg = messages.find((m) => m.type === 'error');
    assert.ok(errMsg);
    assert.match(errMsg.content, /^Manifest router error: \[🦚 Manifest/);
  });

  it('analyzeInterviewSync throws on Manifest payload', async () => {
    const fakeQuery = (() =>
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: '[🦚 Manifest] Router error'
        } as any;
      })()) as any;

    await assert.rejects(
      () => analyzeInterviewSync('Transcript', { interviewType: 'generic' }, fakeQuery),
      /Manifest router error:/
    );

    const fakeGen = (async function* () {
      yield { type: 'text', content: '[🦚 Manifest] Stream error', timestamp: new Date() };
    })();
    await assert.rejects(() => collectAnalysisSync(fakeGen), /Manifest router error:/);
  });

  it('analyzeInterviewDirectAPI retries once without thinking on 400 and detects Manifest errors', async () => {
    const seenParams: any[] = [];
    const fakeClient = {
      messages: {
        stream: (params: any) => {
          seenParams.push(params);
          if (seenParams.length === 1) {
            return {
              async *[Symbol.asyncIterator]() {
                throw Object.assign(new Error('400 {"error":{"message":"thinking parameter not supported"}}'), {
                  status: 400
                });
              },
              finalMessage: async () => {
                throw new Error('unreachable');
              }
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: '## Good interview' }
              };
            },
            finalMessage: async () => ({
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: '## Good interview' }]
            })
          };
        }
      }
    } as any;

    const gen = await analyzeInterviewDirectAPI(
      'Transcript text',
      { interviewType: 'generic', cachedCriteria: 'Evaluate clarity.' },
      fakeClient
    );
    const events = [];
    for await (const ev of gen) {
      events.push(ev);
    }

    assert.equal(seenParams.length, 2);
    assert.ok(seenParams[0].thinking);
    assert.equal(seenParams[1].thinking, undefined);
    const resultEvent = events.find((e) => e.type === 'result');
    assert.equal(resultEvent?.content, '## Good interview');

    // Now verify Direct API rejects [🦚 Manifest payload as error
    const manifestClient = {
      messages: {
        stream: () => ({
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => ({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '[🦚 Manifest] Auth failed' }]
          })
        })
      }
    } as any;

    const errGen = await analyzeInterviewDirectAPI(
      'Transcript text',
      { interviewType: 'generic', cachedCriteria: 'Evaluate clarity.' },
      manifestClient
    );
    const errEvents = [];
    for await (const ev of errGen) {
      errEvents.push(ev);
    }
    assert.equal(errEvents.some((e) => e.type === 'result'), false);
    const err = errEvents.find((e) => e.type === 'error');
    assert.ok(err);
    assert.match(err.content, /^Manifest router error: \[🦚 Manifest/);
  });
});
