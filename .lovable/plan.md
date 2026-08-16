# Fix the break-even / trailing freeze in position management

## The problem

The position manager measures a trade's risk from its *current* stop loss, but it also overwrites that stop every time it moves it. Once a stop is moved to break-even the measured risk becomes zero, and a zero-risk guard at the top of the function makes the manager give up on the trade entirely — no trailing, no take-profit close, no stop close.

For live trades the broker's own stop and target still exit the position, so the damage is lost trailing on winners. For paper trades there is no broker, so the trade never closes at all: it stays open forever, holds an open-trade slot, and distorts P&L and win-rate statistics.

## What to change

### 1. Record each trade's original stop

Add an `initial_stop_loss` column to the trades table, set when the trade is opened and never modified afterwards. Backfill existing rows from their current stop loss. The live stop loss keeps being updated as it is today.

### 2. Measure risk from the original stop

Position management uses the original stop for all "how far in profit is this trade" maths, so break-even and trailing thresholds stay on a fixed scale for the life of the trade instead of drifting each time the stop tightens.

### 3. Never stop managing a trade

Reorder the checks so the exit conditions (stop hit, target hit, early exit) are always evaluated. Only the break-even and trailing calculations are skipped when risk cannot be determined, and the manager falls back to the current stop when the original is unavailable, so nothing is left unmanaged.

### 4. Break-even leaves a small buffer

Move the break-even stop slightly beyond entry rather than exactly to entry, so a trade protected at break-even is never sitting at exactly zero risk and covers its own costs when it is stopped out there.

### 5. Sweep any already-frozen paper trades

One-off cleanup for paper trades currently stuck with a stop equal to their entry: bring them back under management so they exit normally on the next cycle.

## Verification

- New tests covering the full lifecycle: entry, break-even move, continued trailing after break-even, target close after break-even, and stop close after break-even. Each of these fails on today's code.
- A test proving R is measured against the original stop after several trailing moves.
- Re-run the backtest replay suite; the pipeline engine shares this management code, so its management-transition tests must still pass, and the determinism test must still produce identical results.
- Full type check and test suite, with real output reported.

## Technical detail

- Migration: `ALTER TABLE public.trades ADD COLUMN initial_stop_loss numeric`, backfilled with `stop_loss`, plus the matching grants already in place for the table. Regenerate types.
- `src/lib/services/position-manager.ts`: `OpenTrade` gains `initial_stop_loss?: number | null`; `risk` derives from it with a fallback to `stop_loss`; the `risk <= 0` early return is replaced by a narrower guard that only skips the break-even/trail branches; break-even applies a configurable buffer (default a small fraction of initial risk).
- `src/lib/services/orchestrator.ts`: `deriveAccountState` selects and carries `initial_stop_loss` into `OpenTrade`.
- Trade-open paths (`execution.ts` paper fills, `live-execution.server.ts`, backtest engines) write `initial_stop_loss` alongside `stop_loss`.
- `src/lib/backtest/pipeline-engine.ts`: replay legs track their entry stop separately from the managed stop so simulation matches live semantics.
- Cleanup runs inside the reconciliation pass in `tick.server.ts` rather than as a one-shot script.
