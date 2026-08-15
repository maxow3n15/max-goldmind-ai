// Deterministic economic calendar for XAUUSD.
//
// Why this exists: the macro layer used to ask a language model for
// "upcoming events" and how many hours away they were. A model cannot know
// the clock, so those numbers were invented — and an invented event time was
// driving a real execution blackout. This module replaces that with an
// arithmetic calendar: pure functions of a timestamp, no I/O, no model.
//
// Two classes of entry:
//   * `estimated: false` — the release time follows a published rule or a
//     dated schedule we hold verbatim (NFP, FOMC decisions, ISM).
//   * `estimated: true`  — the release reliably lands inside a window but the
//     exact day is set by the agency (CPI, PPI, PCE). These NEVER trigger a
//     hard blackout; they only raise a caution flag.
//
// Anything past COVERAGE_UNTIL is reported as stale rather than guessed at.

export type EventImpact = "high" | "medium";

export interface CalendarEvent {
  id: string;
  name: string;
  /** Scheduled release, UTC epoch ms. */
  at: number;
  impact: EventImpact;
  /** True when the day is inferred from a typical window, not a published date. */
  estimated: boolean;
  /** Where the timing came from, shown in the UI so nothing looks magic. */
  basis: string;
}

export interface CalendarBlackout {
  active: boolean;
  reason: string | null;
  event: string | null;
  minutesAway: number | null;
  /** True when we are inside the settle window *after* a release. */
  postEvent: boolean;
}

export interface EconomicCalendarRead {
  generated_at: number;
  /** Events within the look-ahead horizon, soonest first. */
  upcoming: (CalendarEvent & { minutesAway: number })[];
  /** High-impact releases in the last 2 hours, newest first. */
  recent: (CalendarEvent & { minutesAgo: number })[];
  blackout: CalendarBlackout;
  /** Soft warning: an estimated high-impact release may land nearby. */
  caution: string | null;
  /** True when the dated tables no longer cover `now`. */
  stale: boolean;
}

/** Dated tables below are valid until this instant; after that we say so. */
export const COVERAGE_UNTIL = Date.UTC(2026, 11, 31, 23, 59, 0);

/** Minutes before / after a confirmed high-impact release that block entries. */
export const BLACKOUT_BEFORE_MIN = 30;
export const BLACKOUT_AFTER_MIN = 15;
/** Medium-impact releases get a tighter window. */
export const MEDIUM_BEFORE_MIN = 10;
export const MEDIUM_AFTER_MIN = 10;

const HOUR = 3_600_000;
const MIN = 60_000;

/* ------------------------------------------------------------------ */
/* US Eastern time helpers                                             */
/* ------------------------------------------------------------------ */

function nthWeekdayUtc(year: number, month: number, weekday: number, n: number): number {
  // month is 0-indexed. Returns UTC midnight of the nth `weekday` of the month.
  const first = new Date(Date.UTC(year, month, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return Date.UTC(year, month, 1 + shift + (n - 1) * 7);
}

/**
 * US daylight saving: second Sunday in March 07:00 UTC to first Sunday in
 * November 06:00 UTC. Gold's most violent releases are US ones, so the
 * Eastern offset has to be exact — an hour of drift makes the blackout useless.
 */
export function isUsDst(ms: number): boolean {
  const y = new Date(ms).getUTCFullYear();
  const start = nthWeekdayUtc(y, 2, 0, 2) + 7 * HOUR;
  const end = nthWeekdayUtc(y, 10, 0, 1) + 6 * HOUR;
  return ms >= start && ms < end;
}

/** Convert a wall-clock US Eastern time on a given UTC date to epoch ms. */
function easternToUtc(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month, day, hour + 5, minute);
  return isUsDst(guess) ? guess - HOUR : guess;
}

/** Day-of-month of the nth business day (Mon–Fri), ignoring holidays. */
function nthBusinessDay(year: number, month: number, n: number): number {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCMonth() !== month) break;
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    count += 1;
    if (count === n) return day;
  }
  return 1;
}

/* ------------------------------------------------------------------ */
/* Schedules                                                           */
/* ------------------------------------------------------------------ */

/**
 * Published FOMC decision days (the second day of each two-day meeting).
 * Statement lands 14:00 ET. Held verbatim rather than derived, because the
 * Committee's calendar is not a rule.
 */
const FOMC_DECISION_DAYS: [number, number, number][] = [
  [2026, 0, 28], [2026, 2, 18], [2026, 3, 29], [2026, 5, 17],
  [2026, 6, 29], [2026, 8, 16], [2026, 9, 28], [2026, 11, 9],
];

