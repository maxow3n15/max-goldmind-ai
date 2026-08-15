// Generic FX conversion layer (pure — no network, no clock reads).
//
// Instruments are quoted in their own quote currency (XAU_USD → USD) while a
// broker account is denominated in its own currency (e.g. GBP). Every monetary
// value the risk engine reasons about must be expressed in ACCOUNT currency,
// so each symbol specification carries a validated conversion:
//
//   quote currency  --(validated live FX rate)-->  account currency
//
// Rates are never hardcoded, never guessed and never estimated. When a rate
// cannot be sourced and validated, the caller must refuse to trade.

/** A raw two-sided quote for a currency pair, as reported by a price source. */
export interface FxQuote {
  /** Pair in BASE_QUOTE form, e.g. "GBP_USD". */
  pair: string;
  bid: number;
  ask: number;
  /** Epoch ms at which the source produced the quote. */
  timestamp: number;
  source: string;
  /** False when the source reports the pair as currently untradeable. */
  tradeable?: boolean;
}

export type FxQuoteFetcher = (pair: string) => Promise<FxQuote | null>;

export type FxDirection = "identity" | "direct" | "inverse" | "cross";

/** A fully attributed conversion from one currency into another. */
export interface FxConversion {
  from: string;
  to: string;
  /** Multiply a `from`-denominated amount by this to get `to`. */
  rate: number;
  source: string;
  /** Epoch ms of the OLDEST leg used, so freshness is conservative. */
  timestamp: number;
  direction: FxDirection;
  /** Pairs actually used, in order. Empty for identity. */
  legs: string[];
  /** False when every source reported the market as closed/untradeable. */
  marketOpen?: boolean;
}

/**
 * Maximum age of an FX rate used to size or execute a trade. Deliberately
 * tight: a stale rate silently mis-states risk in the account currency.
 */
export const FX_MAX_AGE_MS = 60_000;

/** Currencies tried as a bridge when no direct or inverse pair exists. */
export const FX_INTERMEDIARIES = ["USD", "EUR"];

const finitePositive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

export function isValidQuote(q: FxQuote | null | undefined): q is FxQuote {
  return (
    !!q &&
    typeof q.pair === "string" &&
    q.pair.length > 0 &&
    finitePositive(q.bid) &&
    finitePositive(q.ask) &&
    q.ask >= q.bid &&
    typeof q.timestamp === "number" &&
    Number.isFinite(q.timestamp) &&
    q.timestamp > 0
  );
}

export function midOf(q: FxQuote): number {
  return (q.bid + q.ask) / 2;
}

export function identityConversion(currency: string): FxConversion {
  const ccy = currency.toUpperCase();
  return {
    from: ccy,
    to: ccy,
    rate: 1,
    source: "identity",
    timestamp: 0,
    direction: "identity",
    legs: [],
  };
}

export interface FxValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validates a conversion for USE AT `now`. Identity conversions are always
 * valid (no rate involved); everything else must be finite, positive and
 * fresher than `maxAgeMs`.
 */
export function validateConversion(
  c: FxConversion | null | undefined,
  now: number,
  maxAgeMs: number = FX_MAX_AGE_MS,
): FxValidation {
  if (!c) return { ok: false, reason: "no FX conversion supplied" };
  if (!c.from || !c.to) return { ok: false, reason: "FX conversion is missing a currency" };
  if (c.direction === "identity") {
    if (c.from !== c.to)
      return { ok: false, reason: "identity conversion between different currencies" };
    if (c.rate !== 1)
      return { ok: false, reason: "identity conversion must have a rate of exactly 1" };
    return { ok: true };
  }
  if (typeof c.rate !== "number" || Number.isNaN(c.rate))
    return { ok: false, reason: `FX rate for ${c.from}/${c.to} is not a number` };
  if (!Number.isFinite(c.rate))
    return { ok: false, reason: `FX rate for ${c.from}/${c.to} is not finite` };
  if (c.rate <= 0)
    return { ok: false, reason: `FX rate for ${c.from}/${c.to} is zero or negative` };
  if (!c.source) return { ok: false, reason: "FX conversion has no source" };
  if (!Number.isFinite(c.timestamp) || c.timestamp <= 0)
    return { ok: false, reason: "FX conversion has no usable timestamp" };
  const age = now - c.timestamp;
  if (age > maxAgeMs)
    return {
      ok: false,
      reason:
        `FX rate ${c.from}/${c.to} is stale (${Math.round(age / 1000)}s old, limit ${Math.round(maxAgeMs / 1000)}s)` +
        (c.marketOpen === false ? " — the currency market is closed" : ""),
    };
  return { ok: true };
}

