import { describe, expect, it } from "vitest";
import {
  eventsAround,
  isUsDst,
  readEconomicCalendar,
} from "../economic-calendar";

describe("US daylight saving boundaries", () => {
  it("is standard time in January and daylight time in July", () => {
    expect(isUsDst(Date.UTC(2026, 0, 15, 12, 0))).toBe(false);
    expect(isUsDst(Date.UTC(2026, 6, 15, 12, 0))).toBe(true);
  });
});

describe("scheduled events", () => {
  it("places non-farm payrolls on the first Friday at 08:30 ET", () => {
    // 2026-05-01 is a Friday, so May's NFP is the 1st: 08:30 EDT = 12:30 UTC.
    const nfp = eventsAround(Date.UTC(2026, 4, 10))
      .filter((e) => e.name.includes("Non-Farm") && new Date(e.at).getUTCMonth() === 4)[0];
    expect(nfp).toBeDefined();
    expect(new Date(nfp!.at).toISOString()).toBe("2026-05-01T12:30:00.000Z");
  });

  it("uses the winter offset for a January payroll release", () => {
    // 2026-01-02 is a Friday: 08:30 EST = 13:30 UTC.
    const nfp = eventsAround(Date.UTC(2026, 0, 10))
      .filter((e) => e.name.includes("Non-Farm") && new Date(e.at).getUTCMonth() === 0)[0];
    expect(new Date(nfp!.at).toISOString()).toBe("2026-01-02T13:30:00.000Z");
  });
});

describe("blackout window", () => {
  const nfpMay = Date.UTC(2026, 4, 1, 12, 30);

  it("blocks entries shortly before a confirmed high-impact release", () => {
    const r = readEconomicCalendar(nfpMay - 10 * 60_000);
    expect(r.blackout.active).toBe(true);
    expect(r.blackout.event).toContain("Non-Farm");
    expect(r.blackout.postEvent).toBe(false);
  });

  it("keeps blocking during the post-release settle window", () => {
    const r = readEconomicCalendar(nfpMay + 5 * 60_000);
    expect(r.blackout.active).toBe(true);
    expect(r.blackout.postEvent).toBe(true);
  });

  it("clears once the settle window has passed", () => {
    const r = readEconomicCalendar(nfpMay + 40 * 60_000);
    expect(r.blackout.active).toBe(false);
  });

  it("never hard-blocks on an estimated release date", () => {
    // The CPI window entry is estimated, so it may only raise a caution.
    const cpiEstimate = Date.UTC(2026, 4, 12, 12, 30);
    const r = readEconomicCalendar(cpiEstimate - 5 * 60_000);
    expect(r.blackout.active).toBe(false);
    expect(r.caution).toContain("CPI");
  });

  it("reports staleness instead of guessing past the schedule coverage", () => {
    const r = readEconomicCalendar(Date.UTC(2031, 0, 1));
    expect(r.stale).toBe(true);
    expect(r.blackout.active).toBe(false);
  });
});
