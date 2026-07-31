import { buildQuantIntel } from "../src/lib/quant.server";
const r = await buildQuantIntel("15", "BUY");
console.log(JSON.stringify({
  price: r.price, degraded: r.degraded,
  volume: { s: r.volume.score, rel: r.volume.relative_volume, part: r.volume.participation },
  vol: { s: r.volatility.score, atr: r.volatility.atr, regime: r.volatility.regime, adr: r.volatility.adr, pct: r.volatility.percentile, ext: r.volatility.extended_move },
  mom: { s: r.momentum.score, rsi: r.momentum.rsi, adx: r.momentum.adx, cci: r.momentum.cci, roc: r.momentum.roc, ts: r.momentum.trend_strength },
  candles: { s: r.candles.score, q: r.candles.quality, p: r.candles.patterns },
  corr: { s: r.correlation.score, sup: r.correlation.supporting, con: r.correlation.conflicting, legs: r.correlation.legs.map(l=>[l.symbol,l.change_pct]) },
}, null, 1));
