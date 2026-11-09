# GoldMind AI: interface polish and a forward demo study

## 1. ICT term tooltips
- Add a shared glossary covering FVG, Order Block, Breaker Block, BOS, CHOCH, Liquidity Sweep, SMT, Premium/Discount, MTF/HTF alignment and Killzone. Each term gets one or two plain-English sentences.
- Add a small `<Term>` wrapper that uses the existing tooltip component. Terms get a dotted gold underline and a short explanation on hover, or on tap on a phone.
- Use it in the Active zones table, the confidence heatmap headers, the Confidence Breakdown panel and the Autopilot trade plan.

## 2. Hover animations
- Add shared motion styles: cards lift and their border glows, buttons press and brighten, and links get a gold underline that slides in.
- Apply them to the card, button and nav link styles so every page picks them up. Users who turn off motion in their device settings get no animation.

## 3. Mobile polish
- Check every signed-in page on a 390px-wide phone screen and fix anything clipped, overflowing or cramped. Wide tables scroll sideways inside their card, header rows stack cleanly, and charts resize to fit.
- Make sure the bottom navigation bar never covers page content.
- Take before and after screenshots to confirm.

## 4. Custom 404 page
- The app already has a basic not-found page. It will be redesigned in the gold style, with a "404 · Off the chart" heading, a short message, and buttons for Dashboard and Autopilot, plus Sign in for visitors who aren't signed in.

## 5. Risk in R on the Performance Analytics chart
- Turn the Holding time vs result chart into a combined chart. The dots stay as they are, and a new line shows each trade's planned risk in R: −1R at the original stop.
- The line also marks trades whose real loss went past −1R, such as through slippage, so you can see actual return against the risk you planned.
- The tooltip gains "Risk: −1.00R · Return: +x.xxR".

## 6. Forward demo study (requests 6 and 7 combined)
- **New "Forward study" page** in the navigation. You start a study, and it records the start date, the 88% gate, and your OANDA demo account.
- **The study runs on the always-on server autopilot**, which runs every minute, so it keeps going when the browser is closed. It is limited to the confirmed OANDA demo account at the 88% confidence gate. The demo floor setting is ignored while a study runs, and real-money trading stays locked.
- **Every decision is logged**, whether taken or rejected, with its confidence, the floor applied, the setup model and the rejection reasons. Every trade is linked to the study with its R result.
- **Page contents:** days running, total decisions, trades taken, win rate, expectancy in R, net P&L, a chart of results over time, a decision log you can filter, and Pause / Resume / End study controls.
- A study needs at least 30 closed trades before its result is treated as meaningful, using the same rule as the backtest research.

## Prerequisite
- **The demo study cannot place trades until you renew your OANDA practice API token**, because the saved token is currently rejected (401). The page will show this clearly.
- **The always-on autopilot also needs one republish** to pick up the changed scheduler secret.

## Technical details
- New table `forward_studies` with `id`, `user_id`, `broker_connection_id`, `floor` (fixed at 88), `status` (active/paused/ended), `started_at` and `ended_at`. It gets RLS limited to the owner, plus grants.
- New nullable `study_id` column on `trades` and `decision_logs`.
- The tick looks up the active study for each user and forces `effectiveConfidenceFloor` to 88. It only places orders when the connection is confirmed as demo, and it stamps `study_id` on decisions and trades.
- Server functions in `forward-study.functions.ts`: start, pause, resume, end, and stats/list, all authenticated.
- Tests:
  - A study always uses 88, even when a demo floor is set.
  - A study never runs on a non-demo or unknown connection.
  - Stats aggregation is correct.
- A new `src/lib/glossary.ts` holds the definitions. The motion styles are `@utility` classes in `src/styles.css`. The 404 is the existing `NotFoundComponent` in `__root.tsx`.
- The analytics chart switches from `ScatterChart` to recharts `ComposedChart`, with a Scatter and a Line on a shared Y axis.
