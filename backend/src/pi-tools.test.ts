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
  classifySpeakerRole,
  computeTranscriptMetrics,
  detectCriteriaScoreMax,
  extractQaTurns,
  parseTranscript,
  verifyEvaluationDraft,
} from './pi-tools.js';
import { runSandboxedTranscriptJs, SANDBOX_MEMORY_CAP_BYTES } from './pi-sandbox.js';
import {
  createWebFetchTool,
  createWebSearchTool,
  fetchPublicUrlBounded,
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

    const vttNoSpeaker = parseTranscript(
      'WEBVTT\n\n1\n00:00:05.000 --> 00:00:10.000\nFirst cue text.\n\n2\n00:00:12.000 --> 00:00:20.000\nSecond cue text.',
    );
    assert.equal(vttNoSpeaker.hasTimestamps, true);
    assert.equal(vttNoSpeaker.timestampFormat, 'vtt');
    assert.equal(vttNoSpeaker.turns.length, 2);
    assert.equal(vttNoSpeaker.turns[0].timestampFormatted, '00:00:05');
    assert.equal(vttNoSpeaker.turns[0].text, 'First cue text.');
    assert.equal(vttNoSpeaker.turns[1].timestampFormatted, '00:00:12');
    assert.equal(vttNoSpeaker.turns[1].text, 'Second cue text.');
    assert.deepEqual(vttNoSpeaker.validTimestamps, ['00:00:05', '00:00:12']);

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

  it('recognizes I1/I2/Interviewer N, C1/Candidate N, Q/A, and host roles in classifySpeakerRole', () => {
    assert.equal(classifySpeakerRole('I1'), 'interviewer');
    assert.equal(classifySpeakerRole('I2'), 'interviewer');
    assert.equal(classifySpeakerRole('Interviewer 1'), 'interviewer');
    assert.equal(classifySpeakerRole('Interviewer2'), 'interviewer');
    assert.equal(classifySpeakerRole('Q'), 'interviewer');
    assert.equal(classifySpeakerRole('Panelist'), 'interviewer');
    assert.equal(classifySpeakerRole('C1'), 'candidate');
    assert.equal(classifySpeakerRole('Candidate 2'), 'candidate');
    assert.equal(classifySpeakerRole('A'), 'candidate');
    assert.equal(classifySpeakerRole('Interviewee'), 'candidate');
    assert.equal(classifySpeakerRole('Ian'), 'other');
    assert.equal(classifySpeakerRole('Claire'), 'other');
    assert.equal(classifySpeakerRole('Quinn'), 'other');
  });

  it('ignores Google Meet/Otter footer and top header noise while attaching standalone section timestamps', () => {
    const meetTranscript = [
      'Google Meet Transcript',
      'Feb 14, 2026 - Product Sense Mock',
      '2026-02-14 10:30 AM PST',
      '',
      '00:00:00',
      'Alice Chen: Welcome! Let us design a transit trip planner for commuters.',
      'Bob Patel: Thanks! Before jumping in, let me clarify the target city and user goal.',
      '',
      '00:04:30',
      'Bob Patel: I will focus on daily rail commuters who transfer between lines and face missed connections.',
      'Alice Chen: Why focus on rail commuters instead of occasional airport travelers?',
      'Bob Patel: Rail commuters ride twice daily, so reliability improvements compound into strong retention.',
      '',
      'Transcription ended after 00:12:45',
    ].join('\n');

    const parsed = parseTranscript(meetTranscript);
    assert.equal(parsed.hasTimestamps, true);
    assert.equal(parsed.timestampFormat, 'otter');
    assert.equal(parsed.maxTimestampSec, 12 * 60 + 45);
    assert.equal(
      parsed.turns.some((t) => /transcription ended/i.test(t.speaker) || /transcription ended/i.test(t.text)),
      false,
    );
    assert.equal(parsed.turns.length, 5);
    assert.equal(parsed.turns[0].speaker, 'Alice Chen');
    assert.equal(parsed.turns[0].timestampFormatted, '00:00:00');
    assert.equal(parsed.turns[1].speaker, 'Bob Patel');
    assert.equal(parsed.turns[1].timestampFormatted, '00:00:00');
    assert.equal(parsed.turns[2].speaker, 'Bob Patel');
    assert.equal(parsed.turns[2].timestampFormatted, '00:04:30');
    assert.equal(parsed.turns[3].speaker, 'Alice Chen');
    assert.equal(parsed.turns[3].timestampFormatted, '00:04:30');

    // Standalone timestamps with prose only (no speaker labels) create distinct segments
    const proseWithTimestamps = [
      '00:03',
      'First segment discusses framing the problem and defining success metrics clearly.',
      '00:18',
      'Second segment explores user pain points and prioritization trade-offs.',
      '00:45',
      'Third segment covers North Star and guardrail metrics.',
    ].join('\n');
    const proseParsed = parseTranscript(proseWithTimestamps);
    assert.equal(proseParsed.hasTimestamps, true);
    assert.equal(proseParsed.timestampFormat, 'plain');
    assert.equal(proseParsed.turns.length, 3);
    assert.deepEqual(
      proseParsed.turns.map((t) => t.timestampFormatted),
      ['00:00:03', '00:00:18', '00:00:45'],
    );
    assert.equal(proseParsed.turns.every((t) => t.speaker === 'Speaker'), true);
  });

  it('strips markdown emphasis around speakers and guards document metadata headers', () => {
    const mdTranscript = [
      '**Program:** APM Loop',
      '**Candidate:** Jordan Lee',
      '**Interview Date:** 2026-02-20',
      '**Interviewer(s):** I1, I2',
      '**Duration:** 45 minutes',
      '**Overall Score:** Pending',
      '',
      '**I1:** How would you improve neighborhood grocery delivery?',
      '**Jordan Lee**: Great question. Note: I want to start by clarifying geographic scope and delivery speed.',
      '**I2:** Focus on suburban families with weekly bulk orders.',
      '*Jordan Lee:* First: we should examine cart assembly time and substitution trust.',
      '**Summary: I would prioritize a smart substitution preview before checkout.**',
    ].join('\n');

    const parsed = parseTranscript(mdTranscript);
    const speakers = Array.from(new Set(parsed.turns.map((t) => t.speaker)));
    assert.deepEqual(speakers, ['I1', 'Jordan Lee', 'I2']);
    assert.equal(parsed.turns[0].role, 'interviewer');
    assert.equal(parsed.turns[1].role, 'candidate');
    assert.equal(parsed.turns[2].role, 'interviewer');
    assert.equal(parsed.turns[3].role, 'candidate');
    assert.match(parsed.turns[3].text, /Summary:/);
  });

  it('infers roles accurately across 2-speaker candidate-first, mixed explicit, and 3+ speaker panels', () => {
    // 1. Mixed explicit interviewer (I1, I2) + named candidate + <15-word noise speaker (>= 100 total words)
    const mixedPanel = [
      'I1: Tell me about a difficult product trade-off you led recently and how you aligned engineering and design.',
      'I2: Also include how you measured post-launch impact and what specific risks you accepted along the way.',
      'Coordinator: Recording started now.',
      'Morgan: I owned a checkout redesign where we delayed one-click upsells for six weeks to fix latency across our mobile web and native iOS funnels.',
      'Morgan: Specifically I partnered with backend leads to cut p95 checkout time from 900ms to 280ms by removing synchronous third-party tax calls and precomputing shipping estimates.',
      'Morgan: After launch, conversion rose 4.2 percent while support tickets dropped 18 percent across mobile checkout sessions over the following quarter.',
    ].join('\n');
    const mixedParsed = parseTranscript(mixedPanel);
    const morganTurns = mixedParsed.turns.filter((t) => t.speaker === 'Morgan');
    const coordTurns = mixedParsed.turns.filter((t) => t.speaker === 'Coordinator');
    assert.equal(morganTurns.every((t) => t.role === 'candidate'), true);
    assert.equal(coordTurns.every((t) => t.role === 'other'), true);

    // 2. Two unnamed speakers where candidate speaks first with long answers and interviewer asks questions second
    const candidateFirst = [
      'Taylor: Hi everyone, thank you so much for making time today. I am excited to walk through a product I use daily and discuss improvements.',
      'Taylor: I would start by breaking down user segments into power creators, casual viewers, and small local businesses who need discoverability without paid promotion overhead.',
      'Devon: Why prioritize local businesses?',
      'Taylor: Because local businesses face cold-start visibility gaps, whereas large creators already have cross-platform distribution channels and dedicated analytics tools to optimize retention.',
      'Devon: What metrics would you track?',
    ].join('\n');
    const cfParsed = parseTranscript(candidateFirst);
    assert.equal(cfParsed.turns.filter((t) => t.speaker === 'Devon').every((t) => t.role === 'interviewer'), true);
    assert.equal(cfParsed.turns.filter((t) => t.speaker === 'Taylor').every((t) => t.role === 'candidate'), true);

    // 3. Three+ unnamed speakers: highest word count & lower question rate => candidate; question-asking panelists => interviewer
    const threeSpeakerPanel = [
      'Panelist One: How would you design a collaborative study space feature inside an education app for university students?',
      'Panelist Two: What guardrails would you put in place to prevent distraction or spam in shared rooms?',
      'Sora: Let me structure this in three parts: user segments, pain points, and metrics. First, let us focus on exam-prep cohorts studying together asynchronously across time zones.',
      'Sora: For pain points, students lose accountability when studying alone, yet live video rooms often turn noisy. An ambient co-study timer with shared milestone check-ins solves both.',
      'Sora: For metrics, our North Star is completed 45-minute study sessions per active cohort, guarded by session drop-off rate and moderation report volume per thousand sessions.',
      'Panelist One: How would you handle cold start for a new campus?',
    ].join('\n');
    const panelParsed = parseTranscript(threeSpeakerPanel);
    assert.equal(panelParsed.turns.filter((t) => t.speaker === 'Sora').every((t) => t.role === 'candidate'), true);
    assert.equal(
      panelParsed.turns.filter((t) => t.speaker === 'Panelist One').every((t) => t.role === 'interviewer'),
      true,
    );
    assert.equal(
      panelParsed.turns.filter((t) => t.speaker === 'Panelist Two').every((t) => t.role === 'interviewer'),
      true,
    );
  });

  it('verifyEvaluationDraft detects inline timestamps, widens Google Meet periodic gap tolerance, and skips 0:0 ratio drift', () => {
    // 1. Structured notes with inline timestamps and time-of-day header, no speaker diarization
    const notesTranscript = [
      'Interview Notes - 2026-02-14 13:02 PST',
      '- Framed the travel planning problem cleanly and picked solo travelers (02:05).',
      '- Explored itinerary sharing options and mobile offline caching constraints (05:34).',
      '- Defined North Star completed trips and cancellation guardrail metric (11:20).',
    ].join('\n');

    const notesDraft = `
## Rubric Scorecard
| Competency | Score | Evidence |
| --- | --- | --- |
| Product Sense | 7/10 | Picked solo travelers at 02:05 |

### Question 1: Travel Planner
- **Score**: 7/10
- At \`05:34\`, candidate "Explored itinerary sharing options and mobile offline caching constraints" and later at \`11:20\` "Defined North Star completed trips and cancellation guardrail metric".
- Strength: Clear segmentation and metrics.
- Weakness: Needs sharper competitive differentiation.

## Overall Assessment
- **Overall Score**: 7/10
- **Pass Verdict**: Borderline
- **Talk-to-Listen Ratio**: 70:30 (estimated)
- **Top 3 Strengths**: Structured framing, user focus, guardrail metrics.
- **Top 3 Weaknesses**: Limited option breadth, late risk check, brief rollout plan.

## Rewrites
1. Instead of: "Explored itinerary sharing options and mobile offline caching constraints" -> After: "Compare three sharing workflows on sync reliability."
2. Instead of: "Defined North Star completed trips and cancellation guardrail metric" -> After: "Pair completed trips with itinerary edit-churn guardrail."
3. Instead of: "Framed the travel planning problem cleanly and picked solo travelers" -> After: "Size solo vs group travelers before prioritizing."
4. Before: "mobile offline caching constraints" -> After: "Specify 50MB offline tile budget and background prefetch."
5. Before: "cancellation guardrail metric" -> After: "Track 7-day rebooking failure rate below 1%."
`;
    const notesRes = verifyEvaluationDraft(notesTranscript, notesDraft);
    assert.equal(notesRes.passed, true, `Expected pass, got issues: ${notesRes.issues.join('; ')}`);
    assert.equal(notesRes.summary.hasTimestamps, true);
    assert.equal(notesRes.summary.hallucinatedTimestamps.length, 0);
    assert.equal(notesRes.summary.talkRatioDriftPp, undefined);

    // 2. Google Meet 5.5-minute periodic gaps: 00:08:00 is 150s from 00:05:30 (<= 360s tolerance), 00:25:00 is out of range
    const periodicTranscript = [
      '00:00:00',
      'Interviewer: Walk me through how you would prioritize onboarding fixes for a creator app.',
      '00:05:30',
      'Candidate: I would segment new creators by upload intent and measure first-publish completion rate within 48 hours.',
      '00:11:00',
      'Candidate: As a guardrail, I would track spam publish rate and creator support tickets per thousand uploads.',
    ].join('\n');
    const periodicMetrics = computeTranscriptMetrics(periodicTranscript);
    const periodicRatio = `${Math.round(periodicMetrics.candidateTalkRatioPct)}:${Math.round(periodicMetrics.interviewerTalkRatioPct)}`;
    const periodicGoodDraft = `
### Question 1
- **Score**: 7/10
- At \`00:08:00\`, candidate emphasized "segment new creators by upload intent and measure first-publish completion rate within 48 hours".
- Strength: Clear activation metric.
- Weakness: Needs deeper supply-side analysis.

## Overall Assessment
- **Overall Score**: 7/10
- **Pass Verdict**: Yes
- **Talk-to-Listen Ratio**: ${periodicRatio}
- **Top 3 Strengths**: Structured, metric-focused, clear guardrails.
- **Top 3 Weaknesses**: Brief rollout plan, few options, short edge-case check.

1. Instead of: "segment new creators by upload intent and measure first-publish completion rate within 48 hours" -> After: "Compare three onboarding experiments by activation lift."
2. Instead of: "track spam publish rate and creator support tickets per thousand uploads" -> After: "Set an explicit <1.5% moderation hold guardrail."
3. Before: "Walk me through how you would prioritize onboarding fixes for a creator app" -> After: "Clarify mobile vs web creator mix upfront."
4. Before: "first-publish completion rate within 48 hours" -> After: "Measure D7 second-publish retention alongside first publish."
5. Before: "creator support tickets per thousand uploads" -> After: "Include encode-failure latency p95 as a technical guardrail."
`;
    const periodicOk = verifyEvaluationDraft(periodicTranscript, periodicGoodDraft);
    assert.equal(periodicOk.passed, true, `Expected pass, got issues: ${periodicOk.issues.join('; ')}`);

    const periodicBadDraft = periodicGoodDraft.replace('00:08:00', '00:25:00');
    const periodicFail = verifyEvaluationDraft(periodicTranscript, periodicBadDraft);
    assert.equal(periodicFail.passed, false);
    assert.deepEqual(periodicFail.summary.hallucinatedTimestamps, ['00:25:00']);
  });

  it('preserves brief (<15w) 2-speaker interviewers, keeps short Candidate openings, and guards multi-heading note transcripts', () => {
    // 1. [P2] Brief (<15 words) interviewer with >= 100 word candidate in 2-speaker inference
    const briefInterviewerTranscript = [
      'Alex: Tell me about a product failure you owned?',
      'Sam: I led a search ranking migration where we shipped a semantic query rewriter without a proper click-through guardrail across long-tail queries. Over the first forty-eight hours, zero-result rates rose slightly while reformulation latency jumped by ninety milliseconds on older mobile devices. As soon as our alerting flagged the latency regression, I rolled back the feature flag, isolated the bottleneck to uncached synonym expansion, and partnered with our search infra lead to add a precomputed cache tier and a strict latency budget before re-enabling the rollout at five percent traffic.',
    ].join('\n');
    const briefMetrics = computeTranscriptMetrics(briefInterviewerTranscript);
    assert.equal(briefMetrics.interviewerTurns, 1);
    assert.equal(briefMetrics.candidateTurns, 1);
    assert.ok(briefMetrics.candidateTalkRatioPct > 85);

    // 2. [P2] Short candidate openings at top of transcript are NOT dropped as metadata
    for (const opening of [
      'Candidate: Absolutely\nInterviewer: Great, let us begin.',
      'Candidate: Not really\nInterviewer: Let me clarify the prompt.',
      '**Candidate:** Absolutely\n**Interviewer:** Great, let us begin.',
    ]) {
      const p = parseTranscript(opening);
      assert.equal(p.turns.length, 2, `Expected 2 turns for opening: ${opening}`);
      assert.equal(p.turns[0].speaker, 'Candidate');
      assert.equal(p.turns[0].role, 'candidate');
    }

    // 3. Multi-heading structured notes + >3-word dash-timestamped note titles do not explode interviewer turns
    const noteHeavyTranscript = [
      '01:10 - Architecture Deep Dive and Scaling Plan: Candidate walked through sharding strategy and cache invalidation across regional clusters.',
      '03:45 - Cross Functional Stakeholder Alignment: Coordinated legal, support, and engineering teams on phased launch milestones.',
      'Candidate: One lesson I learned was to validate edge-case rollback latency before broad launch.',
      'Problem Framing: Defined target users and latency goals clearly across mobile and web endpoints during the initial scoping block.',
      'Solution Tradeoffs: Compared synchronous validation versus asynchronous queue processing under peak traffic conditions.',
      'System Design: Partitioned event streams by tenant key with bounded retry queues and idempotent consumers.',
      'User Journey: Walked through first-time onboarding, error recovery states, and offline sync resolution flows.',
      'Data Model: Separated hot session state from analytical audit logs with TTL retention policies.',
      'Metrics Discussion: Proposed North Star task completion rate paired with p95 error-rate and support-ticket guardrails.',
    ].join('\n');
    const notesParsed = parseTranscript(noteHeavyTranscript);
    assert.equal(
      notesParsed.turns.some((t) => t.speaker === 'Architecture Deep Dive and Scaling Plan'),
      false,
    );
    assert.equal(
      notesParsed.turns.some((t) => t.speaker === 'Problem Framing' || t.speaker === 'Metrics Discussion'),
      false,
    );
    assert.equal(
      notesParsed.turns.some((t) => t.timestampFormatted === '00:01:10'),
      true,
    );
    assert.equal(
      notesParsed.turns.filter((t) => t.role === 'interviewer').length,
      0,
      'Must not bulk-infer multi-heading note sections as interviewer',
    );

    // 4. [P2] Opening dialogue mentioning time-of-day must NOT be dropped by isTopHeaderNoise
    const timeMentionDialogue = parseTranscript(
      'Interviewer: We have until 10:30 AM. Tell me about yourself.\nCandidate: I am a product manager.',
    );
    assert.equal(timeMentionDialogue.turns.length, 2);
    assert.equal(timeMentionDialogue.turns[0].speaker, 'Interviewer');
    assert.equal(timeMentionDialogue.turns[0].role, 'interviewer');
    assert.match(timeMentionDialogue.turns[0].text, /10:30 AM/);

    // 5. [P2] Ordinary 2-part clock times in dialogue ("from 09:00 to 17:00") must NOT flip verifyEvaluationDraft hasTimestamps to true
    const proseClockTranscript =
      'Interviewer: How did you organize support?\nCandidate: We staffed the desk from 09:00 to 17:00 every day.';
    const fabricatedClockDraft = `
### Question 1
- **Score**: 7/10
- At \`09:00\`, candidate said "We staffed the desk from 09:00 to 17:00 every day".
- Strength: Clear coverage model.
- Weakness: Limited escalation metrics.

## Overall Assessment
- **Overall Score**: 7/10
- **Pass Verdict**: Yes
- **Talk-to-Listen Ratio**: 69:31
- **Top 3 Strengths**: Clear staffing, consistent hours, direct answer.
- **Top 3 Weaknesses**: Missing SLA target, no volume metric, no handoff detail.

1. Instead of: "We staffed the desk from 09:00 to 17:00 every day" -> After: "Specify p95 first-response SLA."
2. Before: "We staffed the desk from 09:00 to 17:00 every day" -> After: "Quantify ticket volume per shift."
3. Before: "How did you organize support?" -> After: "Ask for peak-hour overflow handling."
4. Before: "staffed the desk from 09:00 to 17:00" -> After: "Cover weekend on-call rotation."
5. Before: "every day" -> After: "Track backlog carryover rate."
`;
    const proseClockRes = verifyEvaluationDraft(proseClockTranscript, fabricatedClockDraft);
    assert.equal(proseClockRes.summary.hasTimestamps, false);
    assert.equal(proseClockRes.passed, false);
    assert.deepEqual(proseClockRes.summary.hallucinatedTimestamps, ['09:00', '17:00']);

    // 6. [P2] Timestamped opening dialogue mentioning time-of-day is NOT dropped
    const tsTimeDialogue = parseTranscript(
      '[00:00] Interviewer: We have until 10:30 AM.\n[00:15] Candidate: Sounds good, let us begin.',
    );
    assert.equal(tsTimeDialogue.turns.length, 2);
    assert.equal(tsTimeDialogue.turns[0].speaker, 'Interviewer');
    assert.equal(tsTimeDialogue.turns[0].timestampFormatted, '00:00:00');
    assert.match(tsTimeDialogue.turns[0].text, /10:30 AM/);

    // 7. [P2] Partially labeled panel (Interviewer + named interviewer Alice + candidate Bob) disambiguates Alice vs Bob
    const partialPanel = [
      'Interviewer: Welcome! How would you improve commuter trip alerts?',
      'Alice: What specific user segments would you prioritize first?',
      'Bob: I would prioritize daily rail commuters transferring between lines because missed transfers cause high frustration and repeat churn across peak morning commutes.',
      'Alice: How would you measure alert accuracy and false-positive fatigue?',
      'Bob: Our North Star would be timely transfer completion rate per active commute, guarded by alert mute rate and opt-out rate across the first thirty days after enabling alerts.',
    ].join('\n');
    const partialParsed = parseTranscript(partialPanel);
    assert.equal(partialParsed.turns.filter((t) => t.speaker === 'Interviewer').every((t) => t.role === 'interviewer'), true);
    assert.equal(partialParsed.turns.filter((t) => t.speaker === 'Alice').every((t) => t.role === 'interviewer'), true);
    assert.equal(partialParsed.turns.filter((t) => t.speaker === 'Bob').every((t) => t.role === 'candidate'), true);
  });

  it('detects secondary evaluation notes with inline timestamps and coached mock sessions with Q&A-normalized ratio', () => {
    // 1. Secondary notes / digest with single Candidate header line & inline timestamps
    const secondaryNotes = [
      'Practice Session Evaluation',
      'Candidate: Alex Rivera',
      'Duration: 45 minutes',
      'Interview Type: behavioral (practice session with coaching)',
      '',
      'Question-by-Question Analysis',
      'Overall Score: 6.5/10',
      'Would they pass the APM bar? Borderline',
      'Score: 6/10',
      '✅ Strengths (00:01:45): Grounded the SQL optimization story with clear dataset estimates.',
      '00:03:15 - Used imprecise terminology during storage vs query execution discussion.',
    ].join('\n');

    const secondaryMetrics = computeTranscriptMetrics(secondaryNotes);
    assert.equal(secondaryMetrics.sourceDocumentType, 'secondary_evaluation_or_notes');
    assert.equal(secondaryMetrics.hasTimestamps, true);
    assert.equal(secondaryMetrics.timestampFormat, 'inline');
    assert.deepEqual(secondaryMetrics.validTimestamps, ['00:01:45', '00:03:15']);
    assert.equal(secondaryMetrics.candidateTalkRatioPct, 0);
    assert.equal(secondaryMetrics.interviewerTalkRatioPct, 0);
    assert.equal(secondaryMetrics.coachedSessionDetected, false);

    // 2. Coached mock session with >=180-word teaching lecture block
    const lectureWords = Array.from({ length: 195 }, (_, i) => `concept${i}`).join(' ');
    const coachedMock = [
      '[00:00:10] Interviewer: Walk me through how you would instrument an analytics pipeline.',
      '[00:01:00] Candidate: First I would clarify latency requirements and segment batch versus streaming consumers before proposing schemas and backfill verification steps.',
      `[00:02:00] Interviewer: Let me pause and coach you here on how query optimization works: ${lectureWords}. Let's try that again.`,
      '[00:06:00] Candidate: With partitioning isolated from predicate pushdown, I would measure p95 query latency alongside invalid-row drop rate.',
    ].join('\n');

    const coachedMetrics = computeTranscriptMetrics(coachedMock);
    assert.equal(coachedMetrics.sourceDocumentType, 'verbatim_transcript');
    assert.equal(coachedMetrics.coachedSessionDetected, true);
    assert.equal(coachedMetrics.interviewerCoachingBlocks.length, 1);
    assert.ok(typeof coachedMetrics.qaOnlyCandidateTalkRatioPct === 'number');
    assert.ok(coachedMetrics.qaOnlyCandidateTalkRatioPct > coachedMetrics.candidateTalkRatioPct);

    const qaRatioLabel = `${Math.round(coachedMetrics.qaOnlyCandidateTalkRatioPct!)}:${Math.round(100 - coachedMetrics.qaOnlyCandidateTalkRatioPct!)}`;
    const coachedDraft = `
### Question 1
- **Score**: First pass 4/10 -> Coached retry 7/10
- At \`00:01:00\`, candidate started with "First I would clarify latency requirements and segment batch versus streaming consumers".

## Overall Assessment
- **Overall Score**: 6/10
- **Pass Verdict**: Borderline
- **Talk-to-Listen Ratio**: ${qaRatioLabel} (Q&A-only; full session ${Math.round(coachedMetrics.candidateTalkRatioPct)}:${Math.round(coachedMetrics.interviewerTalkRatioPct)})
- **Top 3 Strengths**: Quick uptake on retry, clear segmentation, named p95 latency guardrail.
- **Top 3 Weaknesses**: Initial confusion on optimization vs partitioning, needed coaching interrupt, brief edge cases.

1. Instead of: "First I would clarify latency requirements and segment batch versus streaming consumers" -> After: "Define consumer SLA tiers upfront."
2. Before: "segment batch versus streaming consumers before proposing schemas" -> After: "State schema evolution policy."
3. Before: "With partitioning isolated from predicate pushdown" -> After: "Quantify partition pruning selectivity."
4. Before: "measure p95 query latency alongside invalid-row drop rate" -> After: "Specify 15-minute freshness SLO."
5. Before: "backfill verification steps" -> After: "Add deterministic row-checksum diffing."
`;
    const coachedVerify = verifyEvaluationDraft(coachedMock, coachedDraft);
    assert.equal(coachedVerify.passed, true, `Expected pass, got: ${coachedVerify.issues.join('; ')}`);
    assert.ok((coachedVerify.summary.talkRatioDriftPp ?? 99) <= 1);

    // 3. Long (>=180w) interviewer case prompt WITHOUT coaching cues is NOT misclassified as coaching
    const longPromptTranscript =
      'Interviewer: ' +
      'Here is the business context for your case. '.repeat(24) +
      '\nCandidate: I would begin by identifying our users and measuring retention.';
    const longPromptMetrics = computeTranscriptMetrics(longPromptTranscript);
    assert.equal(longPromptMetrics.coachedSessionDetected, false);
    assert.equal(longPromptMetrics.interviewerCoachingBlocks.length, 0);
    assert.equal(longPromptMetrics.qaOnlyCandidateTalkRatioPct, undefined);

    // 4. Same-level heading after `### Sample Reframes` closes the quote exemption,
    // and bold **Before**: "...", `1. Original answer: "..."`, or `Candidate: "..."` inside Sample Reframes still undergoes verification
    const escapedSectionVerify = verifyEvaluationDraft(
      longPromptTranscript,
      '### Sample Reframes\n1. **Before**: "I secretly invented this bold before quote" -> "Replace with verified or suggested wording."\n2. Original answer: "I secretly invented this original answer quote"\n3. Candidate: "I secretly invented this candidate colon quote"\n### Evidence\nThe candidate said "I secretly invented every metric in this report".',
    );
    assert.equal(escapedSectionVerify.passed, false);
    assert.ok(escapedSectionVerify.summary.unverifiedQuotes.some((q) => /secretly invented every metric/.test(q)));
    assert.ok(escapedSectionVerify.summary.unverifiedQuotes.some((q) => /bold before quote/.test(q)));
    assert.ok(escapedSectionVerify.summary.unverifiedQuotes.some((q) => /original answer quote/.test(q)));
    assert.ok(escapedSectionVerify.summary.unverifiedQuotes.some((q) => /candidate colon quote/.test(q)));
    assert.equal(
      escapedSectionVerify.summary.unverifiedQuotes.some((q) => /Replace with verified or suggested/.test(q)),
      false,
    );
  });

  it('enforces custom 1-5 cachedCriteria format without 1-10 leakage and supports Untested (N/A) coverage', () => {
    const dillerCriteria = `
## EVALUATION DIMENSIONS
### 1. Project Clarity & Articulation (1–5)
### 2. Personal Connection & Authenticity (1–5)
### 3. Leadership & Agency (1–5)
---
OUTPUT FORMAT:
For each of the dimensions, provide Score (1–5), What worked, What to improve.
### Summary Scorecard
| Dimension | Score |
|-----------|-------|
| Project Clarity & Articulation | /5 |
| **TOTAL** | **/50** |
### Top 3 Strengths
### Top 3 Areas for Improvement
### Sample Reframes
`;
    const transcript = [
      '00:05',
      'I1: Tell me about your project and why it matters to you.',
      '00:25',
      'Candidate: I built a local cemetery preservation map so families can locate ancestors without relying on fragmented paper records.',
    ].join('\n');

    const pureFivePointDraft = `
### 1. Project Clarity & Articulation
1. **Score**: 4/5
2. **What worked**: At \`00:25\`, candidate explained clearly: "I built a local cemetery preservation map so families can locate ancestors without relying on fragmented paper records".
3. **What to improve**: Lead with user scale in one sentence.

### 2. Personal Connection & Authenticity
1. **Score**: 4/5
2. **What worked**: Grounded motivation in family history.
3. **What to improve**: Add an origin-story beat.

### Summary Scorecard
| Dimension | Score |
|-----------|-------|
| Project Clarity & Articulation | 4/5 |
| Personal Connection & Authenticity | 4/5 |
| **TOTAL** | **34/50** |

### Top 3 Strengths
- Clear mission statement ("10/10 energy" should not trigger even if quoted).

### Top 3 Areas for Improvement
- Broaden engagement of peers.

### Sample Reframes
#### 1. Origin Story Reframe
> "When my grandfather showed me how paper cemetery ledgers faded over decades, I built a digital map."
#### 2. Outcome Impact Reframe
> "Instead of raw record counts, highlight three families who reconnected with lost plots."
`;
    const pureRes = verifyEvaluationDraft(transcript, pureFivePointDraft, {
      cachedCriteria: dillerCriteria,
    });
    assert.equal(pureRes.passed, true, `Expected 1-5 pass, got: ${pureRes.issues.join('; ')}`);

    const dualScaleDraft = `${pureFivePointDraft}\n### Question 1\n- **Score**: 7/10\n`;
    const dualRes = verifyEvaluationDraft(transcript, dualScaleDraft, {
      cachedCriteria: dillerCriteria,
    });
    assert.equal(dualRes.passed, false);
    assert.ok(dualRes.issues.some((i) => /Dual scoring scale detected/i.test(i)));

    // 5-point prose criteria ("Use a 1–5 scoring scale") + "**Score (1–5)**: 4" + "What a bar-raiser candidate says instead" + "The candidate says" strict check
    const proseFiveCriteria = 'Evaluation Criteria: Use a 1–5 scoring scale across Structure and Impact.';
    const proseFiveDraft = `
### 1. Structure
- **Score (1–5)**: 4
- At \`00:25\`, candidate said: "I built a local cemetery preservation map so families can locate ancestors without relying on fragmented paper records".
- **What a bar-raiser candidate says instead**: "I digitized 400 cemetery plots across three counties, cutting family lookup time from days to 30 seconds."

### 2. Impact
- **Score (1–5)**: 3
- Strength: Clear civic purpose.
- Area for improvement: Add adoption metrics.
- **Talk-to-Listen Ratio**: 67:33

1. Instead of: "families can locate ancestors without relying on fragmented paper records" -> What a bar-raiser candidate says instead: "Over 120 families located ancestors within the first quarter."
2. Before: "I built a local cemetery preservation map" -> After: "Lead with active monthly lookups."
3. Before: "without relying on fragmented paper records" -> After: "Quantify record error reduction."
4. Before: "Tell me about your project and why it matters to you." -> After: "Tie personal motivation to user scale."
5. Before: "so families can locate ancestors" -> After: "Specify retention across repeat visits."
`;
    const proseFiveRes = verifyEvaluationDraft(transcript, proseFiveDraft, {
      cachedCriteria: proseFiveCriteria,
    });
    assert.equal(proseFiveRes.passed, true, `Expected prose 1-5 pass, got: ${proseFiveRes.issues.join('; ')}`);

    // Colon inside bold (**Score:** 4) + single scored dimension + Untested (N/A) on 5-point criteria + Sample Reframes without OUTPUT FORMAT + "Suggested answer to the interviewer:"
    const boldColonUntestedFiveDraft = proseFiveDraft
      .replace('### 1. Structure\n- **Score (1–5)**: 4', '### 1. Structure\n- **Score:** 4')
      .replace('### 2. Impact\n- **Score (1–5)**: 3', '### 2. Impact\n- **Score:** Untested (N/A)\n- Suggested answer to the interviewer: "I would measure weekly retention and task completion first."');
    const boldColonUntestedRes = verifyEvaluationDraft(transcript, boldColonUntestedFiveDraft, {
      cachedCriteria: proseFiveCriteria,
    });
    assert.equal(
      boldColonUntestedRes.passed,
      true,
      `Expected **Score:** + Untested (N/A) pass, got: ${boldColonUntestedRes.issues.join('; ')}`,
    );

    const sampleReframesNoHeadingRes = verifyEvaluationDraft(
      transcript,
      `
Structure: 4/5
Impact: 3/5
Pass Verdict: Yes
Strengths: Clear purpose
Weaknesses: Missing adoption numbers
### Sample Reframes
1. "I started by interviewing ten local residents about their needs."
2. "We tracked weekly successful lookups to measure the impact."
`,
      { cachedCriteria: 'Use a 1–5 scoring scale. Include 2–3 Sample Reframes.' },
    );
    assert.equal(
      sampleReframesNoHeadingRes.passed,
      true,
      `Expected Sample Reframes without OUTPUT FORMAT heading to pass, got: ${sampleReframesNoHeadingRes.issues.join('; ')}`,
    );

    // 3-dimension custom 1-5 rubric with /15 TOTAL (no /50 or Overall Impression required)
    const threeDimFifteenRes = verifyEvaluationDraft(
      transcript,
      `
### Clarity
- **Score**: 4/5
- Strengths: Clear focus.
- What to improve: Add numbers.
### Agency
- **Score**: 4/5
### Impact
- **Score**: 3/5
### Summary Scorecard
| Dimension | Score |
|---|---|
| Clarity | 4/5 |
| Agency | 4/5 |
| Impact | 3/5 |
| **TOTAL** | **11/15** |
1. Instead of: "families can locate ancestors" -> After: "Over 120 families found ancestors in Q1."
2. Before: "local cemetery preservation map" -> After: "Map serving 400 plots across three counties."
3. Before: "without relying on fragmented paper records" -> After: "Eliminated 12 hours/week of ledger lookup."
4. Before: "I built a local cemetery preservation map" -> After: "Partnered with two county historical societies."
5. Before: "so families can locate ancestors" -> After: "Track monthly repeat archive queries."
`,
      {
        cachedCriteria:
          '3 dimensions (1-5).\nOUTPUT FORMAT:\nSummary Scorecard with TOTAL /15, Strengths, What to improve.',
      },
    );
    assert.equal(
      threeDimFifteenRes.passed,
      true,
      `Expected 3-dim /15 custom format to pass, got: ${threeDimFifteenRes.issues.join('; ')}`,
    );

    // 2-dimension 1-5 rubric with TOTAL 8/10 must NOT trigger dual-scale rejection
    const twoDimTenTotalRes = verifyEvaluationDraft(
      transcript,
      `
### Clarity
- **Score**: 4/5
- Strengths: Clear focus.
- What to improve: Add numbers.
### Impact
- **Score**: 4/5
### Summary Scorecard
| Dimension | Score |
|---|---|
| Clarity | 4/5 |
| Impact | 4/5 |
| **TOTAL** | **8/10** |
1. Instead of: "families can locate ancestors" -> After: "Over 120 families found ancestors in Q1."
2. Before: "local cemetery preservation map" -> After: "Map serving 400 plots across three counties."
3. Before: "without relying on fragmented paper records" -> After: "Eliminated 12 hours/week of ledger lookup."
4. Before: "I built a local cemetery preservation map" -> After: "Partnered with two county historical societies."
5. Before: "so families can locate ancestors" -> After: "Track monthly repeat archive queries."
`,
      {
        cachedCriteria:
          'Two dimensions (1-5).\nOUTPUT FORMAT:\nSummary Scorecard with TOTAL /10, Strengths, What to improve.',
      },
    );
    assert.equal(
      twoDimTenTotalRes.passed,
      true,
      `Expected 2-dim 1-5 with TOTAL 8/10 to pass, got: ${twoDimTenTotalRes.issues.join('; ')}`,
    );

    // Non-5/non-10 custom scale (1-4) + plain bullet Sample Reframes
    const fourPointBulletRes = verifyEvaluationDraft(
      transcript,
      `
### Clarity
- **Score**: 3/4
### Impact
- **Score**: 3/4
### Strengths
Clear mission.
### What to improve
Quantify adoption.
### Sample Reframes
- "I started by interviewing ten local residents about their search needs."
- "We measured weekly successful lookups across four hundred plots."
`,
      {
        cachedCriteria:
          'Use a 1–4 scoring scale. Include Strengths, What to improve, and 2 Sample Reframes.',
      },
    );
    assert.equal(
      fourPointBulletRes.passed,
      true,
      `Expected 1-4 custom scale + plain bullet reframes to pass, got: ${fourPointBulletRes.issues.join('; ')}`,
    );

    assert.equal(detectCriteriaScoreMax('Use a 0-100 scoring scale.'), 100);
    assert.equal(detectCriteriaScoreMax('Answers should last 1-5 minutes. Score each dimension out of 10.'), 10);
    assert.equal(detectCriteriaScoreMax('Provide 1-3 examples. Score each dimension on a 1-5 scale.'), 5);
    assert.equal(detectCriteriaScoreMax('Provide 1-3 Sample Reframes. Score each dimension out of 5.'), 5);
    assert.equal(detectCriteriaScoreMax('Score each dimension X/5.'), 5);

    const tableNumericOnlyRes = verifyEvaluationDraft(
      transcript,
      '## Summary Scorecard\n| Dimension | Score |\n|---|---|\n| Clarity | 4 |\n| Impact | 3 |\n',
      {
        cachedCriteria:
          'Use a 1–5 scale.\nOUTPUT FORMAT:\nOnly a Summary Scorecard table with Dimension and Score (1–5) columns.',
      },
    );
    assert.equal(
      tableNumericOnlyRes.passed,
      true,
      `Expected table-only 1-5 numeric cells to pass, got: ${tableNumericOnlyRes.issues.join('; ')}`,
    );

    const tableNumericTenRes = verifyEvaluationDraft(
      transcript,
      '## Summary Scorecard\n| Dimension | Score |\n|---|---|\n| Clarity | 8 |\n| Impact | 7 |\n',
      {
        cachedCriteria:
          'OUTPUT FORMAT:\nOnly a Summary Scorecard table with Dimension and Score (1–10) columns.',
      },
    );
    assert.equal(
      tableNumericTenRes.passed,
      true,
      `Expected table-only 1-10 numeric cells to pass, got: ${tableNumericTenRes.issues.join('; ')}`,
    );

    // Custom OUTPUT FORMAT with only Score (1-5), What worked, What to improve (no Strengths or Rewrites requested)
    const minimalCustomFormatRes = verifyEvaluationDraft(
      transcript,
      `
### Clarity
- **Score**: 4/5
- **What worked**: At \`00:25\`, candidate noted "built a local cemetery preservation map".
- **What to improve**: Lead with target users.

### Impact
- **Score**: 3/5
- **What worked**: Clear community goal.
- **What to improve**: Quantify weekly active families.
`,
      {
        cachedCriteria:
          'OUTPUT FORMAT:\nFor each dimension provide Score (1–5), What worked, and What to improve.',
      },
    );
    assert.equal(
      minimalCustomFormatRes.passed,
      true,
      `Expected minimal custom OUTPUT FORMAT to pass without unrequested Strengths/Rewrites, got: ${minimalCustomFormatRes.issues.join('; ')}`,
    );

    const fabricatedSaysRes = verifyEvaluationDraft(
      transcript,
      `${proseFiveDraft}\nThe candidate says: "I increased company revenue by twenty million dollars."\n`,
      { cachedCriteria: proseFiveCriteria },
    );
    assert.equal(fabricatedSaysRes.passed, false);
    assert.ok(fabricatedSaysRes.summary.unverifiedQuotes.some((q) => /twenty million dollars/.test(q)));

    // Untested (N/A) support when only one overall X/10 score is applicable
    const singleScoreUntestedDraft = `
## Rubric Scorecard
| Competency | Score (X/10) | Evidence |
|---|---|---|
| Product Sense | 7/10 | At \`00:25\`, candidate noted "built a local cemetery preservation map so families can locate ancestors". |
| SQL & System Design | Untested (N/A) | Not probed in session. |

## Overall Assessment
- **Overall Score**: 7/10
- **Pass Verdict**: Borderline
- **Talk-to-Listen Ratio**: 67:33
- **Top 3 Strengths**: Clear user pain.
- **Top 3 Critical Weaknesses**: Untested technical areas, brief metrics, no retention check.

1. Instead of: "built a local cemetery preservation map so families can locate ancestors" -> After: "Quantify monthly active lookups."
2. Before: "without relying on fragmented paper records" -> After: "Benchmark lookup latency."
3. Before: "Tell me about your project and why it matters to you." -> After: "Ask for adoption proof."
4. Before: "families can locate ancestors" -> After: "Define success rate."
5. Before: "fragmented paper records" -> After: "Describe digitization pipeline."
`;
    const naRes = verifyEvaluationDraft(transcript, singleScoreUntestedDraft);
    assert.equal(naRes.passed, true, `Expected Untested (N/A) pass, got: ${naRes.issues.join('; ')}`);
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

  it('enforces an overall elapsed-time deadline on fetchPublicUrlBounded across slow-drip responses and slow DNS', async () => {
    const publicResolver = async () => [{ address: '93.184.216.34', family: 4 as const }];
    const slowDripSrv = await startMockHttpServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.write('chunk-0 ');
      const iv = setInterval(() => {
        if (!res.destroyed) {
          res.write('drip ');
        }
      }, 20);
      req.on('close', () => clearInterval(iv));
      res.on('close', () => clearInterval(iv));
    });

    await assert.rejects(
      () =>
        fetchPublicUrlBounded('http://example.com/slow-drip', 1024 * 1024, undefined, {
          timeoutMs: 75,
          _testResolver: publicResolver,
          _testConnectOverride: { host: '127.0.0.1', port: slowDripSrv.port },
        }),
      /timed out after 75ms/i,
    );

    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(
        () =>
          fetchPublicUrlBounded('http://example.com/slow-dns', 1024 * 1024, undefined, {
            timeoutMs: 50,
            _testResolver: () =>
              new Promise((resolve) => {
                dnsTimer = setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 500);
              }),
          }),
        /timed out after 50ms/i,
      );
    } finally {
      if (dnsTimer) clearTimeout(dnsTimer);
    }
  });
});
