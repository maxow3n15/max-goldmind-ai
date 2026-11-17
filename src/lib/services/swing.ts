import type { MultiTimeframeReport } from './mtf';
import type { StructureRead, LiquidityLevel } from './structure';
import type { SetupClassification, SetupRequirement } from './setup-models';
import type { OpenTrade, ManagementAction } from './position-manager';

export const SWING_POLICY = {
  version: 'swing-v1', entryTimeframe: '60', targetTradesPerWeek: [2, 5],
  maxHoldHours: 96, minRr: 2, demoFloor: 75, liveFloor: 88,
} as const;

export interface SwingMetadata {
  version: string;
  setupId: string;
  firstTarget: number;
  maxHoldHours: number;
}

export interface SwingSetup {
  direction: 'BUY' | 'SELL'; entry: number; stop_loss: number;
  take_profit_1: number; take_profit_2: number | null; take_profit_3: number | null;
  risk_reward: number;
}

/** Only closed-candle evidence may be supplied. No calendar-day pattern is assumed. */
export function buildSwingCandidate(mtf: MultiTimeframeReport | null, price: number | null, levels: LiquidityLevel[] = [], now = Date.now()) {
  const daily = mtf?.timeframes.find(r => r.timeframe === 'D');
  const four = mtf?.timeframes.find(r => r.timeframe === '240');
  const hour = mtf?.timeframes.find(r => r.timeframe === '60');
  const empty = (reason: string) => ({ setup: null, metadata: null, classification: { best: null, matches: [], tradable: false, reason } as SetupClassification, explanation: reason });
  if (!daily || !four || !hour || mtf?.degraded || !price || !Number.isFinite(price) || [daily, four, hour].some(r => r.bars < 12)) return empty('Daily, 4H and 1H closed-candle evidence required');
  const dir = daily.bias;
  if (dir === 'neutral' || four.bias !== dir) return empty('Daily and 4H directional bias must agree');
  const buy = dir === 'bullish';
  const s = four.structure;
  const trigger = hour.structure.events.find(e => e.direction === dir && now >= e.t && now - e.t <= 6 * 3600_000);
  const zones = [...s.fvgs.filter(z => !z.mitigated), ...s.orderBlocks.filter(z => !z.mitigated), ...s.breakers.filter(z => !z.retested)]
    .filter(z => z.direction === dir && z.t <= now && price >= z.bottom && price <= z.top)
    .sort((a, b) => b.t - a.t);
  const zone = zones[0];
  const sweeps = s.sweeps.filter(x => x.reclaimed && x.side === (buy ? 'sell_side' : 'buy_side') && x.t <= now && now - x.t <= 72 * 3600_000);
  const sweep = sweeps[0];
  const impulse = s.events.find(e => e.type === 'BOS' && e.direction === dir && e.t <= now && now - e.t <= 72 * 3600_000);
  const location = s.equilibrium != null && (buy ? price <= s.equilibrium : price >= s.equilibrium);
  const requirements: SetupRequirement[] = [
    { key: 'bias', label: 'Daily and 4H alignment', met: true, detail: dir, hard: true },
    { key: 'zone', label: 'Price inside active 4H FVG, order block or breaker', met: !!zone, detail: zone ? `${zone.bottom}–${zone.top}` : 'No active zone at current price', hard: true },
    { key: 'liquidity', label: '4H sweep reversal or continuation impulse', met: !!sweep || !!impulse, detail: sweep ? 'Reclaimed sweep' : impulse ? 'Confirmed continuation BOS' : 'No recent sweep or impulse', hard: true },
    { key: 'trigger', label: '1H confirmation after zone formation', met: !!trigger && !!zone && trigger.t >= zone.t && (!sweep || trigger.t >= sweep.t), detail: trigger ? `${trigger.type} ${dir}` : 'No recent 1H confirmation', hard: true },
    { key: 'location', label: 'Discount buys / premium sells', met: location, detail: `4H equilibrium ${s.equilibrium ?? 'unavailable'}`, hard: true },
  ];
  if (!zone) return empty(requirements.filter(r => !r.met).map(r => r.label).join('; '));
  const pivot = (buy ? s.swingLows : s.swingHighs).filter(p => p.t <= now).at(-1)?.price;
  const atr = s.atr;
  if (!atr || !Number.isFinite(atr) || atr <= 0) return empty('4H ATR unavailable — structural stop cannot be buffered');
  const boundary = buy ? Math.min(zone.bottom, pivot ?? zone.bottom, sweep ? sweep.level - sweep.penetration : zone.bottom) : Math.max(zone.top, pivot ?? zone.top, sweep ? sweep.level + sweep.penetration : zone.top);
  const stop = Number((boundary + (buy ? -1 : 1) * atr * 0.15).toFixed(2));
  const risk = Math.abs(price - stop);
  const targetPrices = [...levels.filter(l => !l.swept && l.side === (buy ? 'buy_side' : 'sell_side')).map(l => l.price),
    ...(buy ? s.swingHighs : s.swingLows).map(p => p.price),
    ...(buy ? daily.structure.swingHighs : daily.structure.swingLows).map(p => p.price)];
  const targets = [...new Set(targetPrices)].filter(t => Number.isFinite(t) && (buy ? t > price : t < price) && Math.abs(t - price) / risk >= SWING_POLICY.minRr).sort((a, b) => buy ? a - b : b - a).slice(0, 3);
  requirements.push({ key: 'geometry', label: 'Structural stop and real liquidity target ≥ 2R', met: risk > 0 && risk / price >= 0.0005 && risk / price <= 0.02 && targets.length > 0 && (buy ? stop < price : stop > price), detail: `${risk.toFixed(2)} stop distance; ${targets.length} qualifying targets`, hard: true });
  const valid = requirements.every(r => r.met);
  const type = sweep ? 'SWING_4H_SWEEP_RETEST' : 'SWING_TREND_CONTINUATION';
  const best = { type, verdict: valid ? 'VALID' : 'INCOMPLETE', completeness: Math.round(requirements.filter(r => r.met).length / requirements.length * 100), requirements } as const;
  const classification: SetupClassification = { best, matches: [best], tradable: valid, reason: valid ? null : requirements.filter(r => !r.met).map(r => r.label).join('; ') };
  if (!valid || !trigger || !targets[0]) return { setup: null, metadata: null, classification, explanation: classification.reason ?? 'Swing setup incomplete' };
  const setup: SwingSetup = { direction: buy ? 'BUY' : 'SELL', entry: price, stop_loss: stop, take_profit_1: targets[0], take_profit_2: targets[1] ?? null, take_profit_3: targets[2] ?? null, risk_reward: Math.abs(targets[0] - price) / risk };
  const metadata: SwingMetadata = { version: SWING_POLICY.version, setupId: `${type}:${dir}:${zone.t}:${trigger.t}`, firstTarget: targets[0], maxHoldHours: SWING_POLICY.maxHoldHours };
  return { setup, metadata, classification, explanation: `${type}: Daily/4H ${dir}, active 4H zone and closed 1H ${trigger.type}; structural invalidation and opposing liquidity exits.` };
}

