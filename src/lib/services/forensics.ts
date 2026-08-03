// Trade forensics.
//
// A trade's profit and loss is the last line of the story, not the story.
// These pure functions reconstruct what actually happened inside each
// position — how far it went against us before it worked (MAE), how much
// it was ever worth (MFE), and how much of that the exit actually captured.
//
// Everything here is measured from data we already store: entry, stop,
// exit and the running excursions recorded while the trade was open. No
// estimates, no fabricated fills.

export interface ExcursionInput {
  direction: "BUY" | "SELL";
  entry_price: number;
  stop_loss: number;
  /** Excursions recorded so far, in price units. */
  mae?: number | null;
  mfe?: number | null;
}

export interface Excursion {
  mae: number;
  mfe: number;
  mae_r: number;
  mfe_r: number;
}

/** Update a trade's running excursions with the latest price. */
export function updateExcursion(t: ExcursionInput, price: number): Excursion | null {
  const risk = Math.abs(Number(t.entry_price) - Number(t.stop_loss));
  if (!Number.isFinite(price) || price <= 0 || !(risk > 0)) return null;

  const favourable = t.direction === "BUY"
    ? price - Number(t.entry_price)
    : Number(t.entry_price) - price;

  const mfe = Math.max(Number(t.mfe ?? 0), Math.max(0, favourable));
  const mae = Math.max(Number(t.mae ?? 0), Math.max(0, -favourable));

  return {
    mae: +mae.toFixed(3),
    mfe: +mfe.toFixed(3),
    mae_r: +(mae / risk).toFixed(3),
    mfe_r: +(mfe / risk).toFixed(3),
  };
}

/** True when the recorded excursions changed enough to be worth persisting. */
export function excursionChanged(prev: ExcursionInput, next: Excursion, epsilon = 0.05): boolean {
  return Math.abs(next.mae - Number(prev.mae ?? 0)) >= epsilon
    || Math.abs(next.mfe - Number(prev.mfe ?? 0)) >= epsilon;
}

