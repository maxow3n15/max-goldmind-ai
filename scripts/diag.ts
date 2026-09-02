import { fetchCandles } from "../src/lib/candles.server";
import { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } from "../src/lib/backtest/pipeline-engine";

const c = await fetchCandles("GC=F", "60m", "2y", 1);
console.log("bars", c.length, new Date(c[0].t).toISOString(), "→", new Date(c[c.length-1].t).toISOString());
const r = runPipelineBacktest(c, { ...DEFAULT_PIPELINE_CONFIG, timeframe: "60" as any, researchConfidenceFloor: 88, settings: { confidence_threshold: 88 } });
console.log(JSON.stringify({ missing: r.missingTimeframes, fidelity: r.dataFidelity, confidence: r.confidence, candidates: r.candidateBars, approved: r.approvedBars, rejections: r.rejections }, null, 2));
