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
  | 'inline'
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
  sourceDocumentType: 'verbatim_transcript' | 'secondary_evaluation_or_notes';
  coachedSessionDetected: boolean;
  interviewerCoachingBlocks: MonologueInfo[];
  qaOnlyCandidateTalkRatioPct?: number;
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

export interface VerifyEvaluationOptions {
  cachedCriteria?: string;
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

export function classifySpeakerRole(speaker: string): SpeakerRole {
  const s = speaker.trim().toLowerCase();
  if (/^(?:interviewer(?:\s*\d*)?|host|recruiter|hiring manager|panelist|moderator|q|i\d+)\b/.test(s)) {
    return 'interviewer';
  }
  if (/^(?:candidate(?:\s*\d*)?|interviewee|applicant|a|c\d+)\b/.test(s)) {
    return 'candidate';
  }
  return 'other';
}

const METADATA_HEADER_KEY_RE =
  /^(?:(?:program|date|interview\s+date|interview\s+type|interviewers|duration|location|role|position|overall\s+score|title|summary|scorecard|topic|subject|attendees?|participants?|meeting|session|company|recording|transcript)\b|interviewer\(s\))/i;

const PROSE_COLON_PREFIX_RE =
  /^(?:note|notes|first|second|third|example|e\.?g|step|steps|option|options|metric|metrics|question|questions|answer|answers|strength|strengths|weakness|weaknesses|verdict|before|after|instead\s+of|takeaway|takeaways|key\s+takeaways?|overview|background|context|problem|goal|goals|recommendation|recommendations|feedback|pros|cons|risk|risks|timeline|next\s+steps?|action\s+items?|follow[- ]?ups?|rubric|scores?|rating|evaluation|calibration|observations?|highlights?|concerns?|conclusion)\b/i;

function normalizeSpeakerPrefixLine(line: string): { normalized: string; hadEmphasis: boolean } {
  // "**Speaker:** text", "*Speaker:* text", "__Speaker:__ text"
  let m = line.match(/^(\*{1,3}|_{1,2})([^*\n_]{1,50}?):\1\s*(.*)$/);
  if (m) {
    return { normalized: `${m[2].trim()}: ${m[3]}`, hadEmphasis: true };
  }
  // "**Speaker**: text", "*Speaker*: text", "__Speaker__: text"
  m = line.match(/^(\*{1,3}|_{1,2})([^*\n_]{1,50}?)\1\s*:\s*(.*)$/);
  if (m) {
    return { normalized: `${m[2].trim()}: ${m[3]}`, hadEmphasis: true };
  }
  return { normalized: line, hadEmphasis: false };
}

function isCandidateMetadataHeader(
  speaker: string,
  value: string,
  isAtTop: boolean,
  hadEmphasis: boolean,
  nextLineIsMetadata = false,
): boolean {
  if (speaker.trim().toLowerCase() !== 'candidate') return false;
  if (!isAtTop) return false;
  const trimmedVal = value.trim();
  const words = countWords(trimmedVal);
  if (words === 0 || words > 5) return false;
  if (/[?!.,]$/.test(trimmedVal)) return false;
  if (nextLineIsMetadata) return true;
  if (!hadEmphasis) return false;
  // With markdown emphasis at top of doc (e.g. "**Candidate:** Jordan Lee"), match only Title-Case names or ID tags
  return /^(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}|[A-Z]{1,4}[-_]?\d+|Anonymous|Redacted|N\/A|TBD)$/.test(
    trimmedVal,
  );
}

function isMetadataKeyLine(line: string): boolean {
  const { normalized } = normalizeSpeakerPrefixLine(line);
  const kv = normalized.match(/^([A-Za-z][A-Za-z0-9 ._()/-]{0,40}?)\s*:\s*(?!\/\/)(.*)$/);
  return Boolean(kv && METADATA_HEADER_KEY_RE.test(kv[1].trim()));
}

function isTopHeaderNoise(line: string, nextNonEmptyLine?: string): boolean {
  const { normalized, hadEmphasis } = normalizeSpeakerPrefixLine(line);
  const kv = normalized.match(/^([A-Za-z][A-Za-z0-9 ._()/-]{0,40}?)\s*:\s*(?!\/\/)(.*)$/);
  if (kv) {
    const key = kv[1].trim();
    const val = kv[2] ?? '';
    const nextIsMeta = nextNonEmptyLine ? isMetadataKeyLine(nextNonEmptyLine) : false;
    if (
      METADATA_HEADER_KEY_RE.test(key) ||
      isCandidateMetadataHeader(key, val, true, hadEmphasis, nextIsMeta)
    ) {
      return true;
    }
    // Never drop an explicit or valid speaker dialogue line just because it mentions a time or date
    if (
      classifySpeakerRole(key) !== 'other' ||
      (key.split(/\s+/).length <= 3 && !PROSE_COLON_PREFIX_RE.test(key))
    ) {
      return false;
    }
  }
  if (countWords(line) <= 12) {
    const stripped = line.replace(/[*_]/g, '').trim();
    if (
      /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}\b/i.test(stripped) ||
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(stripped) ||
      /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(stripped) ||
      /\b\d{1,2}:\d{2}\s*(?:AM|PM|PST|PDT|EST|EDT|CST|CDT|MST|MDT|UTC|GMT)\b/i.test(stripped) ||
      /^(?:google\s+meet\s+transcript|otter\.ai\s+transcript|meeting\s+transcript|interview\s+transcript|transcript|notes\s+by\s+gemini|attendees?|participants?)\b/i.test(
        stripped,
      )
    ) {
      return true;
    }
  }
  return false;
}

function isSpeakerMetadataGuard(
  candidateSpeaker: string,
  textAfterColon: string,
  isAtTop: boolean,
  hadEmphasis: boolean,
  nextLineIsMetadata = false,
): boolean {
  return (
    METADATA_HEADER_KEY_RE.test(candidateSpeaker) ||
    PROSE_COLON_PREFIX_RE.test(candidateSpeaker) ||
    isCandidateMetadataHeader(
      candidateSpeaker,
      textAfterColon,
      isAtTop,
      hadEmphasis,
      nextLineIsMetadata,
    )
  );
}

