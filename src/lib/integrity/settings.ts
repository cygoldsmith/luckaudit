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
      // Advanced spec control category: private information is essentially
      // impossible, so flags here measure skill, speed or false positives.
      // Listed first so a crypto-price market is never filed as a study market.
      { id: "control", label: "Crypto prices (control)", tagSlugs: ["crypto-prices"] },
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
  /**
   * Raised from 400 on 2026-11-07 after the first build showed most markets
   * are not testable (no qualifying sudden move). This is a size limit only;
   * it does not look at outcomes, and the nine settings are unchanged.
   */
  libraryMaxMarkets: 5000,
  sessionSearchesBeforeHint: 5,
};

/**
 * Wallet method — "Luck Auditor — Statistical Method Spec" (Advanced spec),
 * pre-registered parameters. The market verdict is built from these wallet
 * flags; the Market Integrity Search pre-move test above is kept as context.
 */
export const WALLET_METHOD_ID = "luck-auditor-wallet-v1";
export const WALLET_SETTINGS = {
  /** Minimum position cost s_min, USD. */
  minCost: 10,
  /** Entry price range [p_lo, p_hi]; first-buy price of the kept token. */
  priceRange: [0.02, 0.95] as const,
  /** Calibration bin edges: 0.02–0.05, then 5¢ bins to 0.95. */
  calibrationEdges: [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
  /** Bins backed by fewer markets fall back to c(p) = p. */
  minMarketsPerBin: 30,
  /** Minimum positions per wallet n_min. */
  minPositions: 5,
  /** False discovery rate α. */
  alpha: 0.05,
  /** Jumps: +J points within D minutes, keeps ≥ half for H hours. */
  jump: { size: 0.1, withinMinutes: 60, persistHours: 2, persistFraction: 0.5, selfImpactShare: 0.2 },
  /** Pre-jump window W, hours. */
  preJumpHours: 6,
  /** Test 2 null rate clamp. */
  rateClamp: [0.01, 0.99] as const,
  /** Placebo replicates R and price match. */
  placeboRuns: 30,
  placeboMatch: [0.01, 0.02] as const,
  /** Positive control: injected odds multipliers and record sizes. */
  injectedOdds: [2, 4] as const,
  injectedSizes: [5, 10, 20, 50] as const,
  injectedWallets: 200,
  /** Edge profile thresholds (descriptive, fixed in advance). */
  edge: { highVolumeN: 200, highVolumeMaxOdds: 1.5, longshotMaxN: 50, longshotMinOdds: 3, longshotMaxMedianPrice: 0.3 },
  /** Placebo A: above this empirical FDR, BY becomes the primary rule. */
  byFallbackFdr: 0.1,
  /** Market verdict: minimum tested participants, and how many participants to examine. */
  market: { minTestedParticipants: 5, maxParticipants: 500 },
} as const;

/**
 * Parameter change log (Advanced spec: "list any later change with its reason").
 * 2026-11-07 ~15:00 ET — The market verdict moved from the pre-move buying test
 * to the count of flagged wallets among a market's participants, because a
 * market-level timing label could itself move prices. Wallet parameters are the
 * Advanced spec defaults, unchanged. Crypto-price markets were added as the
 * spec's control category.
 */
export const CHANGE_LOG = [
  {
    at: "2026-11-07T20:00:00Z",
    change: "Market verdict now counts flagged wallets among participants (Advanced spec Test 1/Test 2 tiers); pre-move test kept as context.",
    reason: "A market-level timing label could itself move prices; wallet records come from other resolved markets.",
  },
  {
    at: "2026-11-07T20:00:00Z",
    change: "Added crypto-price markets as the control category.",
    reason: "Required by the Advanced spec's negative control.",
  },
];

export type ScoreType = "aggressor-flow" | "price-drift";
export type CategoryId = (typeof SETTINGS.library.categories)[number]["id"];
