# GoldMind AI

AI Trading Platform Prompt for Loveable

Build a professional AI-powered web application called GoldMind AI that analyses XAUUSD (Gold) in real time, provides high-probability trade setups, explains every decision, and can automatically execute trades through MetaTrader 5 when enabled by the user.

Goal

Create a modern trading platform similar in quality to institutional trading software, with a clean dark interface, fast performance, and an AI assistant that thinks like an experienced Smart Money Concepts (ICT) trader.

The system should never guarantee profits or claim certainty. Every recommendation should include a confidence score and make clear that markets are uncertain.



Dashboard

Create a premium dashboard with:

Live XAUUSD chart

Current market price

Trend direction

Market session (Asian, London, New York)

Volatility indicator

AI confidence percentage

Open trades

Closed trades

Daily P&L

Weekly P&L

Monthly P&L

Win rate

Average Risk:Reward

Maximum drawdown

Account balance

Equity

Free margin

Margin level

Use a dark black/grey design with gold accents.



Chart

Embed an interactive TradingView chart.

Allow users to switch between:

1 Minute

5 Minute

15 Minute

30 Minute

1 Hour

4 Hour

Daily

The AI should continuously analyse whichever timeframe is selected while maintaining higher-timeframe context.



AI Analysis Engine

The AI must analyse:

Market Structure

Break of Structure (BOS)

Change of Character (CHOCH)

Internal Structure

External Structure

Liquidity

Liquidity Sweeps

Equal Highs

Equal Lows

Premium

Discount

Fair Value Gaps

Inverse Fair Value Gaps

Order Blocks

Breaker Blocks

Mitigation Blocks

Supply Zones

Demand Zones

Trend

Swing Highs

Swing Lows

Fibonacci Retracements

ATR

Session Timing

Volume (where available)

Previous Day High/Low

Previous Week High/Low

Daily Open

Asian Range

London Open

New York Open

The AI should combine all confluences before suggesting any trade.



Trade Recommendations

When a valid setup appears, generate:

Direction

BUY or SELL

Entry Price

Stop Loss

Take Profit 1

Take Profit 2

Take Profit 3

Risk Reward Ratio

Confidence %

Expected Holding Time

Probability Rating

Suggested Risk %



Explanation Engine

Every recommendation must include a detailed explanation in plain English.

Example:

“The daily trend remains bullish. London swept liquidity beneath the previous day’s low before reclaiming support. Price has entered a 4-hour bullish order block and filled a fair value gap. The stop loss is positioned below the liquidity sweep to reduce the chance of being stopped by normal market movement. Take profit targets align with previous swing highs and major liquidity pools.”

The explanation should read like an experienced professional trader teaching the user.



Risk Management

Allow the user to configure:

Maximum daily loss

Maximum weekly loss

Maximum trades per day

Risk per trade

Maximum open trades

Maximum exposure

If any limit is exceeded, the AI must stop trading automatically until reset by the user.



Trade Execution

Include two modes:

Paper Trading

Automatically simulate trades.

Live Trading

Execute trades through MetaTrader 5 after the user explicitly enables live mode and connects a supported brokerage account.

The user must always retain the ability to disable automation instantly.



Trade Journal

Save every trade.

Store:

Entry

Exit

Profit

Loss

Risk

Reward

Duration

Reason for Entry

Reason for Exit

Screenshot of chart (if available)

AI explanation

Confidence

Market session



Performance Analytics

Generate dashboards showing:

Win rate

Average RR

Profit factor

Sharpe ratio (if enough data)

Maximum drawdown

Best session

Worst session

Best weekday

Worst weekday

Most profitable setup

Least profitable setup

Monthly performance



AI Learning

Continuously evaluate completed trades.

Track which combinations of confluences perform best.

Adjust future confidence scores based on historical performance while ensuring users can always review the reasoning behind each recommendation.

Do not claim autonomous self-improvement beyond the data available within the application.



News Filter

Display upcoming high-impact economic events.

Warn users before:

FOMC

CPI

PPI

NFP

Powell Speeches

Interest Rate Decisions

ECB

BOE

BOJ

Allow the user to choose whether the AI avoids trading around high-impact news.



Alerts

Allow alerts via:

Browser

Email

Telegram

Discord

Push notifications

Custom webhook



AI Assistant

Include an integrated chatbot that answers questions like:

“Why did you buy here?”

“Why is the stop loss there?”

“Why did confidence drop?”

“What market structure changed?”

“Where is the liquidity?”

The assistant should explain using ICT/Smart Money Concepts in clear language.



Settings

Allow users to configure:

Risk %

Broker connection

Trading mode

Preferred timeframe

Preferred trading session

Dark mode

Notification preferences

News avoidance rules



Security

Require user authentication.

Encrypt API keys and broker credentials.

Never expose sensitive credentials in the frontend.

Require confirmation before enabling live trading.



Tech Stack

Frontend:

Next.js

React

TypeScript

Tailwind CSS

Backend:

Python

FastAPI

Database:

PostgreSQL

Authentication:

Supabase Auth or Auth.js

Trading:

MetaTrader 5 integration

Broker API support where available

AI:

OpenAI API for reasoning and explanations

Charts:

TradingView Advanced Charts



UI Style

Design a premium institutional trading platform inspired by Bloomberg Terminal, TradingView, and modern fintech dashboards.

Use:

Dark charcoal background

Gold accent colours

Glassmorphism panels

Smooth animations

Responsive design

Mobile support

Professional typography

Clean spacing

Fast loading

The application should feel polished, reliable, and suitable for serious traders.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e6af7af9-9ab4-44c0-b52b-fe50f301646e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
