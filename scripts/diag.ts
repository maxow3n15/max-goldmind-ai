import { fetchCandles } from "../src/lib/candles.server";
import { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } from "../src/lib/backtest/pipeline-engine";
import { ReplayCorrelation, loadCorrelationSeries } from "../src/lib/backtest/replay-correlation";

const base = await fetchCandles("GC=F", "15m", "60d", 1);
const m5 = await fetchCandles("GC=F", "5m", "60d", 1);
const m1 = await fetchCandles("GC=F", "1m", "7d", 1);
const series = await loadCorrelationSeries("15m", "60d");
const correlation = series.length ? new ReplayCorrelation(series) : null;
console.log("bars", base.length, "corr legs", series.length);

for (const floor of [88, 70]) {
  const chunks = 4, size = Math.floor(base.length / chunks);
  const rows: any[] = [];
  for (let i = 0; i < chunks; i++) {
    const slice = base.slice(i * size, i === chunks - 1 ? base.length : (i + 1) * size);
    const r = runPipelineBacktest(slice, { ...DEFAULT_PIPELINE_CONFIG, timeframe: "15" as any,
      finerSeries: { "5": m5, "1": m1 } as any, correlation,
      researchConfidenceFloor: floor, settings: { confidence_threshold: floor } });
    rows.push({ chunk: i+1, role: i === chunks-1 ? "holdout" : "train",
      from: new Date(slice[0].t).toISOString().slice(0,10), to: new Date(slice[slice.length-1].t).toISOString().slice(0,10),
      bars: slice.length, cand: r.candidateBars, appr: r.approvedBars, trades: r.metrics.trades,
      winRate: r.metrics.winRate, expR: r.metrics.expectancyR, pf: r.metrics.profitFactor, ddPct: Number(r.metrics.maxDrawdownPct.toFixed(2)),
      net: r.metrics.netPnl, cP90: r.confidence.p90, cMax: r.confidence.max,
      degraded: r.dataFidelity.mtfDegradedFraction,
      models: r.modelStats.map((m:any)=>`${m.model}:${m.trades}t/${m.winRate}%/${m.expectancyR}R`),
      topRej: r.rejections.slice(0,3) });
  }
  console.log("\n===== FLOOR", floor, "=====");
  console.log(JSON.stringify(rows, null, 1));
}
