// Pure validation of an AI-produced trade setup.
//
// The model is a language model, not a price feed: it can return a stop on the
// wrong side of entry, an entry hundreds of dollars away from spot, duplicate
// targets, or a fabricated risk:reward. Sizing divides by the stop distance, so
// a bad setup is not just unprofitable — it is a sizing hazard. Everything
// downstream consumes the sanitised result, never the raw model JSON.

export interface RawSetup {
  direction?: unknown;
  entry?: unknown;
  stop_loss?: unknown;
  take_profit_1?: unknown;
  take_profit_2?: unknown;
  take_profit_3?: unknown;
  risk_reward?: unknown;
  [k: string]: unknown;
}

export interface CleanSetup {
  direction: "BUY" | "SELL";
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number | null;
  take_profit_3: number | null;
  risk_reward: number;
  expected_hold_hours: number | null;
  probability_rating: string | null;
  suggested_risk_pct: number | null;
}

export interface SetupValidation {
  setup: CleanSetup | null;
  rejections: string[];
}

/** Stop distance must sit inside a plausible XAUUSD band, as % of price. */
const MIN_STOP_PCT = 0.03;
const MAX_STOP_PCT = 2.5;
/** How far entry may sit from the reference spot price, as % of price. */
const MAX_ENTRY_DRIFT_PCT = 1.2;
/** Nearest target must at least pay for the risk taken. */
const MIN_RR = 1.0;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function validateSetup(raw: RawSetup | null | undefined, referencePrice?: number | null): SetupValidation {
  const rejections: string[] = [];
  if (!raw || typeof raw !== "object") return { setup: null, rejections };

  const direction = String(raw.direction ?? "").toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") {
    return { setup: null, rejections: ["Setup discarded: direction was not BUY or SELL"] };
  }

  const entry = num(raw.entry);
  const stop = num(raw.stop_loss);
  if (entry == null || entry <= 0 || stop == null || stop <= 0) {
    return { setup: null, rejections: ["Setup discarded: entry or stop-loss was not a usable price"] };
  }

  const wrongSide = direction === "BUY" ? stop >= entry : stop <= entry;
  if (wrongSide) {
    return { setup: null, rejections: [`Setup discarded: ${direction} stop ${stop} sits on the wrong side of entry ${entry}`] };
  }

  const stopPct = (Math.abs(entry - stop) / entry) * 100;
  if (stopPct < MIN_STOP_PCT) {
    return { setup: null, rejections: [`Setup discarded: stop is only ${stopPct.toFixed(3)}% away — inside spread/noise`] };
  }
  if (stopPct > MAX_STOP_PCT) {
    return { setup: null, rejections: [`Setup discarded: stop is ${stopPct.toFixed(2)}% away — implausibly wide for XAUUSD`] };
  }

  const ref = referencePrice != null && Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : null;
  if (ref) {
    const drift = (Math.abs(entry - ref) / ref) * 100;
    if (drift > MAX_ENTRY_DRIFT_PCT) {
      return {
        setup: null,
        rejections: [`Setup discarded: entry ${entry} is ${drift.toFixed(2)}% from spot ${ref} — not actionable now`],
      };
    }
  }

  const risk = Math.abs(entry - stop);
  const targets = [raw.take_profit_1, raw.take_profit_2, raw.take_profit_3]
    .map(num)
    .filter((t): t is number => t != null && t > 0)
    .filter((t) => (direction === "BUY" ? t > entry : t < entry))
    .filter((t, idx, arr) => arr.indexOf(t) === idx)
    .sort((a, b) => (direction === "BUY" ? a - b : b - a))
    .slice(0, 3);

  if (targets.length === 0) {
    return { setup: null, rejections: ["Setup discarded: no take-profit on the correct side of entry"] };
  }

  const rr = +(Math.abs(targets[0]! - entry) / risk).toFixed(2);
  if (rr < MIN_RR) {
    return { setup: null, rejections: [`Setup discarded: nearest target pays only ${rr}R for the risk taken`] };
  }

  const holdRaw = num(raw['expected_hold_hours']);
  const riskPctRaw = num(raw['suggested_risk_pct']);

  return {
    setup: {
      direction,
      entry: +entry.toFixed(2),
      stop_loss: +stop.toFixed(2),
      take_profit_1: +targets[0]!.toFixed(2),
      take_profit_2: targets[1] != null ? +targets[1].toFixed(2) : null,
      take_profit_3: targets[2] != null ? +targets[2].toFixed(2) : null,
      // Recomputed, never trusted from the model.
      risk_reward: rr,
      expected_hold_hours: holdRaw != null && holdRaw > 0 ? holdRaw : null,
      probability_rating:
        typeof raw['probability_rating'] === "string" ? (raw['probability_rating'] as string) : null,
      suggested_risk_pct: riskPctRaw != null && riskPctRaw > 0 ? Math.min(riskPctRaw, 0.5) : null,
    },
    rejections,
  };
}

/** Clamp a model-reported confidence into 0-100, or 0 when unusable. */
export function clampConfidence(v: unknown): number {
  const n = num(v);
  if (n == null) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
