import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { int, obj, opt, str } from '@earendil-works/pi-schema';

export type TimestampFormat =
  | 'bracket-hms'
  | 'bracket-ms'
  | 'paren-hms'
  | 'paren-ms'
  | 'dash-hms'
  | 'dash-ms'
  | 'vtt'
  | 'otter'
  | 'plain'
  | 'none';

export type SpeakerRole = 'interviewer' | 'candidate' | 'other';

export interface TranscriptTurn {
  turnIndex: number;
  speaker: string;
  role: SpeakerRole;
  rawTimestamp?: string;
  timestampFormatted?: string;
  timestampSec?: number;
  text: string;
  wordCount: number;
}

export interface ParsedTranscript {
  hasTimestamps: boolean;
  timestampFormat: TimestampFormat;
  validTimestamps: string[];
  minTimestampSec?: number;
  maxTimestampSec?: number;
  turns: TranscriptTurn[];
}

export interface SpeakerMetric {
  speaker: string;
  role: SpeakerRole;
  turns: number;
  words: number;
  sharePct: number;
  durationSec?: number;
  wpm?: number;
}

export interface MonologueInfo {
  turnIndex: number;
  startTimestamp: string;
  endTimestamp: string;
  wordCount: number;
  preview: string;
}

export interface TranscriptMetrics {
  hasTimestamps: boolean;
  timestampFormat: TimestampFormat;
  validTimestamps: string[];
  totalWords: number;
  totalTurns: number;
  candidateWords: number;
  interviewerWords: number;
  candidateTurns: number;
  interviewerTurns: number;
  candidateTalkRatioPct: number;
  interviewerTalkRatioPct: number;
  durationWeightedCandidateRatioPct?: number;
  durationWeightedInterviewerRatioPct?: number;
  candidateWpm?: number;
  interviewerWpm?: number;
  speakerStats: SpeakerMetric[];
  longestCandidateMonologues: MonologueInfo[];
  fillerWords: {
    total: number;
    counts: Record<string, number>;
  };
  ownershipPronouns: {
    firstPersonSingularI: number;
    firstPersonPluralWe: number;
    iToWeRatio: number;
  };
  signposting: {
    totalHits: number;
    matchedKeywords: string[];
  };
}

export interface FollowUpProbe {
  turnIndex: number;
  timestamp: string;
  text: string;
  probeType: 'metric-probe' | 'rescue-probe' | 'ownership-probe' | 'tradeoff-probe' | 'clarification';
}

export interface QaTurn {
  questionNumber: number;
  startTimestamp: string;
  endTimestamp: string;
  interviewerPrompt: string;
  followUpProbes: FollowUpProbe[];
  candidateWordCount: number;
  candidateTurnIndices: number[];
  openingQuote: string;
  closingQuote: string;
}

export interface QuestionQualityAudit {
  questionNumber: number;
  startTimestamp: string;
  endTimestamp: string;
  upfrontFrameworkInFirst25Pct: boolean;
  frameworkEvidence: string[];
  userSegmentationBeforeSolution: boolean;
  segmentationEvidence: string[];
  optionBreadthCount: number;
  optionEvidence: string[];
  metricSpecificity: 'hierarchical' | 'mixed' | 'vanity-generic' | 'none';
  metricDetails: {
    northStarOrPrimaryHits: string[];
    guardrailOrCounterHits: string[];
    genericVanityHits: string[];
  };
  quantifiedImpactMetrics: boolean;
  quantifiedEvidence: string[];
  tradeoffTiming: 'unprompted' | 'interviewer-nudged' | 'missing';
  tradeoffEvidence: string[];
  ownershipSignals: {
    firstPersonSingularI: number;
    firstPersonPluralWe: number;
    weDominant: boolean;
  };
}

export interface VerificationResult {
  passed: boolean;
  issues: string[];
  warnings: string[];
  summary: {
    hasTimestamps: boolean;
    citedTimestampCount: number;
    hallucinatedTimestamps: string[];
    verifiedTimestamps: string[];
    verifiedQuoteCount: number;
    unverifiedQuotes: string[];
    citedTalkRatioPct?: number;
    actualTalkRatioPct: number;
    talkRatioDriftPp?: number;
    missingSections: string[];
    rewriteCount: number;
  };
}

function countWords(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length;
}

export function parseTimestampToSec(raw: string): number | null {
  const cleaned = raw.trim().replace(/^[[(]|[\])]$/g, '').split('.')[0];
  const parts = cleaned.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m >= 60 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    if (m >= 60 || s >= 60) return null;
    return m * 60 + s;
  }
  return null;
}

