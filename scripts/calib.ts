import { fetchCandles } from "@/lib/candles.server";
import { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG, summariseByModel } from "@/lib/backtest/pipeline-engine";
import { buildFidelityCaveats } from "@/lib/backtest/pipeline-adapter";
import { ReplayCorrelation, loadCorrelationSeries } from "@/lib/backtest/replay-correlation";

const tf = process.env.TF ?? "60";
const range = process.env.RANGE ?? "2y";
const interval = tf === "60" ? "60m" : tf === "240" ? "1h" : `${tf}m`;
const floor = Number(process.env.FLOOR ?? "88");

const candles = await fetchCandles("GC=F", interval, range, 1);
console.log("bars", candles.length, new Date(candles[0].t).toISOString(), "→", new Date(candles.at(-1)!.t).toISOString());

const series = await loadCorrelationSeries(interval, range);
const correlation = series.length ? new ReplayCorrelation(series) : null;
console.log("correlation legs", series.length);

const res = runPipelineBacktest(candles, {
  ...DEFAULT_PIPELINE_CONFIG,
  timeframe: tf as any,
  correlation,
  researchConfidenceFloor: floor,
  settings: { confidence_threshold: floor },
  caveats: buildFidelityCaveats({ realCorrelation: !!correlation }),
});
console.log(JSON.stringify({
  floor,
  metrics: res.metrics,
  confidence: res.confidence,
  candidateBars: res.candidateBars,
  approvedBars: res.approvedBars,
  models: res.models,
  modelStats: res.modelStats,
  rejections: res.rejections,
  missingTimeframes: res.missingTimeframes,
}, null, 2));
