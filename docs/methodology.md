# Wallet record test

Method ID: `market-integrity-search-v1`. The wallet page, the market page's participant scan and the integrity search's wallet check all use the same record test, the Market Integrity Search wallet check (Part B). It replaces the earlier Monte Carlo P&L baseline (`hold-to-resolution-v1.1`), which has been removed.

## Bets

A bet is a resolved binary market in which the wallet:

- still held shares at resolution: net shares = shares bought − shares sold, counting only trades before resolution;
- held only one outcome (wallets holding both Yes and No are skipped);
- paid at least **$10** for the held shares, at an average buy price of **3¢–50¢**.

If several of a wallet's bets share an event, only the **largest by cost** counts. Resolution must be a verified final binary payout. In the integrity search, records also exclude every event being searched, and they come from the reference library's bets table. On the wallet page they come from the wallet's own retrieved history.

## Fair chance and the exact test

Each bet's fair chance is `max(price, bucket win rate)`. The bucket win rate comes from the library's price-bucket check (3–10¢, 10–20¢, 20–30¢, 30–40¢, 40–50¢), with each market counted at most once per bucket. Before the library is built, fair chance is the price.

- Expected wins = Σ fair chances.
- p-value = exact Poisson-binomial `P(wins ≥ actual)`.
- Luck ratio = actual ÷ expected. It measures the size of the edge, separate from how sure we are.

## Decision rules

| Setting | Bar |
| --- | --- |
| One wallet (wallet page) | Fewer than 5 bets: *too few bets*. Chance of winning every bet > 0.05: *record too short to test*. Otherwise p ≤ 0.05: *unusual record*. |
| A group of m wallets (participant scan, integrity search) | Pre-filter: drop wallets whose win-every-bet chance exceeds 0.05 ÷ m. Then Benjamini–Hochberg at 5% across the rest, with q-values shown. |
| Fragility | For a flagged wallet, remove its most surprising win and retest. If it no longer passes the same bar, it is labeled *depends on one bet*. |

If the fake-wallet placebo measures a false-flag rate above 10%, group checks switch to Bonferroni (0.05 ÷ m).

## What it does not say

- "Unusual" means hard to explain by luck given the prices paid. Skill, research and fast reading of public news produce the same pattern. Labels never say insider, cheater, rigged or fair.
- Opening a wallet from the leaderboard selects for success. A single-wallet p-value is not corrected for that selection or for repeated searches, so test wallets together for a corrected answer.
- Related events can be dependent, and prices are imperfectly calibrated. The fake-wallet placebo on the library measures how often this produces false flags.
- One person can use many wallets. Addresses are shown shortened, with no attempt to link them to people.

See [market-integrity-method.md](market-integrity-method.md) for the market test, the library, and the placebos.
