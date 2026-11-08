# Market Integrity Search — implementation notes

Method ID: `market-integrity-search-v1`. This implements the team's “Market Integrity Search — Method” document. The nine settings live in [`src/lib/integrity/settings.ts`](../src/lib/integrity/settings.ts) and should be committed before running on real markets.

## Hour-1 data check (setting #5)

Checked on 2026-11-07 against the resolved Warsh Fed-chair market:

- `GET /v2/trades?condition=…` with `taker_only=true` (the API default) serves **each fill once, on its taker side**. Every transaction hash appeared exactly once in a 1,000-row page.
- `taker_only=false` adds one maker row per counterparty (the original LuckAudit tape).
- The taker row identifies the aggressor, so the score is **aggressor flow**. Price drift is implemented as the fallback but not selected.

This decision depends on the data format only, not on any result.

## Where each step lives

| Method step | Code |
| --- | --- |
| Hourly prices (last trade, carried forward) | `buildHourly` in `src/lib/integrity/core.ts` |
| Big move (≥10 pts, half kept 2 h later or resolves that way, ≤25% single wallet) | `findBigMove` |
| Windows, cushion, score, p = (1+k)/(1+n) | `windowFlows`, `scoreAtHour`, `marketTest` |
| Wallet bets table (net held, ≥$10, 3–50¢, no both-sides, largest per event) | `marketBets`, `walletRecord` |
| Price-bucket check, fair chance = max(price, bucket rate) | `calibrate`, `fairChance` |
| Wallet list (top 20 net $ behind favored side, ≥$100) | `listWallets`, `netBehind` |
| Pre-filter (∏ fair > 0.05/m), BH, fragility | `walletCheck` |
| Percentile vs. library, same category and score type | `percentile`, `integrityReport` |
| Multi-market: iterative 20×M pre-filter, BH, q-values, one wallet group | `multiMarket`, `multiReport` |
| Excess rate with 95% margin | `excessRate` |
| Placebo 1 (random time), Placebo 2 (fake wallets), planted buying | `randomTimePlacebo`, `fakeWalletPlacebo`, `plantedBuying` |

`tests/integrity.test.ts` checks the document's worked examples: score 0.67, p = 4/710, wallet p = 0.000019 with 1.87 expected wins, the fragility p ≈ 0.00016, and Example 2's BH table, including k = 3, the q-values and the 14 → 10 pre-filter.

## Interpretation choices the document leaves open

- **Move timing.** The move hour h is the clock hour whose closing Yes price differs from hour h−1 by at least 10 points. The move starts at the beginning of hour h, the pre-move window covers hours h−6 to h−1, and comparison windows start at every hour s ≤ h−12. That gives n = h−11 windows, matching Example 1's 709.
- **Single-wallet share.** This uses taker dollars in the move hour, since each fill is counted once.
- **Calibration.** Bets in the same market and bucket are averaged into one observation per market.
- **Fragility.** The flag survives if the p-value without the lowest-fair-chance win still clears the BH threshold that flagged it, k·α/m.
- **Fake-wallet twins.** Each bet is replaced by a random library bet from a different wallet and event priced within 1¢. The twin keeps that replacement bet's result.
- **Truncated tapes.** Retrieval keeps the newest fills (150 pages per feed). A truncated taker tape drops its first partial hour. A truncated all-sides tape contributes no library bets, because net holdings would be wrong. If it doesn't reach the pre-move window, wallets are listed by taker flow and the report says so.
- **Library volume floor.** Library markets need at least $10,000 of lifetime Gamma volume, because most smaller markets are untraded placeholders that can never be tested. The floor applies to the library: wallet records, bucket calibration, percentiles, placebos and category searches. Pasted markets of any size are still tested, but a market below the floor gets no percentile, because it has no comparable set. Volume doesn't look at outcomes, but lifetime volume includes trading after the news, so markets with big moves are slightly more likely to clear the floor. That affects which markets are in the library, not the validity of the p-value within any one market.
- **Library sample.** Every resolved market in the setting-#1 tag slugs from the last 180 days is discovered in 15-day slices, because Gamma rejects offsets above about 2,000. Every eligible market is included (up to 5,000), in a fixed-seed shuffled order with equal shares per category and no use of outcomes. The cap was 400 until the first build showed most markets are not testable; raising it changes only the library size, not any of the nine settings.

## Caveats carried over from the statistical review

These are the method's own assumptions, not bugs. They should be stated in the demo.

- The wallet pre-filter (drop if ∏ fair > 0.05/m) loses power relative to plain BH. It does not inflate the false discovery rate.
- BH assumes valid, at most positively dependent p-values. Related markets in one category can share news, and the random-time placebo is the empirical check on this.
- Library calibration and wallet records reuse the same resolved bets. Excluding the searched event limits but does not remove that overlap.

## Running it

```sh
npm run dev -- --port 3000
npm run library -- --discover   # discover candidates, then build until done (resumable)
```

Pages: a market's **Integrity test** tab (single search) and `/integrity` (multi-market search, method check, the nine settings). APIs: `GET /api/integrity/:condition`, `POST /api/integrity/multi`, `GET|POST /api/integrity/library`, `GET /api/integrity/method-check`.
