// Funded-account challenge presets.
//
// Rule sets for the major evaluation providers. They are starting points:
// every field remains editable per account, because firms change their
// terms and run promotions. Nothing here is enforced until the user saves
// a profile — the presets only pre-fill the onboarding form.

export type DrawdownType = "static" | "trailing" | "eod_trailing";
export type ChallengePhase = "evaluation_1" | "evaluation_2" | "funded";

export interface ChallengePreset {
  key: string;
  provider: string;
  label: string;
  /** Phase-specific defaults, keyed by phase. */
  phases: Partial<Record<ChallengePhase, PhaseRules>>;
  note: string;
}

export interface PhaseRules {
  profit_target_pct: number;
  daily_loss_limit_pct: number;
  max_drawdown_pct: number;
  drawdown_type: DrawdownType;
  drawdown_basis: "equity" | "balance";
  daily_loss_basis: "balance" | "equity";
  consistency_rule_pct: number | null;
  min_trading_days: number;
  max_trading_days: number | null;
  news_restriction_minutes: number;
  weekend_holding_allowed: boolean;
  overnight_holding_allowed: boolean;
  daily_reset_utc_hour: number;
}

const base: PhaseRules = {
  profit_target_pct: 8,
  daily_loss_limit_pct: 5,
  max_drawdown_pct: 10,
  drawdown_type: "static",
  drawdown_basis: "equity",
  daily_loss_basis: "balance",
  consistency_rule_pct: null,
  min_trading_days: 0,
  max_trading_days: null,
  news_restriction_minutes: 0,
  weekend_holding_allowed: true,
  overnight_holding_allowed: true,
  daily_reset_utc_hour: 0,
};

const r = (o: Partial<PhaseRules>): PhaseRules => ({ ...base, ...o });