/** Swing legs are never tightened by short-term momentum or a rolling intraday ATR. */
export function evaluateSwingPosition(trade: OpenTrade, price: number, fourHour: StructureRead | null, now = Date.now()): ManagementAction {
  const meta = trade.swing;
  if (!meta || !Number.isFinite(price) || price <= 0) return { type: 'none' };
  const buy = trade.direction === 'BUY';
  if (buy ? price <= trade.stop_loss : price >= trade.stop_loss) return { type: 'close', price, reason: 'Swing structural stop hit' };
  if (trade.take_profit_1 != null && (buy ? price >= trade.take_profit_1 : price <= trade.take_profit_1)) return { type: 'close', price, reason: 'Swing liquidity target reached' };
  const opened = Date.parse(trade.opened_at);
  if (Number.isFinite(opened) && now - opened >= SWING_POLICY.maxHoldHours * 3600_000) return { type: 'close', price, reason: 'Swing maximum holding time: 96 hours' };
  const day = new Date(now);
  if (day.getUTCDay() === 5 && day.getUTCHours() >= 20) return { type: 'close', price, reason: 'Swing weekend protection — Friday 20:00 UTC' };
  const protectedAlready = buy ? trade.stop_loss > trade.entry_price : trade.stop_loss < trade.entry_price;
  const firstHit = buy ? price >= meta.firstTarget : price <= meta.firstTarget;
  if (!firstHit && !protectedAlready) return { type: 'none' };
  const risk = Math.abs(trade.entry_price - (trade.initial_stop_loss ?? trade.stop_loss));
  if (!protectedAlready && risk > 0) {
    const be = trade.entry_price + (buy ? 1 : -1) * risk * 0.05;
    if (buy ? be < price : be > price) return { type: 'move_stop', new_stop: Number(be.toFixed(2)), reason: 'Swing TP1 reached — break-even plus 0.05R estimated cost buffer' };
  }
  const pivot = (buy ? fourHour?.swingLows : fourHour?.swingHighs)?.filter(p => p.t > opened && p.t <= now).at(-1);
  const atr = fourHour?.atr;
  if (!pivot || !atr || atr <= 0) return { type: 'none' };
  const next = Number((pivot.price + (buy ? -1 : 1) * atr * 0.15).toFixed(2));
  if (buy ? next > trade.stop_loss && next < price : next < trade.stop_loss && next > price) return { type: 'move_stop', new_stop: next, reason: 'Trail behind confirmed closed 4H swing pivot' };
  return { type: 'none' };
}