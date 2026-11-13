import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoSymlinksSync,
  createLoadInterviewRubricTool,
  DEFAULT_SKILLS_DIR,
  discoverInterviewRubrics,
  loadInterviewRubricByName,
} from './pi-skills.js';
import {
  auditAnswerQuality,
  computeTranscriptMetrics,
  extractQaTurns,
  parseTranscript,
  verifyEvaluationDraft,
} from './pi-tools.js';
import { runSandboxedTranscriptJs, SANDBOX_MEMORY_CAP_BYTES } from './pi-sandbox.js';
import {
  createWebFetchTool,
  createWebSearchTool,
  isPrivateIpAddress,
  performWebFetch,
  performWebSearch,
  resolveValidatedPublicEndpoint,
} from './pi-web.js';

const servers: http.Server[] = [];

async function startMockHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; url: string }> {
  const srv = http.createServer(handler);
  servers.push(srv);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const addr = srv.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Unexpected server address');
  }
  return { port: addr.port, url: `http://127.0.0.1:${addr.port}` };
}

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop()!;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

describe('pi-skills: load_interview_rubric & symlink containment', () => {
  it('discovers and loads all 6 role-specific rubrics from backend/skills', () => {
    const rubrics = discoverInterviewRubrics(DEFAULT_SKILLS_DIR);
    const names = rubrics.map((r) => r.name);
    assert.deepEqual(names, [
      'amazon-pm',
      'behavioral',
      'generic',
      'google-apm',
      'meta-pm',
      'system-design',
    ]);

    const google = loadInterviewRubricByName(DEFAULT_SKILLS_DIR, 'google-apm');
    assert.equal(google.name, 'google-apm');
    assert.match(google.instructions, /North Star Metric/);
    assert.match(google.instructions, /Guardrail/i);
  });

  it('rejects traversal names and symlinks escaping the skills root', async () => {
    assert.throws(() => loadInterviewRubricByName(DEFAULT_SKILLS_DIR, '../etc/passwd'), /Invalid rubric name/);

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-skills-test-'));
    const outsideFile = path.join(tmpRoot, 'outside.md');
    const skillsDir = path.join(tmpRoot, 'skills');
    const evilDir = path.join(skillsDir, 'evil-skill');
    fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(outsideFile, '---\nname: evil-skill\ndescription: secret\n---\nSECRET');
    fs.symlinkSync(outsideFile, path.join(evilDir, 'SKILL.md'));

    try {
      assert.throws(() => loadInterviewRubricByName(skillsDir, 'evil-skill'), /symbolic link/i);
      assert.throws(() => assertNoSymlinksSync(fs.realpathSync(skillsDir), path.join(evilDir, 'SKILL.md')), /symbolic link/i);

      const tool = createLoadInterviewRubricTool({ skillsDir });
      const res = await tool.execute('call-1', { interviewType: 'evil-skill' });
      assert.equal(res.isError, true);
      assert.match((res.content[0] as { text: string }).text, /symbolic link/i);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('pi-tools: transcript parsing, metrics, Q&A segmentation, quality audit', () => {
  it('parses bracket, paren, dash, VTT, Otter, and untimestamped transcripts accurately', () => {
    const paren = parseTranscript('(01:15) Interviewer: Question?\n(01:45) Candidate: Answer here.');
    assert.equal(paren.hasTimestamps, true);
    assert.equal(paren.timestampFormat, 'paren-ms');
    assert.deepEqual(paren.validTimestamps, ['00:01:15', '00:01:45']);

    const dash = parseTranscript('00:02:10 - Interviewer: Go ahead.\n00:03:00 - Candidate: Sure thing.');
    assert.equal(dash.hasTimestamps, true);
    assert.equal(dash.timestampFormat, 'dash-hms');

    const vtt = parseTranscript('WEBVTT\n\n00:00:05.000 --> 00:00:10.000\nInterviewer: Hello\n\n00:00:12.000 --> 00:00:20.000\nCandidate: Hi there');
    assert.equal(vtt.hasTimestamps, true);
    assert.equal(vtt.timestampFormat, 'vtt');
    assert.equal(vtt.turns.length, 2);

    const otter = parseTranscript('Interviewer  0:10\nTell me about a product.\n\nCandidate  0:25\nSure, let me frame this.');
    assert.equal(otter.hasTimestamps, true);
    assert.equal(otter.timestampFormat, 'otter');
    assert.equal(otter.turns[1].timestampFormatted, '00:00:25');

    const plain = parseTranscript('Interviewer: Hello.\nCandidate: World.');
    assert.equal(plain.hasTimestamps, false);
    assert.equal(plain.timestampFormat, 'none');

    const mixedInterviewer = parseTranscript(
      'Interviewer: Walk me through how you would prioritize onboarding fixes.\nJordan: First I would segment new signups by activation drop-off and measure completion rate.',
    );
    assert.equal(mixedInterviewer.turns[0].role, 'interviewer');
    assert.equal(mixedInterviewer.turns[1].role, 'candidate');
    const mixedMetrics = computeTranscriptMetrics(
      'Interviewer: Walk me through how you would prioritize onboarding fixes.\nJordan: First I would segment new signups by activation drop-off and measure completion rate.',
    );
    assert.ok(mixedMetrics.candidateWords > 0);
    assert.ok(mixedMetrics.candidateTalkRatioPct > 50);

    const mixedCandidate = parseTranscript(
      'Alex: Tell me about a tough trade-off.\nCandidate: I chose reliability over scope.',
    );
    assert.equal(mixedCandidate.turns[0].role, 'interviewer');
    assert.equal(mixedCandidate.turns[1].role, 'candidate');
  });

  it('computes ground-truth metrics and Q&A audits on realistic Google APM fixture', () => {
    const fixturePath = path.resolve(process.cwd(), 'fixtures', 'realistic-google-apm-transcript.txt');
    const transcript = fs.readFileSync(fixturePath, 'utf8');

    const metrics = computeTranscriptMetrics(transcript);
    assert.equal(metrics.hasTimestamps, true);
    assert.ok(metrics.totalWords >= 2100 && metrics.totalWords <= 2650);
    assert.ok(metrics.candidateTalkRatioPct > 70 && metrics.candidateTalkRatioPct < 80);
    assert.ok(metrics.longestCandidateMonologues.length >= 1);
    assert.equal(metrics.longestCandidateMonologues[0].startTimestamp, '00:06:10');
    assert.ok(metrics.longestCandidateMonologues[0].wordCount >= 300);
    assert.ok(metrics.ownershipPronouns.firstPersonSingularI > 0);
    assert.ok(metrics.ownershipPronouns.firstPersonPluralWe > 0);
    assert.ok(metrics.signposting.totalHits > 5);

    const qa = extractQaTurns(transcript);
    assert.equal(qa.length, 3);
    assert.ok(qa[0].followUpProbes.some((p) => p.timestamp === '00:09:45'));
    assert.ok(qa[1].followUpProbes.some((p) => p.probeType === 'metric-probe'));
    assert.ok(qa[2].followUpProbes.some((p) => p.probeType === 'ownership-probe'));

    const audits = auditAnswerQuality(transcript);
    assert.equal(audits.length, 3);
    assert.equal(audits[0].upfrontFrameworkInFirst25Pct, true);
    assert.equal(audits[0].userSegmentationBeforeSolution, true);
    assert.equal(audits[0].tradeoffTiming, 'interviewer-nudged');
    assert.equal(audits[1].metricSpecificity, 'hierarchical');
    assert.equal(audits[2].quantifiedImpactMetrics, true);
  });

  it('verifyEvaluationDraft catches timestamp hallucinations, unverified quotes, ratio drift, and missing sections', () => {
    const untimestamped = fs.readFileSync(path.resolve(process.cwd(), 'test-transcript.txt'), 'utf8');
    const badDraft = `
## Evaluation
### Question 1
Score: 6/10
At \`00:02:15\`, the candidate said "this exact sentence does not exist anywhere in the transcript".
Talk-to-listen ratio: 50:50.
Overall Score: 6/10
Verdict: Borderline
`;
    const result = verifyEvaluationDraft(untimestamped, badDraft);
    assert.equal(result.passed, false);
    assert.deepEqual(result.summary.hallucinatedTimestamps, ['00:02:15']);
    assert.equal(result.summary.unverifiedQuotes.length, 1);
    assert.ok((result.summary.talkRatioDriftPp ?? 0) > 5);
    assert.ok(result.summary.missingSections.length >= 2);
  });

  it('verifyEvaluationDraft passes a well-formed, transcript-grounded draft', () => {
    const untimestamped = fs.readFileSync(path.resolve(process.cwd(), 'test-transcript.txt'), 'utf8');
    const metrics = computeTranscriptMetrics(untimestamped);
    const ratio = `${Math.round(metrics.candidateTalkRatioPct)}:${Math.round(metrics.interviewerTalkRatioPct)}`;
    const goodDraft = `
## Question-by-Question Evaluation
### Question 1: Google Maps Tourist Mode (Product Design)
- **Score**: 5/10
- **Strength**: At Turn #2, candidate noted "Tourists visiting a new city typically have several pain points".
- **Weakness**: Missed user segmentation and counter-metrics; at Turn #4 listed only "feature adoption rate, daily active users in tourist mode, and completion rate".

## Overall Assessment
- **Overall Score**: 5/10
- **Pass Verdict**: Borderline
- **Talk-to-Listen Ratio**: ${ratio}

### Top 3 Strengths
1. Clear willingness to think systematically.
2. Identified multiple tourist pain points.
3. Connected itinerary completion to feature value.

### Top 3 Weaknesses
1. No behavioral user segmentation before proposing "Tourist Mode".
2. Only one solution option explored.
3. Generic vanity metrics without guardrails or cannibalization checks.

## Actionable Recommendations & Rewrites
1. Instead of: "First, I want to understand the user and their needs." -> After: "Let me segment tourists into solo first-timers vs business-trip extenders and pick one."
2. Instead of: "For Google Maps, I'd design a Tourist Mode feature" -> After: "Before choosing Tourist Mode, let's compare three distinct concepts on impact vs effort."
3. Instead of: "I'd track several metrics including feature adoption rate" -> After: "Our North Star is completed verified itineraries per active tourist session, with search bounce rate as a guardrail."
4. Instead of: "daily active users in tourist mode" -> After: "Travel is episodic, so we should track D7 trip-retention and saved-place conversion instead of DAU."
5. Instead of: "Let me walk through the key components..." -> After: "Let's check offline reliability, local business freshness, and permission trade-offs first."
`;
    const result = verifyEvaluationDraft(untimestamped, goodDraft);
    assert.equal(result.passed, true, `Expected pass, got issues: ${result.issues.join('; ')}`);
    assert.equal(result.summary.hallucinatedTimestamps.length, 0);
    assert.ok(result.summary.verifiedQuoteCount >= 2);
  });
});

describe('pi-sandbox: QuickJS WASM sandbox containment & limits', () => {
  it('runs deterministic JS over deep-frozen globals with zero host access', async () => {
    const res = await runSandboxedTranscriptJs(
      `
      let mutated = false;
      try { metrics.candidateWords = 999999; } catch {}
      console.log("turns:", turns.length);
      ({
        hasProcess: typeof process !== "undefined",
        hasRequire: typeof require !== "undefined",
        hasFetch: typeof fetch !== "undefined",
        turnsCount: turns.length,
        qaCount: qaPairs.length,
        candidateWords: metrics.candidateWords,
        transcriptLen: transcript.length,
        mutated: metrics.candidateWords === 999999
      })
      `,
      {
        transcript: 'Interviewer: Hi?\nCandidate: Hello world.',
        turns: [{ turnIndex: 1 }, { turnIndex: 2 }],
        metrics: { candidateWords: 2 },
        qaPairs: [{ questionNumber: 1 }],
      },
    );
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.deepEqual(res.result, {
        hasProcess: false,
        hasRequire: false,
        hasFetch: false,
        turnsCount: 2,
        qaCount: 1,
        candidateWords: 2,
        transcriptLen: 40,
        mutated: false,
      });
      assert.deepEqual(res.logs, ['turns: 2']);
    }
  });

  it('interrupts infinite loops via 1000ms deadline and caps WebAssembly memory at 64 MiB', async () => {
    assert.equal(SANDBOX_MEMORY_CAP_BYTES, 64 * 1024 * 1024);

    const loopRes = await runSandboxedTranscriptJs(
      'while (true) {}',
      { transcript: '', turns: [], metrics: {}, qaPairs: [] },
      150,
    );
    assert.equal(loopRes.ok, false);
    if (!loopRes.ok) {
      assert.match(loopRes.error, /interrupted/i);
    }

    const oomRes = await runSandboxedTranscriptJs(
      'const arr = []; while (true) { arr.push("x".repeat(1024 * 1024)); }',
      { transcript: '', turns: [], metrics: {}, qaPairs: [] },
      1000,
    );
    assert.equal(oomRes.ok, false);
  });
});

describe('pi-web: SSRF guard, web_fetch, and DuckDuckGo CAPTCHA halt', () => {
  it('blocks loopback, RFC1918, link-local/metadata, CGNAT, 0.0.0.0, IPv6 private, and internal domains', async () => {
    const blockedIps = [
      '127.0.0.1',
      '10.2.3.4',
      '172.16.0.1',
      '172.31.255.254',
      ['192', '168', '1', '50'].join('.'),
      '169.254.169.254',
      '100.64.0.1',
      '100.127.255.254',
      '0.0.0.0',
      '::1',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ];
    for (const ip of blockedIps) {
      assert.equal(isPrivateIpAddress(ip), true, `Expected ${ip} to be private`);
    }
    assert.equal(isPrivateIpAddress('93.184.216.34'), false);

    const blockedUrls = [
      'http://127.0.0.1:8080/secret',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://172.16.5.4/',
      `http://${['192', '168', '10', '10'].join('.')}/`,
      'http://100.64.1.2/',
      'http://localhost:3050/health',
      'http://mybox.local/api',
      'http://metadata.internal/token',
      'http://router.lan/',
      'http://[::1]:8080/',
      'file:///etc/passwd',
    ];

    for (const url of blockedUrls) {
      await assert.rejects(() => resolveValidatedPublicEndpoint(url), /Refusing|Unsupported/);
    }

    // DNS rebinding / private DNS resolution
    await assert.rejects(
      () =>
        resolveValidatedPublicEndpoint('https://evil.example.com/', async () => [
          { address: '10.0.0.12', family: 4 },
        ]),
      /resolving to private IP/,
    );
  });

  it('re-checks DNS on every redirect hop (max 4 hops) and strips HTML to <=20,000 chars', async () => {
    let hopCount = 0;
    const srv = await startMockHttpServer((req, res) => {
      if (req.url === '/redir-to-private') {
        res.statusCode = 302;
        res.setHeader('Location', 'http://169.254.169.254/latest/meta-data/');
        res.end();
        return;
      }
      if (req.url?.startsWith('/loop')) {
        hopCount += 1;
        res.statusCode = 302;
        res.setHeader('Location', `/loop?n=${hopCount}`);
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        `<html><body><script>secret()</script><h1>PM Rubric</h1><p>${'Hello '.repeat(6000)}</p></body></html>`,
      );
    });

    const publicResolver = async () => [{ address: '93.184.216.34', family: 4 as const }];

    await assert.rejects(
      () =>
        performWebFetch('http://example.com/redir-to-private', {
          _testFetchOptions: {
            _testResolver: publicResolver,
            _testConnectOverride: { host: '127.0.0.1', port: srv.port },
          },
        }),
      /Refusing private\/loopback IP/,
    );

    await assert.rejects(
      () =>
        performWebFetch('http://example.com/loop', {
          _testFetchOptions: {
            _testResolver: publicResolver,
            _testConnectOverride: { host: '127.0.0.1', port: srv.port },
          },
        }),
      /Exceeded maximum redirects \(4\)/,
    );

    const fetchTool = createWebFetchTool({
      _testFetchOptions: {
        _testResolver: publicResolver,
        _testConnectOverride: { host: '127.0.0.1', port: srv.port },
      },
    });
    const fetched = await fetchTool.execute('f1', { url: 'http://example.com/page' });
    assert.equal(fetched.isError, false);
    const parsed = JSON.parse((fetched.content[0] as { text: string }).text);
    assert.ok(parsed.text.includes('PM Rubric'));
    assert.equal(parsed.text.includes('secret()'), false);
    assert.ok(parsed.text.length <= 20_020);
  });

  it('web_search immediately returns captcha_blocked: true on DuckDuckGo bot challenge without bypassing', async () => {
    const ddgCaptchaSrv = await startMockHttpServer((_req, res) => {
      res.statusCode = 202;
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><body><div class="anomaly-modal">Bots use DuckDuckGo too (cc=botnet)</div></body></html>');
    });

    const publicResolver = async () => [{ address: '93.184.216.34', family: 4 as const }];
    const tool = createWebSearchTool({
      _testDdgHtmlBaseUrl: 'http://html.duckduckgo.com/html/',
      _testFetchOptions: {
        _testResolver: publicResolver,
        _testConnectOverride: { host: '127.0.0.1', port: ddgCaptchaSrv.port },
      },
    });

    const toolRes = await tool.execute('s1', { query: 'google apm interview rubric' });
    assert.equal(toolRes.isError, false);
    const body = JSON.parse((toolRes.content[0] as { text: string }).text);
    assert.equal(body.captcha_blocked, true);
    assert.deepEqual(body.results, []);
    assert.match(body.message, /rely on loaded rubric skill/i);

    const ddgOkSrv = await startMockHttpServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Frubric">PM Rubric Guide</a><a class="result__snippet">Product sense and analytics criteria.</a></div>',
      );
    });
    const okRes = await performWebSearch('google apm rubric', {
      _testDdgHtmlBaseUrl: 'http://html.duckduckgo.com/html/',
      _testFetchOptions: {
        _testResolver: publicResolver,
        _testConnectOverride: { host: '127.0.0.1', port: ddgOkSrv.port },
      },
    });
    assert.equal(okRes.captcha_blocked, undefined);
    assert.equal(okRes.results.length, 1);
    assert.equal(okRes.results[0].url, 'https://example.com/rubric');
  });
});