export function formatSecAsHms(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function classifySpeakerRole(speaker: string): SpeakerRole {
  const s = speaker.trim().toLowerCase();
  if (/^(?:interviewer|host|recruiter|hiring manager|panelist|moderator|q)\b/.test(s)) {
    return 'interviewer';
  }
  if (/^(?:candidate|interviewee|applicant|a)\b/.test(s)) {
    return 'candidate';
  }
  return 'other';
}

export function parseTranscript(transcript: string): ParsedTranscript {
  const lines = (transcript || '').replace(/\r\n/g, '\n').split('\n');
  const turns: TranscriptTurn[] = [];
  let detectedFormat: TimestampFormat = 'none';
  let pendingVttTimestamp: { raw: string; sec: number } | null = null;
  let currentTurn: Omit<TranscriptTurn, 'wordCount'> | null = null;

  const pushCurrent = () => {
    if (!currentTurn) return;
    const text = currentTurn.text.trim();
    if (text) {
      turns.push({
        ...currentTurn,
        text,
        wordCount: countWords(text),
      });
    }
    currentTurn = null;
  };

  const setFormat = (fmt: TimestampFormat) => {
    if (detectedFormat === 'none') {
      detectedFormat = fmt;
    }
  };

  // Patterns ordered from most specific to most general
  const bracketRe = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*:\s*(.*)$/;
  const parenRe = /^\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*:\s*(.*)$/;
  const dashRe = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*:\s*(.*)$/;
  const plainTsSpeakerRe = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*:\s*(.*)$/;
  const otterRe = /^([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s{1,4}(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
  const vttCueRe = /^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?/;
  const untimestampedSpeakerRe = /^([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*:\s*(.+)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'WEBVTT' || /^\d+$/.test(line)) {
      if (line === 'WEBVTT') setFormat('vtt');
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = line.match(vttCueRe))) {
      setFormat('vtt');
      const sec = parseTimestampToSec(m[1]);
      if (sec !== null) {
        pendingVttTimestamp = { raw: m[1], sec };
      }
      continue;
    }

    if ((m = line.match(bracketRe))) {
      const sec = parseTimestampToSec(m[1]);
      if (sec !== null) {
        pushCurrent();
        setFormat(m[1].split(':').length === 3 ? 'bracket-hms' : 'bracket-ms');
        currentTurn = {
          turnIndex: turns.length + 1,
          speaker: m[2].trim(),
          role: classifySpeakerRole(m[2]),
          rawTimestamp: m[1],
          timestampFormatted: formatSecAsHms(sec),
          timestampSec: sec,
          text: m[3] || '',
        };
        pendingVttTimestamp = null;
        continue;
      }
    }

    if ((m = line.match(parenRe))) {
      const sec = parseTimestampToSec(m[1]);
      if (sec !== null) {
        pushCurrent();
        setFormat(m[1].split(':').length === 3 ? 'paren-hms' : 'paren-ms');
        currentTurn = {
          turnIndex: turns.length + 1,
          speaker: m[2].trim(),
          role: classifySpeakerRole(m[2]),
          rawTimestamp: m[1],
          timestampFormatted: formatSecAsHms(sec),
          timestampSec: sec,
          text: m[3] || '',
        };
        pendingVttTimestamp = null;
        continue;
      }
    }

    if ((m = line.match(dashRe))) {
      const sec = parseTimestampToSec(m[1]);
      if (sec !== null) {
        pushCurrent();
        setFormat(m[1].split(':').length === 3 ? 'dash-hms' : 'dash-ms');
        currentTurn = {
          turnIndex: turns.length + 1,
          speaker: m[2].trim(),
          role: classifySpeakerRole(m[2]),
          rawTimestamp: m[1],
          timestampFormatted: formatSecAsHms(sec),
          timestampSec: sec,
          text: m[3] || '',
        };
        pendingVttTimestamp = null;
        continue;
      }
    }

    if ((m = line.match(plainTsSpeakerRe))) {
      const sec = parseTimestampToSec(m[1]);
      if (sec !== null) {
        pushCurrent();
        setFormat('plain');
        currentTurn = {
          turnIndex: turns.length + 1,
          speaker: m[2].trim(),
          role: classifySpeakerRole(m[2]),
          rawTimestamp: m[1],
          timestampFormatted: formatSecAsHms(sec),
          timestampSec: sec,
          text: m[3] || '',
        };
        pendingVttTimestamp = null;
        continue;
      }
    }

    if ((m = line.match(otterRe))) {
      const sec = parseTimestampToSec(m[2]);
      if (sec !== null) {
        pushCurrent();
        setFormat('otter');
        currentTurn = {
          turnIndex: turns.length + 1,
          speaker: m[1].trim(),
          role: classifySpeakerRole(m[1]),
          rawTimestamp: m[2],
          timestampFormatted: formatSecAsHms(sec),
          timestampSec: sec,
          text: '',
        };
        pendingVttTimestamp = null;
        continue;
      }
    }

    if ((m = line.match(untimestampedSpeakerRe))) {
      const candidateSpeaker = m[1].trim();
      // Avoid splitting prose sentences containing colons like "First: we should..."
      const looksLikeSpeaker =
        candidateSpeaker.split(/\s+/).length <= 3 &&
        !/^(?:note|first|second|third|example|e\.g|step|option|summary|metric|question|answer)\b/i.test(
          candidateSpeaker,
        );
      if (looksLikeSpeaker) {
        pushCurrent();
        const ts = pendingVttTimestamp;
        pendingVttTimestamp = null;
        currentTurn = {
          turnIndex: turns.length + 1,
          speaker: candidateSpeaker,
          role: classifySpeakerRole(candidateSpeaker),
          ...(ts
            ? {
                rawTimestamp: ts.raw,
                timestampFormatted: formatSecAsHms(ts.sec),
                timestampSec: ts.sec,
              }
            : {}),
          text: m[2] || '',
        };
        continue;
      }
    }

    // Continuation line
    if (currentTurn) {
      currentTurn.text = currentTurn.text ? `${currentTurn.text} ${line}` : line;
    } else {
      const ts = pendingVttTimestamp;
      pendingVttTimestamp = null;
      currentTurn = {
        turnIndex: turns.length + 1,
        speaker: 'Speaker',
        role: 'other',
        ...(ts
          ? {
              rawTimestamp: ts.raw,
              timestampFormatted: formatSecAsHms(ts.sec),
              timestampSec: ts.sec,
            }
          : {}),
        text: line,
      };
    }
  }

  pushCurrent();

  // Assign heuristic roles when neither role or only one role is explicitly labeled
  const hasExplicitInterviewer = turns.some((t) => t.role === 'interviewer');
  const hasExplicitCandidate = turns.some((t) => t.role === 'candidate');
  if (!hasExplicitInterviewer && !hasExplicitCandidate && turns.length > 0) {
    const distinctSpeakers = Array.from(new Set(turns.map((t) => t.speaker)));
    if (distinctSpeakers.length === 2) {
      const firstSpeaker = turns[0].speaker;
      for (const turn of turns) {
        turn.role = turn.speaker === firstSpeaker ? 'interviewer' : 'candidate';
      }
    }
  } else if (hasExplicitInterviewer !== hasExplicitCandidate) {
    const otherSpeakers = Array.from(
      new Set(turns.filter((t) => t.role === 'other').map((t) => t.speaker)),
    );
    if (otherSpeakers.length === 1) {
      const inferredRole: SpeakerRole = hasExplicitInterviewer ? 'candidate' : 'interviewer';
      for (const turn of turns) {
        if (turn.role === 'other') {
          turn.role = inferredRole;
        }
      }
    }
  }

  const timestamps = turns
    .map((t) => t.timestampFormatted)
    .filter((ts): ts is string => Boolean(ts));
  const secs = turns
    .map((t) => t.timestampSec)
    .filter((s): s is number => typeof s === 'number');

  return {
    hasTimestamps: timestamps.length > 0,
    timestampFormat: timestamps.length > 0 ? detectedFormat : 'none',
    validTimestamps: Array.from(new Set(timestamps)),
    ...(secs.length > 0
      ? {
          minTimestampSec: Math.min(...secs),
          maxTimestampSec: Math.max(...secs),
        }
      : {}),
    turns,
  };
}

const FILLER_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'um', regex: /\bum+\b/gi },
  { label: 'uh', regex: /\buh+\b/gi },
  { label: 'you know', regex: /\byou know\b/gi },
  { label: 'sort of', regex: /\bsort of\b/gi },
  { label: 'kind of', regex: /\bkind of\b/gi },
  { label: 'maybe', regex: /\bmaybe\b/gi },
  { label: 'I guess', regex: /\bi guess\b/gi },
  { label: 'probably', regex: /\bprobably\b/gi },
  // Count conversational filler "like" (preceded by comma or followed by comma/article/hesitation)
  { label: 'like', regex: /(?:,\s*like\b|\blike\s*,|\blike\s+(?:um|uh|you know|basically|actually)\b)/gi },
];

const SIGNPOST_PHRASES = [
  'first',
  'second',
  'third',
  'finally',
  'to summarize',
  'in summary',
  'let me clarify',
  'clarifying question',
  'before jumping',
  'let me break this down',
  'structure my answer',
  'user segment',
  'user segments',
  'pain point',
  'pain points',
  'trade-off',
  'tradeoff',
  'counter-metric',
  'guardrail',
  'north star',
  'on the supply side',
  'does that make sense',
  'let me pause',
];

export function computeTranscriptMetrics(transcript: string): TranscriptMetrics {
  const parsed = parseTranscript(transcript);
  const turns = parsed.turns;

  const totalWords = turns.reduce((acc, t) => acc + t.wordCount, 0);
  const speakerMap = new Map<
    string,
    { speaker: string; role: SpeakerRole; turns: number; words: number; durationSec: number }
  >();

  let candidateWords = 0;
  let interviewerWords = 0;
  let candidateTurns = 0;
  let interviewerTurns = 0;
  let candidateDurationSec = 0;
  let interviewerDurationSec = 0;

  for (let i = 0; i < turns.length; i += 1) {
    const t = turns[i];
    const next = turns[i + 1];
    let turnDur = 0;
    if (
      parsed.hasTimestamps &&
      typeof t.timestampSec === 'number' &&
      next &&
      typeof next.timestampSec === 'number' &&
      next.timestampSec >= t.timestampSec
    ) {
      turnDur = next.timestampSec - t.timestampSec;
    }

    const existing = speakerMap.get(t.speaker) ?? {
      speaker: t.speaker,
      role: t.role,
      turns: 0,
      words: 0,
      durationSec: 0,
    };
    existing.turns += 1;
    existing.words += t.wordCount;
    existing.durationSec += turnDur;
    speakerMap.set(t.speaker, existing);

    if (t.role === 'candidate') {
      candidateWords += t.wordCount;
      candidateTurns += 1;
      candidateDurationSec += turnDur;
    } else if (t.role === 'interviewer') {
      interviewerWords += t.wordCount;
      interviewerTurns += 1;
      interviewerDurationSec += turnDur;
    }
  }

  const dialogueWords = candidateWords + interviewerWords;
  const candidateTalkRatioPct =
    dialogueWords > 0 ? Math.round((candidateWords / dialogueWords) * 1000) / 10 : 0;
  const interviewerTalkRatioPct =
    dialogueWords > 0 ? Math.round((100 - candidateTalkRatioPct) * 10) / 10 : 0;

  const totalMeasuredDur = candidateDurationSec + interviewerDurationSec;
  const durationWeightedCandidateRatioPct =
    parsed.hasTimestamps && totalMeasuredDur > 0
      ? Math.round((candidateDurationSec / totalMeasuredDur) * 1000) / 10
      : undefined;
  const durationWeightedInterviewerRatioPct =
    durationWeightedCandidateRatioPct !== undefined
      ? Math.round((100 - durationWeightedCandidateRatioPct) * 10) / 10
      : undefined;

  const candidateWpm =
    parsed.hasTimestamps && candidateDurationSec > 10
      ? Math.round((candidateWords / candidateDurationSec) * 60)
      : undefined;
  const interviewerWpm =
    parsed.hasTimestamps && interviewerDurationSec > 10
      ? Math.round((interviewerWords / interviewerDurationSec) * 60)
      : undefined;

  const speakerStats: SpeakerMetric[] = Array.from(speakerMap.values()).map((s) => ({
    speaker: s.speaker,
    role: s.role,
    turns: s.turns,
    words: s.words,
    sharePct: totalWords > 0 ? Math.round((s.words / totalWords) * 1000) / 10 : 0,
    ...(parsed.hasTimestamps && s.durationSec > 0
      ? {
          durationSec: s.durationSec,
          wpm: Math.round((s.words / s.durationSec) * 60),
        }
      : {}),
  }));

  const longestCandidateMonologues: MonologueInfo[] = turns
    .map((t, idx) => ({ t, next: turns[idx + 1] }))
    .filter(({ t }) => t.role === 'candidate' && t.wordCount >= 120)
    .sort((a, b) => b.t.wordCount - a.t.wordCount)
    .slice(0, 5)
    .map(({ t, next }) => ({
      turnIndex: t.turnIndex,
      startTimestamp: t.timestampFormatted ?? `Turn #${t.turnIndex}`,
      endTimestamp: next?.timestampFormatted ?? `Turn #${t.turnIndex}`,
      wordCount: t.wordCount,
      preview: t.text.split(/\s+/).slice(0, 32).join(' ') + (t.wordCount > 32 ? '...' : ''),
    }));

  const candidateText = turns
    .filter((t) => t.role === 'candidate' || (candidateTurns === 0 && t.role === 'other'))
    .map((t) => t.text)
    .join(' ');

  const fillerCounts: Record<string, number> = {};
  let fillerTotal = 0;
  for (const fp of FILLER_PATTERNS) {
    const matches = candidateText.match(fp.regex);
    const count = matches ? matches.length : 0;
    fillerCounts[fp.label] = count;
    fillerTotal += count;
  }

  const iMatches = candidateText.match(/\b(?:i|i'm|i've|i'd|i'll|my|mine|myself)\b/gi);
  const weMatches = candidateText.match(/\b(?:we|we're|we've|we'd|we'll|our|ours|ourselves)\b/gi);
  const firstPersonSingularI = iMatches ? iMatches.length : 0;
  const firstPersonPluralWe = weMatches ? weMatches.length : 0;
  const iToWeRatio =
    firstPersonPluralWe > 0
      ? Math.round((firstPersonSingularI / firstPersonPluralWe) * 100) / 100
      : firstPersonSingularI;

  const lowerCandidateText = candidateText.toLowerCase();
  const matchedKeywords: string[] = [];
  let totalHits = 0;
  for (const phrase of SIGNPOST_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = lowerCandidateText.match(new RegExp(`\\b${escaped}\\b`, 'g'));
    if (matches && matches.length > 0) {
      matchedKeywords.push(phrase);
      totalHits += matches.length;
    }
  }

  return {
    hasTimestamps: parsed.hasTimestamps,
    timestampFormat: parsed.timestampFormat,
    validTimestamps: parsed.validTimestamps,
    totalWords,
    totalTurns: turns.length,
    candidateWords,
    interviewerWords,
    candidateTurns,
    interviewerTurns,
    candidateTalkRatioPct,
    interviewerTalkRatioPct,
    ...(durationWeightedCandidateRatioPct !== undefined
      ? { durationWeightedCandidateRatioPct, durationWeightedInterviewerRatioPct }
      : {}),
    ...(candidateWpm !== undefined ? { candidateWpm } : {}),
    ...(interviewerWpm !== undefined ? { interviewerWpm } : {}),
    speakerStats,
    longestCandidateMonologues,
    fillerWords: {
      total: fillerTotal,
      counts: fillerCounts,
    },
    ownershipPronouns: {
      firstPersonSingularI,
      firstPersonPluralWe,
      iToWeRatio,
    },
    signposting: {
      totalHits,
      matchedKeywords,
    },
  };
}

function classifyProbeType(text: string): FollowUpProbe['probeType'] {
  const normalized = text.toLowerCase().replace(/[*_`]/g, '');
  if (
    /\b(?:you specifically|your role|what did you|did you personally|your decision|individually|specifically owned|personally made)\b/.test(
      normalized,
    )
  ) {
    return 'ownership-probe';
  }
  if (/\b(?:metric|measure|success|dau|nps|retention|cannibaliz|counter-metric|guardrail)\b/.test(normalized)) {
    return 'metric-probe';
  }
  if (/\b(?:trade-?off|downside|risk|what about|supply|merchant|driver|host|creator|blind spot|concern)\b/.test(normalized)) {
    return 'tradeoff-probe';
  }
  if (/\b(?:wait|let me pause|hold on|what if|rescue|narrow|focus|too broad)\b/.test(normalized)) {
    return 'rescue-probe';
  }
  return 'clarification';
}

function isPrimaryQuestionTurn(turn: TranscriptTurn, currentBlockHasCandidate: boolean): boolean {
  const lower = turn.text.toLowerCase();
  // Explicit transition to a new question
  if (
    /\b(?:next question|second question|third question|final question|last question|let's move on|move on to|switching gears|shift gears|another question|question\s+[2-9]|tell me about a time|walk me through a time|let's start with)\b/.test(
      lower,
    )
  ) {
    return true;
  }

  // If this is the first substantive question in the transcript
  if (!currentBlockHasCandidate) {
    return true;
  }

  // Follow-up / probe markers keep it attached to the current primary question
  if (
    /\b(?:what metrics|how would you measure|measure success|cannibaliz|what about|specifically|what did you|your own|trade-?off|push back|dig into|follow up|follow-up|supply|merchant|driver|rescue|why did you choose|what happens if|that sounds interesting)\b/.test(
      lower,
    )
  ) {
    return false;
  }

  // New broad product/behavioral/analytical question framing
  if (
    /\b(?:how would you design|imagine you're|suppose you are|design a|how would you improve|describe a situation)\b/.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}

function snippetWords(text: string, fromEnd = false, count = 22): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= count) return words.join(' ');
  return fromEnd
    ? words.slice(words.length - count).join(' ')
    : words.slice(0, count).join(' ');
}

export function extractQaTurns(transcript: string): QaTurn[] {
  const parsed = parseTranscript(transcript);
  const turns = parsed.turns;
  const qaTurns: QaTurn[] = [];

  let activeBlock: {
    questionNumber: number;
    startTurn: TranscriptTurn;
    endTurn: TranscriptTurn;
    interviewerPrompt: string;
    followUpProbes: FollowUpProbe[];
    candidateTurns: TranscriptTurn[];
  } | null = null;

  const finalizeBlock = () => {
    if (!activeBlock) return;
    const candidateWordCount = activeBlock.candidateTurns.reduce((s, t) => s + t.wordCount, 0);
    const firstCand = activeBlock.candidateTurns[0];
    const lastCand = activeBlock.candidateTurns[activeBlock.candidateTurns.length - 1];
    qaTurns.push({
      questionNumber: activeBlock.questionNumber,
      startTimestamp: activeBlock.startTurn.timestampFormatted ?? `Turn #${activeBlock.startTurn.turnIndex}`,
      endTimestamp: activeBlock.endTurn.timestampFormatted ?? `Turn #${activeBlock.endTurn.turnIndex}`,
      interviewerPrompt: activeBlock.interviewerPrompt,
      followUpProbes: activeBlock.followUpProbes,
      candidateWordCount,
      candidateTurnIndices: activeBlock.candidateTurns.map((t) => t.turnIndex),
      openingQuote: firstCand ? snippetWords(firstCand.text, false, 24) : '',
      closingQuote: lastCand ? snippetWords(lastCand.text, true, 24) : '',
    });
    activeBlock = null;
  };

  for (const turn of turns) {
    if (turn.role === 'interviewer') {
      // Skip intro/greeting-only turns that do not pose an interview question yet
      const isPureGreeting =
        !activeBlock &&
        /\b(?:hi|hello|thanks for (?:joining|making time)|welcome|ready to (?:jump in|start|begin))\b/i.test(
          turn.text,
        ) &&
        !/\b(?:how would you|design a|tell me about|walk me through|measure|imagine|suppose|describe a|what metrics)\b/i.test(
          turn.text,
        );

      if (isPureGreeting) {
        continue;
      }
      if (!activeBlock) {
        activeBlock = {
          questionNumber: qaTurns.length + 1,
          startTurn: turn,
          endTurn: turn,
          interviewerPrompt: turn.text,
          followUpProbes: [],
          candidateTurns: [],
        };
      } else if (isPrimaryQuestionTurn(turn, activeBlock.candidateTurns.length > 0)) {
        finalizeBlock();
        activeBlock = {
          questionNumber: qaTurns.length + 1,
          startTurn: turn,
          endTurn: turn,
          interviewerPrompt: turn.text,
          followUpProbes: [],
          candidateTurns: [],
        };
      } else {
        activeBlock.endTurn = turn;
        activeBlock.followUpProbes.push({
          turnIndex: turn.turnIndex,
          timestamp: turn.timestampFormatted ?? `Turn #${turn.turnIndex}`,
          text: turn.text,
          probeType: classifyProbeType(turn.text),
        });
      }
    } else {
      // Skip opening candidate greeting acknowledgment before the first question
      if (
        !activeBlock &&
        qaTurns.length === 0 &&
        turn.role === 'candidate' &&
        turn.wordCount < 45 &&
        /\b(?:yes|sure|definitely|thanks|thank you|ready|excited)\b/i.test(turn.text)
      ) {
        continue;
      }
      if (!activeBlock) {
        activeBlock = {
          questionNumber: qaTurns.length + 1,
          startTurn: turn,
          endTurn: turn,
          interviewerPrompt: '(Implicit / unprinted opening prompt)',
          followUpProbes: [],
          candidateTurns: [],
        };
      }
      activeBlock.endTurn = turn;
      activeBlock.candidateTurns.push(turn);
    }
  }

  finalizeBlock();
  return qaTurns;
}

