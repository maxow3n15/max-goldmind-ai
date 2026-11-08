/** Pure helpers to explain OANDA 401s in plain language. */
export function cleanCredential(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "");
}

export function classifyOanda401(
  accountId: string,
  listStatus: number,
  accessibleIds: string[],
): string {
  if (listStatus === 401 || listStatus === 403) {
    return "OANDA rejected the API token — it is invalid or has been revoked (generating a new token cancels the old one). Generate a fresh practice token in OANDA → Manage API Access and update this connection.";
  }
  if (listStatus >= 200 && listStatus < 300) {
    if (!accessibleIds.includes(accountId)) {
      const list = accessibleIds.length ? accessibleIds.join(", ") : "none";
      return `The token works, but account ${accountId || "(blank)"} isn't on it. Accounts this token can use: ${list}. Update the Account ID on this connection.`;
    }
    return `The token can see account ${accountId} but OANDA refused this request — check the token's permissions in OANDA.`;
  }
  return `OANDA refused the request and the token could not be checked (status ${listStatus}).`;
}
