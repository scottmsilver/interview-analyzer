# Pi v3 Upgrades & 11-Model Quality / Time Tradeoff

> **Headline Result**: Implementing `Pi v3` Upgrades 1–3 plus **universal tool-prompt and verifier hill-climbing** raised `Pi` (`claude-opus-5-5`) to **90%–94.4%** blind-judge win rates and elevated **`gemini-4-hydrogen`** on the **4-model Pareto frontier** from **`7.91/10` (`207.1s`)** to **`8.44/10` (`130.4s`, `70%` win rate)** on Dev (`N = 5`) and **`8.54/10` (`115.3s`, `91.7%` combined blind win rate — `100%` Fable `6/6`, `100%` quote fidelity, `0` hallucinated timestamps)** on a **locked SHA-256-disjoint Blind Holdout (`N = 6`)**. Across **11 live Manifest models** (`55/55` completed), **`pi-agent`** is the default analyzer across backend and frontend, exposing the streamlined **2-mode Pareto picker**: **`Fast — Gemini 4 Hydrogen ★ (Default)`** (`~2 min`, `DEFAULT_PI_MODEL = 'gemini-4-hydrogen'` under Manifest) and **`Deep — Fable 5.1`** (`~6.5 min`, `8.62/10`, `100%` blind win rate).

---

## 1. Quality vs. Wall-Clock Time Tradeoff Chart

![Pi v3 Quality vs. Wall-Clock Latency Tradeoff (11 Models)](./pi-v3-quality-time-tradeoff.png)

*Methodology*: Each of the 11 models ran the full `Pi v3` multi-tool pipeline (`analyze_transcript_metrics`, `extract_qa_turns`, `load_interview_rubric`, `audit_answer_quality`, `run_transcript_js`, `verify_evaluation_draft`) on the same **5 stratified Dev historical cases** (`case-01` `google-apm`, `case-04` `generic`, `case-05` `amazon-pm`, `case-11` `google-apm`, `case-17` `diller`). Outputs were scored blindly and position-balanced against the saved historical production analyses by two cross-family judges (`gemini-4-carbon` and `claude-fable-5-1`). Reported wall-clock latency reflects successful end-to-end single-run duration (excluding retry backoff sleeps after 3 upstream `504` gateway timeouts on initial concurrent `gemini-4-carbon`/`gemini-4-argon` runs; `gemini-4-hydrogen` had zero timeouts). Post-climb `gemini-4-hydrogen` and `claude-opus-5-5` Dev (`N = 5`) points reflect the updated production codebase, independently validated on a locked `N = 6` unseen holdout set (`case-03`, `06`, `07`, `12`, `18`, `19`).

---

## 2. Production UI & Backend Defaults

`DEFAULT_ANALYSIS_METHOD` in [`analyzer.ts`](../backend/src/analyzer.ts) and [`server.ts`](../backend/src/server.ts) is `'pi-agent'`, and `DEFAULT_PI_MODEL` in [`pi-analyzer.ts`](../backend/src/pi-analyzer.ts) defaults to `'gemini-4-hydrogen'` when running through the Manifest router (`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` configured, `ANTHROPIC_MODEL` unset). The Analyze dropdown in [`App.tsx`](../frontend/src/App.tsx) focuses on the **2 streamlined Pareto modes**:

| UI Preset Label | Method | Model ID | Mean Latency | Composite Quality | Win Rate | Default |
|---|---|---|---:|---:|---:|:---:|
| **`Fast — Gemini 4 Hydrogen ★ (Default)`** | **`pi-agent`** | **`gemini-4-hydrogen`** | **130.4s** *(115.3s holdout)* | **8.44/10** *(8.54/10 holdout)* | **70%** *(91.7% holdout)* | **Yes** |
| `Deep — Fable 5.1` | `pi-agent` | `claude-fable-5-1` | 394.0s | 8.62/10 | 100% | — |

*Why 2 modes in the UI*: Climbed `gemini-4-hydrogen` reaches **`8.44–8.54/10`** quality in **`~2 min`** (`115.3s–130.4s`), delivering virtually the same composite quality as `claude-opus-5-5` (`8.46/10` at `235.2s`) in half the wait while overtaking `claude-sonnet-5-5` (`7.57/10` at `115.8s`), leaving **`claude-fable-5-1`** (`394.0s`, `8.62/10`, `100%` win rate) as the dedicated `Deep` tier.