export interface ResolveConversionInput {
  from: string;
  to: string;
  fetchQuote: FxQuoteFetcher;
  now: number;
  maxAgeMs?: number;
  intermediaries?: string[];
}

export type ResolveConversionResult =
  | { ok: true; conversion: FxConversion }
  | { ok: false; reason: string };

/**
 * Resolves `from` → `to` using, in order: identity, the direct pair, the
 * inverse pair, then a cross through a major intermediary. Every candidate is
 * validated before it is accepted; an unusable quote is skipped, not patched.
 */
export async function resolveConversion(
  input: ResolveConversionInput,
): Promise<ResolveConversionResult> {
  const from = (input.from ?? "").toUpperCase();
  const to = (input.to ?? "").toUpperCase();
  const maxAgeMs = input.maxAgeMs ?? FX_MAX_AGE_MS;
  if (!from || !to)
    return { ok: false, reason: "currency pair is incomplete — conversion refused" };
  if (from === to) return { ok: true, conversion: identityConversion(from) };

  const tried: string[] = [];
  const get = async (pair: string): Promise<FxQuote | null> => {
    tried.push(pair);
    try {
      const q = await input.fetchQuote(pair);
      return isValidQuote(q) ? q : null;
    } catch {
      return null;
    }
  };

  /** Rate that converts A → B using either A_B or B_A. */
  const leg = async (
    a: string,
    b: string,
  ): Promise<{ rate: number; quote: FxQuote; inverse: boolean } | null> => {
    const direct = await get(`${a}_${b}`);
    if (direct) return { rate: midOf(direct), quote: direct, inverse: false };
    const inverse = await get(`${b}_${a}`);
    if (inverse) {
      const mid = midOf(inverse);
      if (!finitePositive(mid)) return null;
      return { rate: 1 / mid, quote: inverse, inverse: true };
    }
    return null;
  };

  const first = await leg(from, to);
  if (first) {
    const conversion: FxConversion = {
      from,
      to,
      rate: first.rate,
      source: first.quote.source,
      timestamp: first.quote.timestamp,
      direction: first.inverse ? "inverse" : "direct",
      legs: [first.quote.pair],
      marketOpen: first.quote.tradeable !== false,
    };
    const v = validateConversion(conversion, input.now, maxAgeMs);
    return v.ok ? { ok: true, conversion } : { ok: false, reason: v.reason! };
  }

  for (const mid of input.intermediaries ?? FX_INTERMEDIARIES) {
    const via = mid.toUpperCase();
    if (via === from || via === to) continue;
    const a = await leg(from, via);
    if (!a) continue;
    const b = await leg(via, to);
    if (!b) continue;
    const conversion: FxConversion = {
      from,
      to,
      rate: a.rate * b.rate,
      source: `${a.quote.source}+${b.quote.source}`,
      timestamp: Math.min(a.quote.timestamp, b.quote.timestamp),
      direction: "cross",
      legs: [a.quote.pair, b.quote.pair],
      marketOpen: a.quote.tradeable !== false && b.quote.tradeable !== false,
    };
    const v = validateConversion(conversion, input.now, maxAgeMs);
    if (v.ok) return { ok: true, conversion };
    return { ok: false, reason: v.reason! };
  }

  return {
    ok: false,
    reason: `Unable to safely convert ${from} instrument value into ${to} account currency — no usable rate from ${tried.join(", ") || "any pair"}.`,
  };
}

/** Human-readable summary for logs and trade records. */
export function describeConversion(c: FxConversion): string {
  if (c.direction === "identity") return `${c.from} (no conversion required)`;
  return `${c.from}→${c.to} @ ${c.rate.toPrecision(8)} (${c.direction}, ${c.legs.join(" × ")}, ${c.source})`;
}
