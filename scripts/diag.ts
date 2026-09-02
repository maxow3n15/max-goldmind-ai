import { fetchCandles } from "../src/lib/candles.server";
import { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } from "../src/lib/backtest/pipeline-engine";

const base = await fetchCandles("GC=F", "15m", "60d", 1);
const m5 = await fetchCandles("GC=F", "5m", "60d", 1);
const m1 = await fetchCandles("GC=F", "1m", "7d", 1);
console.log("15m", base.length, "5m", m5.length, "1m", m1.length);
const r = runPipelineBacktest(base, { ...DEFAULT_PIPELINE_CONFIG, timeframe: "15" as any, finerSeries: { "5": m5, "1": m1 } as any, researchConfidenceFloor: 88, settings: { confidence_threshold: 88 } });
console.log(JSON.stringify({ missing: r.missingTimeframes, fidelity: r.dataFidelity, confidence: r.confidence, approved: r.approvedBars, rejections: r.rejections }, null, 2));