---

## 3. What Changed in `Pi v3` (Upgrades 1–3)

1. **Authoritative `cachedCriteria` Scale, Format & Competency Fidelity** ([`pi-tools.ts`](../backend/src/pi-tools.ts), [`pi-analyzer.ts`](../backend/src/pi-analyzer.ts)):
   - `detectCriteriaScoreMax` detects custom scoring scales (`1–5`, `1–4`, `/15`, `0–100`, `X/5`) from `cachedCriteria` while ignoring minute ranges and `TOTAL X/N` aggregates, instructing `verify_evaluation_draft` and `buildPiSystemPrompt` to enforce exclusively the custom scale and reject dual `X/10` score leakage.
   - Custom `OUTPUT FORMAT` headers and rubric rows are honored without forcing unrequested default sections; unprobed competencies are marked `Untested (N/A)` rather than penalized numerically, and role/level mismatches are flagged explicitly.
2. **Coached Mocks, Secondary Evaluation Notes & Granular Attribution** ([`pi-tools.ts`](../backend/src/pi-tools.ts)):
   - Detects `coachedSessionDetected` mocks and computes `qaOnlyCandidateTalkRatioPct` excluding `>=180`-word coaching explanation blocks so heavy tutor monologues do not distort candidate talk ratios.
   - Detects `secondary_evaluation_or_notes` digests, preserving inherited inline source timestamps (`05:34`, `00:01:45`) cleanly as `hasTimestamps: true, timestampFormat: 'inline'` without fabricating `Turn #N` headers or bogus single-header `100:0` speaker ratios.
3. **Time-Boxed Practice Drills & Quote Verifier Hardening** ([`pi-tools.ts`](../backend/src/pi-tools.ts), [`pi-tools.test.ts`](../backend/src/pi-tools.test.ts)):
   - Requires concrete time-boxed practice drills and prep artifacts paired alongside `Sample Reframes` / verbatim rewrites.
   - Enforces a heading-hierarchy boundary inside `Sample Reframes` and strict prefix rules (`Before:`, `Original answer:`, `Candidate:`, vs. prescribed `Suggested answer:` / `What a bar-raiser candidate says instead:`) so rewritten examples never masquerade as unverified transcript quotes.

---

## 4. `gemini-4-hydrogen` Universal Hill-Climbing & Blind Holdout (`N = 6`)

To unlock faster turnaround and higher Fable signal-to-noise without overfitting to benchmark transcripts or adding brittle model-specific hacks, improvements followed a strict **Dev vs. Locked Blind Holdout** protocol:
- **Dev Split (`N = 5`)**: `case-01`, `case-04`, `case-05`, `case-11`, `case-17` across `google-apm`, `amazon-pm`, `generic`, and `diller`.
- **Locked Blind Holdout (`N = 6`)**: `case-03`, `case-06`, `case-07`, `case-12`, `case-18`, `case-19` — verified SHA-256 disjoint from Dev and kept completely untouched until the final candidate config was frozen.

### Universal Changes Selected (Round 1 Winner)

1. **Verifier Precision & Filler Measurement** ([`pi-tools.ts`](../backend/src/pi-tools.ts), [`pi-tools.test.ts`](../backend/src/pi-tools.test.ts)):
   - Fixed inverted quote-pair backtracking in `verifyEvaluationDraft` (`“([^"”\n]*)["”]|"([^"\n]*)"` spanning `20..300` chars) so short standalone quotes and rewrites cannot accidentally merge across prose.
   - Added support for numbered/prefixed `Sample Reframes` headings, exempted pure `Practice Drills` script lines without source-quote prefixes or clock/`Turn #N` citations, supported multi-line prescribed labels (`prevNonEmptyLine`), and expanded same-line prescribed labels (without matching bare `Original answer:`).
   - Expanded `FILLER_PATTERNS` `'like'` detection to capture conversational ASR `"like"` while avoiding grammatical `"like to"` / `"like a/an/the/this/that"`.
