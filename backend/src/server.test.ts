import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createApp,
  getClientIp,
  isValidAdminKey,
  SlidingWindowRateLimiter
} from './server.js';

const activeServers: http.Server[] = [];

async function startTestServer(app: ReturnType<typeof createApp>): Promise<string> {
  const server = http.createServer(app);
  activeServers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, 'localhost', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Unexpected server address');
  }
  return `http://localhost:${addr.port}`;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop()!;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});

describe('admin key and client IP helpers', () => {
  it('isValidAdminKey performs timing-safe validation and rejects malformed inputs', () => {
    assert.equal(isValidAdminKey('secret-key-123', 'secret-key-123'), true);
    assert.equal(isValidAdminKey('secret-key-124', 'secret-key-123'), false);
    assert.equal(isValidAdminKey('short', 'secret-key-123'), false);
    assert.equal(isValidAdminKey('', 'secret-key-123'), false);
    assert.equal(isValidAdminKey(undefined, 'secret-key-123'), false);
    assert.equal(isValidAdminKey(['secret-key-123'], 'secret-key-123'), false);
    assert.equal(isValidAdminKey('secret-key-123', undefined), false);
  });

  it('getClientIp honors CF-Connecting-IP and X-Forwarded-For only from trusted loopback proxies or when TRUST_PROXY=true', () => {
    const prevTrustProxy = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    try {
      for (const loopback of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        assert.equal(
          getClientIp({
            headers: {
              'cf-connecting-ip': '2001:db8::cafe',
              'x-forwarded-for': '2001:db8::1, 2001:db8::2'
            },
            ip: loopback,
            socket: { remoteAddress: loopback } as any
          }),
          '2001:db8::cafe'
        );

        assert.equal(
          getClientIp({
            headers: {
              'x-forwarded-for': ' 2001:db8::1 , 2001:db8::2 '
            },
            ip: loopback,
            socket: { remoteAddress: loopback } as any
          }),
          '2001:db8::1'
        );

        assert.equal(
          getClientIp({
            headers: {},
            ip: loopback,
            socket: { remoteAddress: loopback } as any
          }),
          loopback
        );
      }

      // Untrusted public remote IP must ignore spoofed forwarding headers
      assert.equal(
        getClientIp({
          headers: {
            'cf-connecting-ip': '2001:db8::cafe',
            'x-forwarded-for': '2001:db8::1, 2001:db8::2'
          },
          ip: '198.51.100.42',
          socket: { remoteAddress: '198.51.100.42' } as any
        }),
        '198.51.100.42'
      );

      // Missing remoteAddress is untrusted by default
      assert.equal(
        getClientIp({
          headers: {
            'cf-connecting-ip': '2001:db8::cafe',
            'x-forwarded-for': '2001:db8::1'
          },
          ip: '::1',
          socket: {} as any
        }),
        '::1'
      );

      // TRUST_PROXY=true trusts forwarding headers even from a non-loopback proxy IP
      process.env.TRUST_PROXY = 'true';
      assert.equal(
        getClientIp({
          headers: {
            'cf-connecting-ip': '203.0.113.9',
            'x-forwarded-for': '198.51.100.1'
          },
          ip: '10.0.0.5',
          socket: { remoteAddress: '10.0.0.5' } as any
        }),
        '203.0.113.9'
      );
    } finally {
      if (prevTrustProxy === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prevTrustProxy;
    }
  });
});

describe('SlidingWindowRateLimiter', () => {
  it('blocks requests exceeding the window limit with 429 and Retry-After', async () => {
    const prevToken = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
    try {
      const limiter = new SlidingWindowRateLimiter(60_000, 2, () => 'client-a');
      const app = createApp({
        analyzeRateLimiter: limiter.middleware,
        requireApprovedUser: (_req, _res, next) => next()
      });
      const baseUrl = await startTestServer(app);

      // Hit /api/analyze (missing file -> 400) twice, 3rd hit should be 429 before multer
      const r1 = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });
      const r2 = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });
      const r3 = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });

      assert.equal(r1.status, 400);
      assert.equal(r2.status, 400);
      assert.equal(r3.status, 429);
      assert.ok(Number(r3.headers.get('retry-after')) >= 1);
    } finally {
      if (prevToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = prevToken;
    }
  });
});

