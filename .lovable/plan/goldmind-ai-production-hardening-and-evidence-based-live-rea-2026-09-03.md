# GoldMind AI — production hardening and evidence-based live readiness

Snapshot under audit: commit `0ece74e810644b47e469fabe9ac6bc1746a26391`, Bun 1.3.3.

## Pre-verified findings (checked just now against current source)

- **Defect #10 — live secret in git.** A plaintext `x-cron-secret` value is committed in
  `supabase/migrations/20260803210536_*.sql` (line 30) and `20260803210609_*.sql` (line 14).
  Confirmed present. This is a standing exposure.
- **Defect #1 — status constraint gap.** `20260728165337_*.sql:69` allows only
  `open | closed | cancelled`, but three modules write `reconciliation_required`
  (`src/lib/brokers/live-execution.server.ts`, `src/lib/execution-state.server.ts`,
  `src/lib/services/execution-state.ts`). Confirmed present.
- **Defect #2 — invented spread.** `src/lib/services/spot.server.ts:23-24` builds
  `bid = mid - 0.15`, `ask = mid + 0.15` as literals. Confirmed present.
- **No `test` script** in `package.json` and **no `vitest.config.ts`**, despite 17 test files.
  Confirmed present.

Everything else in the brief is treated as an unverified hypothesis, re-checked against
current source before any edit, with a regression test per confirmed defect.

## Scope reality

This is a ~150-file trading stack and the brief spans 10 phases, 16 verification
demonstrations and 7 documents. That is multi-session work. This plan sequences it so every
session ends on a buildable, independently useful commit, and `docs/continuation.md`
always names the in-progress phase, the changed files, the fixed/partial/untouched defect
numbers, and the single next step.

## Session 1 (what I will do on approval)

**Phase 0 — exposure handling**
- Prepare rotation, do not perform it: I will not call the cron/webhook endpoint to test
  whether the leaked secret is live (that could fire a real trading tick), and I will not
  print the value in any file. Activity is judged only from the deployed cron job config.
- Add a forward migration that rewrites the `pg_net` cron job to read the secret from
  secure storage instead of a literal, and drop/recreate the job without the inline value.
- Add secret scanning: gitleaks in CI plus a local pre-commit hook, and a migration
  regression test that fails when a secret-shaped literal appears in a new migration file.
- Record rotation as **pending operator action** in `docs/production-audit.md` with exact
  numbered steps. No history rewriting.

**Baseline reproduction**
- Add `vitest.config.ts` with the `@/` alias from `tsconfig.json` and a Node environment,
  then a `"test": "vitest run"` script. No dependency upgrades, no touching
  `bunfig.toml`'s 24-hour supply-chain guard.
- Run `bun install`, `bun run lint`, `bun run build`, `bun run test`; record real output and
  versions in `docs/verification-report.md`, tagged against the commit above.

**Phase 1 start — database integrity**
- Forward migration adding `reconciliation_required` (and the rest of the intent lifecycle
  states) to the trade-status constraint, plus indexes and the order-intent table with its
  idempotency key, environment/connection pinning columns and RLS. No destructive changes to
  existing rows.
- Replace swallowed query errors on the money-moving read paths with explicit failures that
  block new exposure.

## Subsequent sessions (priority order)

1. **Phase 1 rest** — one server-authoritative execution service used by scheduled, browser,
   webhook, manual-cycle and ticket paths; intent persisted before any broker side effect;
   transaction-safe per-account leases with fencing; broker timeout treated as UNKNOWN.
2. **Phase 2** — single validated pre-submission policy check (fresh account state, exposure,
   loss/drawdown budget, margin reservation), per-setup risk cap across ladder legs, real
   instrument precision/units, sizing from executable bid/ask and re-derived from actual fill.
3. **Phase 3** — broker-authoritative reconciliation with durable cursors; SL/TP and external
   closes ingested normally rather than as permanent conflicts; protective management running
   independently of AI availability and the entry kill switch; genuinely side-effect-free dry run.
4. **Phase 4** — broker quotes as the execution authority (removes the 0.15 spread), correct
   4h aggregation with candle availability times, injected clock, authoritative economic
   calendar adapter that fails closed for automated entries when coverage is unverifiable.
   Standing rule: headline sentiment can never relax a calendar blackout, freshness gate,
   execution safeguard or risk limit.
5. **Phase 5** — relabel the heuristic 0–100 output as a setup-quality score, not a win
   probability; full decision provenance (model/prompt/strategy version, evidence snapshot);
   headlines treated as untrusted data; out-of-sample factor ablations; INSUFFICIENT_EVIDENCE
   instead of confident numbers on small samples.
6. **Phase 6** — close the live/replay proposal gap explicitly, document what replay does not
   reproduce, chronological train/validate/held-out split with a final untouched segment,
   dependence-aware resampling for ladder legs, and a forward-demo evidence collector.
7. **Phase 7** — credential key rotation support, SSRF allowlist verification, platform-
   compatible scheduling with strict timeouts and bounded retries, durable heartbeats and an
   operator-configured alert channel, corrected fill-count reporting.
8. **Phase 8** — CI gates and the 16 required demonstrations, using a local Supabase Postgres
   for RLS/concurrency tests and stubs for fault injection; plus an explicitly armed practice-
   account harness that is not run without demo authorization.
9. **Phase 9** — server-derived readiness report separating engineering / deployed / broker /
   forward-edge / authorization / armed states, and the rollout runbook.

## Deliverables and reporting rules

`docs/production-audit.md`, `verification-report.md`, `live-readiness.md`,
`operations-runbook.md`, `research-validation.md`, `continuation.md`, plus updated CI.
Every individual claim is tagged **implemented-untested**, **tested-locally**,
**verified-deployed**, or **externally-pending-dependency**. A green local build is never
reported as deployment safety. Final scoring of the 16 areas out of 10 comes at the end, with
evidence and the specific reason each score is not higher; unknown dimensions are
NOT VERIFIED rather than guessed. Live execution stays locked throughout; no real orders.

## Two things I need from you

1. **Rotation authorization.** I can regenerate and set the cron secret via project secrets
   if you authorize it; otherwise it stays operator-pending with written steps.
2. **Demo broker authorization.** The practice-account qualification harness will be built but
   not executed unless you explicitly arm it against a named demo account.