2. **Universal Turn-1 Batching, Signal-to-Noise & Quote Discipline** ([`pi-analyzer.ts`](../backend/src/pi-analyzer.ts), [`pi-sandbox.ts`](../backend/src/pi-sandbox.ts)):
   - Guided `buildPiSystemPrompt` to batch Turn-1 analysis calls in parallel, cap optional `run_transcript_js` usage to `<= 1` consistency/drift check, and narrowed `analyze_transcript_metrics` + `run_transcript_js` tool descriptions so raw word/WPM/filler/`I`-vs-`we` counts act strictly as internal diagnostic evidence rather than table filler in prose (translating into Talk-to-Listen Ratio and direction-of-control insights instead).
   - Enforced single-speaker, single-turn quote integrity and multi-part/ecosystem problem calibration, targeting `~2,600–3,500` crisp coaching words.
3. **Why Round 2 Was Reverted (Anti-Overfitting Gate)**:
   - A candidate Round 2 experiment tested an explicit Gemini-only word budget (`2,200–3,000` words) plus follow-up split rules. While it accelerated Dev runs to `91.9s` (`meanWords = 3,026`) and lifted Fable Clarity (`6.70 -> 7.60`), it dropped Fable Diagnostic Insight (`7.90 -> 7.30`), lowering Dev composite quality (`8.38`, `60%` win rate). Per the selection rule, Round 2 was reverted in favor of Round 1's lighter, 100%-universal changes (`8.44`, `70%` win rate).

### Hill-Climbing Progression & Unseen Holdout Validation (`gemini-4-hydrogen`)

| Run / Split | n | Mean Time | Median | Turns / Tools | Mean Tokens | Gemini Judge | Fable Judge | Composite | Paired Hist Comp | Combined Win Rate | Quote Fidelity | Strict / In-Loop Pass | Hallucinated TS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Baseline `v3` (`N=5` Dev)** | 5 | 207.1s | 204.1s | 9.8 / 12.0 | 366.6k | 8.72 | 7.10 | 7.91 | 7.64 | 50% (3/5 Gem, 2/5 Fab) | 100.0% | 5/5 / 5/5 | 0 |
| **Round 1 Universal (`N=5` Dev, Winner)** | 5 | **130.4s** | 143.2s | **4.2 / 6.2** | **139.0k** | **9.18** | **7.70** | **8.44** | 7.53 | **70%** (5/5 Gem, 2/5 Fab) | 93.0% | 4/5 / 4/5 | 0 |
| *Round 2 Gemini Budget (`N=5` Dev, Reverted)* | 5 | *91.9s* | *91.6s* | *3.6 / 5.6* | *127.5k* | *9.26* | *7.50* | *8.38* | *7.74* | *60% (4/5 Gem, 2/5 Fab)* | *98.8%* | *4/5 / 4/5* | *0* |
| **Locked Blind Holdout (`N=6` Unseen)** | **6** | **115.3s** | **119.0s** | **4.3 / 6.3** | **115.8k** | **9.22** | **7.87** | **8.54** | **7.25** | **91.7%** (5/6+1t Gem, **6/6** Fab) | **100.0%** | **6/6 / 6/6** | **0** |

**`claude-opus-5-5` Non-Regression Check (`N = 5` Dev)**:
- Mean latency improved slightly (`238.4s -> 235.2s`, median `235.4s`, `-1.8` turns, `-60.8k` tokens), combined win rate held at **`90%`** (`5/5` Gem `9.02`, `4/5` Fab `7.90`), composite quality scored **`8.46`** vs paired historical `7.24` (`+1.22`), quote fidelity rose (`93.6% -> 98.0%`), `inLoopVerify` passed `5/5`, and hallucinated timestamps remained **`0`**.

---

## 5. `Pi v2` → `Pi v3` Validation Lift (`claude-opus-5-5`, `N = 9`)

Tested on the 9 hardest historical regressions (`case-01`, `03`, `04`, `05`, `06`, `07`, `11`, `17`, `18`):