describe('analyze input validation', () => {
  it('rejects invalid interviewType and oversized cachedCriteria with 400', async () => {
    const prevToken = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
    try {
      const app = createApp({
        requireApprovedUser: (req, _res, next) => {
          req.user = { uid: 'test-uid', email: 'user@example.com' };
          next();
        }
      });
      const baseUrl = await startTestServer(app);

      const formBadType = new FormData();
      formBadType.append('transcript', new Blob(['Candidate answer'], { type: 'text/plain' }), 'test.txt');
      formBadType.append('interviewType', 'bad;injection');

      const r1 = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        body: formBadType
      });
      assert.equal(r1.status, 400);

      const formLargeCriteria = new FormData();
      formLargeCriteria.append('transcript', new Blob(['Candidate answer'], { type: 'text/plain' }), 'test.txt');
      formLargeCriteria.append('interviewType', 'google-apm');
      formLargeCriteria.append('cachedCriteria', 'x'.repeat(50 * 1024 + 1));

      const r2 = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        body: formLargeCriteria
      });
      assert.equal(r2.status, 400);

      const formBadMethod = new FormData();
      formBadMethod.append('transcript', new Blob(['Candidate answer'], { type: 'text/plain' }), 'test.txt');
      formBadMethod.append('interviewType', 'google-apm');
      formBadMethod.append('method', 'unknown-method');

      const r3 = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        body: formBadMethod
      });
      assert.equal(r3.status, 400);

      const formBadStreamMethod = new FormData();
      formBadStreamMethod.append('transcript', new Blob(['Candidate answer'], { type: 'text/plain' }), 'test.txt');
      formBadStreamMethod.append('interviewType', 'google-apm');
      formBadStreamMethod.append('method', 'unknown-method');

      const r4 = await fetch(`${baseUrl}/api/analyze/stream`, {
        method: 'POST',
        body: formBadStreamMethod
      });
      assert.equal(r4.status, 400);
    } finally {
      if (prevToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = prevToken;
    }
  });

  it('recognizes OpenAI-only credentials for pi-agent while rejecting direct-api with 500', async () => {
    const prevAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    const prevOpenAiKey = process.env.OPENAI_API_KEY;
    const prevPiApi = process.env.PI_LLM_API;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.PI_LLM_API = 'openai-completions';

    try {
      const app = createApp({
        requireApprovedUser: (req, _res, next) => {
          req.user = { uid: 'test-uid', email: 'user@example.com' };
          next();
        }
      });
      const baseUrl = await startTestServer(app);

      const directForm = new FormData();
      directForm.append('method', 'direct-api');
      const rDirect = await fetch(`${baseUrl}/api/analyze`, { method: 'POST', body: directForm });
      assert.equal(rDirect.status, 500);

      // pi-agent passes credential preflight and proceeds to file validation (400 missing file)
      const piForm = new FormData();
      piForm.append('method', 'pi-agent');
      const rPi = await fetch(`${baseUrl}/api/analyze`, { method: 'POST', body: piForm });
      assert.equal(rPi.status, 400);

      const piStreamForm = new FormData();
      piStreamForm.append('method', 'pi-agent');
      const rPiStream = await fetch(`${baseUrl}/api/analyze/stream`, { method: 'POST', body: piStreamForm });
      assert.equal(rPiStream.status, 400);
    } finally {
      if (prevAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = prevAuthToken;
      if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevApiKey;
      if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAiKey;
      if (prevPiApi === undefined) delete process.env.PI_LLM_API;
      else process.env.PI_LLM_API = prevPiApi;
    }
  });
});

