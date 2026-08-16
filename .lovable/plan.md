# Backtesting the real decision pipeline — feasibility assessment

## What I verified in the code

- `src/lib/backtest/engine.ts` is a self-contained EMA/RSI/ATR rule engine. It shares only `risk-engine.ts` (`assessRisk`, `SIMULATION_GOLD_SPEC`) with live. It never touches `orchestrator.ts`, `setup-models.ts`, `confidence-engine.ts`, `structure.ts`, `mtf.ts`, `safety.ts` or `position-manager.ts`. Your read is correct: no backtest has validated the live strategy.
- `runDecisionPipeline` in `orchestrator.ts` is genuinely pure — no I/O, no React, no network. It takes `analysis`, `mtf`, `entryStructure`, `quant`, `macro`, `sessionReport`, `quote`, `settings`, `snapshot`, `trades`, `challenge`, `calibration` and returns plans. It can be driven from historical data as-is, with no changes to the file.
- `structure.ts`, `mtf.ts`, `setup-models.ts`, `confidence-engine.ts`, `scoring.ts`, `safety.ts`, `risk-engine.ts`, `position-manager.ts`, `sessions-liquidity.ts`, `economic-calendar.ts`, `volume/volatility/momentum/candle-quality` are all pure functions over candle arrays or plain objects. All directly replayable.
- The *inputs* are the problem, not the pipeline. Three input builders are live-only:
  - `mtf.server.ts` / `quant.server.ts` fetch "now" and cache; they have no point-in-time mode.
  - `correlation.ts` is fed by `changePct()` — a current snapshot with no history at all.
  - `macro`/news comes from live RSS feeds; there is no historical archive.
- **Data ceiling.** `candles.server.ts` pulls Yahoo `chart`. Yahoo caps intraday history: 1m ≈ 7 days, 5m/15m/30m ≈ 60 days, 60m ≈ 730 days. The backtest UI already offers `15m × 3mo/6mo/1y/2y`, which the provider silently truncates. A true 3-month 15-minute backtest is not obtainable from the current data source at all.

## 1. Full replay including real AI calls — cost and feasibility

Volume for 3 months of 15m gold: ~92 bars/day × ~65 trading days ≈ **6,000 bars**.

- Naive one call per bar: ~6,000 gateway calls. The evidence brief from `ai-context.server.ts` is a large prompt (multi-thousand tokens), so roughly **20–40M input tokens** per run, at 2–6s latency each. Serialised that is **5–10 hours**; even at 5-way concurrency you are fighting 429s and burning a large amount of credit for one run. Re-running with a tweaked parameter costs the same again.
- It also cannot run inside a server function: the Worker request budget is minutes, not hours. It would need a chunked background job with checkpointing.
- It is not even reproducible: the model is non-deterministic, so two runs of the same window give different equity curves. That undermines the point of a backtest.

Bounding it is possible and is the only sane version:
- **Candidate pre-filter** — only call the AI on bars where the deterministic layer already says a setup could exist (structure flip + reclaimed sweep/zone present + session window + spread/quality OK). On historical gold that is typically low single-digit percent of bars: **~60–200 calls per 3-month run**, minutes not hours.
- **Persistent response cache** keyed by the existing `marketStateHash` (`market-state.ts`) plus timeframe and prompt version, stored in a table. First run pays; every re-run of the same window is free and *deterministic*, which also fixes the reproducibility problem.
- Even bounded, this only becomes worth building **after** the deterministic harness exists, because the pre-filter is exactly the deterministic harness.

Verdict: full unbounded AI replay is not feasible. Bounded + cached AI replay is feasible as a later phase.

## 2. Deterministic-only replay (AI step replaced)

Feasible, and the highest value per unit of work. The catch worth stating plainly: `setup-models.ts` is a *classifier*, not a *generator* — it grades a proposal it is given. Removing the AI means something must synthesise the proposal (direction, entry, SL, TP) from structure. That synthesiser is new code and is a strategy decision in itself, but it is a small, honest one: the setup models already define what must be true, so the generator is the inverse of the classifier —

- direction from the flip event (CHOCH/BOS) + HTF bias,
- entry at the unmitigated FVG/OB/breaker edge the model requires,
- stop beyond the sweep extreme / swing with the ATR buffer `setup-validation.ts` already enforces,
- TP1/2/3 at the `buildLiquidityLevels` targets on the correct side.