export interface ForensicTrade {
  id: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  stop_loss: number;
  exit_price: number | null;
  pnl: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  risk_reward: number | null;
  confidence: number | null;
  session: string | null;
  reason_exit: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface ForensicsReport {
  sample: number;
  /** Share of the best unrealised move that the exits actually banked. */
  capture_efficiency: number | null;
  avg_mae_r: number | null;
  avg_mfe_r: number | null;
  avg_mae_r_winners: number | null;
  avg_mae_r_losers: number | null;
  /** Losers that were in profit by 1R or more before reversing. */
  gave_back_winners: number;
  /** Stop-outs whose best move never exceeded 0.25R — the entry was simply wrong. */
  immediately_wrong: number;
  /** Winners whose worst drawdown was under 0.25R — clean, well-timed entries. */
  clean_entries: number;
  /** Suggested stop distance in R that would have survived 90% of winners. */
  stop_survival_r: number | null;
  /** Median hold time of winners and losers, in minutes. */
  hold_minutes_winners: number | null;
  hold_minutes_losers: number | null;
  findings: string[];
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, d = 2) => (n == null ? null : Number(n.toFixed(d)));

export function buildForensics(trades: ForensicTrade[]): ForensicsReport {
  const rows = trades.filter((t) => t.pnl != null && t.mfe_r != null && t.mae_r != null);
  const winners = rows.filter((t) => Number(t.pnl) > 0);
  const losers = rows.filter((t) => Number(t.pnl) <= 0);

  const realisedR = (t: ForensicTrade) => {
    const risk = Math.abs(Number(t.entry_price) - Number(t.stop_loss));
    if (!(risk > 0) || t.exit_price == null) return null;
    const move = t.direction === "BUY"
      ? Number(t.exit_price) - Number(t.entry_price)
      : Number(t.entry_price) - Number(t.exit_price);
    return move / risk;
  };

  const capturePairs = rows
    .map((t) => ({ realised: realisedR(t), best: Number(t.mfe_r) }))
    .filter((p): p is { realised: number; best: number } => p.realised != null && p.best > 0.1);
  const captureEfficiency = capturePairs.length
    ? (capturePairs.reduce((a, p) => a + Math.max(0, p.realised), 0) /
       capturePairs.reduce((a, p) => a + p.best, 0)) * 100
    : null;

  const gaveBack = losers.filter((t) => Number(t.mfe_r) >= 1).length;
  const immediatelyWrong = losers.filter((t) => Number(t.mfe_r) < 0.25).length;
  const cleanEntries = winners.filter((t) => Number(t.mae_r) < 0.25).length;

  // The drawdown a stop would have had to tolerate to keep 90% of the winners.
  const winnerMae = winners.map((t) => Number(t.mae_r)).sort((a, b) => a - b);
  const stopSurvival = winnerMae.length
    ? winnerMae[Math.min(winnerMae.length - 1, Math.floor(winnerMae.length * 0.9))]
    : null;

  const holdMinutes = (t: ForensicTrade) =>
    t.closed_at ? (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / 60_000 : null;
  const holdW = median(winners.map(holdMinutes).filter((x): x is number => x != null));
  const holdL = median(losers.map(holdMinutes).filter((x): x is number => x != null));

  const avgMaeW = mean(winners.map((t) => Number(t.mae_r)));
  const avgMaeL = mean(losers.map((t) => Number(t.mae_r)));

  const findings: string[] = [];
  if (rows.length < 5) {
    findings.push(`Only ${rows.length} closed trade${rows.length === 1 ? "" : "s"} carry excursion data — forensics need at least 5 before the patterns mean anything.`);
  } else {
    if (captureEfficiency != null && captureEfficiency < 45) {
      findings.push(`Exits are capturing only ${captureEfficiency.toFixed(0)}% of the move the trades actually offered — targets are being left on the table or winners are being cut early.`);
    }
    if (gaveBack >= Math.max(2, losers.length * 0.3)) {
      findings.push(`${gaveBack} losing trade${gaveBack === 1 ? " was" : "s were"} up 1R or more before reversing — the break-even rule is triggering too late for these conditions.`);
    }
    if (immediatelyWrong >= Math.max(2, losers.length * 0.5)) {
      findings.push(`${immediatelyWrong} losers never moved 0.25R in favour — those entries were wrong from the first tick, which is an entry-timing problem rather than a management one.`);
    }
    if (stopSurvival != null && avgMaeW != null && stopSurvival > 0.75) {
      findings.push(`Winners routinely draw down to ${stopSurvival.toFixed(2)}R before working — stops tighter than that are cutting good trades.`);
    }
    if (cleanEntries >= winners.length * 0.6 && winners.length >= 3) {
      findings.push(`${cleanEntries} of ${winners.length} winners barely went offside — entry timing on the winning setups is genuinely good.`);
    }
    if (holdW != null && holdL != null && holdL > holdW * 1.5) {
      findings.push(`Losers are being held ${(holdL / Math.max(1, holdW)).toFixed(1)}x longer than winners — the classic pattern of hoping a loser back rather than accepting it.`);
    }
  }

  return {
    sample: rows.length,
    capture_efficiency: round(captureEfficiency, 1),
    avg_mae_r: round(mean(rows.map((t) => Number(t.mae_r)))),
    avg_mfe_r: round(mean(rows.map((t) => Number(t.mfe_r)))),
    avg_mae_r_winners: round(avgMaeW),
    avg_mae_r_losers: round(avgMaeL),
    gave_back_winners: gaveBack,
    immediately_wrong: immediatelyWrong,
    clean_entries: cleanEntries,
    stop_survival_r: round(stopSurvival),
    hold_minutes_winners: round(holdW, 0),
    hold_minutes_losers: round(holdL, 0),
    findings,
  };
}
