import type { PolishBookmaker } from "../config/index.js";
import type { ApiSuccessResponse } from "./api.js";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type Period = "day" | "week" | "month";

export interface SelectionRef {
  matchLabel: string;
  market: string;
  selection: string;
}

export interface OddsRule {
  /** Each leg >= x. */
  everyLegMin?: number;
  /** At least one leg >= x. */
  anyLegMin?: number;
  /** Total odds >= x. */
  totalMin?: number;
  totalMax?: number;
  everyLegMax?: number;
}

export interface FreebetTerms {
  /**
   * Net win = amount * (winFactor * odds - stakeDeduction).
   * winFactor: 1 (Betclic) | 0.88 (Fortuna, Le Bull, Betters, Betcris).
   */
  winFactor: number;
  /** 1 (Betclic, Fortuna) | 0.88 (Le Bull, Betters, Betcris). */
  stakeDeduction: number;
  odds?: OddsRule;
  minLegs?: number;
  validDays?: number;
  maxWinPln?: number;
}

export interface Wagering {
  multiplier: number;
  of: "deposit" | "bonus" | "deposit_plus_bonus";
  ownFundsOnly: boolean;
  odds?: OddsRule;
  minLegs?: number;
  days?: number;
  baseCapPln?: number;
  depositLocked?: boolean;
}

export type PayoutForm =
  | { kind: "cash" }
  | { kind: "freebet"; terms: FreebetTerms }
  | { kind: "bonus_funds"; wagering: Wagering };

export type TaxRelief =
  | { kind: "stake_factor"; factor: number }
  | { kind: "winnings_topup"; percentOfWin: number; lostOnAnyVoid: boolean }
  | { kind: "freebet_refund"; percentOfNetStake: number; capPerDayPln?: number; terms: FreebetTerms }
  | { kind: "odds_multiplier"; multiplier: number };

export type AccaBonusBase = "total_odds" | "each_leg_odds" | "profit" | "gross_win" | "odds_above_one";

export type PromotionEffect =
  // Certain: change the payout of a winning coupon
  | { type: "TAX_RELIEF"; relief: TaxRelief }
  | {
      type: "ACCA_BONUS";
      base: AccaBonusBase;
      tiers: { minLegs: number; percent: number }[];
      qualifyingLegMinOdds?: number;
      capPln?: number;
      paidAs: PayoutForm;
    }
  | {
      type: "ODDS_BOOST";
      selection: SelectionRef;
      baseOdds: number;
      boostedOdds: number;
      maxStakePln?: number;
      extraPaidAs: PayoutForm;
    }
  // Random: change the expected value
  | {
      type: "REFUND_ON_LOSS";
      percent: number;
      base: "gross_stake" | "net_stake";
      capPln: number;
      paidAs: PayoutForm;
      firstCouponOnly: boolean;
    }
  | { type: "REFUND_ON_ONE_MISS"; minLegs: number; capPln: number; paidAs: PayoutForm }
  | { type: "REFUND_ON_CONDITION"; condition: string; capPln?: number; paidAs: PayoutForm }
  | { type: "EARLY_WIN"; rule: "two_goal_lead"; markets: string[] }
  // Account level: not tied to one coupon
  | {
      type: "DEPOSIT_BONUS";
      depositIndex: number;
      percent: number;
      capPln: number;
      minDepositPln: number;
      paidAs: PayoutForm;
    }
  | { type: "FREEBET_GRANT"; amountPln: number; trigger: string; terms: FreebetTerms }
  | {
      type: "CASHBACK";
      percent: number;
      of: "net_loss" | "turnover";
      period: Period;
      capPln?: number;
      paidAs: PayoutForm;
    }
  | { type: "TASK_REWARD"; task: string; rewardPln: number; paidAs: PayoutForm }
  | { type: "OTHER"; description: string };

export interface Eligibility {
  betTypes: ("single" | "accumulator")[];
  minLegs?: number;
  maxLegs?: number;
  odds?: OddsRule;
  minStakePln?: number;
  maxStakePln?: number;
  fundsSource: "own_money_only" | "any";
  /** Our league slugs; undefined = all. */
  leagues?: string[];
  /** Normalized market codes; undefined = all. */
  markets?: string[];
  placementWindows?: { days: Weekday[]; from: string; to: string; channel?: "web" | "app" }[];
  /** Days counted from the account's openedAt (welcome windows; "only after day 45"). */
  accountAgeDays?: { from?: number; to?: number };
  /**
   * The effect counts only if the user picked this promotion as their welcome
   * package (forBET Bonus Box).
   */
  requiresChosenWelcome?: boolean;
  /**
   * Account or history conditions we cannot check. Until the user confirms them
   * (BookmakerAccountState.confirmations) they are "needs_confirmation" and the
   * effect stays out of the payout and the ranking.
   */
  requiresConfirmation: { key: string; label: string; expires: "never" | "end_of_day" | "end_of_week" }[];
  /** Action on the bookmaker's own coupon (eToto "Zmień współczynnik"): counted, with a reminder. */
  couponAction?: string;
  /** Anything else we only display. */
  notes: string[];
}

export interface PromotionEffectEntry {
  effect: PromotionEffect;
  /** Extra conditions of this variant only, e.g. Betclic singles: 0.94 always, 1.0 if confirmed. */
  extraEligibility?: Partial<Eligibility>;
  /** "full" only when the formula is proven by the terms or a test coupon. */
  valuation: "full" | "display_only";
}

export interface Promotion {
  /** Stable slug, e.g. "betclic-bez-podatku-2". */
  id: string;
  bookmaker: PolishBookmaker;
  /** The bookmaker's own name, e.g. "Bez Podatku 2.0". */
  name: string;
  audience: "new_customer" | "existing_customer" | "everyone";
  /** Part of a loyalty program. */
  loyaltyProgram?: boolean;
  recurrence:
    | { kind: "one_time" | "per_event" | "always_on" }
    | { kind: "per_period"; period: Period };
  /** ISO date-time. */
  validFrom?: string;
  /** ISO date-time; undefined = until further notice. */
  validTo?: string;
  activation:
    | { kind: "automatic" | "join_button" | "coupon_toggle" | "choose_at_deposit" }
    | { kind: "registration_code" | "promo_code"; code: string };
  eligibility: Eligibility;
  effects: PromotionEffectEntry[];
  stacking: { exclusiveGroup?: string; combinableWith: string[] };
  source: {
    promoUrl: string;
    termsUrl: string;
    /**
     * Human-readable terms page for the "Regulamin" link, when `termsUrl` is a
     * machine endpoint (JSON CMS) the hash and evidence were taken from.
     */
    publicTermsUrl?: string;
    termsVersionDate?: string;
    termsHash: string;
    fetchedAt: string;
    /** Quote from the terms for every non-trivial field (field path -> quote). */
    evidence: Record<string, string>;
  };
  review: {
    status: "draft" | "verified" | "suspended" | "expired";
    verifiedAt?: string;
    verifiedBy?: string;
  };
  version: number;
}

export type PromotionsResponse = ApiSuccessResponse<{
  promotions: Promotion[];
  generatedAt: string;
}>;