export function auditAnswerQuality(
  transcript: string,
  questionNumber?: number,
): QuestionQualityAudit[] {
  const parsed = parseTranscript(transcript);
  const qaTurns = extractQaTurns(transcript);
  const selected =
    questionNumber !== undefined
      ? qaTurns.filter((q) => q.questionNumber === questionNumber)
      : qaTurns;

  return selected.map((qa) => {
    const candidateTurns = parsed.turns.filter((t) => qa.candidateTurnIndices.includes(t.turnIndex));
    const fullCandidateText = candidateTurns.map((t) => t.text).join(' ');
    const words = fullCandidateText.trim().split(/\s+/).filter(Boolean);
    const first25Text = words.slice(0, Math.max(15, Math.ceil(words.length * 0.25))).join(' ');

    // 1. Upfront framework in first 25%
    const frameworkPatterns: Array<[string, RegExp]> = [
      ['explicit roadmap/structure', /\b(?:first|structure|framework|walk through|break this down|three parts|start with|goal|clarify)\b/i],
      ['clarifying questions', /\b(?:clarify|assumption|scope|are we focusing|who is the target)\b/i],
      ['STAR framing', /\b(?:situation|context|my role|the goal was)\b/i],
    ];
    const frameworkEvidence: string[] = [];
    for (const [label, re] of frameworkPatterns) {
      if (re.test(first25Text)) frameworkEvidence.push(label);
    }

    // 2. User segmentation before solutioning
    const lowerFull = fullCandidateText.toLowerCase();
    const segRe = /\b(?:segment|segments|persona|personas|first-time|repeat|solo|family|commuter|business traveler|power user|merchant|supplier|driver|creator)\b/i;
    const solRe = /\b(?:option\s+(?:one|1)|we (?:introduce|surface|build)|i (?:would|want to) (?:build|design|propose)|button|tab|mode|feed|notification|app screen|dashboard|algorithm|recommendation engine)\b/i;
    const segMatch = segRe.exec(lowerFull);
    const solMatch = solRe.exec(lowerFull);
    const segmentationEvidence: string[] = [];
    if (segMatch) segmentationEvidence.push(`segment cue: "${segMatch[0]}"`);
    const userSegmentationBeforeSolution = Boolean(
      segMatch && (!solMatch || segMatch.index <= solMatch.index),
    );

    // 3. Option breadth
    const optionMatches =
      fullCandidateText.match(
        /\b(?:option\s+(?:1|2|3|one|two|three)|alternatively|another idea|second approach|third idea|we could also|compare(?:d)? (?:two|three) approaches)\b/gi,
      ) ?? [];
    const optionEvidence = Array.from(new Set(optionMatches.map((m) => m.toLowerCase())));

    // 4. Metric specificity
    const northStarOrPrimary =
      fullCandidateText.match(
        /\b(?:north star|primary metric|activation rate|completion rate|retention|d7|d30|conversion rate|repeat rate|time to value|successful trips?)\b/gi,
      ) ?? [];
    const guardrailOrCounter =
      fullCandidateText.match(
        /\b(?:guardrail|counter-?metric|cannibaliz\w*|bounce rate|opt-?out|churn|latency|error rate|spam|abuse|support ticket)\b/gi,
      ) ?? [];
    const genericVanity =
      fullCandidateText.match(/\b(?:dau|mau|adoption|nps|engagement|page views|clicks)\b/gi) ?? [];

    const northStarOrPrimaryHits = Array.from(new Set(northStarOrPrimary.map((m) => m.toLowerCase())));
    const guardrailOrCounterHits = Array.from(new Set(guardrailOrCounter.map((m) => m.toLowerCase())));
    const genericVanityHits = Array.from(new Set(genericVanity.map((m) => m.toLowerCase())));

    let metricSpecificity: QuestionQualityAudit['metricSpecificity'] = 'none';
    if (northStarOrPrimaryHits.length > 0 && guardrailOrCounterHits.length > 0) {
      metricSpecificity = 'hierarchical';
    } else if (northStarOrPrimaryHits.length > 0 || guardrailOrCounterHits.length > 0) {
      metricSpecificity = 'mixed';
    } else if (genericVanityHits.length > 0) {
      metricSpecificity = 'vanity-generic';
    }

    // 5. Quantified impact metrics
    const quantMatches =
      fullCandidateText.match(
        /(?:\$\d[\d,.]*[kmb]?|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\b\d+\s*(?:ms|seconds?|minutes?|days?|weeks?|months?)\b)/gi,
      ) ?? [];
    const quantifiedEvidence = Array.from(new Set(quantMatches)).slice(0, 10);

    // 6. Unprompted vs interviewer-nudged trade-offs
    const firstProbeTurnIdx = qa.followUpProbes[0]?.turnIndex ?? Number.POSITIVE_INFINITY;
    const preProbeText = candidateTurns
      .filter((t) => t.turnIndex < firstProbeTurnIdx)
      .map((t) => t.text)
      .join(' ');
    const postProbeText = candidateTurns
      .filter((t) => t.turnIndex > firstProbeTurnIdx)
      .map((t) => t.text)
      .join(' ');
    const tradeoffRe = /\b(?:trade-?off|downside|risk|cannibaliz|supply-?side|cold start|privacy|drawback|cost of|negative impact)\b/gi;
    const preMatches = preProbeText.match(tradeoffRe) ?? [];
    const postMatches = postProbeText.match(tradeoffRe) ?? [];
    let tradeoffTiming: QuestionQualityAudit['tradeoffTiming'] = 'missing';
    if (preMatches.length > 0) {
      tradeoffTiming = 'unprompted';
    } else if (postMatches.length > 0) {
      tradeoffTiming = 'interviewer-nudged';
    }
    const tradeoffEvidence = Array.from(new Set([...preMatches, ...postMatches].map((s) => s.toLowerCase())));

    // 7. Ownership ("I" vs "we")
    const iCount = (fullCandidateText.match(/\b(?:i|i'm|i've|i'd|i'll|my|mine|myself)\b/gi) ?? []).length;
    const weCount = (fullCandidateText.match(/\b(?:we|we're|we've|we'd|we'll|our|ours|ourselves)\b/gi) ?? []).length;

    return {
      questionNumber: qa.questionNumber,
      startTimestamp: qa.startTimestamp,
      endTimestamp: qa.endTimestamp,
      upfrontFrameworkInFirst25Pct: frameworkEvidence.length > 0,
      frameworkEvidence,
      userSegmentationBeforeSolution,
      segmentationEvidence,
      optionBreadthCount: optionEvidence.length,
      optionEvidence,
      metricSpecificity,
      metricDetails: {
        northStarOrPrimaryHits,
        guardrailOrCounterHits,
        genericVanityHits,
      },
      quantifiedImpactMetrics: quantifiedEvidence.length > 0,
      quantifiedEvidence,
      tradeoffTiming,
      tradeoffEvidence,
      ownershipSignals: {
        firstPersonSingularI: iCount,
        firstPersonPluralWe: weCount,
        weDominant: weCount > iCount && weCount >= 3,
      },
    };
  });
}

function normalizeForQuoteMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTalkRatioPair(raw: string, fullLine: string): boolean {
  const parts = raw.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.length === 2 && parts[0] + parts[1] === 100) {
    return true;
  }
  if (parts.length === 2 && /ratio|talk[- ]to[- ]listen|candidate[- ]to[- ]interviewer|split/i.test(fullLine)) {
    return true;
  }
  return false;
}

export function verifyEvaluationDraft(
  transcript: string,
  draftMarkdown: string,
): VerificationResult {
  const parsed = parseTranscript(transcript);
  const metrics = computeTranscriptMetrics(transcript);
  const issues: string[] = [];
  const warnings: string[] = [];

  // 1. Check cited timestamps line by line
  const citedTimestamps: string[] = [];
  const hallucinatedTimestamps: string[] = [];
  const verifiedTimestamps: string[] = [];
  const turnSecs = parsed.turns
    .map((t) => t.timestampSec)
    .filter((s): s is number => typeof s === 'number');

  const lines = (draftMarkdown || '').split('\n');
  for (const line of lines) {
    const tsMatches = line.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? [];
    for (const rawTs of tsMatches) {
      if (isTalkRatioPair(rawTs, line)) {
        continue;
      }
      const sec = parseTimestampToSec(rawTs);
      if (sec === null) {
        // Could be a non-clock ratio like 80:20 (handled above) or invalid time like 99:99
        continue;
      }
      // Exclude scores or years/dates unless formatted like clock
      const formatted = formatSecAsHms(sec);
      citedTimestamps.push(rawTs);

      if (!parsed.hasTimestamps) {
        if (!hallucinatedTimestamps.includes(rawTs)) {
          hallucinatedTimestamps.push(rawTs);
        }
      } else {
        const minSec = parsed.minTimestampSec ?? 0;
        const maxSec = (parsed.maxTimestampSec ?? 0) + 60;
        const nearestDist =
          turnSecs.length > 0
            ? Math.min(...turnSecs.map((ts) => Math.abs(ts - sec)))
            : Number.POSITIVE_INFINITY;

        if (sec < Math.max(0, minSec - 15) || sec > maxSec || nearestDist > 90) {
          if (!hallucinatedTimestamps.includes(rawTs)) {
            hallucinatedTimestamps.push(rawTs);
          }
        } else if (!verifiedTimestamps.includes(formatted)) {
          verifiedTimestamps.push(formatted);
        }
      }
    }
  }

  if (!parsed.hasTimestamps && hallucinatedTimestamps.length > 0) {
    issues.push(
      `Hallucinated clock timestamps on an untimestamped transcript: ${hallucinatedTimestamps.join(', ')}. Cite Turn #N instead of fabricated timestamps.`,
    );
  } else if (parsed.hasTimestamps && hallucinatedTimestamps.length > 0) {
    issues.push(
      `Out-of-range or unanchored timestamps cited: ${hallucinatedTimestamps.join(', ')}. Anchor only to observed transcript timestamps.`,
    );
  }

  // 2. Verify quoted snippets (>= 20 chars) excluding prescribed "After" rewrites
  const normalizedTranscript = normalizeForQuoteMatch(transcript);
  let verifiedQuoteCount = 0;
  const unverifiedQuotes: string[] = [];

  for (const line of lines) {
    const isPrescribedRewriteLine =
      /^\s*(?:[-*]|\d+\.)?\s*(?:\*\*)?(?:after|suggested|say instead|stronger alternative|rewrite)\b/i.test(
        line,
      );
    const quoteMatches = line.matchAll(/["“]([^"”\n]{20,300})["”]/g);
    for (const qm of quoteMatches) {
      const rawQuote = qm[1].trim();
      // If a single line has both "Instead of/Before: "..."" -> "After: "..."" skip only the part after "After:"
      const idx = qm.index ?? 0;
      const prefixBeforeQuote = line.slice(0, idx).toLowerCase();
      if (isPrescribedRewriteLine || /(?:->|→|\bafter\b|\bsay\b|\btry\b)\s*:?\s*$/i.test(prefixBeforeQuote)) {
        continue;
      }

      const normQuote = normalizeForQuoteMatch(rawQuote.replace(/\.\.\.|…/g, ' '));
      if (normQuote.length < 15) continue;

      if (normalizedTranscript.includes(normQuote)) {
        verifiedQuoteCount += 1;
      } else {
        // Also check 5-word sliding substring tolerance if minor ellipsis/cleanup
        const words = normQuote.split(' ').filter(Boolean);
        const core = words.slice(0, Math.min(6, words.length)).join(' ');
        if (words.length >= 5 && normalizedTranscript.includes(core)) {
          verifiedQuoteCount += 1;
        } else {
          unverifiedQuotes.push(rawQuote);
        }
      }
    }
  }

  if (unverifiedQuotes.length > 0) {
    issues.push(
      `Unverified verbatim quote(s) not found in transcript: ${unverifiedQuotes
        .slice(0, 3)
        .map((q) => `"${q.slice(0, 60)}"`)
        .join('; ')}`,
    );
  }

  // 3. Compare cited talk-to-listen ratio against actual candidateTalkRatioPct
  let citedTalkRatioPct: number | undefined;
  let talkRatioDriftPp: number | undefined;

  const ratioContextRe =
    /(?:talk[- ]to[- ]listen|talk\s*\/\s*listen|candidate[- ]to[- ]interviewer|talk ratio)[^\n]{0,60}?(\d{1,2}(?:\.\d+)?)\s*(?::|\/|%)/i;
  const ratioMatch = draftMarkdown.match(ratioContextRe);
  if (ratioMatch) {
    const val = Number.parseFloat(ratioMatch[1]);
    if (!Number.isNaN(val) && val > 0 && val < 100) {
      citedTalkRatioPct = val;
      talkRatioDriftPp = Math.round(Math.abs(val - metrics.candidateTalkRatioPct) * 10) / 10;
      if (talkRatioDriftPp > 5) {
        issues.push(
          `Talk-to-listen ratio drift of ${talkRatioDriftPp}pp: draft cites ${val}% candidate talk, while measured transcript is ${metrics.candidateTalkRatioPct}:${metrics.interviewerTalkRatioPct}.`,
        );
      }
    }
  } else {
    warnings.push('No explicit talk-to-listen ratio found in draft.');
  }

  // 4. Required sections check
  const missingSections: string[] = [];
  const lowerDraft = draftMarkdown.toLowerCase();

  const scoreMatches = draftMarkdown.match(/\b\d+(?:\.\d+)?\s*\/\s*10\b/g) ?? [];
  if (scoreMatches.length === 0) {
    missingSections.push('per-question and overall X/10 score');
  } else if (scoreMatches.length === 1) {
    missingSections.push('per-question X/10 scores (only 1 score found)');
  }

  if (!/\b(?:yes|no|borderline)\b/i.test(draftMarkdown) || !/(?:verdict|pass|bar)/i.test(lowerDraft)) {
    missingSections.push('pass verdict (Yes/No/Borderline)');
  }
  if (!/strength/i.test(lowerDraft)) {
    missingSections.push('top 3 strengths');
  }
  if (!/weakness|area(?:s)? for improvement|gap/i.test(lowerDraft)) {
    missingSections.push('top 3 weaknesses');
  }

  // Count concrete rewrites ("Instead of" / "Before" -> "After" or numbered actionable recommendations)
  const rewriteMarkers = draftMarkdown.match(/(?:instead of|before\s*:|->\s*after|→\s*\*\*after|after\s*:)/gi) ?? [];
  const rewritePairs = Math.floor(rewriteMarkers.length / 2);
  const recMatches =
    draftMarkdown.match(/^\s*(?:\d+\.|[-*])\s+(?:\*\*)?(?:instead of|before|recommendation)/gim) ?? [];
  const rewriteCount = Math.max(rewritePairs, recMatches.length);
  if (rewriteCount < 5) {
    missingSections.push(`5-7 concrete "Instead of"/"Before" -> "After" rewrites (found ${rewriteCount})`);
  }

  for (const m of missingSections) {
    issues.push(`Missing required evaluation element: ${m}`);
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
    summary: {
      hasTimestamps: parsed.hasTimestamps,
      citedTimestampCount: citedTimestamps.length,
      hallucinatedTimestamps,
      verifiedTimestamps,
      verifiedQuoteCount,
      unverifiedQuotes,
      ...(citedTalkRatioPct !== undefined ? { citedTalkRatioPct } : {}),
      actualTalkRatioPct: metrics.candidateTalkRatioPct,
      ...(talkRatioDriftPp !== undefined ? { talkRatioDriftPp } : {}),
      missingSections,
      rewriteCount,
    },
  };
}

export function createAnalyzeTranscriptMetricsTool(
  getTranscript: () => string,
  recordToolCall?: (name: string) => void,
): AgentTool {
  const schema = obj({});
  return {
    name: 'analyze_transcript_metrics',
    label: 'Analyze transcript talk metrics',
    description:
      'Parse the interview transcript to detect timestamp format, valid timestamps, exact per-speaker word counts, candidate vs interviewer talk-to-listen ratio, longest candidate monologues (>=120 words), filler/hedging word counts, "I" vs "we" ownership pronouns, and signposting hits.',
    parameters: schema,
    execute: async (): Promise<AgentToolResult<Record<string, never>>> => {
      const metrics = computeTranscriptMetrics(getTranscript());
      recordToolCall?.('analyze_transcript_metrics');
      return {
        content: [{ type: 'text', text: JSON.stringify(metrics) }],
        details: {},
        isError: false,
      };
    },
  };
}

export function createExtractQaTurnsTool(
  getTranscript: () => string,
  recordToolCall?: (name: string) => void,
): AgentTool {
  const schema = obj({});
  return {
    name: 'extract_qa_turns',
    label: 'Extract Q&A turns and follow-up probes',
    description:
      'Segment the transcript into primary interview questions plus attached follow-up/rescue/pushback probes, with start/end timestamps (or Turn #N), candidate word counts, turn indices, and verbatim opening/closing quotes.',
    parameters: schema,
    execute: async (): Promise<AgentToolResult<Record<string, never>>> => {
      const qaTurns = extractQaTurns(getTranscript());
      recordToolCall?.('extract_qa_turns');
      return {
        content: [{ type: 'text', text: JSON.stringify({ questionCount: qaTurns.length, questions: qaTurns }) }],
        details: {},
        isError: false,
      };
    },
  };
}

export function createAuditAnswerQualityTool(
  getTranscript: () => string,
  recordToolCall?: (name: string) => void,
): AgentTool {
  const schema = obj({
    questionNumber: opt(
      int({
        description: 'Optional 1-based question number to audit. Omit to audit all questions.',
        minimum: 1,
      }),
    ),
  });
  return {
    name: 'audit_answer_quality',
    label: 'Audit answer structure and metrics',
    description:
      'Audit each question (or a specific questionNumber) for upfront framework in the first 25%, user segmentation before solutioning, option breadth, metric specificity (North Star + guardrail/counter-metric vs generic DAU/adoption/NPS), quantified impact, unprompted vs interviewer-nudged trade-offs, and "I" vs "we" ownership.',
    parameters: schema,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const qNum =
        typeof (params as { questionNumber?: unknown })?.questionNumber === 'number'
          ? (params as { questionNumber: number }).questionNumber
          : undefined;
      const audits = auditAnswerQuality(getTranscript(), qNum);
      recordToolCall?.('audit_answer_quality');
      return {
        content: [{ type: 'text', text: JSON.stringify({ audits }) }],
        details: {},
        isError: false,
      };
    },
  };
}

export function createVerifyEvaluationDraftTool(
  getTranscript: () => string,
  recordToolCall?: (name: string) => void,
  onVerified?: (result: VerificationResult) => void,
): AgentTool {
  const schema = obj({
    draftMarkdown: str({
      description: 'Complete Markdown evaluation draft to verify against transcript ground truth before returning final response.',
    }),
  });
  return {
    name: 'verify_evaluation_draft',
    label: 'Verify evaluation draft citations',
    description:
      'Deterministically verify your draft evaluation against the parsed transcript: flags hallucinated clock timestamps when untimestamped, verifies quoted snippets (>=20 chars), checks talk-to-listen ratio accuracy (<=5pp drift), and checks required sections and 5-7 Before/After rewrites. Always call this before your final response.',
    parameters: schema,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const draft = String((params as { draftMarkdown?: unknown })?.draftMarkdown ?? '');
      const result = verifyEvaluationDraft(getTranscript(), draft);
      recordToolCall?.('verify_evaluation_draft');
      onVerified?.(result);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: {},
        isError: false,
      };
    },
  };
}
