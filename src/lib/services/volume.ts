// Volume & participation analysis.
//
// Answers one question: is this price move backed by genuine participation?
// Strong participation lifts confidence; weak participation trims it.

import { sma, type Candle } from "@/lib/indicators";
import type { VolumeReport } from "./quant.types";
import type { Direction } from "./types";

const neutral = (msg: string): VolumeReport => ({
  score: 50, notes: [msg], degraded: true,
  relative_volume: null, volume_ma_20: null, volume_ma_50: null,
  spike: false, pullback_volume_declining: false, continuation_volume_rising: false,
  exhaustion: false, participation: "healthy",
});

export function analyseVolume(candles: Candle[], direction?: Direction | null): VolumeReport {
  const usable = candles.filter((c) => Number.isFinite(c.v) && c.v > 0);
  if (usable.length < 25) return neutral("Volume data unavailable for this feed");

  const vols = usable.map((c) => c.v);
  const cur = vols[vols.length - 1];
  const ma20 = sma(vols, 20);
  const ma50 = vols.length >= 50 ? sma(vols, 50) : null;
  const rel = ma20 ? cur / ma20 : null;

  const recent = usable.slice(-6);
  const up = (c: Candle) => c.c >= c.o;
  const dirUp = direction ? direction === "BUY" : recent[recent.length - 1].c >= recent[0].c;

  // Pullback candles = those moving against the working direction.
  const pullbacks = recent.filter((c) => up(c) !== dirUp);
  const continuation = recent.filter((c) => up(c) === dirUp);
  const avg = (a: Candle[]) => (a.length ? a.reduce((s, c) => s + c.v, 0) / a.length : 0);
  const pullbackVol = avg(pullbacks);
  const contVol = avg(continuation);

  const pullbackDeclining = pullbacks.length > 0 && contVol > 0 && pullbackVol < contVol * 0.85;
  const contRising = continuation.length >= 2 && ma20 != null && contVol > ma20;

  const spike = rel != null && rel >= 1.8;
  // Exhaustion: huge volume but a small body — buyers/sellers absorbed.
  const lastC = usable[usable.length - 1];
  const range = Math.max(1e-9, lastC.h - lastC.l);
  const bodyPct = Math.abs(lastC.c - lastC.o) / range;
  const exhaustion = spike && bodyPct < 0.35;

  let score = 50;
  const notes: string[] = [];
  if (rel != null) {
    if (rel >= 1.5) { score += 16; notes.push(`Relative volume ${rel.toFixed(2)}x — strong participation`); }
    else if (rel >= 1.1) { score += 8; notes.push(`Relative volume ${rel.toFixed(2)}x — above average`); }
    else if (rel < 0.7) { score -= 12; notes.push(`Relative volume ${rel.toFixed(2)}x — thin participation`); }
    else notes.push(`Relative volume ${rel.toFixed(2)}x — normal`);
  }
  if (ma50 != null && ma20 != null) {
    if (ma20 > ma50 * 1.05) { score += 6; notes.push("Volume MA(20) above MA(50) — activity building"); }
    else if (ma20 < ma50 * 0.9) { score -= 5; notes.push("Volume MA(20) below MA(50) — activity fading"); }
  }
  if (pullbackDeclining) { score += 10; notes.push("Volume declining into pullbacks — healthy trend behaviour"); }
  else if (pullbacks.length > 0 && pullbackVol > contVol * 1.25) { score -= 8; notes.push("Pullbacks carrying heavier volume than the impulse"); }
  if (contRising) { score += 8; notes.push("Volume rising with trend continuation"); }
  if (exhaustion) { score -= 14; notes.push("Volume spike on a small body — possible exhaustion / absorption"); }
  else if (spike) { score += 6; notes.push("Volume spike backing the current move"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const participation = score >= 65 ? "strong" : score >= 45 ? "healthy" : "weak";

  return {
    score, notes,
    relative_volume: rel != null ? +rel.toFixed(2) : null,
    volume_ma_20: ma20 != null ? Math.round(ma20) : null,
    volume_ma_50: ma50 != null ? Math.round(ma50) : null,
    spike,
    pullback_volume_declining: pullbackDeclining,
    continuation_volume_rising: contRising,
    exhaustion,
    participation,
  };
}
