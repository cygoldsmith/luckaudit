/**
 * Market Integrity Search — the nine prespecified settings.
 *
 * Commit this file before running anything on real markets. Settings chosen
 * after seeing results can, even by accident, be the ones that produce the most
 * dramatic verdicts. The only setting allowed to depend on data is #5, and it
 * depends only on the data format (see DATA_CHECK), never on results.
 */

export const METHOD_ID = "market-integrity-search-v1";

/** Hour-1 data check (decides setting #5 from the data format only). */
export const DATA_CHECK = {
  checkedAt: "2026-11-07",
  checkedOn:
    "0x61b66d02793b4a68ab0cc25be60d65f517fe18c7d654041281bb130341244fcc (Warsh Fed chair nomination, resolved)",
  fillsAppearOnce:
    "Data API /v2/trades with taker_only=true (the default) serves each fill once, on its taker side; taker_only=false adds one maker row per counterparty. Every transaction hash appeared exactly once in a 1,000-row taker_only=true page.",
  aggressorIdentifiable:
    "Yes. The taker_only=true row is the side whose order filled immediately against a resting order.",
  choice: "aggressor-flow" as const,
};

export const SETTINGS = {
  /**
   * #1 Reference library. Categories are assigned in this order by Gamma event
   * tag slug. Markets need at least minVolumeUsd of lifetime Gamma volume: most
   * smaller markets are untraded placeholders that can never be tested. Volume
   * does not look at which side won.
   */
  library: {
    days: 180,
    minVolumeUsd: 10_000,
    categories: [
      { id: "awards", label: "Awards", tagSlugs: ["awards"] },
      {
        id: "announcements",
        label: "Company & government announcements",
        tagSlugs: [
          "fed-rates",
          "global-rates",
          "economic-policy",
          "earnings",
          "business",
        ],
      },
      {
        id: "politics",
        label: "Politics & world events",
        tagSlugs: ["politics", "geopolitics", "world", "elections"],
      },
    ],
  },
  /** #2 Big move. */
  bigMove: {
    minChange: 0.1,
    persistHours: 2,
    persistFraction: 0.5,
    maxSingleWalletShare: 0.25,
  },
  /** #3 Pre-move window, hours. */
  windowHours: 6,
  /** #4 Minimum earlier comparison windows. */
  minComparisonWindows: 48,
  /** #5 One-sidedness score (decided by DATA_CHECK). Cushion floor in USD. */
  score: { type: DATA_CHECK.choice, cushionFloor: 100 },
  /** #6 Wallets listed. */
  walletList: { count: 20, minNetUsd: 100 },
  /** #7 Wallet record rules. */
  walletRecord: { minCost: 10, minPrice: 0.03, maxPrice: 0.5, minBets: 5 },
  /** #8 Error budget. */
  alpha: 0.05,
  /** #9 Placebo runs. */
  placeboRuns: 20,
} as const;

/** Price buckets for the calibration check (Step 0). */
export const PRICE_BUCKETS = [
  [0.03, 0.1],
  [0.1, 0.2],
  [0.2, 0.3],
  [0.3, 0.4],
  [0.4, 0.5],
] as const;

/** Placebo thresholds stated in the method. */
export const CALIBRATION_LIMIT = 0.1;

/**
 * Operational limits (not statistical settings). They bound retrieval cost and
 * are fixed before results are seen. A truncated tape keeps its most recent
 * fills; comparison windows then start at the first complete retrieved hour.
 */
export const LIMITS = {
  takerPages: 150,
  allSidesPages: 150,
  libraryMaxMarkets: 400,
  sessionSearchesBeforeHint: 5,
};

export type ScoreType = "aggressor-flow" | "price-drift";
export type CategoryId = (typeof SETTINGS.library.categories)[number]["id"];
