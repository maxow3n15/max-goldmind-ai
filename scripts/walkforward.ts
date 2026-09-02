import { fetchCandles } from "@/lib/candles.server";
import { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } from "@/lib/backtest/pipeline-engine";
import { ReplayCorrelation, loadCorrelationSeries } from "@/lib/backtest/replay-correlation";

const FLOOR = Number(process.env.FLOOR ?? "70");
const candles = await fetchCandles("GC=F", "60m", "2y", 1);
const series = await loadCorrelationSeries("60m", "2y");
const correlation = series.length ? new ReplayCorrelation(series) : null;

const CHUNKS = 4;
const size = Math.floor(candles.length / CHUNKS);
const chunks = Array.from({ length: CHUNKS }, (_, i) =>
  candles.slice(i * size, i === CHUNKS - 1 ? candles.length : (i + 1) * size));

type Variant = { name: string; confidenceWeights?: any; exits?: any };
const variants: Variant[] = [
  { name: "baseline" },
  { name: "structure-heavy", confidenceWeights: { htf_alignment: 20, structure: 20, liquidity: 10, entry_zone: 10, fvg_ob: 10, momentum: 8, smt: 2, news_macro: 5, risk_reward: 10, market_conditions: 5 } },
  { name: "ict-heavy", confidenceWeights: { htf_alignment: 12, structure: 14, liquidity: 16, entry_zone: 14, fvg_ob: 16, momentum: 8, smt: 2, news_macro: 6, risk_reward: 8, market_conditions: 4 } },
  { name: "be0.8-trail2.0", exits: { breakEvenAtR: 0.8, trailAtrMultiple: 2.0 } },
  { name: "be0.3-trail1.2", exits: { breakEvenAtR: 0.3, trailAtrMultiple: 1.2 } },
];

const t0 = Date.now();
const out: any[] = [];
for (const v of variants) {
  const perChunk = chunks.map((c, idx) => {
    const r = runPipelineBacktest(c, {
      ...DEFAULT_PIPELINE_CONFIG,
      timeframe: "60" as any,
      correlation,
      researchConfidenceFloor: FLOOR,
      settings: { confidence_threshold: FLOOR },
      confidenceWeights: v.confidenceWeights ?? null,
      exits: v.exits ?? null,
    });
    return {
      chunk: idx + 1,
      from: new Date(c[0].t).toISOString().slice(0, 10),
      to: new Date(c.at(-1)!.t).toISOString().slice(0, 10),
      candidates: r.candidateBars,
      approved: r.approvedBars,
      trades: r.metrics.trades,
      winRate: r.metrics.winRate,
      expectancyR: r.metrics.expectancyR,
      profitFactor: r.metrics.profitFactor,
      maxDdPct: r.metrics.maxDrawdownPct,
      netPnl: r.metrics.netPnl,
      confMax: r.confidence.max,
      confP90: r.confidence.p90,
      models: r.modelStats,
    };
  });
  const train = perChunk.slice(0, 3);
  const test = perChunk[3];
  out.push({
    variant: v.name,
    trainTrades: train.reduce((a, c) => a + c.trades, 0),
    trainNet: +train.reduce((a, c) => a + c.netPnl, 0).toFixed(2),
    trainExpR: +(train.reduce((a, c) => a + c.expectancyR * c.trades, 0) / Math.max(1, train.reduce((a, c) => a + c.trades, 0))).toFixed(3),
    oosTrades: test.trades, oosNet: test.netPnl, oosExpR: test.expectancyR, oosWinRate: test.winRate,
    perChunk,
  });
  console.log(v.name, "done", ((Date.now() - t0) / 1000).toFixed(0) + "s");
}
console.log(JSON.stringify(out, null, 2));