describe('security headers, auth enforcement, and static SPA serving', () => {
  it('sets required security headers including COOP same-origin-allow-popups', async () => {
    const app = createApp();
    const baseUrl = await startTestServer(app);

    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  });

  it('rejects unauthenticated requests on /api/analyze and /api/analyze/stream', async () => {
    const app = createApp();
    const baseUrl = await startTestServer(app);

    const r1 = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });
    const r2 = await fetch(`${baseUrl}/api/analyze/stream`, { method: 'POST' });
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
  });

  it('allows same-origin POST matching Host without ALLOWED_ORIGINS while rejecting untrusted cross-origin requests', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowedOrigins = process.env.ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOWED_ORIGINS;

    try {
      const app = createApp();
      const baseUrl = await startTestServer(app);
      const parsed = new URL(baseUrl);

      // Same-origin POST (e.g. combined static/Docker deployment on non-allowlisted port)
      const sameOriginRes = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        headers: {
          Origin: `http://${parsed.host}`,
        },
      });
      // Passes CORS and reaches auth middleware (401)
      assert.equal(sameOriginRes.status, 401);
      assert.equal(sameOriginRes.headers.get('access-control-allow-origin'), `http://${parsed.host}`);

      // Untrusted cross-origin POST is rejected by CORS (500)
      const crossOriginRes = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        headers: {
          Origin: 'https://untrusted.example.com',
        },
      });
      assert.equal(crossOriginRes.status, 500);
      assert.equal(crossOriginRes.headers.get('access-control-allow-origin'), null);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = prevAllowedOrigins;
    }
  });

  it('serves static assets with immutable caching and index.html SPA fallback with no-cache', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-static-test-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'assets'));
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>');
      fs.writeFileSync(path.join(tmpDir, 'assets', 'app-123.js'), 'console.log("ok");');

      const app = createApp({ staticDir: tmpDir });
      const baseUrl = await startTestServer(app);

      const assetRes = await fetch(`${baseUrl}/assets/app-123.js`);
      assert.equal(assetRes.status, 200);
      assert.equal(assetRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');

      const rootRes = await fetch(`${baseUrl}/`);
      assert.equal(rootRes.status, 200);
      assert.equal(rootRes.headers.get('cache-control'), 'no-cache');
      assert.match(await rootRes.text(), /SPA/);

      const spaRouteRes = await fetch(`${baseUrl}/share/abc12345`);
      assert.equal(spaRouteRes.status, 200);
      assert.equal(spaRouteRes.headers.get('cache-control'), 'no-cache');
      assert.match(await spaRouteRes.text(), /SPA/);

      const missingAssetRes = await fetch(`${baseUrl}/assets/missing.js`);
      assert.equal(missingAssetRes.status, 404);

      const missingApiRes = await fetch(`${baseUrl}/api/nonexistent`);
      assert.equal(missingApiRes.status, 404);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/shared/:shareId', () => {
  function createFakeAnalysesDb(records: Record<string, Record<string, any>>) {
    return {
      collection(name: string) {
        assert.equal(name, 'analyses');
        return {
          where(field: string, _op: string, value: string) {
            assert.equal(field, 'shareId');
            return {
              limit() {
                return {
                  async get() {
                    const doc = records[value];
                    if (!doc) {
                      return { empty: true, docs: [] };
                    }
                    return {
                      empty: false,
                      docs: [{ data: () => doc }]
                    };
                  }
                };
              }
            };
          }
        };
      }
    } as any;
  }

  const fakeRecords: Record<string, Record<string, any>> = {
    private1234: {
      userId: 'owner-uid',
      title: 'Private Interview',
      interviewType: 'google-apm',
      transcriptFileName: 't.txt',
      transcriptContent: 'SECRET TRANSCRIPT',
      analysis: '## Result',
      shareMode: 'private',
      sharedWith: ['friend@example.com']
    },
    anyone12345: {
      userId: 'owner-uid',
      title: 'Public Share',
      interviewType: 'google-apm',
      transcriptFileName: 't.txt',
      transcriptContent: 'SECRET TRANSCRIPT',
      analysis: '## Public Result',
      shareMode: 'anyone',
      sharedWith: ['friend@example.com'],
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    specific123: {
      userId: 'owner-uid',
      title: 'Specific Share',
      interviewType: 'meta-pm',
      transcriptFileName: 'meta.txt',
      transcriptContent: 'SECRET TRANSCRIPT',
      analysis: '## Specific Result',
      shareMode: 'specific',
      // Deliberately omit owner email from sharedWith to test owner uid authorization
      sharedWith: ['Recipient@Example.COM'],
      createdAt: '2026-01-02T00:00:00.000Z',
      savedAt: '2026-01-02T00:01:00.000Z'
    }
  };

  function makeSharedApp() {
    return createApp({
      isFirebaseConfigured: () => true,
      getDb: () => createFakeAnalysesDb(fakeRecords),
      optionalVerifiedUser: async (req) => {
        const token = req.headers.authorization;
        if (token === 'Bearer owner-token') {
          return { uid: 'owner-uid', email: 'owner@example.com' };
        }
        if (token === 'Bearer recipient-token') {
          return { uid: 'recipient-uid', email: 'recipient@example.com' };
        }
        if (token === 'Bearer stranger-token') {
          return { uid: 'stranger-uid', email: 'stranger@example.com' };
        }
        return null;
      }
    });
  }

  it('validates shareId format, handles 404, 403 private, and 200 anyone without leaking sensitive fields', async () => {
    const baseUrl = await startTestServer(makeSharedApp());

    const invalidRes = await fetch(`${baseUrl}/api/shared/bad`);
    assert.equal(invalidRes.status, 400);

    const missingRes = await fetch(`${baseUrl}/api/shared/nonexistent1234`);
    assert.equal(missingRes.status, 404);
    assert.equal((await missingRes.json() as any).code, 'NOT_FOUND');

    const privateRes = await fetch(`${baseUrl}/api/shared/private1234`);
    assert.equal(privateRes.status, 403);
    assert.equal((await privateRes.json() as any).code, 'PRIVATE');

    const anyoneRes = await fetch(`${baseUrl}/api/shared/anyone12345`);
    assert.equal(anyoneRes.status, 200);
    const body = (await anyoneRes.json()) as Record<string, any>;
    assert.equal(body.title, 'Public Share');
    assert.equal(body.analysis, '## Public Result');
    assert.equal(body.shareMode, 'anyone');
    assert.equal('transcriptContent' in body, false);
    assert.equal('userId' in body, false);
    assert.equal('sharedWith' in body, false);
  });

  it('enforces specific sharing: 401 unauthenticated, (a) owner by uid even absent from sharedWith, (b) case-insensitive recipient, (c) unrelated user 403', async () => {
    const baseUrl = await startTestServer(makeSharedApp());

    // Unauthenticated -> 401 AUTH_REQUIRED
    const unauthRes = await fetch(`${baseUrl}/api/shared/specific123`);
    assert.equal(unauthRes.status, 401);
    assert.equal((await unauthRes.json() as any).code, 'AUTH_REQUIRED');

    // (a) Owner by uid even when absent from sharedWith -> 200
    const ownerRes = await fetch(`${baseUrl}/api/shared/specific123`, {
      headers: { Authorization: 'Bearer owner-token' }
    });
    assert.equal(ownerRes.status, 200);
    const ownerBody = (await ownerRes.json()) as Record<string, any>;
    assert.equal(ownerBody.shareMode, 'specific');
    assert.equal(ownerBody.analysis, '## Specific Result');
    assert.equal('transcriptContent' in ownerBody, false);
    assert.equal('userId' in ownerBody, false);
    assert.equal('sharedWith' in ownerBody, false);

    // (b) Recipient in sharedWith (case-insensitive) -> 200
    const recipientRes = await fetch(`${baseUrl}/api/shared/specific123`, {
      headers: { Authorization: 'Bearer recipient-token' }
    });
    assert.equal(recipientRes.status, 200);
    assert.equal((await recipientRes.json() as any).title, 'Specific Share');

    // (c) Unrelated user -> 403 FORBIDDEN
    const strangerRes = await fetch(`${baseUrl}/api/shared/specific123`, {
      headers: { Authorization: 'Bearer stranger-token' }
    });
    assert.equal(strangerRes.status, 403);
    assert.equal((await strangerRes.json() as any).code, 'FORBIDDEN');
  });
});
