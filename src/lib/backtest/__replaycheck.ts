import { runPipelineBacktest, DEFAULT_PIPELINE_CONFIG } from "/dev-server/src/lib/backtest/pipeline-engine";
const res = await (async () => {
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=60d", { headers: { "User-Agent": "Mozilla/5.0" } });
  const j: any = await r.json();
  const q = j.chart.result[0]; const ts = q.timestamp; const o = q.indicators.quote[0];
  const candles: any[] = [];
  for (let i=0;i<ts.length;i++){ if([o.open[i],o.high[i],o.low[i],o.close[i]].some((x:any)=>x==null)) continue;
    candles.push({t:ts[i]*1000,o:o.open[i],h:o.high[i],l:o.low[i],c:o.close[i],v:o.volume[i]??0}); }
  console.log("candles", candles.length);
  return runPipelineBacktest(candles, { ...DEFAULT_PIPELINE_CONFIG, timeframe: "15" });
})();
console.log({trades: res.trades.length, candidateBars: res.candidateBars, approved: res.approvedBars, net: res.metrics.netPnl, wr: res.metrics.winRate, pf: res.metrics.profitFactor});
console.log(res.rejections);
console.log(res.models);
