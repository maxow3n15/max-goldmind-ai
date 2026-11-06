# Roadmap
- [x] Sweep confidence floors (88/76/74/70/66/60/58) on 60d 15m
- [x] Pull 8 years of candles (OANDA: 4H 12k, 1H 47k, 30m 94k bars, 2018-11 → 2026-11) and rerun floor test
- Finding: 1H @ 60% floor = 69 trades, 57% IS win, +0.10R IS, +1.62R OOS (6 trades) — promising but OOS sample tiny; live gate unchanged at 88%