export function parseTranscript(transcript: string): ParsedTranscript {
  const lines = (transcript || '').replace(/\r\n/g, '\n').split('\n');
  const turns: TranscriptTurn[] = [];
  let detectedFormat: TimestampFormat = 'none';
  let pendingVttTimestamp: { raw: string; sec: number } | null = null;
  let activeSectionTimestamp: { raw: string; sec: number } | null = null;
  const footerTimestampSecs: number[] = [];
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
  const timestampedPatterns: Array<{ re: RegExp; fmt: (ts: string) => TimestampFormat }> = [
    {
      re: /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/,
      fmt: (ts) => (ts.split(':').length === 3 ? 'bracket-hms' : 'bracket-ms'),
    },
    {
      re: /^\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*(.+)$/,
      fmt: (ts) => (ts.split(':').length === 3 ? 'paren-hms' : 'paren-ms'),
    },
    {
      re: /^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+)$/,
      fmt: (ts) => (ts.split(':').length === 3 ? 'dash-hms' : 'dash-ms'),
    },
    {
      re: /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/,
      fmt: () => 'plain',
    },
  ];
  const speakerColonRe = /^([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*:\s*(?!\/\/)(.*)$/;
  const otterRe = /^([*_]{0,3}[A-Za-z][A-Za-z0-9 ._-]{0,40}?[*_]{0,3})\s{1,4}(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
  const vttCueRe = /^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?/;
  const standaloneTsRe = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?$/;
  const transcriptionEndedRe = /^Transcription ended after\s+(\d{1,2}:\d{2}(?::\d{2})?)\b/i;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx].trim();
    if (!line) continue;
    if (line === 'WEBVTT' || /^\d+$/.test(line)) {
      if (line === 'WEBVTT') setFormat('vtt');
      continue;
    }

    const findNextNonEmptyLine = (): string | undefined => {
      for (let j = lineIdx + 1; j < lines.length; j += 1) {
        const next = lines[j].trim();
        if (next) return next;
      }
      return undefined;
    };

    let m: RegExpMatchArray | null;
    if ((m = line.match(transcriptionEndedRe))) {
      pushCurrent();
      const footerSec = parseTimestampToSec(m[1]);
      if (footerSec !== null) {
        footerTimestampSecs.push(footerSec);
      }
      activeSectionTimestamp = null;
      pendingVttTimestamp = null;
      continue;
    }

    if ((m = line.match(vttCueRe))) {
      pushCurrent();
      setFormat('vtt');
      activeSectionTimestamp = null;
      const sec = parseTimestampToSec(m[1]);
      if (sec !== null) {
        pendingVttTimestamp = { raw: m[1], sec };
      }
      continue;
    }

    if ((m = line.match(standaloneTsRe))) {
      const sec = parseTimestampToSec(m[1]);
      if (sec !== null) {
        pushCurrent();
        setFormat(m[1].split(':').length === 3 ? 'otter' : 'plain');
        activeSectionTimestamp = { raw: m[1], sec };
        pendingVttTimestamp = { raw: m[1], sec };
        continue;
      }
    }

    let matchedTimestamped = false;
    for (const pat of timestampedPatterns) {
      if ((m = line.match(pat.re))) {
        const sec = parseTimestampToSec(m[1]);
        if (sec !== null) {
          const { normalized, hadEmphasis } = normalizeSpeakerPrefixLine(m[2]);
          const spkMatch = normalized.match(speakerColonRe);
          if (spkMatch) {
            const spk = spkMatch[1].trim();
            const textAfter = spkMatch[2] || '';
            const isAtTop = turns.length === 0 && !currentTurn;
            const validSpeakerWordCount =
              spk.split(/\s+/).length <= 3 || classifySpeakerRole(spk) !== 'other';
            if (
              validSpeakerWordCount &&
              !isSpeakerMetadataGuard(spk, textAfter, isAtTop, hadEmphasis)
            ) {
              pushCurrent();
              setFormat(pat.fmt(m[1]));
              currentTurn = {
                turnIndex: turns.length + 1,
                speaker: spk,
                role: classifySpeakerRole(spk),
                rawTimestamp: m[1],
                timestampFormatted: formatSecAsHms(sec),
                timestampSec: sec,
                text: textAfter.trim(),
              };
              pendingVttTimestamp = null;
              activeSectionTimestamp = null;
              matchedTimestamped = true;
              break;
            }
            // Timestamped prose/heading line (not a valid speaker): preserve timestamp as 'Speaker' turn
            pushCurrent();
            setFormat(pat.fmt(m[1]));
            currentTurn = {
              turnIndex: turns.length + 1,
              speaker: 'Speaker',
              role: 'other',
              rawTimestamp: m[1],
              timestampFormatted: formatSecAsHms(sec),
              timestampSec: sec,
              text: m[2].trim(),
            };
            pendingVttTimestamp = null;
            activeSectionTimestamp = null;
            matchedTimestamped = true;
            break;
          }
        }
      }
    }
    if (matchedTimestamped) continue;

    if ((m = line.match(otterRe))) {
      const sec = parseTimestampToSec(m[2]);
      const cleanedSpeaker = m[1].replace(/^[*_]+|[*_]+$/g, '').trim();
      const isDateOnly =
        /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}$/i.test(cleanedSpeaker);
      if (sec !== null && cleanedSpeaker && !isDateOnly && !METADATA_HEADER_KEY_RE.test(cleanedSpeaker)) {
        pushCurrent();
        setFormat('otter');
        currentTurn = {
          turnIndex: turns.length + 1,
          speaker: cleanedSpeaker,
          role: classifySpeakerRole(cleanedSpeaker),
          rawTimestamp: m[2],
          timestampFormatted: formatSecAsHms(sec),
          timestampSec: sec,
          text: '',
        };
        pendingVttTimestamp = null;
        activeSectionTimestamp = null;
        continue;
      }
    }

    if (
      turns.length === 0 &&
      !currentTurn &&
      !activeSectionTimestamp &&
      !pendingVttTimestamp &&
      isTopHeaderNoise(line, findNextNonEmptyLine())
    ) {
      continue;
    }

    const { normalized: normLine, hadEmphasis } = normalizeSpeakerPrefixLine(line);
    if ((m = normLine.match(speakerColonRe))) {
      const candidateSpeaker = m[1].trim();
      const textAfterColon = m[2] ?? '';
      const hasTextOrExplicitRole =
        textAfterColon.trim().length > 0 || classifySpeakerRole(candidateSpeaker) !== 'other';
      const isAtTop = turns.length === 0 && !currentTurn;
      const nextLine = findNextNonEmptyLine();
      const nextIsMeta = nextLine ? isMetadataKeyLine(nextLine) : false;
      // Avoid splitting prose sentences containing colons like "First: we should..." or metadata headers
      const looksLikeSpeaker =
        hasTextOrExplicitRole &&
        candidateSpeaker.split(/\s+/).length <= 3 &&
        !isSpeakerMetadataGuard(candidateSpeaker, textAfterColon, isAtTop, hadEmphasis, nextIsMeta);
      if (looksLikeSpeaker) {
        pushCurrent();
        const ts = pendingVttTimestamp ?? activeSectionTimestamp;
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
          text: textAfterColon.trim(),
        };
        continue;
      }
    }

    // Continuation line
    if (currentTurn) {
      currentTurn.text = currentTurn.text ? `${currentTurn.text} ${line}` : line;
    } else {
      const ts = pendingVttTimestamp ?? activeSectionTimestamp;
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
  const totalDialogueWords = turns.reduce((acc, t) => acc + t.wordCount, 0);
  const speakerStatsMap = new Map<
    string,
    { speaker: string; role: SpeakerRole; words: number; turns: number; questionTurns: number }
  >();
  for (const turn of turns) {
    if (turn.speaker === 'Speaker') continue;
    const entry = speakerStatsMap.get(turn.speaker) ?? {
      speaker: turn.speaker,
      role: turn.role,
      words: 0,
      turns: 0,
      questionTurns: 0,
    };
    entry.words += turn.wordCount;
    entry.turns += 1;
    if (/\?/.test(turn.text)) {
      entry.questionTurns += 1;
    }
    speakerStatsMap.set(turn.speaker, entry);
  }

  const allNamedSpeakers = Array.from(speakerStatsMap.values());
  const substantiveSpeakers = allNamedSpeakers.filter(
    (s) => totalDialogueWords < 100 || s.words >= 15,
  );
  // Preserve brief speakers (e.g. concise <15-word interviewer) when there are exactly 2 named speakers
  const realSpeakers =
    substantiveSpeakers.length < 2 && allNamedSpeakers.length === 2
      ? allNamedSpeakers
      : substantiveSpeakers;

  const hasExplicitInterviewer = turns.some((t) => t.role === 'interviewer');
  const hasExplicitCandidate = turns.some((t) => t.role === 'candidate');

  const speakerInterviewerScore = (s: { words: number; turns: number; questionTurns: number }) =>
    (s.questionTurns / Math.max(1, s.turns)) * 2 - s.words / Math.max(1, s.turns) / 120;

  if (hasExplicitInterviewer !== hasExplicitCandidate) {
    const otherRealSpeakers = realSpeakers.filter((s) => s.role === 'other');
    const allOtherNamedSpeakers = allNamedSpeakers.filter((s) => s.role === 'other');
    if (allOtherNamedSpeakers.length <= 3) {
      const inferredBySpeaker = new Map<string, SpeakerRole>();
      if (otherRealSpeakers.length === 1) {
        inferredBySpeaker.set(
          otherRealSpeakers[0].speaker,
          hasExplicitInterviewer ? 'candidate' : 'interviewer',
        );
      } else if (otherRealSpeakers.length === 2) {
        const [a, b] = otherRealSpeakers;
        const scoreA = speakerInterviewerScore(a);
        const scoreB = speakerInterviewerScore(b);
        if (hasExplicitInterviewer) {
          // Disambiguate e.g. Interviewer + named interviewer Alice + candidate Bob
          if (Math.abs(scoreA - scoreB) > 0.15) {
            if (scoreA > scoreB) {
              inferredBySpeaker.set(a.speaker, 'interviewer');
              inferredBySpeaker.set(b.speaker, 'candidate');
            } else {
              inferredBySpeaker.set(b.speaker, 'interviewer');
              inferredBySpeaker.set(a.speaker, 'candidate');
            }
          }
        } else {
          // Explicit candidate + 2 remaining speakers (e.g. 2 panelists, or 1 panelist + 1 non-question shadow)
          if (a.questionTurns > 0 && b.questionTurns > 0) {
            inferredBySpeaker.set(a.speaker, 'interviewer');
            inferredBySpeaker.set(b.speaker, 'interviewer');
          } else if (Math.abs(scoreA - scoreB) > 0.15) {
            inferredBySpeaker.set(scoreA > scoreB ? a.speaker : b.speaker, 'interviewer');
          } else {
            inferredBySpeaker.set(a.speaker, 'interviewer');
            inferredBySpeaker.set(b.speaker, 'interviewer');
          }
        }
      }
      for (const turn of turns) {
        const inferred = inferredBySpeaker.get(turn.speaker);
        if (turn.role === 'other' && inferred) {
          turn.role = inferred;
        }
      }
    }
  } else if (!hasExplicitInterviewer && !hasExplicitCandidate && realSpeakers.length >= 2) {
    const inferredBySpeaker = new Map<string, SpeakerRole>();
    if (realSpeakers.length === 2) {
      const [a, b] = realSpeakers;
      const scoreA = speakerInterviewerScore(a);
      const scoreB = speakerInterviewerScore(b);
      if (Math.abs(scoreA - scoreB) > 0.15) {
        if (scoreA > scoreB) {
          inferredBySpeaker.set(a.speaker, 'interviewer');
          inferredBySpeaker.set(b.speaker, 'candidate');
        } else {
          inferredBySpeaker.set(b.speaker, 'interviewer');
          inferredBySpeaker.set(a.speaker, 'candidate');
        }
      } else {
        inferredBySpeaker.set(a.speaker, 'interviewer');
        inferredBySpeaker.set(b.speaker, 'candidate');
      }
    } else {
      const totalRealWords = realSpeakers.reduce((sum, s) => sum + s.words, 0);
      const top = [...realSpeakers].sort((x, y) => y.words - x.words)[0];
      const others = realSpeakers.filter((s) => s.speaker !== top.speaker);
      const topQRate = top.questionTurns / Math.max(1, top.turns);
      const avgOtherQRate =
        others.reduce((sum, s) => sum + s.questionTurns / Math.max(1, s.turns), 0) /
        Math.max(1, others.length);
      if (top.words >= totalRealWords * 0.35 && topQRate < avgOtherQRate) {
        inferredBySpeaker.set(top.speaker, 'candidate');
        for (const other of others) {
          if (other.questionTurns > 0) {
            inferredBySpeaker.set(other.speaker, 'interviewer');
          }
        }
      }
    }

    for (const turn of turns) {
      const role = inferredBySpeaker.get(turn.speaker);
      if (role) {
        turn.role = role;
      }
    }
  }

  const timestamps = turns
    .map((t) => t.timestampFormatted)
    .filter((ts): ts is string => Boolean(ts));
  const secs = turns
    .map((t) => t.timestampSec)
    .filter((s): s is number => typeof s === 'number');
  const boundSecs = timestamps.length > 0 ? [...secs, ...footerTimestampSecs] : secs;

  return {
    hasTimestamps: timestamps.length > 0,
    timestampFormat: timestamps.length > 0 ? detectedFormat : 'none',
    validTimestamps: Array.from(new Set(timestamps)),
    ...(boundSecs.length > 0
      ? {
          minTimestampSec: Math.min(...boundSecs),
          maxTimestampSec: Math.max(...boundSecs),
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
  // Count conversational filler "like" without matching verb "like to" or comparisons "like a/this/that"
  {
    label: 'like',
    regex:
      /(?:,\s*like\b|\blike\s*,|\blike\s+(?:um|uh|you know|basically|actually|i\s+mean|i\s+guess)\b|\b(?:was|is|it's|that's|and|so|or|yeah)\s+like\s+(?!to\b|a\b|an\b|the\b|this\b|that\b|these\b|those\b))/gi,
  },
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

const SECONDARY_NOTES_MARKER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bquestion-by-question\b/i,
  /\boverall\s+(?:interview\s+)?score\s*:\s*\d+(?:\.\d+)?\s*\/\s*(?:10|5)\b/i,
  /^\s*(?:\*\*)?score(?:\*\*)?\s*:\s*\d+(?:\.\d+)?\s*\/\s*(?:10|5)\s*$/im,
  /\b(?:comprehensive evaluation|analyze this interview transcript in detail|practice session with coaching)\b/i,
  /^[✅❌]\s+/m,
  /\bpass the\b[^\n]{0,40}\bbar\?/i,
];

const INTERVIEWER_COACHING_CUE_RE =
  /\b(?:let's try that again|try answering again|try that again|if i were answering|let me pause|in a real interview|don't ever do that|good retry|practice session|let me coach|re-?answer)\b/i;

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

function extractInlineTranscriptTimestampSecs(transcript: string): number[] {
  const secs: number[] = [];
  const lines = (transcript || '').replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^Transcription ended after\s+\d{1,2}:\d{2}(?::\d{2})?\b/i.test(line)) {
      continue;
    }
    const matches = line.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
    for (const match of matches) {
      const rawTs = match[0];
      if (isTalkRatioPair(rawTs, line)) continue;
      const idx = match.index ?? 0;
      const before = line.slice(0, idx);
      const after = line.slice(idx + rawTs.length);
      if (/^\s*(?:am|pm|a\.m\.|p\.m\.|pst|pdt|est|edt|cst|cdt|mst|mdt|utc|gmt)\b/i.test(after)) {
        continue;
      }
      if (
        /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*$/.test(before) ||
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}\s*(?:at\s+)?$/i.test(
          before,
        )
      ) {
        continue;
      }
      // Require transcript-offset context so ordinary 2-part clock times in prose ("from 09:00 to 17:00") are ignored
      const isThreePartHms = rawTs.split(':').length === 3;
      const isWrapped =
        (/\($/.test(before) && /^\)/.test(after)) || (/\[$/.test(before) && /^\]/.test(after));
      const isLineStartOffset =
        /^(?:[-*•]\s*)?$/.test(before) && !/^\s*(?:to|-|–)\s*\d{1,2}:\d{2}\b/i.test(after);
      if (!isThreePartHms && !isWrapped && !isLineStartOffset) {
        continue;
      }
      const sec = parseTimestampToSec(rawTs);
      if (sec !== null) {
        secs.push(sec);
      }
    }
  }
  return secs;
}

