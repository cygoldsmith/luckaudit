# LuckAudit

A market-first Polymarket investigation tool built with Next.js, TypeScript, statistical analysis, and **local Ollama AI**. No Polymarket key or external AI key is required.

## Run

```sh
npm install
npm run dev -- --port 3001
```

Open http://localhost:3001. Port 3000 is currently occupied by another local project; any available port works. For a production Node server:

```sh
npm run build
npm start -- --port 3001
```

Use Node 22 or later. This app now has server API routes and is **not a static export**.

## Local AI

Keep Ollama running. LuckAudit discovers an installed model, preferring Gemma 4. On this machine it detected `gemma4:e4b-it-qat`.

Optional `.env.local` settings (copy `.env.example`):

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e4b-it-qat
```

Only local loopback Ollama URLs are accepted. No prompt or evidence is sent to an external AI provider. Polymarket data is still fetched from Polymarket's public service. A local report may take a minute or more depending on hardware. Reports use schema-constrained JSON, validate cited evidence IDs, and preserve server-computed conclusions. If Ollama is unavailable or generation fails, the deterministic statistical report remains usable.

Check local model status at `/api/status`.

## Market integrity search

Paste a resolved market (or search several, or a whole library category) to test whether buying in the 6 hours before its big move was unusually one-sided toward the side that then won. Each report has a market p-value, a wallet check on the top 20 pre-move buyers (exact Poisson-binomial, BH-corrected), and a percentile against a 180-day reference library. Multi-market searches apply Benjamini–Hochberg across markets. Placebo tests measure the false-alarm rate.

- Nine prespecified settings: `src/lib/integrity/settings.ts`
- Method and implementation notes: [docs/market-integrity-method.md](docs/market-integrity-method.md)
- Build the reference library (with the dev server running): `npm run library -- --discover`

## Main flow

1. Search the Market Explorer by title, topic, Polymarket URL, or condition ID. Browse active or resolved binary markets.
2. Open a market to inspect observed prices, large fills, participant concentration, persistent price rises, and entries preceding those rises.
3. Scan the historical records of up to five leading participants, or open any participant's wallet investigation.
4. Use the wallet's **Primary markets** tab to see where its loaded activity is concentrated. Other wallet tabs show trades, qualifying bets, and the exact wallet record test.
5. Generate a local AI explanation with references to computed evidence. Download market investigations as JSON or wallet fills as CSV.
6. Open **Validation** to run reproducible exact-test benchmarks and inspect known-label false discovery and power results. These synthetic results are not a measured false discovery rate for real wallets.

The leaderboard at `/leaderboard` remains available for trader discovery, watchlists, recent investigations, and comparison.

Search applies to the currently loaded leaderboard; **Load more traders** follows Polymarket's opaque cursor. Watchlist and recent-history storage keeps trader identities, not financial values that could be confused with another period.

## Real data and saved cases

The app uses real public records: Gamma provides market discovery and metadata; the [Polymarket Data API v2](https://data-api.polymarket.com/v2/docs) supplies leaderboard, trades, activity, positions, resolutions, profile statistics, and P&L history. Market turnover sums retrieved wallet-side fills and must not be interpreted as exchange-wide volume.

Every response carries a retrieval timestamp and an origin (`live`, `cache`, or `snapshot`). If a live request fails, an available saved response can be shown with an explicit snapshot notice. If no saved data exists, the app shows an error rather than substituting fictional results.

A recorded Federal Reserve market is linked beneath market search. Two real-wallet cases are linked below the leaderboard totals:

- A resolved-position case with complete retrieved histories and 19 eligible event observations in the bundled recording.
- A large-wallet case that demonstrates bounded retrieval and an explicitly withheld assessment.

Compressed, public-data recordings live in `src/data/snapshots/`. They were retrieved on November 7, 2026 UTC. Runtime cache files are stored in the ignored `.luckaudit-cache/` directory. To update bundled recordings from the running app:

```sh
npm run snapshots
```

The recorder refreshes market browsing, the recorded Fed market, the monthly leaderboard, and two selected wallet histories, preserving retrieval provenance. Set `LUCKAUDIT_URL` to override its local port. It does not generate or edit trading records.

## Statistical method

See [docs/methodology.md](docs/methodology.md) for assumptions, formulas, eligibility, and limitations.

See [docs/market-integrity-method.md](docs/market-integrity-method.md) for the market test, library and placebos, and [docs/market-audit-method.md](docs/market-audit-method.md) for the descriptive market views. An earlier cohort spec is reviewed in [docs/statistical-spec-review.md](docs/statistical-spec-review.md). The tool screens for anomalies; it cannot establish fairness, information misuse, or an absence of manipulation.

Important distinctions:

- Leaderboard `volume` is **shares, not USD**. Finite-window P&L includes marked changes; lifetime P&L is realized. The app retains those definitions.
- Profitable closed positions are not the same as correct predictions. Closed positions may include early exits.
- The wallet record test counts resolved binary bets still held at resolution, costing at least $10 at 3¢–50¢, one per event (the largest), with an exact Poisson-binomial p-value. One wallet is judged at 0.05; groups use the pre-filter and Benjamini–Hochberg.
- Bet P&L in the record is held shares × payout − cost; API P&L is displayed separately.
- One bet per event is kept, the largest by cost, without considering whether it won.
- Tail frequencies are **exploratory, conditional, and not selection-adjusted**. Leaderboard selection and residual dependence prevent a platform-wide significance claim.
- No result determines that a trader is an insider, or establishes skill rather than luck.

## Retrieval limits

To keep a single investigation bounded: at most 10,000 fills, 10,000 activity records, 3,000 closed positions, 2,000 other positions, and 240 resolution markets are fetched. Pagination failures, missing data, and limits are reported. A missing numeric value remains unavailable, never zero. API requests time out and retry transient failures once. Missing AI configuration does not block statistical analysis.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

The tests cover the integrity method's worked examples, the wallet bet rules and record test, real-wallet recordings, market normalization, concentration, timing coverage, self-impact exclusions, exact Poisson-binomial tails, BH/BY corrections, reproducible synthetic validation, local AI contracts, and exports.

## Structure

- `src/app/page.tsx` — market search and browsing
- `src/app/leaderboard/page.tsx` — leaderboard, watchlist, history, comparison, and wallet entry
- `src/components/market-investigation.tsx` — market activity, timing, participants, and local AI report
- `src/components/wallet-primary-markets.tsx` — wallet activity by market
- `src/app/validation/page.tsx` — synthetic validation results and unmeasured real-world checks
- `src/components/wallet-investigation.tsx` — investigation dashboard
- `src/components/audit-charts.tsx` — P&L and exact win-distribution charts
- `src/app/api/` — validated server endpoints
- `src/lib/polymarket.ts` — ingestion, cursor pagination, cache, and saved snapshots
- `src/lib/analysis.ts` — wallet bet rules and exact record test
- `src/lib/integrity/` — market integrity method: settings, statistics, library and reports
- `src/lib/report.ts` — statistical reports and local Ollama explanations
- `src/lib/market-data.ts` — Gamma discovery and market ingestion cache
- `src/lib/market-analysis.ts` — descriptive market signals
- `src/lib/statistical-core.ts`, `src/lib/validation.ts` — exact-test core and synthetic benchmark
- `tests/` — calculation and local AI contract tests

This is a local Node application. The retained Sites project identifier is not a published deployment; deploying the server routes to another platform requires an appropriate Node host or runtime adapter.
