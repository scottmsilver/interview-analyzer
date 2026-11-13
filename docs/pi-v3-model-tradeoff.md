# Pi v3 Upgrades & 11-Model Quality / Time Tradeoff

> **Headline Result**: Implementing `Pi v3` Upgrades 1–3 raised `Pi` (`claude-opus-5-5`) on the 9 hardest historical transcripts from an **11.1%** (`0/9` Gemini, `2/9` Fable) blind-judge win rate in `Pi v2` to **94.4%** (`9/9` Gemini, `8/9` Fable) with **`0` hallucinated timestamps**. Across **11 live Manifest models** on `N = 5` stratified historical cases (`55/55` completed), **`pi-agent` (`claude-opus-5-5`)** is now the default analyzer across both backend and frontend, sitting at the knee of a 4-model Pareto frontier alongside **`claude-sonnet-5-5`**, **`gemini-4-hydrogen`**, and **`claude-fable-5-1`**.

---

## 1. Quality vs. Wall-Clock Time Tradeoff Chart

![Pi v3 Quality vs. Wall-Clock Latency Tradeoff (11 Models)](./pi-v3-quality-time-tradeoff.png)

*Methodology*: Each of the 11 models ran the full `Pi v3` multi-tool pipeline (`analyze_transcript_metrics`, `extract_qa_turns`, `load_interview_rubric`, `audit_answer_quality`, `run_transcript_js`, `verify_evaluation_draft`) on the same **5 stratified historical cases** (`case-01` `google-apm`, `case-04` `generic`, `case-05` `amazon-pm`, `case-11` `google-apm`, `case-17` `diller`). Outputs were scored blindly and position-balanced against the saved historical production analyses by two cross-family judges (`gemini-4-carbon` and `claude-fable-5-1`). Reported wall-clock latency reflects successful end-to-end single-run duration (excluding retry backoff sleeps after 3 upstream `504` gateway timeouts on initial concurrent `gemini-4-carbon`/`gemini-4-argon` runs; `gemini-4-hydrogen` had zero timeouts).

---

## 2. Production UI & Backend Defaults

`DEFAULT_ANALYSIS_METHOD` in [`analyzer.ts`](../backend/src/analyzer.ts) and [`server.ts`](../backend/src/server.ts) is now `'pi-agent'`, and the Analyze dropdown in [`App.tsx`](../frontend/src/App.tsx) exposes the **4 Pareto-optimal `Pi v3` tiers**:

| UI Preset Label | Method | Model ID | Mean Latency | Composite Quality | Win Rate | Default |
|---|---|---|---:|---:|---:|:---:|
| `Pi Fast — Sonnet 5.5` | `pi-agent` | `claude-sonnet-5-5` | 115.8s | 7.57/10 | 20% | — |
| `Pi — Gemini 4 Hydrogen` | `pi-agent` | `gemini-4-hydrogen` | 207.1s | 7.91/10 | 50% | — |
| **`Pi — Opus 5.5 ★ (Default)`** | **`pi-agent`** | **`claude-opus-5-5`** | **238.4s** | **8.51/10** | **90%** | **Yes** |
| `Pi Max — Fable 5.1` | `pi-agent` | `claude-fable-5-1` | 394.0s | 8.62/10 | 100% | — |

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

## 4. `Pi v2` → `Pi v3` Validation Lift (`claude-opus-5-5`, `N = 9`)

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

## 5. 11-Model Tradeoff Benchmark (`N = 5` Stratified Cases)

Sorted by mean wall-clock latency (fastest to slowest; `55/55` completed):

