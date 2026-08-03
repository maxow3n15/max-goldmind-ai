// Confidence calibration.
//
// A confidence number only means something if 80% confidence really does
// win about 80% of the time. This module compares every prediction the
// engine has made against what the market actually did, and reports the
// gap honestly — including when the engine is over-confident.
//
// Pure statistics over closed trades. When the sample is too small to say
// anything, it says so rather than inventing a correction.

export interface CalibrationTrade {
  confidence: number | null;
  pnl: number | null;
}

export interface CalibrationBin {
  label: string;
  lower: number;
  upper: number;
  /** Mean confidence the engine claimed inside this bin. */
  predicted: number;
  /** Realised win rate inside this bin. */
  actual: number | null;
  trades: number;
  gap: number | null;
}

export interface CalibrationReport {
  sample: number;
  /** Mean squared error of the probability forecasts. Lower is better; 0.25 = coin flip. */
  brier: number | null;
  /** Skill against always predicting the base rate. Positive means the confidence adds information. */
  brier_skill: number | null;
  /** Expected calibration error — the average distance between claim and reality. */
  ece: number | null;
  /** Positive = over-confident (claims more than it delivers). */
  bias: number | null;
  bins: CalibrationBin[];
  /** Confidence level above which the engine has actually been profitable. */
  reliable_threshold: number | null;
  reliable: boolean;
  verdict: string;
  notes: string[];
}

const BINS: Array<[number, number]> = [
  [70, 76], [76, 82], [82, 88], [88, 94], [94, 101],
];

const MIN_SAMPLE = 20;
const MIN_PER_BIN = 3;

export function buildCalibration(trades: CalibrationTrade[]): CalibrationReport {
  const rows = trades.filter(
    (t) => t.pnl != null && t.confidence != null && Number(t.confidence) > 0,
  ) as Array<{ confidence: number; pnl: number }>;

  const notes: string[] = [];
  if (rows.length === 0) {
    return {
      sample: 0, brier: null, brier_skill: null, ece: null, bias: null, bins: [],
      reliable_threshold: null, reliable: false,
      verdict: "No closed trades with a confidence score yet — calibration starts once the engine has outcomes to be judged against.",
      notes,
    };
  }

  const won = (p: number) => (p > 0 ? 1 : 0);
  const baseRate = rows.reduce((a, t) => a + won(t.pnl), 0) / rows.length;

  const brier = rows.reduce((a, t) => {
    const p = Math.min(1, Math.max(0, Number(t.confidence) / 100));
    return a + (p - won(t.pnl)) ** 2;
  }, 0) / rows.length;

  const brierRef = rows.reduce((a, t) => a + (baseRate - won(t.pnl)) ** 2, 0) / rows.length;
  const brierSkill = brierRef > 0 ? 1 - brier / brierRef : null;

  const bins: CalibrationBin[] = BINS.map(([lo, hi]) => {
    const inBin = rows.filter((t) => Number(t.confidence) >= lo && Number(t.confidence) < hi);
    const actual = inBin.length >= MIN_PER_BIN
      ? (inBin.reduce((a, t) => a + won(t.pnl), 0) / inBin.length) * 100
      : null;
    const predicted = inBin.length
      ? inBin.reduce((a, t) => a + Number(t.confidence), 0) / inBin.length
      : (lo + hi) / 2;
    return {
      label: hi > 100 ? `${lo}%+` : `${lo}–${hi}%`,
      lower: lo,
      upper: hi,
      predicted: +predicted.toFixed(1),
      actual: actual == null ? null : +actual.toFixed(1),
      trades: inBin.length,
      gap: actual == null ? null : +(predicted - actual).toFixed(1),
    };
  });

  const scored = bins.filter((b) => b.actual != null);
  const totalScored = scored.reduce((a, b) => a + b.trades, 0);
  const ece = totalScored
    ? scored.reduce((a, b) => a + (b.trades / totalScored) * Math.abs(b.predicted - (b.actual as number)), 0)
    : null;
  const bias = totalScored
    ? scored.reduce((a, b) => a + (b.trades / totalScored) * (b.predicted - (b.actual as number)), 0)
    : null;

  // The lowest confidence floor at which the engine has been net profitable.
  let reliableThreshold: number | null = null;
  for (const [lo] of BINS) {
    const above = rows.filter((t) => Number(t.confidence) >= lo);
    if (above.length >= MIN_PER_BIN * 2 && above.reduce((a, t) => a + t.pnl, 0) > 0) {
      reliableThreshold = lo;
      break;
    }
  }

  const enough = rows.length >= MIN_SAMPLE;
  if (!enough) {
    notes.push(`${rows.length} of the ${MIN_SAMPLE} closed trades needed for a statistically meaningful calibration. Treat the numbers below as provisional.`);
  }
  if (bias != null && bias > 12) {
    notes.push(`The engine is over-confident by roughly ${bias.toFixed(0)} points — it claims more certainty than the outcomes justify.`);
  } else if (bias != null && bias < -12) {
    notes.push(`The engine is under-confident by roughly ${Math.abs(bias).toFixed(0)} points — it is winning more often than it predicts.`);
  }
  if (brierSkill != null && brierSkill < 0 && enough) {
    notes.push("Confidence currently carries negative skill: the score is not distinguishing winners from losers better than the raw win rate does.");
  }

  const reliable = enough && ece != null && ece <= 12 && (brierSkill ?? 0) > 0;

  const verdict = !enough
    ? "Provisional — not enough closed trades to judge the confidence engine yet."
    : reliable
      ? `Well calibrated: confidence is within ${(ece as number).toFixed(1)} points of realised outcomes and carries positive skill.`
      : bias != null && bias > 0
        ? `Over-confident by ${bias.toFixed(0)} points — the adaptive layer is discounting scores accordingly.`
        : "Poorly calibrated — confidence is not yet tracking outcomes reliably.";

  return {
    sample: rows.length,
    brier: +brier.toFixed(4),
    brier_skill: brierSkill == null ? null : +brierSkill.toFixed(3),
    ece: ece == null ? null : +ece.toFixed(1),
    bias: bias == null ? null : +bias.toFixed(1),
    bins,
    reliable_threshold: reliableThreshold,
    reliable,
    verdict,
    notes,
  };
}

/**
 * Discount a raw confidence score by the measured over-confidence. Only
 * applied once the sample is large enough to trust; otherwise the raw
 * score passes through untouched.
 */
export function calibratedConfidence(raw: number, cal: CalibrationReport | null): number {
  if (!cal || cal.sample < MIN_SAMPLE || cal.bias == null) return raw;
  // Correct at most 15 points, and never inflate beyond the raw score by
  // more than 5 — an under-confident engine still has to earn its trades.
  const correction = Math.max(-5, Math.min(15, cal.bias));
  return Math.max(0, Math.min(100, Math.round(raw - correction)));
}

export const CALIBRATION_MIN_SAMPLE = MIN_SAMPLE;
