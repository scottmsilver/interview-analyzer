#!/usr/bin/env npx tsx
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  analyzeInterview,
  analyzeInterviewDirectAPI,
  type AnalysisMessage,
  collectAnalysisSync,
} from './analyzer.js';
import { analyzeInterviewPi, type PiRunTelemetry } from './pi-analyzer.js';
import type { PiApiMode } from './pi-llm.js';
import { computeTranscriptMetrics, verifyEvaluationDraft } from './pi-tools.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');

export interface BakeoffArm {
  id: string;
  label: string;
  method: 'direct-api' | 'agent-sdk' | 'pi-agent';
  model: string;
  apiMode?: PiApiMode;
}

export interface BakeoffFixture {
  id: string;
  label: string;
  path: string;
  interviewType: string;
}

export const DEFAULT_ARMS: BakeoffArm[] = [
  {
    id: 'direct-api-opus-5',
    label: 'direct-api (claude-opus-5)',
    method: 'direct-api',
    model: 'claude-opus-5',
  },
  {
    id: 'agent-sdk-opus-5',
    label: 'agent-sdk (claude-opus-5)',
    method: 'agent-sdk',
    model: 'claude-opus-5',
  },
  {
    id: 'pi-agent-opus-5',
    label: 'pi-agent (claude-opus-5)',
    method: 'pi-agent',
    model: 'claude-opus-5',
    apiMode: 'anthropic-messages',
  },
  {
    id: 'pi-agent-sonnet-5-5',
    label: 'pi-agent (claude-sonnet-5-5)',
    method: 'pi-agent',
    model: 'claude-sonnet-5-5',
    apiMode: 'anthropic-messages',
  },
  {
    id: 'pi-agent-gpt-5-4',
    label: 'pi-agent (gpt-5.4, openai-completions)',
    method: 'pi-agent',
    model: 'gpt-5.4',
    apiMode: 'openai-completions',
  },
];

export const DEFAULT_FIXTURES: BakeoffFixture[] = [
  {
    id: 'fixture-a-untimestamped',
    label: 'Fixture A (test-transcript.txt, untimestamped)',
    path: path.resolve(BACKEND_ROOT, 'test-transcript.txt'),
    interviewType: 'google-apm',
  },
  {
    id: 'fixture-b-realistic-apm',
    label: 'Fixture B (realistic-google-apm-transcript.txt, timestamped)',
    path: path.resolve(BACKEND_ROOT, 'fixtures', 'realistic-google-apm-transcript.txt'),
    interviewType: 'google-apm',
  },
];

export interface PlantedSignalDetection {
  fixtureId: string;
  detected: string[];
  missed: string[];
  detectionRate: number;
}

export interface BakeoffArmResult {
  fixtureId: string;
  fixtureLabel: string;
  armId: string;
  armLabel: string;
  method: string;
  model: string;
  apiMode?: string;
  status: 'ok' | 'error';
  error?: string;
  latencyMs: number;
  turns: number;
  toolCallCount: number;
  toolNames: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestampHallucinations: number;
  hallucinatedTimestamps: string[];
  verifiedTimestampAnchors: number;
  verifiedQuotes: number;
  unverifiedQuotes: number;
  quoteFidelityPct: number | null;
  citedTalkRatioPct?: number;
  actualTalkRatioPct: number;
  talkRatioErrorPp: number | null;
  plantedSignals: PlantedSignalDetection;
  concreteRewrites: number;
  verificationPassed: boolean;
  outputLengthChars: number;
  markdownFile?: string;
}

