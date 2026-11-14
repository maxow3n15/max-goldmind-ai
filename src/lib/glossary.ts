export const GLOSSARY: Record<string, string> = {
  FVG: "Fair Value Gap: a price area crossed quickly with little trading between candles. Price may revisit it, but a revisit is not guaranteed.",
  "Fair Value Gap": "A price area crossed quickly with little trading between candles. Price may revisit it, but a revisit is not guaranteed.",
  CHOCH: "Change of Character: price breaks the recent trend structure in the opposite direction. It can signal a change, but needs confirmation.",
  BOS: "Break of Structure: price passes a recent swing high or low in the trend's direction.",
  "Order Block": "A candle area before a strong price move, watched as a possible support or resistance zone. It is not proof of institutional orders.",
  "Breaker Block": "An order block that failed and may now act as support or resistance in the opposite direction.",
  Breaker: "An order block that failed and may now act as support or resistance in the opposite direction.",
  "Liquidity Sweep": "Price briefly crosses a recent high or low, then moves back inside. This may trigger stops before a reversal.",
  SMT: "A divergence between related markets: one makes a new high or low while the other does not. It is supporting evidence, not a trade signal alone.",
  "Premium/Discount": "The upper and lower halves of a chosen price range. Premium is above the midpoint; discount is below it.",
  MTF: "Multi-timeframe: checking the same market on several chart periods for agreement or conflict.",
  HTF: "Higher timeframe: a longer chart period used to judge the broader market direction.",
  Killzone: "A commonly watched trading-session window. Activity may increase, but profitable trades are not guaranteed.",
};

export function termDefinition(label: string): string | undefined {
  const normalized = label.replaceAll("_", " ").toLowerCase();
  return Object.entries(GLOSSARY).find(([key]) => normalized.includes(key.toLowerCase()))?.[1];
}