export function computeTranscriptMetrics(transcript: string): TranscriptMetrics {
  const parsed = parseTranscript(transcript);
  const turns = parsed.turns;
  const inlineSecs = extractInlineTranscriptTimestampSecs(transcript);
  const distinctInlineSecs = Array.from(new Set(inlineSecs)).sort((a, b) => a - b);
  const effectiveHasTimestamps = parsed.hasTimestamps || distinctInlineSecs.length >= 2;
  const effectiveTimestampFormat: TimestampFormat = parsed.hasTimestamps
    ? parsed.timestampFormat
    : distinctInlineSecs.length >= 2
      ? 'inline'
      : 'none';
  const effectiveValidTimestamps = parsed.hasTimestamps
    ? parsed.validTimestamps
    : distinctInlineSecs.length >= 2
      ? distinctInlineSecs.map(formatSecAsHms)
      : [];

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

  const secondaryMarkerHits = SECONDARY_NOTES_MARKER_PATTERNS.filter((re) => re.test(transcript)).length;
  const hasExplicitInterviewer = turns.some(
    (t) => t.role === 'interviewer' && classifySpeakerRole(t.speaker) === 'interviewer',
  );
  const isSecondaryNotes =
    secondaryMarkerHits >= 2 && (!hasExplicitInterviewer || interviewerTurns <= 1);
  const sourceDocumentType: TranscriptMetrics['sourceDocumentType'] = isSecondaryNotes
    ? 'secondary_evaluation_or_notes'
    : 'verbatim_transcript';

  const dialogueWords = candidateWords + interviewerWords;
  let candidateTalkRatioPct =
    dialogueWords > 0 ? Math.round((candidateWords / dialogueWords) * 1000) / 10 : 0;
  let interviewerTalkRatioPct =
    dialogueWords > 0 ? Math.round((100 - candidateTalkRatioPct) * 10) / 10 : 0;
  if (isSecondaryNotes && (candidateTurns <= 2 || !hasExplicitInterviewer)) {
    candidateTalkRatioPct = 0;
    interviewerTalkRatioPct = 0;
  }

  const coachingTurns = turns
    .map((t, idx) => ({ t, next: turns[idx + 1] }))
    .filter(
      ({ t }) =>
        t.role === 'interviewer' &&
        t.wordCount >= 180 &&
        INTERVIEWER_COACHING_CUE_RE.test(t.text),
    );
  const interviewerCoachingBlocks: MonologueInfo[] = [...coachingTurns]
    .sort((a, b) => b.t.wordCount - a.t.wordCount)
    .slice(0, 5)
    .map(({ t, next }) => ({
      turnIndex: t.turnIndex,
      startTimestamp: t.timestampFormatted ?? `Turn #${t.turnIndex}`,
      endTimestamp: next?.timestampFormatted ?? `Turn #${t.turnIndex}`,
      wordCount: t.wordCount,
      preview: t.text.split(/\s+/).slice(0, 32).join(' ') + (t.wordCount > 32 ? '...' : ''),
    }));

  const interviewerText = turns
    .filter((t) => t.role === 'interviewer')
    .map((t) => t.text)
    .join(' ');
  const hasCoachingCue = INTERVIEWER_COACHING_CUE_RE.test(interviewerText);
  const coachedSessionDetected = !isSecondaryNotes && hasCoachingCue;

  let qaOnlyCandidateTalkRatioPct: number | undefined;
  if (!isSecondaryNotes && coachingTurns.length > 0 && candidateWords > 0) {
    const coachingTurnIndices = new Set(coachingTurns.map(({ t }) => t.turnIndex));
    const nonLectureInterviewerWords = turns
      .filter((t) => t.role === 'interviewer' && !coachingTurnIndices.has(t.turnIndex))
      .reduce((sum, t) => sum + t.wordCount, 0);
    const qaDenom = candidateWords + nonLectureInterviewerWords;
    if (qaDenom > 0) {
      qaOnlyCandidateTalkRatioPct = Math.round((candidateWords / qaDenom) * 1000) / 10;
    }
  }

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
    hasTimestamps: effectiveHasTimestamps,
    timestampFormat: effectiveTimestampFormat,
    validTimestamps: effectiveValidTimestamps,
    sourceDocumentType,
    coachedSessionDetected,
    interviewerCoachingBlocks,
    ...(qaOnlyCandidateTalkRatioPct !== undefined ? { qaOnlyCandidateTalkRatioPct } : {}),
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

/** Detects an explicit numeric scoring ceiling (e.g. 4, 5, 7, 10, 100) from cachedCriteria, or null if unspecified. */
export function detectCriteriaScoreMax(criteria = ''): number | null {
  if (!criteria) return null;
  const cleaned = criteria
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b\d{1,4}\/\d{1,2}\/\d{1,4}\b/g, '')
    .replace(/\btotal\b[^\n]*\/\s*\d+\b/gi, '');
  const slashMatch = cleaned.match(
    /(?:^|[\s(|:xX]|\b\d+(?:\.\d+)?)\/\s*(100|20|10|7|6|5|4|3)\b(?!\s*\/\s*\d)/m,
  );
  if (slashMatch) return Number.parseInt(slashMatch[1], 10);
  const pointScaleMatch = cleaned.match(
    /\b(100|20|10|7|6|5|4|3)[- ]point\s+(?:scale|rubric)\b|\bout\s+of\s+(100|20|10|7|6|5|4|3)\b/i,
  );
  if (pointScaleMatch) {
    return Number.parseInt(pointScaleMatch[1] ?? pointScaleMatch[2], 10);
  }
  const unitAfterRe =
    /^\s*(?:min(?:ute)?s?|sec(?:ond)?s?|hours?|hrs?|days?|weeks?|months?|years?|bullets?|sentences?|examples?|sample\s+reframes?|reframes?|questions?|items?|words?|stor(?:y|ies)|people|persons?|%)/i;
  for (const m of cleaned.matchAll(/\b(?:0|1)\s*(?:[–-]|to)\s*(100|20|10|7|6|5|4|3)\b/gi)) {
    const startIdx = m.index ?? 0;
    const endIdx = startIdx + m[0].length;
    if (unitAfterRe.test(cleaned.slice(endIdx))) continue;
    const clauseBefore = (cleaned.slice(Math.max(0, startIdx - 35), startIdx).split(/[.\n]/).pop() ?? '');
    const clauseAfter = (cleaned.slice(endIdx, Math.min(cleaned.length, endIdx + 35)).split(/[.\n]/)[0] ?? '');
    if (
      /(?:score|scoring|scale|rubric|rating|dimension|criterion|criteria|grade|grading|evaluation)/i.test(
        `${clauseBefore} ${clauseAfter}`,
      ) ||
      cleaned[startIdx - 1] === '('
    ) {
      return Number.parseInt(m[1], 10);
    }
  }
  if (/\btotal\b[^\n]*\/\s*50\b/i.test(criteria)) return 5;
  return null;
}

/** Returns true when cachedCriteria specifies a 1–5 scoring scale rather than 1–10. */
export function isFivePointCriteria(criteria = ''): boolean {
  return detectCriteriaScoreMax(criteria) === 5;
}

export function verifyEvaluationDraft(
  transcript: string,
  draftMarkdown: string,
  options: VerifyEvaluationOptions = {},
): VerificationResult {
  const parsed = parseTranscript(transcript);
  const metrics = computeTranscriptMetrics(transcript);
  const issues: string[] = [];
  const warnings: string[] = [];

  // 1. Check cited timestamps line by line
  const citedTimestamps: string[] = [];
  const hallucinatedTimestamps: string[] = [];
  const verifiedTimestamps: string[] = [];
  const parsedTurnSecs = parsed.turns
    .map((t) => t.timestampSec)
    .filter((s): s is number => typeof s === 'number');
  const inlineSecs = extractInlineTranscriptTimestampSecs(transcript);
  const distinctInlineSecs = new Set(inlineSecs);

  const effectiveHasTimestamps = parsed.hasTimestamps || distinctInlineSecs.size >= 2;
  const turnSecsSet = new Set<number>(parsedTurnSecs);
  if (effectiveHasTimestamps) {
    for (const s of inlineSecs) {
      turnSecsSet.add(s);
    }
  }
  const turnSecs = Array.from(turnSecsSet);
  const boundSecs = [
    ...turnSecs,
    ...(typeof parsed.minTimestampSec === 'number' ? [parsed.minTimestampSec] : []),
    ...(typeof parsed.maxTimestampSec === 'number' ? [parsed.maxTimestampSec] : []),
  ];
  const minBoundSec = boundSecs.length > 0 ? Math.min(...boundSecs) : 0;
  const maxBoundSec = boundSecs.length > 0 ? Math.max(...boundSecs) : 0;

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

      if (!effectiveHasTimestamps) {
        if (!hallucinatedTimestamps.includes(rawTs)) {
          hallucinatedTimestamps.push(rawTs);
        }
      } else {
        const nearestDist =
          turnSecs.length > 0
            ? Math.min(...turnSecs.map((ts) => Math.abs(ts - sec)))
            : Number.POSITIVE_INFINITY;

        if (sec < Math.max(0, minBoundSec - 30) || sec > maxBoundSec + 180 || nearestDist > 360) {
          if (!hallucinatedTimestamps.includes(rawTs)) {
            hallucinatedTimestamps.push(rawTs);
          }
        } else if (!verifiedTimestamps.includes(formatted)) {
          verifiedTimestamps.push(formatted);
        }
      }
    }
  }

  if (!effectiveHasTimestamps && hallucinatedTimestamps.length > 0) {
    issues.push(
      `Hallucinated clock timestamps on an untimestamped transcript: ${hallucinatedTimestamps.join(', ')}. Cite Turn #N instead of fabricated timestamps.`,
    );
  } else if (effectiveHasTimestamps && hallucinatedTimestamps.length > 0) {
    issues.push(
      `Out-of-range or unanchored timestamps cited: ${hallucinatedTimestamps.join(', ')}. Anchor only to observed transcript timestamps.`,
    );
  }

  // Locate Sample Reframes & Practice Drills sections respecting heading hierarchy (exits on any equal-or-higher heading)
  const sampleReframesBodyLines: string[] = [];
  const inSampleReframesLine = new Set<number>();
  const inPracticeDrillsLine = new Set<number>();
  let reframeHeadingLevel: number | null = null;
  let drillsHeadingLevel: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = lines[i].match(/^\s*(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingTitle = headingMatch[2].trim();
      if (reframeHeadingLevel !== null && level <= reframeHeadingLevel) {
        reframeHeadingLevel = null;
      }
      if (drillsHeadingLevel !== null && level <= drillsHeadingLevel) {
        drillsHeadingLevel = null;
      }
      if (
        /^(?:(?:part|section)\s+\d+\s*[:.)-]?\s*|\d+[.)]\s*|[ivx]+[.)]\s*)?sample\s+reframes\b/i.test(
          headingTitle,
        )
      ) {
        reframeHeadingLevel = level;
        continue;
      }
      if (
        /^(?:(?:part|section)\s+\d+\s*[:.)-]?\s*|\d+[.)]\s*|[ivx]+[.)]\s*)?(?:time[- ]boxed\s+)?(?:practice\s+drills|drills\s*(?:&|and)\s*prep\s+artifacts|prep\s+drills|actionable\s+drills)\b/i.test(
          headingTitle,
        )
      ) {
        drillsHeadingLevel = level;
        continue;
      }
    }
    if (reframeHeadingLevel !== null) {
      inSampleReframesLine.add(i);
      sampleReframesBodyLines.push(lines[i]);
    }
    if (drillsHeadingLevel !== null) {
      inPracticeDrillsLine.add(i);
    }
  }

  // 2. Verify quoted snippets (>= 20 chars) excluding prescribed "After" / suggested rewrites
  const normalizedTranscript = normalizeForQuoteMatch(transcript);
  let verifiedQuoteCount = 0;
  const unverifiedQuotes: string[] = [];
  let prevNonEmptyLine = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const isHeadingLine = /^\s*#{1,6}\s+/.test(line);
    const prevStripped = prevNonEmptyLine.replace(/[*_`>]/g, '').trim();
    const hasPrescribedPrevLine =
      !isHeadingLine &&
      /(?:\bafter\b|\bsays?\s+instead\b|\bdoes\s+(?:instead|differently)\b|\btry(?:\s+saying)?\b|\breframe\b|\brephrase\b|\breplacement(?:\s+(?:script|phrasing|line))?\b|\bscript\b|\bstall\s+phrase\b|\bopening\s+ritual\b|suggested(?:\s+(?:answer|reframe|version|phrasing|response|script))?(?:\s+to\s+[^:]{1,40})?|stronger\s+(?:alternative|version|phrasing|response)|model\s+(?:answer|response)|revised(?:\s+(?:answer|version))?|(?:what\s+a\s+)?(?:strong|bar[- ]raiser)\s+candidate\s+(?:does|says|would\s+say)(?:\s+(?:instead|differently))?)\s*:\s*$/i.test(
        prevStripped,
      );

    const isPrescribedRewriteLine =
      /^\s*(?:[-*]|\d+\.)?\s*(?:\*\*)?(?:after|suggested(?:\s+(?:answer|reframe|version|phrasing|response|script))?|say\s+instead|replacement(?:\s+(?:script|phrasing|line))?|stall\s+phrase|script|stronger\s+(?:alternative|version|phrasing|response)|rewrite|model\s+(?:answer|response)|what\s+a\s+strong\s+candidate\s+(?:does|says)|what\s+a\s+bar-raiser)\b/i.test(
        line,
      );
    const quoteMatches = line.matchAll(/“([^"”\n]*)["”]|"([^"\n]*)"/g);
    for (const qm of quoteMatches) {
      const rawQuote = (qm[1] ?? qm[2] ?? '').trim();
      if (rawQuote.length < 20 || rawQuote.length > 300) {
        continue;
      }
      // If a single line has both "Instead of/Before: "..."" -> "After: "..."" skip only the prescribed rewrite part
      const idx = qm.index ?? 0;
      const prefixBeforeQuote = line.slice(0, idx).toLowerCase().replace(/[*_`]/g, '');
      const clauseBeforeQuote = prefixBeforeQuote.split(/(?:->|→|["“”])/).pop() ?? prefixBeforeQuote;
      const hasSourceQuotePrefix =
        /\bcandidate\b\s*:|\b(?:instead\s+of|before|original|current|actual|weak(?:er|est)?|initial|first[- ]pass|transcript|verbatim|the\s+candidate|interviewer|said|asked|stated|claimed|mentioned|wrote|quoted|their\s+(?:answer|response|words)|what\s+(?:they|you))\b/i.test(
          clauseBeforeQuote,
        );
      const hasPrescribedPrefix =
        /(?:->|→)\s*$/.test(prefixBeforeQuote) ||
        /(?:\bafter\b|\bsays?\s+instead\b|\bdoes\s+(?:instead|differently)\b|\btry(?:\s+saying)?\b|\breframe\b|\brephrase\b|\breplacement(?:\s+(?:script|phrasing|line))?\b|\bscript\b|\bstall\s+phrase\b|\bopening\s+ritual\b|could\s+(?:say|answer|open\s+with)|might\s+(?:say|answer)|would\s+say|suggested(?:\s+(?:answer|reframe|version|phrasing|response|script))?(?:\s+to\s+(?:the\s+)?(?:interviewer|this|that|question(?:\s+\d+)?))?|stronger\s+(?:alternative|version|phrasing|response)|model\s+(?:answer|response)|revised(?:\s+(?:answer|version))?|(?:\bwhat\s+a\s+)?(?:strong|bar[- ]raiser)(?:\s+candidate(?:\s+would\s+say|\s+(?:does|says)(?:\s+(?:instead|differently))?)?|\s+(?:answer|response|comparison)))\s*:?\s*$/i.test(
          clauseBeforeQuote,
        );
      const isStandaloneOrLabeledReframeInSection =
        inSampleReframesLine.has(i) &&
        !hasSourceQuotePrefix &&
        !/\b(?:question|prompt)\s*:?\s*$/i.test(clauseBeforeQuote);
      const isScriptInPracticeDrills =
        inPracticeDrillsLine.has(i) &&
        !hasSourceQuotePrefix &&
        !/\b\d{1,2}:\d{2}\b|\bturn\s*#\s*\d+/i.test(line);
      if (
        hasPrescribedPrefix ||
        (!hasSourceQuotePrefix &&
          (isPrescribedRewriteLine ||
            isStandaloneOrLabeledReframeInSection ||
            hasPrescribedPrevLine ||
            isScriptInPracticeDrills))
      ) {
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

    if (isHeadingLine) {
      prevNonEmptyLine = '';
    } else if (trimmedLine.length > 0) {
      prevNonEmptyLine = trimmedLine;
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

  const criteria = options.cachedCriteria ?? '';
  const detectedScaleMax = detectCriteriaScoreMax(criteria);
  const isCustomNonTenScale = detectedScaleMax !== null && detectedScaleMax !== 10;
  const hasCustomOutputFormat = /^(?:#{1,6}\s*|\*{1,2})?output\s+format\b(?:\s*:|\*{1,2})?/im.test(
    criteria,
  );
  const requestsSampleReframes = /\bsample\s+reframes\b/i.test(criteria);

  // 3. Compare cited talk-to-listen ratio against actual candidateTalkRatioPct
  let citedTalkRatioPct: number | undefined;
  let talkRatioDriftPp: number | undefined;

  const hasMeasuredRatio =
    metrics.candidateTalkRatioPct > 0 || metrics.interviewerTalkRatioPct > 0;
  const ratioContextRe =
    /(?:talk[- ]to[- ]listen|talk\s*\/\s*listen|candidate[- ]to[- ]interviewer|talk ratio)[^\n]{0,60}?(\d{1,2}(?:\.\d+)?)\s*(?::|\/|%)/i;
  const ratioMatch = draftMarkdown.match(ratioContextRe);
  if (ratioMatch) {
    const val = Number.parseFloat(ratioMatch[1]);
    if (!Number.isNaN(val) && val > 0 && val < 100) {
      citedTalkRatioPct = val;
      if (hasMeasuredRatio) {
        const driftFull = Math.abs(val - metrics.candidateTalkRatioPct);
        const driftQa =
          typeof metrics.qaOnlyCandidateTalkRatioPct === 'number'
            ? Math.abs(val - metrics.qaOnlyCandidateTalkRatioPct)
            : driftFull;
        talkRatioDriftPp = Math.round(Math.min(driftFull, driftQa) * 10) / 10;
        if (talkRatioDriftPp > 5) {
          const qaNote =
            typeof metrics.qaOnlyCandidateTalkRatioPct === 'number'
              ? ` (or Q&A-only ${metrics.qaOnlyCandidateTalkRatioPct}%)`
              : '';
          issues.push(
            `Talk-to-listen ratio drift of ${talkRatioDriftPp}pp: draft cites ${val}% candidate talk, while measured transcript is ${metrics.candidateTalkRatioPct}:${metrics.interviewerTalkRatioPct}${qaNote}.`,
          );
        }
      }
    }
  } else if (
    metrics.sourceDocumentType !== 'secondary_evaluation_or_notes' &&
    !hasCustomOutputFormat
  ) {
    warnings.push('No explicit talk-to-listen ratio found in draft.');
  }

  // 4. Required sections check
  const missingSections: string[] = [];
  const lowerDraft = draftMarkdown.toLowerCase();
  const unquotedDraft = draftMarkdown.replace(/["“][^"”\n]{1,300}["”]/g, '""');

  const hasUntestedMarkers = /\b(?:untested|not tested|n\/a|not determinable)\b/i.test(
    draftMarkdown,
  );

  if (
    (isCustomNonTenScale && detectedScaleMax !== null) ||
    (hasCustomOutputFormat && (detectedScaleMax === 10 || /\bscore\b/i.test(criteria)))
  ) {
    const targetMax = detectedScaleMax ?? 10;
    const plainDraftForScale = draftMarkdown.replace(/[*_`]/g, '');
    const customScaleRe = new RegExp(
      `\\b\\d+(?:\\.\\d+)?\\s*\\/\\s*${targetMax}\\b|(?:^|[-*|]\\s*)(?:\\d+\\.\\s+)?score(?:\\s*\\((?:0|1)\\s*[–-]\\s*${targetMax}\\))?\\s*:\\s*\\d+(?:\\.\\d+)?\\b|\\|\\s*\\d+(?:\\.\\d+)?\\s*\\|`,
      'gim',
    );
    const customScaleMatches = plainDraftForScale.match(customScaleRe) ?? [];
    if (
      customScaleMatches.length === 0 ||
      (customScaleMatches.length === 1 && !hasUntestedMarkers)
    ) {
      missingSections.push(
        `dimension X/${targetMax} scores matching the 1-${targetMax} rubric scale`,
      );
    }
    if (isCustomNonTenScale) {
      const tenScaleLines = unquotedDraft
        .split('\n')
        .filter((line) => /\b\d+(?:\.\d+)?\s*\/\s*10\b/.test(line) && !/\btotal\b/i.test(line));
      if (tenScaleLines.length > 0) {
        issues.push(
          `Dual scoring scale detected: cachedCriteria specifies a 1-${targetMax} (/${targetMax}) scale, so remove all X/10 scores and follow only the 1-${targetMax} (/${targetMax}) scale and structure defined in cachedCriteria.`,
        );
      }
    }
  } else if (!hasCustomOutputFormat) {
    const scoreMatches = draftMarkdown.match(/\b\d+(?:\.\d+)?\s*\/\s*10\b/g) ?? [];
    if (scoreMatches.length === 0) {
      missingSections.push('per-question and overall X/10 score');
    } else if (scoreMatches.length === 1 && !hasUntestedMarkers) {
      missingSections.push('per-question X/10 scores (only 1 score found)');
    }
  }

  if (isCustomNonTenScale || hasCustomOutputFormat) {
    const expectsConclusion =
      /\b(?:overall(?:\s+(?:impression|score|assessment))?|total\b|summary\s+scorecard|verdict|pass|champion)\b/i.test(
        criteria,
      );
    const hasCustomConclusion =
      /\b(?:overall(?:\s+(?:impression|score|assessment))?|total\b[^\n]*(?:\/\s*\d+|\bscore\b)|summary\s+scorecard|champion)\b/i.test(
        draftMarkdown,
      ) ||
      (/\b(?:yes|no|borderline|indeterminate|not determinable)\b/i.test(draftMarkdown) &&
        /(?:verdict|pass|bar)/i.test(lowerDraft));
    if (expectsConclusion && !hasCustomConclusion) {
      missingSections.push('overall impression / total summary matching cachedCriteria');
    }
  } else if (
    !/\b(?:yes|no|borderline|indeterminate|not determinable)\b/i.test(draftMarkdown) ||
    !/(?:verdict|pass|bar)/i.test(lowerDraft)
  ) {
    missingSections.push('pass verdict (Yes/No/Borderline)');
  }

  const expectsStrengths = !hasCustomOutputFormat || /\bstrength/i.test(criteria);
  const expectsWeaknesses =
    !hasCustomOutputFormat ||
    /weakness|area(?:s)? for improvement|what to improve|gap/i.test(criteria);
  if (expectsStrengths && !/strength/i.test(lowerDraft)) {
    missingSections.push('top 3 strengths');
  }
  if (expectsWeaknesses && !/weakness|area(?:s)? for improvement|what to improve|gap/i.test(lowerDraft)) {
    missingSections.push('top 3 weaknesses');
  }

  // Count concrete rewrites ("Instead of" / "Before" -> "After" or numbered actionable recommendations / Sample Reframes)
  const rewriteMarkers =
    draftMarkdown.match(/(?:instead of|before\s*:|->\s*after|→\s*\*\*after|after\s*:)/gi) ?? [];
  const rewritePairs = Math.floor(rewriteMarkers.length / 2);
  const recMatches =
    draftMarkdown.match(/^\s*(?:\d+\.|[-*])\s+(?:\*\*)?(?:instead of|before|recommendation)/gim) ??
    [];
  let rewriteCount = Math.max(rewritePairs, recMatches.length);

  if (requestsSampleReframes) {
    if (sampleReframesBodyLines.length > 0) {
      const sectionBody = sampleReframesBodyLines.join('\n');
      const subHeadings = sectionBody.match(/^\s*####+\s+\S/gm)?.length ?? 0;
      const h3Headings = sectionBody.match(/^\s*###\s+\S/gm)?.length ?? 0;
      const numberedBlocks = sectionBody.match(/^\s*\d+\.\s+\S/gm)?.length ?? 0;
      const boldNumberedBlocks = sectionBody.match(/^\s*\*\*\d+\.\s+\S/gm)?.length ?? 0;
      const plainBullets = sectionBody.match(/^\s*[-*]\s+\S/gm)?.length ?? 0;
      rewriteCount = Math.max(
        rewriteCount,
        h3Headings,
        subHeadings,
        numberedBlocks,
        boldNumberedBlocks,
        plainBullets,
      );
    }
    if (rewriteCount < 2) {
      missingSections.push(
        `2-3 Sample Reframes required by cachedCriteria (found ${rewriteCount})`,
      );
    }
  } else if ((!hasCustomOutputFormat || /\brewrite/i.test(criteria)) && rewriteCount < 5) {
    missingSections.push(
      `5-7 concrete "Instead of"/"Before" -> "After" rewrites (found ${rewriteCount})`,
    );
  }

  for (const m of missingSections) {
    issues.push(`Missing required evaluation element: ${m}`);
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
    summary: {
      hasTimestamps: effectiveHasTimestamps,
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
      'Parse the interview transcript to detect timestamp format, valid timestamps, exact per-speaker word counts, candidate vs interviewer talk-to-listen ratio, longest candidate monologues (>=120 words), filler/hedging word counts, "I" vs "we" ownership pronouns, and signposting hits. Treat word, filler, pronoun, and WPM counts strictly as internal diagnostic signals—report Talk-to-Listen Ratio in the evaluation rather than raw lexical tallies.',
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
  options: VerifyEvaluationOptions = {},
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
      'Deterministically verify your draft evaluation against the parsed transcript: flags hallucinated clock timestamps when untimestamped, verifies quoted snippets (>=20 chars), checks talk-to-listen ratio accuracy (<=5pp drift), and checks required sections and rewrites/sample reframes respecting cachedCriteria format. Always call this before your final response.',
    parameters: schema,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const draft = String((params as { draftMarkdown?: unknown })?.draftMarkdown ?? '');
      const result = verifyEvaluationDraft(getTranscript(), draft, options);
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