export const CHALLENGE_PRESETS: ChallengePreset[] = [
  {
    key: "ftmo",
    provider: "FTMO",
    label: "FTMO Challenge",
    note: "Static 10% max loss measured from the initial balance; 5% daily loss on balance + floating P&L, resetting at 00:00 CE(S)T.",
    phases: {
      evaluation_1: r({ profit_target_pct: 10, daily_loss_limit_pct: 5, max_drawdown_pct: 10, min_trading_days: 4, daily_reset_utc_hour: 22 }),
      evaluation_2: r({ profit_target_pct: 5, daily_loss_limit_pct: 5, max_drawdown_pct: 10, min_trading_days: 4, daily_reset_utc_hour: 22 }),
      funded: r({ profit_target_pct: 0, daily_loss_limit_pct: 5, max_drawdown_pct: 10, min_trading_days: 0, daily_reset_utc_hour: 22 }),
    },
  },
  {
    key: "myforexfunds",
    provider: "Prop firm (MFF-style)",
    label: "MFF-style Evaluation",
    note: "8% target with a 5% daily and 12% overall limit; commonly pairs with a news-window restriction.",
    phases: {
      evaluation_1: r({ profit_target_pct: 8, daily_loss_limit_pct: 5, max_drawdown_pct: 12, min_trading_days: 5, news_restriction_minutes: 2 }),
      evaluation_2: r({ profit_target_pct: 5, daily_loss_limit_pct: 5, max_drawdown_pct: 12, min_trading_days: 5, news_restriction_minutes: 2 }),
      funded: r({ profit_target_pct: 0, daily_loss_limit_pct: 5, max_drawdown_pct: 12, news_restriction_minutes: 2 }),
    },
  },
  {
    key: "the5ers",
    provider: "The5ers",
    label: "The5ers Hyper/High-Stakes",
    note: "Lower targets with a tight 3% daily limit and a 6% overall limit — sizing discipline matters more than trade count.",
    phases: {
      evaluation_1: r({ profit_target_pct: 6, daily_loss_limit_pct: 3, max_drawdown_pct: 6, min_trading_days: 3 }),
      evaluation_2: r({ profit_target_pct: 6, daily_loss_limit_pct: 3, max_drawdown_pct: 6, min_trading_days: 3 }),
      funded: r({ profit_target_pct: 0, daily_loss_limit_pct: 3, max_drawdown_pct: 6 }),
    },
  },
  {
    key: "funded_next",
    provider: "Trailing-drawdown firm",
    label: "Trailing drawdown evaluation",
    note: "Maximum loss trails the highest equity reached, so giving profit back is as fatal as losing capital.",
    phases: {
      evaluation_1: r({ profit_target_pct: 8, daily_loss_limit_pct: 4, max_drawdown_pct: 8, drawdown_type: "trailing", min_trading_days: 3 }),
      funded: r({ profit_target_pct: 0, daily_loss_limit_pct: 4, max_drawdown_pct: 8, drawdown_type: "trailing" }),
    },
  },
  {
    key: "topstep_style",
    provider: "Topstep-style",
    label: "End-of-day trailing account",
    note: "The loss limit trails the end-of-day balance, and positions must be flat before the session close.",
    phases: {
      evaluation_1: r({
        profit_target_pct: 6, daily_loss_limit_pct: 3, max_drawdown_pct: 4,
        drawdown_type: "eod_trailing", min_trading_days: 5,
        overnight_holding_allowed: false, weekend_holding_allowed: false,
        consistency_rule_pct: 50, daily_reset_utc_hour: 21,
      }),
      funded: r({
        profit_target_pct: 0, daily_loss_limit_pct: 3, max_drawdown_pct: 4,
        drawdown_type: "eod_trailing", overnight_holding_allowed: false,
        weekend_holding_allowed: false, consistency_rule_pct: 50, daily_reset_utc_hour: 21,
      }),
    },
  },
  {
    key: "consistency_firm",
    provider: "Consistency-rule firm",
    label: "Consistency-weighted evaluation",
    note: "No single day may account for more than 30% of total profit — the engine spreads gains across sessions.",
    phases: {
      evaluation_1: r({ profit_target_pct: 10, daily_loss_limit_pct: 5, max_drawdown_pct: 10, consistency_rule_pct: 30, min_trading_days: 5 }),
      funded: r({ profit_target_pct: 0, daily_loss_limit_pct: 5, max_drawdown_pct: 10, consistency_rule_pct: 30 }),
    },
  },
  {
    key: "custom",
    provider: "Custom",
    label: "Custom / other provider",
    note: "Enter the rules from your account dashboard. Every field below is enforced exactly as configured.",
    phases: { evaluation_1: r({}), evaluation_2: r({}), funded: r({ profit_target_pct: 0 }) },
  },
];

export function presetByKey(key: string): ChallengePreset {
  return CHALLENGE_PRESETS.find((p) => p.key === key) ?? CHALLENGE_PRESETS[CHALLENGE_PRESETS.length - 1]!;
}

export function rulesFor(key: string, phase: ChallengePhase): PhaseRules {
  const preset = presetByKey(key);
  return preset.phases[phase] ?? preset.phases.evaluation_1 ?? base;
}

export const PHASES: { value: ChallengePhase; label: string }[] = [
  { value: "evaluation_1", label: "Evaluation — phase 1" },
  { value: "evaluation_2", label: "Evaluation — phase 2" },
  { value: "funded", label: "Funded account" },
];

/**
 * Best-effort provider detection from broker account metadata. Prop accounts
 * almost always carry the firm name in the account label or server name, so
 * we match on that rather than guessing.
 */
export function detectPreset(meta: { label?: string | null; account_name?: string | null; broker_id?: string | null }): ChallengePreset | null {
  const hay = [meta.label, meta.account_name, meta.broker_id].filter(Boolean).join(" ").toLowerCase();
  if (!hay) return null;
  const matchers: [string, string][] = [
    ["ftmo", "ftmo"],
    ["myforexfunds", "myforexfunds"],
    ["mff", "myforexfunds"],
    ["5ers", "the5ers"],
    ["the5ers", "the5ers"],
    ["topstep", "topstep_style"],
    ["fundednext", "funded_next"],
    ["funded next", "funded_next"],
    ["apex", "topstep_style"],
  ];
  for (const [needle, key] of matchers) {
    if (hay.includes(needle)) return presetByKey(key);
  }
  return null;
}