export function scorePlantedSignals(fixtureId: string, markdown: string): PlantedSignalDetection {
  const lower = (markdown || '').toLowerCase();
  const checks: Array<{ name: string; regex: RegExp }> =
    fixtureId.includes('fixture-b')
      ? [
          {
            name: 'unstructured_monologue_00:06:10',
            regex: /(?:monologue|uninterrupted|rambling|00:06:10|06:10|320\s*words)/i,
          },
          {
            name: 'supply_side_blind_spot_00:09:45',
            regex: /(?:supply[- ]side|two-sided|cold[- ]start|electrician|contractor|00:09:45|09:45)/i,
          },
          {
            name: 'dau_nps_vanity_trap_and_cannibalization',
            regex: /(?:cannibaliz|vanity|generic|low[- ]frequency|guardrail|counter-?metric)/i,
          },
          {
            name: 'we_vs_i_ownership_diffusion',
            regex: /(?:"we"|\bwe\b[^.\n]{0,40}\b"i"\b|ownership|personal contribution|singular)/i,
          },
        ]
      : [
          {
            name: 'no_fabricated_timestamps',
            regex: /(?:no timestamp|untimestamped|turn\s*#?\d|without timestamps)/i,
          },
          {
            name: 'missing_segmentation_or_clarification',
            regex: /(?:segment|persona|clarif|everyone|too broad)/i,
          },
          {
            name: 'generic_metrics_without_guardrails',
            regex: /(?:dau|adoption|guardrail|counter-?metric|vanity)/i,
          },
        ];

  const detected: string[] = [];
  const missed: string[] = [];
  for (const c of checks) {
    if (c.regex.test(lower)) detected.push(c.name);
    else missed.push(c.name);
  }
  const detectionRate = checks.length > 0 ? Math.round((detected.length / checks.length) * 100) : 100;
  return { fixtureId, detected, missed, detectionRate };
}

export function parseCliArgs(argv: string[]): {
  armsFilter?: string[];
  fixturesFilter?: string[];
  outDir: string;
  allowDirectKey: boolean;
  help: boolean;
} {
  let armsFilter: string[] | undefined;
  let fixturesFilter: string[] | undefined;
  let outDir = path.resolve(
    BACKEND_ROOT,
    '.bakeoff-runs',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  let allowDirectKey = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--allow-direct-key') {
      allowDirectKey = true;
    } else if (arg === '--arms' && argv[i + 1]) {
      armsFilter = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--arms=')) {
      armsFilter = arg.slice('--arms='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--fixtures' && argv[i + 1]) {
      fixturesFilter = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--fixtures=')) {
      fixturesFilter = arg.slice('--fixtures='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--out-dir' && argv[i + 1]) {
      outDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--out-dir=')) {
      outDir = path.resolve(arg.slice('--out-dir='.length));
    }
  }

  return { armsFilter, fixturesFilter, outDir, allowDirectKey, help };
}

export function validateBakeoffEnvironment(allowDirectKey: boolean): void {
  if (process.env.ANTHROPIC_API_KEY && !allowDirectKey) {
    throw new Error(
      'Refusing to run with raw ANTHROPIC_API_KEY without --allow-direct-key. Unset ANTHROPIC_API_KEY and use Manifest (ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL), or explicitly pass --allow-direct-key.',
    );
  }
  if (!allowDirectKey && (!process.env.ANTHROPIC_AUTH_TOKEN || !process.env.ANTHROPIC_BASE_URL)) {
    throw new Error(
      'Manifest credentials required: set both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL (or pass --allow-direct-key).',
    );
  }
}

async function runSingleArm(
  fixture: BakeoffFixture,
  transcript: string,
  arm: BakeoffArm,
  outDir: string,
): Promise<BakeoffArmResult> {
  const actualMetrics = computeTranscriptMetrics(transcript);
  const start = Date.now();
  let turns = 1;
  const toolNames: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  try {
    let generator: AsyncGenerator<AnalysisMessage>;
    if (arm.method === 'pi-agent') {
      generator = await analyzeInterviewPi(transcript, {
        interviewType: fixture.interviewType,
        model: arm.model,
        apiMode: arm.apiMode,
        allowUnlistedModel: true,
      });
    } else if (arm.method === 'direct-api') {
      generator = await analyzeInterviewDirectAPI(transcript, {
        interviewType: fixture.interviewType,
        model: arm.model,
      });
    } else {
      generator = await analyzeInterview(transcript, {
        interviewType: fixture.interviewType,
        model: arm.model,
      });
    }

    const wrapped = (async function* () {
      for await (const msg of generator) {
        if (msg.type === 'raw' && msg.raw) {
          if (msg.raw.type === 'pi_telemetry') {
            const t = msg.raw as PiRunTelemetry;
            turns = t.turns;
            inputTokens = t.usage.inputTokens;
            outputTokens = t.usage.outputTokens;
            totalTokens = t.usage.totalTokens;
          } else if (msg.raw.type === 'tool_use' && msg.raw.tool) {
            toolNames.push(String(msg.raw.tool));
          } else if (msg.raw.type === 'result' && msg.raw.usage) {
            inputTokens = msg.raw.usage.input_tokens ?? inputTokens;
            outputTokens = msg.raw.usage.output_tokens ?? outputTokens;
            turns = msg.raw.num_turns ?? turns;
          }
        }
        yield msg;
      }
    })();

    const markdown = await collectAnalysisSync(wrapped);
    const latencyMs = Date.now() - start;
    const verification = verifyEvaluationDraft(transcript, markdown);
    const plantedSignals = scorePlantedSignals(fixture.id, markdown);

    const totalQuoted = verification.summary.verifiedQuoteCount + verification.summary.unverifiedQuotes.length;
    const quoteFidelityPct =
      totalQuoted > 0
        ? Math.round((verification.summary.verifiedQuoteCount / totalQuoted) * 100)
        : null;

    const mdFile = `${fixture.id}__${arm.id}.md`;
    fs.writeFileSync(path.join(outDir, mdFile), markdown, 'utf8');

    return {
      fixtureId: fixture.id,
      fixtureLabel: fixture.label,
      armId: arm.id,
      armLabel: arm.label,
      method: arm.method,
      model: arm.model,
      apiMode: arm.apiMode,
      status: 'ok',
      latencyMs,
      turns,
      toolCallCount: toolNames.length,
      toolNames,
      inputTokens,
      outputTokens,
      totalTokens: totalTokens || inputTokens + outputTokens,
      timestampHallucinations: verification.summary.hallucinatedTimestamps.length,
      hallucinatedTimestamps: verification.summary.hallucinatedTimestamps,
      verifiedTimestampAnchors: verification.summary.verifiedTimestamps.length,
      verifiedQuotes: verification.summary.verifiedQuoteCount,
      unverifiedQuotes: verification.summary.unverifiedQuotes.length,
      quoteFidelityPct,
      citedTalkRatioPct: verification.summary.citedTalkRatioPct,
      actualTalkRatioPct: verification.summary.actualTalkRatioPct,
      talkRatioErrorPp: verification.summary.talkRatioDriftPp ?? null,
      plantedSignals,
      concreteRewrites: verification.summary.rewriteCount,
      verificationPassed: verification.passed,
      outputLengthChars: markdown.length,
      markdownFile: mdFile,
    };
  } catch (err) {
    return {
      fixtureId: fixture.id,
      fixtureLabel: fixture.label,
      armId: arm.id,
      armLabel: arm.label,
      method: arm.method,
      model: arm.model,
      apiMode: arm.apiMode,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
      turns,
      toolCallCount: toolNames.length,
      toolNames,
      inputTokens,
      outputTokens,
      totalTokens,
      timestampHallucinations: 0,
      hallucinatedTimestamps: [],
      verifiedTimestampAnchors: 0,
      verifiedQuotes: 0,
      unverifiedQuotes: 0,
      quoteFidelityPct: null,
      actualTalkRatioPct: actualMetrics.candidateTalkRatioPct,
      talkRatioErrorPp: null,
      plantedSignals: { fixtureId: fixture.id, detected: [], missed: [], detectionRate: 0 },
      concreteRewrites: 0,
      verificationPassed: false,
      outputLengthChars: 0,
    };
  }
}

function renderSummaryMarkdown(results: BakeoffArmResult[]): string {
  const lines: string[] = [
    '# Interview Analyzer Bake-Off Results',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Fixture | Arm | Status | Latency | Turns | Tools | Tokens | TS Hallucinations | Verified TS | Quote Fidelity | Ratio Err (pp) | Planted Signals | Rewrites | Verified |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ];

  for (const r of results) {
    lines.push(
      `| ${r.fixtureId} | ${r.armLabel} | ${r.status} | ${(r.latencyMs / 1000).toFixed(1)}s | ${r.turns} | ${r.toolCallCount} | ${r.totalTokens} | ${r.timestampHallucinations} | ${r.verifiedTimestampAnchors} | ${r.quoteFidelityPct !== null ? `${r.quoteFidelityPct}%` : 'N/A'} | ${r.talkRatioErrorPp !== null ? r.talkRatioErrorPp : 'N/A'} | ${r.plantedSignals.detectionRate}% | ${r.concreteRewrites} | ${r.verificationPassed ? 'PASS' : 'FAIL'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(`Usage: npm run bakeoff -- [options]
Options:
  --arms <csv>          Comma-separated arm IDs or prefixes (${DEFAULT_ARMS.map((a) => a.id).join(', ')})
  --fixtures <csv>      Comma-separated fixture IDs or file paths
  --out-dir <path>      Output directory (default: .bakeoff-runs/<timestamp>)
  --allow-direct-key    Permit raw ANTHROPIC_API_KEY instead of Manifest auth`);
    process.exit(0);
  }

  validateBakeoffEnvironment(cli.allowDirectKey);

  const selectedArms = cli.armsFilter
    ? DEFAULT_ARMS.filter((a) =>
        cli.armsFilter!.some((f) => a.id === f || a.id.includes(f) || a.label.toLowerCase().includes(f.toLowerCase())),
      )
    : DEFAULT_ARMS;

  if (selectedArms.length === 0) {
    throw new Error(`No matching arms for --arms=${cli.armsFilter?.join(',')}`);
  }

  const selectedFixtures = cli.fixturesFilter
    ? cli.fixturesFilter.map((f, idx) => {
        const match = DEFAULT_FIXTURES.find((df) => df.id === f || df.id.includes(f));
        if (match) return match;
        const resolved = path.resolve(f);
        return {
          id: `custom-fixture-${idx + 1}`,
          label: path.basename(resolved),
          path: resolved,
          interviewType: 'google-apm',
        };
      })
    : DEFAULT_FIXTURES;

  fs.mkdirSync(cli.outDir, { recursive: true });
  const results: BakeoffArmResult[] = [];

  for (const fixture of selectedFixtures) {
    if (!fs.existsSync(fixture.path)) {
      throw new Error(`Fixture file not found: ${fixture.path}`);
    }
    const transcript = fs.readFileSync(fixture.path, 'utf8');
    console.log(`\n=== ${fixture.label} (${transcript.length} chars) ===`);

    for (const arm of selectedArms) {
      console.log(`-> Running ${arm.label}...`);
      const res = await runSingleArm(fixture, transcript, arm, cli.outDir);
      results.push(res);
      console.log(
        `   ${res.status.toUpperCase()} in ${(res.latencyMs / 1000).toFixed(1)}s | tools=${res.toolCallCount} | ts_hallucinations=${res.timestampHallucinations} | planted=${res.plantedSignals.detectionRate}% | verified=${res.verificationPassed}`,
      );
      if (res.error) {
        console.error(`   Error: ${res.error}`);
      }
    }
  }

  const summaryMd = renderSummaryMarkdown(results);
  fs.writeFileSync(path.join(cli.outDir, 'bakeoff-summary.json'), JSON.stringify(results, null, 2), 'utf8');
  fs.writeFileSync(path.join(cli.outDir, 'bakeoff-summary.md'), summaryMd, 'utf8');
  console.log(`\n${summaryMd}`);
  console.log(`Saved bake-off artifacts to: ${cli.outDir}`);
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((err) => {
    console.error('[bakeoff] Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
