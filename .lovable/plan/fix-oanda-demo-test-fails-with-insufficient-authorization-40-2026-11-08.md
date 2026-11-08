# Fix: OANDA demo test fails with "Insufficient authorization" (401)

## What's happening
The app reached OANDA's practice server correctly, but OANDA rejected the API token. This message from OANDA means one of:
1. The token was revoked or regenerated (generating a new token in OANDA kills the old one).
2. The saved Account ID doesn't belong to that token (e.g. a different sub-account or a live account ID).
3. Stray spaces/line breaks were pasted with the token.

The connection code itself is correct — it's a credentials problem — but the app should tell you which of these it is.

## Your step (needed regardless)
1. Log in to OANDA → My Account → Manage API Access → generate a fresh token for the **practice (fxTrade Practice)** account.
2. Copy the Account ID (format `101-004-xxxxxxx-001`) from the same practice login.
3. In Broker Connections, edit "OANDA PRACTICE" and paste both, then re-run the demo test.

## What I'll change
- **Trim credentials** on save and use, so stray spaces can't break the token.
- **Smarter diagnosis**: on a 401, the test will list the accounts the token can access and report clearly:
  - "Token is invalid or revoked — generate a new one", or
  - "Token works but account X isn't on it — available accounts: …" (with a one-click option to use the right one).
- **Clearer message** in the demo test step instead of the raw OANDA error.
- Small tests for the trimming and the 401 diagnosis messages.

No safety gates, risk limits or live-trading lock are touched.

## Technical details
- `connectors.server.ts`: trim `token`/`accountId`; in `oanda.fetchAccount`, catch 401 and call `GET /v3/accounts` to classify bad-token vs account-mismatch.
- Demo execution test step "account" surfaces the classified message.
- Vitest cases for both classifications.