Everything after that is the real code path, unmodified: `classifySetup` → `computeStructuredConfidence` → `computeComposite` → `runSafety` → `buildAdaptivePolicy` → `buildLadderPlans`/`riskPerLot` → `position-manager.evaluate`.

Known fidelity gaps to accept and label in the UI:
- **Macro/news factors are neutralised** (no historical feed) — the macro contribution to composite score and the news blackout gate cannot be replayed. Confidence numbers will therefore differ from live.
- **Correlation factor is neutralised** (no historical DXY/yields series wired).
- **Spread/slippage is modelled, not observed** — reuse the paper-fill assumptions (spread cross + 0.05 slippage).
- Economic calendar *is* replayable — `economic-calendar.ts` is rule-based from a timestamp, so the news-window gate can be honoured historically.

That still exercises the large majority of what was hardened: MTF, SMC structure, setup models, confidence engine, safety gates, adaptive policy, challenge budget, broker-spec risk sizing, ladder building and trade management.

## 3. What I recommend

A phased build, Phase A first, decided independently of Phase B.

**Phase A — deterministic pipeline replay harness (recommended now).**
Build a point-in-time replay layer plus a structure-derived proposal generator, drive the *real* `runDecisionPipeline` bar by bar, and simulate fills/management intrabar. Deterministic, repeatable, no API spend, runs in a normal server function for a 60-day window.

**Phase B — optional AI-in-the-loop mode (only if Phase A shows the deterministic core is sound).**
Reuse Phase A's harness; on candidate bars only, call `runMarketAnalysis` with an evidence brief built from the *sliced* history, cache responses by market-state hash, and run as a chunked job. Compare the two modes' equity curves to measure what the AI is actually adding — which is a genuinely useful number to have.

**Prerequisite worth deciding now:** the Yahoo intraday ceiling. Options are (a) accept 60-day maximum on 15m and fix the UI period options so they stop lying, (b) run longer windows on 60m/240m where 2 years is available, or (c) start persisting candles to the database on every tick so depth accumulates going forward. I would do (a)+(b) immediately and (c) as a background improvement.

## 4. Reusable vs. new code, and size

Reusable unchanged: `orchestrator.ts`, `setup-models.ts`, `confidence-engine.ts`, `scoring.ts`, `safety.ts`, `adaptive.ts`, `risk-engine.ts`, `execution.ts`, `position-manager.ts`, `structure.ts`, `mtf.ts`, `sessions-liquidity.ts`, `economic-calendar.ts`, `candle-integrity.ts`, quant modules, `challenge/engine.ts`, plus the whole metrics/equity/UI half of `backtest/engine.ts` and `backtesting.tsx`.

New code needed:
| Piece | Rough size |
| --- | --- |
| Point-in-time replay data layer (multi-TF historical slices, as-of alignment, no lookahead) | ~250 lines |
| Structure-derived setup proposal generator | ~200 lines |
| Replay adapter: synthetic `snapshot`/`settings`/`trades`/`quote`/`challenge`/`calibration` per bar, neutral macro/correlation stubs | ~250 lines |
| Intrabar fill + management simulator driving `position-manager.evaluate` and ladder legs | ~250 lines |
| Rework `backtest/engine.ts` into "classic" vs "pipeline" modes, keep metrics | ~150 lines changed |
| Server function + UI mode toggle and fidelity-caveat panel | ~150 lines |
| Tests (no-lookahead guard, ladder fills, management transitions, determinism) | ~250 lines |

Phase A total ≈ **1,300–1,500 lines, ~8–10 files**, one substantial build turn (possibly two). Phase B on top ≈ 400–500 lines plus a cache table migration.

**Biggest risk to guard explicitly:** lookahead leakage. Every historical read must be sliced strictly to `t <= bar.t`, and the existing 30s/45s caches in `mtf.server.ts`/`quant.server.ts` must be bypassed entirely in replay rather than reused. I would make that a tested invariant, not a convention.

## Recommendation

Build Phase A. It converts the backtester from a proxy strategy into a real validation of the deterministic system, costs nothing to re-run, and produces the candidate filter that makes Phase B affordable. Treat Phase B as a follow-up experiment to quantify the AI's contribution, not as the primary backtest.
