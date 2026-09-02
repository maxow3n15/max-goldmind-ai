import { fetchCandles } from "@/lib/candles.server";
import { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } from "@/lib/backtest/pipeline-engine";
import { ReplayCorrelation, loadCorrelationSeries } from "@/lib/backtest/replay-correlation";

const candles = await fetchCandles("GC=F", "15m", "60d", 300_000);
const series = await loadCorrelationSeries("15m", "60d");
console.log("gold bars", candles.length, "corr legs", series.map(s=>`${s.symbol}:${s.candles.length}`).join(" "));
const correlation = series.length ? new ReplayCorrelation(series) : null;
const res = runPipelineBacktest(candles as any, {
  ...DEFAULT_PIPELINE_CONFIG, timeframe: "15" as any, correlation,
  settings: { risk_per_trade: 0.5, confidence_threshold: 88 },
} as any);
console.log(JSON.stringify({
  bars: res.bars, candidateBars: res.candidateBars, approvedBars: res.approvedBars,
  confidence: res.confidence, trades: res.trades.length, metrics: res.metrics,
  rejections: res.rejections.slice(0,8), models: res.models,
}, null, 2));
