import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callChat } from "./ai-gateway.server";
import { fetchHeadlines } from "./news.server";
import type { MacroReport } from "./services/macro.types";

const SYSTEM = `You are GoldMind AI's macro desk: a senior gold (XAUUSD) fundamental analyst.
You receive live financial headlines. Judge how the CURRENT macro environment affects gold.

Framework:
- Bullish gold: weaker USD, rising rate-cut odds / dovish central banks, sticky inflation, falling real yields, rising geopolitical risk, safe-haven demand, equity fear (high VIX), central-bank gold buying.
- Bearish gold: stronger USD, higher-for-longer rates / hawkish tone, rising treasury yields, faster disinflation, strong risk appetite, falling safe-haven demand.

news_score: 0-100 where 50 = neutral, 100 = maximum bullish for gold, 0 = maximum bearish.
sentiment_score: 0-100 institutional / safe-haven demand for gold right now.
Only use the supplied headlines plus well-known scheduled release calendars. Never invent specific data prints that are not in the headlines.

Respond ONLY with valid JSON:
{
  "news_score": number,
  "gold_bias": "bullish"|"bearish"|"neutral",
  "dollar_strength": "strong"|"neutral"|"weak",
  "rate_outlook": "hawkish"|"neutral"|"dovish",
  "risk_environment": "risk-on"|"risk-off"|"mixed",
  "yields": "rising"|"falling"|"flat",
  "geopolitical_risk": "high"|"medium"|"low",
  "sentiment_score": number,
  "summary": string (3-5 sentences, causal chain e.g. "Fed dovish -> USD weaker -> gold supported"),
  "bullish_drivers": string[],
  "bearish_drivers": string[],
  "headlines": [{"title":string,"source":string,"impact":"high"|"medium"|"low","gold_effect":"bullish"|"bearish"|"neutral","reason":string}] (max 10, most important first),
  "upcoming_events": [{"name":string,"when":string,"hours_away":number|null,"impact":"high"|"medium"|"low","expectation":string|null,"priced_in":boolean}] (max 6),
  "post_event_high_impact_within_60min": boolean
}`;

interface Cached { at: number; report: MacroReport }
let cache: Cached | null = null;
const TTL_MS = 5 * 60_000;

function neutral(reason: string): MacroReport {
  return {
    generated_at: Date.now(),
    news_score: 50,
    gold_bias: "neutral",
    dollar_strength: "neutral",
    rate_outlook: "neutral",
    risk_environment: "mixed",
    yields: "flat",
    geopolitical_risk: "low",
    sentiment_score: 50,
    summary: `Macro intelligence unavailable (${reason}). Fundamental confidence is held at neutral, which blocks autonomous execution until the feed recovers.`,
    bullish_drivers: [],
    bearish_drivers: [],
    headlines: [],
    upcoming_events: [],
    blackout: { active: false, reason: null, event: null, minutes_away: null },
    post_event_wait: false,
    degraded: true,
  };
}

async function build(): Promise<MacroReport> {
  const news = await fetchHeadlines(8);
  if (news.length === 0) return neutral("no headlines returned");

  const list = news.slice(0, 45)
    .map((n) => `- [${n.category}] ${n.title} (${n.source}, ${n.published_at})`)
    .join("\n");

  const raw = await callChat({
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Current UTC time: ${new Date().toISOString()}\n\nLive headlines:\n${list}\n\nScore the macro environment for XAUUSD. JSON only.`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  let p: any;
  try { p = JSON.parse(raw); } catch { return neutral("model returned unparseable output"); }

  const events = Array.isArray(p.upcoming_events) ? p.upcoming_events : [];
  const imminent = events.find(
    (e: any) => e?.impact === "high" && typeof e.hours_away === "number" && e.hours_away >= 0 && e.hours_away <= 1,
  );

  const byUrl = new Map(news.map((n) => [n.title.toLowerCase().slice(0, 50), n.url]));
  const headlines = (Array.isArray(p.headlines) ? p.headlines : []).slice(0, 10).map((h: any) => ({
    title: String(h?.title ?? ""),
    source: String(h?.source ?? "—"),
    url: byUrl.get(String(h?.title ?? "").toLowerCase().slice(0, 50)),
    impact: (["high", "medium", "low"].includes(h?.impact) ? h.impact : "low") as any,
    gold_effect: (["bullish", "bearish", "neutral"].includes(h?.gold_effect) ? h.gold_effect : "neutral") as any,
    reason: String(h?.reason ?? ""),
  }));

  return {
    generated_at: Date.now(),
    news_score: Math.max(0, Math.min(100, Number(p.news_score ?? 50))),
    gold_bias: p.gold_bias ?? "neutral",
    dollar_strength: p.dollar_strength ?? "neutral",
    rate_outlook: p.rate_outlook ?? "neutral",
    risk_environment: p.risk_environment ?? "mixed",
    yields: p.yields ?? "flat",
    geopolitical_risk: p.geopolitical_risk ?? "low",
    sentiment_score: Math.max(0, Math.min(100, Number(p.sentiment_score ?? 50))),
    summary: String(p.summary ?? ""),
    bullish_drivers: Array.isArray(p.bullish_drivers) ? p.bullish_drivers.map(String) : [],
    bearish_drivers: Array.isArray(p.bearish_drivers) ? p.bearish_drivers.map(String) : [],
    headlines,
    upcoming_events: events.slice(0, 6).map((e: any) => ({
      name: String(e?.name ?? "Event"),
      when: String(e?.when ?? ""),
      hours_away: e?.hours_away == null ? null : Number(e.hours_away),
      impact: (["high", "medium", "low"].includes(e?.impact) ? e.impact : "low") as any,
      expectation: e?.expectation ? String(e.expectation) : null,
      priced_in: !!e?.priced_in,
    })),
    blackout: imminent
      ? {
          active: true,
          reason: `High-impact release within ${Math.round(Number(imminent.hours_away) * 60)} minutes`,
          event: String(imminent.name),
          minutes_away: Math.round(Number(imminent.hours_away) * 60),
        }
      : { active: false, reason: null, event: null, minutes_away: null },
    post_event_wait: !!p.post_event_high_impact_within_60min,
  };
}

/** Live macro / news intelligence report (cached 5 minutes, shared server-side). */
export const getMacroIntel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<MacroReport> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.report;
    try {
      const report = await build();
      if (!report.degraded) cache = { at: Date.now(), report };
      return report;
    } catch (e: any) {
      return neutral(e?.message ?? "unknown error");
    }
  });
