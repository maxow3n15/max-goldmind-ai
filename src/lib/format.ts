export const fmtUsd = (n: number | null | undefined, digits = 2) =>
  n == null || Number.isNaN(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export const fmtNum = (n: number | null | undefined, digits = 2) =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (n: number | null | undefined, digits = 1) =>
  n == null || Number.isNaN(n) ? "—" : `${(n).toFixed(digits)}%`;

export const currentSession = (d: Date = new Date()) => {
  const h = d.getUTCHours();
  if (h >= 0 && h < 7) return "Asian";
  if (h >= 7 && h < 12) return "London";
  if (h >= 12 && h < 17) return "New York";
  if (h >= 17 && h < 21) return "NY Afternoon";
  return "Asian";
};