| Metric | Pi v2 Baseline | Pi v3 | Delta |
|---|---:|---:|---:|
| **Gemini Judge Win Rate (`gemini-4-carbon`)** | 0/9 (0.0%) | **9/9 (100.0%)** | **+100.0 pts** |
| **Fable Judge Win Rate (`claude-fable-5-1`)** | 2/9 (22.2%) | **8/9 (88.9%)** | **+66.7 pts** |
| **Combined Blind Win Rate** | 11.1% | **94.4%** | **+83.3 pts** |
| **Composite Overall Score** (vs. Paired Hist.) | 7.21 (vs. 8.24) | **8.53** (vs. 7.47) | **+1.32** |
| **Gemini Overall Score** | 7.43 (vs. 8.98) | **9.06** (vs. 7.96) | **+1.63** |
| **Fable Overall Score** | 6.98 (vs. 7.50) | **8.00** (vs. 6.98) | **+1.02** |
| Grounding Accuracy (Gem / Fab) | 8.06 / 7.17 | **9.33 / 7.94** | +1.27 / +0.77 |
| Rubric Calibration (Gem / Fab) | 7.50 / 6.89 | **9.11 / 7.94** | +1.61 / +1.05 |
| Diagnostic Insight (Gem / Fab) | 8.00 / 7.17 | **8.94 / 8.11** | +0.94 / +0.94 |
| Coaching Actionability (Gem / Fab) | 7.83 / 7.56 | **9.06 / 8.44** | +1.23 / +0.88 |
| Clarity & Signal-to-Noise (Gem / Fab) | 7.56 / 6.78 | **8.78 / 7.83** | +1.22 / +1.05 |
| Mean Wall-Clock Time / Median | 207.1s / 201.1s | 230.3s / 242.3s | +23.2s |
| Mean Turns / Tool Calls | 6.9 turns / 8.7 tools | **5.7 turns / 7.6 tools** | **-1.2 turns** |
| Mean Total Tokens | 228.3k | **209.8k** | **-18.5k** |
| Hallucinated Timestamps (`verify`) | 0 | **0** | **0** |

*Only single-judge miss in `v3`*: `case-04` (`generic`), where Gemini preferred `Pi v3` (`8.5` vs `8.2`) while Fable slightly preferred the historical run (`7.5` vs `7.8`). On custom `1–5` rubrics (`case-17`, `18`), secondary evaluation notes (`case-06`, `11`), and behavioral mocks (`case-01`, `03`, `05`, `07`), `Pi v3` won across both judges.

---

## 6. 11-Model Tradeoff Benchmark (`N = 5` Dev Stratified Cases)

Sorted by mean wall-clock latency (fastest to slowest; `55/55` completed):

