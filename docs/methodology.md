# Wallet method and market verdict

LuckAudit's verdicts come from wallets. A market is judged by how many of its participants have records elsewhere that are unlikely under market odds. Its own price movements never decide the verdict.

The wallet method is the team's "Luck Auditor — Statistical Method Spec" (the Advanced spec, method ID `luck-auditor-wallet-v1`). Its parameters are in `WALLET_SETTINGS` in [`src/lib/integrity/settings.ts`](../src/lib/integrity/settings.ts), and later changes are listed in `CHANGE_LOG`. The statistics are in [`src/lib/integrity/wallet-spec.ts`](../src/lib/integrity/wallet-spec.ts).

## Population (the reference library)

Resolved markets from the last 180 days with at least $10k volume:
- **Study categories:** politics and world events, awards, and company or government announcements.
- **Control category:** crypto-price markets.

For each market the full trade tape is pulled once, so every wallet is collected in one pass.

## Steps

1. **Positions.** For each wallet × market × token: net shares = bought − sold, using trades before the scheduled end. A position is kept if net shares > 0 and cost is at least $10. Wallets holding both tokens are dropped. The entry price p is the **first buy price** and must be within 2¢–95¢.
2. **Event collapse.** One bet per wallet per event:
   - **Neg-risk Yes positions** merge into one bet that wins if any leg wins. Its null probability is the sum of the entry prices, and the bet is dropped above 0.95.
   - **Otherwise,** the largest-cost position is kept.
3. **Calibration.**
   - Bins: 0.02–0.05, then 5¢ bins up to 0.95.
   - Each market × token counts once per bin. The fit is an isotonic regression weighted by markets per bin.
   - Bins with fewer than 30 markets fall back to c(p) = p.
   - Each bet's null probability is q = max(p, c(p)).
4. **Test 1 (record).** Observed wins O against expected wins E = Σq, with an exact Poisson-binomial p = P(S ≥ O) and an odds multiplier e^θ̂.
   - **Pre-filter (Tarone):** drop wallets whose win-every-bet chance Πq exceeds α/m, and repeat until m is stable.
   - **Correction:** Benjamini–Hochberg at 5%. Wallets that also pass Benjamini–Yekutieli get a BY-robust badge.
5. **Test 2 (timing).** z = 1 if the wallet's first entry fell within 6 hours before a favorable jump: +10 points within 60 minutes, keeping half the rise for 2 hours, and the wallet made under 20% of the volume during the rise. r is the share of other wallets' first entries in the same token that fell in those windows, clamped to [0.01, 0.99]. Test 2 uses its own pre-filter and BH. It is never combined with Test 1.
6. **Leave-one-event-out (LOEO).** Remove the flagged wallet's most influential win (the smallest q) and re-test. It passes if p is still at or below the main run's BH bar k·α/m.
7. **Tiers:**
   - **Strong anomaly:** Test 1 + Test 2 + LOEO.
   - **Anomaly:** Test 1 + LOEO.
   - **Weak:** anything else flagged.
8. **Edge profile.** A descriptive label:
   - **High-volume:** n ≥ 200 and odds under ×1.5.
   - **Concentrated longshot:** n < 50, odds of ×3 or more, and median entry price under 0.30.
   - **Mixed:** everything else.

## Market verdict

1. Take the market's participants. For a resolved or pasted market, the top 500 wallets by trading volume. For an open market in a category search, its current top holders (up to 100 per side), valued at today's price.
2. Look up each participant in the population. A participant counts as **flagged** if it is tier 1 or 2 **and** its Test 1 p, re-computed **without this market's event**, still clears the main run's bar. No wallet is flagged because of this market itself.
3. With T tested participants and F flagged, the base rate π is the flagged share of tested participations in **other library markets of the same category** (this market left out). If that category has fewer than 50 tested participations, the population rate is used instead. The p-value is the exact binomial P(X ≥ F), with X ~ Binomial(T, π). Category rates differ widely (crypto price markets about 7%, politics about 1.6%), so a pooled rate would mark whole categories as elevated; see `CHANGE_LOG`.
4. Verdicts:
   - **Elevated participation by anomalous wallets:** p ≤ 0.05.
   - **Typical participation:** otherwise.
   - **Not enough testable wallets:** T < 5.
5. In Compare markets, the market p-values are corrected together with Benjamini–Hochberg. A single market's verdict also shows a category check: its p corrected together with every library market in its category.

Open markets can be checked, because participants' records come from other, resolved markets. Compare markets offers an Open option (the 20 most-traded live markets in a category) and a Closed option (library markets, optionally filtered by resolution date). The Market Integrity Search pre-move buying test is still shown as context for resolved markets, but it never sets the verdict.

## Validation

Shown on the Method page under **Show the advanced statistics**:
- **Placebo A.** Matched synthetic twins, built from borrowed positions in the same category group within ±1¢ (±2¢ fallback), from other wallets and other events, over 30 runs. The empirical FDR is the mean twin flags divided by the real flags. Above 10%, BY becomes the primary rule.
- **Placebo B.** Outcomes redrawn from Bernoulli(q). The mid-p histogram should be flat.
- **Positive control.** 200 injected wallets copying real price profiles (n = 5, 10, 20, 50; odds ×2 and ×4). Shows the recall per cell.
- **Negative control.** Flags per 1,000 tested wallets in the crypto control versus the study categories, with a Fisher exact test.
- **Timing placebo.** Each first entry is replaced by a random other wallet's, which is equivalent to z ~ Bernoulli(r).

## Interpretation choices

- **LOEO and per-market bar.** The spec says to compare against "the BH cutoff from the main run, p_(k)". This uses the BH rejection bar k·α/m that p_(k) must clear. Comparing against the flagged p-value itself would make any sole flagged wallet fail LOEO by construction.
- **Truncated tapes.** Markets whose all-sides tape hits the retrieval limit contribute timing counts but no positions, because their net holdings would be wrong.
- **Wallet page own-history test.** When a wallet isn't in the library, the wallet page applies the same position rules to its own retrieved history, judged as a single test at 0.05.

## What it cannot see

- A one-shot insider with no record.
- One person using many wallets.
- Positions sold before resolution (only partly covered by Test 2).
- Reacting to public news faster than others.

Every card and verdict carries the disclaimer: *Statistical anomaly under market odds. Consistent with skill, speed, or information. Not an accusation.*