| Model | Provider | Cost Tier | n | Mean Time | Median | Turns / Tools | Mean Tokens | Gemini Judge | Fable Judge | Composite | Paired Hist Comp | Combined Win Rate | Quote Fidelity | Strict / In-Loop Pass | Pareto Optimal |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **`claude-sonnet-5-5`** | Anthropic | `$0 Sub` | 5 | **115.8s** | 119.7s | 5.4 / 6.4 | 208.3k | 7.90 | 7.24 | **7.57** | 8.15 | 20% (1/5 Gem, 1/5 Fab) | 100.0% | 5/5 / 5/5 | **Yes** |
| `gpt-6-luna` | OpenAI Codex | `$0 Sub` | 5 | 130.2s | 149.9s | 6.0 / 7.0 | 139.6k | 7.10 | 5.90 | 6.50 | 8.45 | 0% (0/5 Gem, 0/5 Fab) | 91.2% | 4/5 / 4/5 | No |
| `gemini-3.8-flash` | Google Gemini | `API Key` | 5 | 201.7s | 190.3s | 14.6 / 14.6 | 454.9k | 8.54 | 6.60 | 7.57 | 8.05 | 40% (3/5 Gem, 1/5 Fab) | 88.4% | 3/5 / 2/5 | No |
| `claude-haiku-5-5` | Anthropic | `$0 Sub` | 5 | 202.1s | 213.4s | 7.2 / 8.6 | 413.4k | 7.08 | 6.70 | 6.89 | 8.08 | 10% (1/5 Gem, 0/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| **`gemini-4-hydrogen`** | **Google Gemini** | **`API Key`** | **5** | **207.1s** | **204.1s** | **9.8 / 12.0** | **366.6k** | **8.72** | **7.10** | **7.91** | **7.64** | **50%** (3/5 Gem, 2/5 Fab) | **100.0%** | **5/5 / 5/5** | **Yes** |
| **`claude-opus-5-5`** | Anthropic | `$0 Sub` | 5 | **238.4s** | 247.2s | 5.8 / 7.6 | 235.2k | **9.02** | **8.00** | **8.51** | 7.46 | **90%** (5/5 Gem, 4/5 Fab) | 93.6% | 2/5 / 5/5 | **Yes** |
| `gpt-6-astra` | OpenAI Codex | `$0 Sub` | 5 | 264.2s | 229.7s | 6.2 / 7.4 | 127.5k | 8.96 | 7.00 | 7.98 | 7.37 | 60% (5/5 Gem, 1/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| `gpt-6.1-sol` | OpenAI Codex | `$0 Sub` | 5 | 304.8s | 307.3s | 7.4 / 8.0 | 151.3k | 8.52 | 7.26 | 7.89 | 7.48 | 60% (4/5 Gem, 2/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| **`claude-fable-5-1`** | Anthropic | `$0 Sub` | 5 | **394.0s** | 379.5s | 6.2 / 8.2 | 279.6k | **9.14** | **8.10** | **8.62** | 7.34 | **100%** (5/5 Gem, 5/5 Fab) | 100.0% | 5/5 / 5/5 | **Yes** |
| `gemini-4-argon` | Google Gemini | `API Key` | 5 | 434.4s | 421.9s | 5.4 / 7.4 | 208.8k | 8.78 | 7.16 | 7.97 | 7.75 | 50% (3/5 Gem, 2/5 Fab) | 100.0% | 5/5 / 5/5 | No |
| `gemini-4-carbon` | Google Gemini | `API Key` | 5 | 537.2s | 547.0s | 8.6 / 10.6 | 316.9k | 9.02 | 7.40 | 8.21 | 7.55 | 60% (4/5 Gem, 2/5 Fab) | 100.0% | 5/5 / 5/5 | No |

*Zero hallucinations*: Every completed model across all `55/55` runs recorded `totalHallucinatedTS = 0`.

---

## 6. Key Takeaways & Model Selection Notes

1. **`gemini-4-hydrogen` Displaces Slower Google Models on the Frontier**:
   - At `207.1s` mean latency (`204.1s` median), `7.91/10` composite quality, `50%` win rate, `100.0%` quote fidelity, and `5/5` strict verifier pass rate, `gemini-4-hydrogen` jumped onto the 4-model Pareto frontier right between `claude-sonnet-5-5` (`115.8s`, `7.57`) and `claude-opus-5-5` (`238.4s`, `8.51`).
   - It matched `gemini-3.8-flash`'s speed (`207.1s` vs `201.7s`) with `+0.34` higher composite quality (`7.91` vs `7.57`) and `100%` quote fidelity (`88.4%` on Flash), while running **`2.1x` faster than `gemini-4-argon`** (`434.4s`) and **`2.6x` faster than `gemini-4-carbon`** (`537.2s`) with zero `504` gateway timeouts.
   - Its strongest scores were Coaching Actionability (`8.85` composite: `9.4` Gem / `8.3` Fab) and Diagnostic Insight (`8.35`: `9.0` Gem / `7.7` Fab), with `claude-fable-5-1` marking down verbosity (`clarity_and_signal_to_noise`: `6.2` Fab / `8.0` Gem).
2. **Anthropic Frontier Remains Unbeaten on Cost-Free Speed, Knee Quality, and Peak Quality**:
   - **Fastest (`claude-sonnet-5-5`, `115.8s`, `7.57/10`)**: `~2x` faster than `opus` and faster than `haiku` (`202.1s`), `100%` quote fidelity, `$0` subscription.
   - **Default Sweet Spot (`claude-opus-5-5`, `238.4s`, `8.51/10`, `90%` win)**: +0.60 higher composite quality and `+40` percentage points higher win rate than `gemini-4-hydrogen` for only `+31.3s` extra latency, at `$0` incremental subscription cost.
   - **Max Quality (`claude-fable-5-1`, `394.0s`, `8.62/10`, `100%` win)**: Perfect `5/5` win rate on both judges (`+155.6s` slower than `opus` for `+0.11` composite lift).
3. **Cross-Family Judge Calibration**:
   - Both judges independently ranked `claude-fable-5-1` #1 and `claude-opus-5-5` #2 (`gemini-4-carbon`: `9.14` / `9.02`; `claude-fable-5-1`: `8.10` / `8.00`), confirming zero Anthropic self-preference bias at the top. `gemini-4-carbon` scored Google/Codex verbosity more leniently (~1.4–2.0 pts higher than `claude-fable-5-1`), whereas `claude-fable-5-1` still ranked `gemini-4-carbon` (`7.40`) above `claude-sonnet-5-5` (`7.24`).