function monthlyEvents(year: number, month: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;

  // Non-farm payrolls: first Friday, 08:30 ET. Pure rule.
  const nfpDay = new Date(nthWeekdayUtc(year, month, 5, 1)).getUTCDate();
  out.push({
    id: `nfp-${key}`,
    name: "US Non-Farm Payrolls",
    at: easternToUtc(year, month, nfpDay, 8, 30),
    impact: "high",
    estimated: false,
    basis: "Rule: first Friday of the month, 08:30 ET",
  });

  // ISM Manufacturing PMI: first business day, 10:00 ET.
  out.push({
    id: `ism-mfg-${key}`,
    name: "ISM Manufacturing PMI",
    at: easternToUtc(year, month, nthBusinessDay(year, month, 1), 10, 0),
    impact: "medium",
    estimated: false,
    basis: "Rule: first business day, 10:00 ET",
  });

  // ISM Services PMI: third business day, 10:00 ET.
  out.push({
    id: `ism-svc-${key}`,
    name: "ISM Services PMI",
    at: easternToUtc(year, month, nthBusinessDay(year, month, 3), 10, 0),
    impact: "medium",
    estimated: false,
    basis: "Rule: third business day, 10:00 ET",
  });

  // CPI / PPI / Core PCE: reliably 08:30 ET, but the BLS/BEA pick the day.
  // Flagged estimated so they inform but never hard-block.
  out.push({
    id: `cpi-${key}`,
    name: "US CPI (estimated window)",
    at: easternToUtc(year, month, 12, 8, 30),
    impact: "high",
    estimated: true,
    basis: "Typical window: 10th–15th of the month, 08:30 ET",
  });
  out.push({
    id: `pce-${key}`,
    name: "US Core PCE (estimated window)",
    at: easternToUtc(year, month, 28, 8, 30),
    impact: "high",
    estimated: true,
    basis: "Typical window: last week of the month, 08:30 ET",
  });

  // FOMC decisions falling in this month.
  for (const [y, m, d] of FOMC_DECISION_DAYS) {
    if (y !== year || m !== month) continue;
    out.push({
      id: `fomc-${y}-${m + 1}-${d}`,
      name: "FOMC rate decision",
      at: easternToUtc(y, m, d, 14, 0),
      impact: "high",
      estimated: false,
      basis: "Published FOMC meeting calendar, 14:00 ET statement",
    });
    out.push({
      id: `fomc-presser-${y}-${m + 1}-${d}`,
      name: "FOMC press conference",
      at: easternToUtc(y, m, d, 14, 30),
      impact: "high",
      estimated: false,
      basis: "Published FOMC meeting calendar, 14:30 ET press conference",
    });
  }

  return out;
}

/** Every scheduled event in the month containing `ms`, plus its neighbours. */
export function eventsAround(ms: number): CalendarEvent[] {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const months: [number, number][] = [
    m === 0 ? [y - 1, 11] : [y, m - 1],
    [y, m],
    m === 11 ? [y + 1, 0] : [y, m + 1],
  ];
  return months
    .flatMap(([yy, mm]) => monthlyEvents(yy, mm))
    .sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/**
 * Full calendar verdict at `now`. Deterministic: the same `now` always
 * yields the same blackout decision, which is exactly what an execution
 * gate needs.
 */
export function readEconomicCalendar(now: number, lookaheadHours = 12): EconomicCalendarRead {
  const stale = now > COVERAGE_UNTIL;
  const all = eventsAround(now);

  const upcoming = all
    .filter((e) => e.at >= now && e.at - now <= lookaheadHours * HOUR)
    .map((e) => ({ ...e, minutesAway: Math.round((e.at - now) / MIN) }));

  const recent = all
    .filter((e) => e.at < now && now - e.at <= 2 * HOUR)
    .map((e) => ({ ...e, minutesAgo: Math.round((now - e.at) / MIN) }))
    .sort((a, b) => b.at - a.at);

  let blackout: CalendarBlackout = {
    active: false, reason: null, event: null, minutesAway: null, postEvent: false,
  };
  let caution: string | null = null;

  if (!stale) {
    for (const e of all) {
      if (e.estimated) continue;              // estimated days never hard-block
      const before = e.impact === "high" ? BLACKOUT_BEFORE_MIN : MEDIUM_BEFORE_MIN;
      const after = e.impact === "high" ? BLACKOUT_AFTER_MIN : MEDIUM_AFTER_MIN;
      const delta = Math.round((e.at - now) / MIN);
      if (delta <= before && delta >= -after) {
        blackout = {
          active: true,
          event: e.name,
          minutesAway: delta,
          postEvent: delta < 0,
          reason: delta >= 0
            ? `${e.name} in ${delta} min — entries paused until ${after} min after the release`
            : `${e.name} released ${Math.abs(delta)} min ago — waiting for the spread and spike to settle`,
        };
        break;
      }
    }

    if (!blackout.active) {
      const soft = upcoming.find(
        (e) => e.estimated && e.impact === "high" && e.minutesAway <= 90,
      );
      if (soft) {
        caution = `${soft.name} may land within ${soft.minutesAway} min (${soft.basis}). Timing is not confirmed, so entries are allowed but sizing should stay conservative.`;
      }
    }
  }

  return {
    generated_at: now,
    upcoming: upcoming.slice(0, 8),
    recent: recent.slice(0, 4),
    blackout,
    caution,
    stale,
  };
}