| Model | Provider | Cost Tier | n | Mean Time | Median | Turns / Tools | Mean Tokens | Gemini Judge | Fable Judge | Composite | Paired Hist Comp | Combined Win Rate | Quote Fidelity | Strict / In-Loop Pass | Pareto Optimal |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **`claude-sonnet-5-5`** | Anthropic | `$0 Sub` | 5 | **115.8s** | 119.7s | 5.4 / 6.4 | 208.3k | 7.90 | 7.24 | **7.57** | 8.15 | 20% (1/5 Gem, 1/5 Fab) | 100.0% | 5/5 / 5/5 | **Yes** |
| `gpt-6-luna` | OpenAI Codex | `$0 Sub` | 5 | 130.2s | 149.9s | 6.0 / 7.0 | 139.6k | 7.10 | 5.90 | 6.50 | 8.45 | 0% (0/5 Gem, 0/5 Fab) | 91.2% | 4/5 / 4/5 | No |
| **`gemini-4-hydrogen`** *(Climbed)* | **Google Gemini** | **`API Key`** | **5** | **130.4s** | **143.2s** | **4.2 / 6.2** | **139.0k** | **9.18** | **7.70** | **8.44** | **7.53** | **70%** (5/5 Gem, 2/5 Fab) | **93.0%** | **4/5 / 4/5** | **Yes** |
| `gemini-3.8-flash` | Google Gemini | `API Key` | 5 | 201.7s | 190.3s | 14.6 / 14.6 | 454.9k | 8.54 | 6.60 | 7.57 | 8.05 | 40% (3/5 Gem, 1/5 Fab) | 88.4% | 3/5 / 2/5 | No |
| `claude-haiku-5-5` | Anthropic | `$0 Sub` | 5 | 202.1s | 213.4s | 7.2 / 8.6 | 413.4k | 7.08 | 6.70 | 6.89 | 8.08 | 10% (1/5 Gem, 0/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| **`claude-opus-5-5`** *(Post-climb)* | Anthropic | `$0 Sub` | 5 | **235.2s** | 235.4s | 4.0 / 6.0 | 174.4k | **9.02** | **7.90** | **8.46** | 7.24 | **90%** (5/5 Gem, 4/5 Fab) | 98.0% | 3/5 / 5/5 | **Yes** |
| `gpt-6-astra` | OpenAI Codex | `$0 Sub` | 5 | 264.2s | 229.7s | 6.2 / 7.4 | 127.5k | 8.96 | 7.00 | 7.98 | 7.37 | 60% (5/5 Gem, 1/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| `gpt-6.1-sol` | OpenAI Codex | `$0 Sub` | 5 | 304.8s | 307.3s | 7.4 / 8.0 | 151.3k | 8.52 | 7.26 | 7.89 | 7.48 | 60% (4/5 Gem, 2/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| **`claude-fable-5-1`** | Anthropic | `$0 Sub` | 5 | **394.0s** | 379.5s | 6.2 / 8.2 | 279.6k | **9.14** | **8.10** | **8.62** | 7.34 | **100%** (5/5 Gem, 5/5 Fab) | 100.0% | 5/5 / 5/5 | **Yes** |
| `gemini-4-argon` | Google Gemini | `API Key` | 5 | 434.4s | 421.9s | 5.4 / 7.4 | 208.8k | 8.78 | 7.16 | 7.97 | 7.75 | 50% (3/5 Gem, 2/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| `gemini-4-carbon` | Google Gemini | `API Key` | 5 | 537.2s | 547.0s | 8.6 / 10.6 | 316.9k | 9.02 | 7.40 | 8.21 | 7.55 | 60% (4/5 Gem, 2/5 Fab) | 100.0% | 5/5 / 5/5 | No |

*Zero hallucinations*: Every completed model across all `55/55` Dev runs and `6/6` Holdout runs recorded `totalHallucinatedTS = 0`.

---

## 7. Key Takeaways & Model Selection Notes

1. **Universal Hill-Climbing Closed Almost the Entire Quality Gap to `Opus` at Half the Latency**:
   - On Dev (`N = 5`), `gemini-4-hydrogen` improved from `207.1s` / `7.91` / `50%` win to **`130.4s` / `8.44` / `70%` win** (`-37%` latency, `-62%` tokens, `+0.53` quality), matching `gpt-6-luna`'s speed (`130.2s`) while scoring **`+1.94` points higher** (`8.44` vs `6.50`), and even outpacing slow flagship Google models (`gemini-4-argon` `434.4s / 7.97`, `gemini-4-carbon` `537.2s / 8.21`).
   - On the locked **Blind Holdout (`N = 6`)**, generalization held cleanly with zero degradation: **`115.3s` mean (`119.0s` median), `8.54/10` composite (`9.22` Gem / `7.87` Fab), `91.7%` combined blind win rate (`6/6` Fable wins), `100.0%` quote fidelity, `6/6` strict verify pass, and `0` hallucinated timestamps**.
2. **Anthropic `$0` Subscription Frontier & Peak Depth**:
   - **Fastest `$0` Option (`claude-sonnet-5-5`, `115.8s`, `7.57/10`)**: Pure Anthropic low-latency option, `100%` quote fidelity, `$0` subscription.
   - **Balanced `$0` Option (`claude-opus-5-5`, `235.2s`, `8.46/10`, `90%` win)**: High win-rate consistency across both judges (`5/5` Gem, `4/5` Fab) at `$0` incremental subscription cost.
   - **Max Quality (`claude-fable-5-1`, `394.0s`, `8.62/10`, `100%` win)**: Perfect `5/5` win rate on both judges (`+158.8s` slower than `opus` for `+0.16` composite lift).
3. **Cross-Family Judge Calibration**:
   - At the `Pi v3` frontier (`fable-5-1` `8.62`, `opus-5-5` `8.46`, climbed `gemini-4-hydrogen` `8.44` Dev / `8.54` Holdout), both cross-family judges (`gemini-4-carbon` and `claude-fable-5-1`) strongly favored `Pi v3` over historical production analyses while confirming that universal tool-batching and signal-to-noise hygiene lifted both Google and Anthropic models (`opus-5-5` token usage dropped `-25.9%` and quote fidelity climbed `93.6% -> 98.0%`).
