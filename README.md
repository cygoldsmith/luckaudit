# LuckAudit

**Which wallets keep winning in ways luck can't explain, and which markets do they trade in?**

LuckAudit audits Polymarket wallets. A wallet is flagged only when its record on resolved bets is too good to be luck under calibrated market odds, at a 5% false discovery rate. Pick any market, and LuckAudit checks its participating wallets against that population. It then reports whether unusually many of them have anomalous records. Every result comes with a measured false-flag rate.

Built at **HackBU 2026 – NYCAIRR**, track: **Markets & Networks** (transparency and fairness in financial and information systems).

## What it does

1. **Wallet audit.** Every wallet in a 180-day library of resolved markets gets:
   - **Test 1:** an exact Poisson-binomial test of its wins against calibrated odds.
   - **Test 2:** a timing test of how often it entered just before price jumps.
   - **Robustness:** a leave-one-event-out check and a tier (strong anomaly, anomaly, or weak).
2. **Market verdict.** A market's top wallets by volume are looked up in that population. Each flagged wallet is re-tested without this market, so no wallet is flagged because of the market being checked. The count of flagged wallets is then compared with the population rate.
   - **Elevated participation by anomalous wallets**, or
   - **Typical participation**, or
   - **Not enough testable wallets**.
3. **Several markets at once.** Benjamini–Hochberg across the markets stops extra searches from creating false alarms.

Paste a polymarket.com link or condition ID into the search bar. A polymarket.us link (the separate US exchange, whose trades are not public) is matched to the same event on the main exchange.

## Responsible AI and fair use

The event's theme is AI responsibility. These rules are built into the tool:

- **An anomaly, not an accusation.** The words "insider," "cheater," "rigged" and "fair" never appear as labels. "Nothing unusual" is not proof a market was clean.
- **Verdicts from wallets, not prices.** A market is never labeled from its own price moves; the verdict counts participants whose records elsewhere are anomalous.
- **Measured error rates.** A matched-twin placebo measures how often random wallets would be flagged; it is shown next to every verdict, with a positive control showing what the audit misses.
- **Parameters fixed in advance.** The wallet method's parameters in `src/lib/integrity/settings.ts` are the Advanced spec's defaults (written Nov 6), unchanged. Every later change is listed in `CHANGE_LOG` with its reason.
- **Records from resolved markets only.** Wallet records use only resolved bets; a market's own trades never flag a wallet.
- **Privacy.** Wallets are shown as shortened addresses, with no attempt to link them to people.
- **Local AI only.** Optional plain-English explanations run on a local model through Ollama. No data is sent to an outside AI service, and the AI can only cite evidence the statistics computed.

## How it works

| Step | What happens |
| --- | --- |
| Positions | Net shares held at the scheduled end, cost $10+, first-buy entry price 2¢–95¢, one bet per wallet per event (neg-risk Yes legs merged) |
| Null odds | q = max(entry price, calibrated win rate), from an isotonic fit of realized win rates |
| Test 1 | Exact Poisson-binomial p for observed wins; Tarone pre-filter; Benjamini–Hochberg at 5%; BY-robust badge |
| Test 2 | First entries within 6 h before favorable +10-point jumps, against other wallets' entry rate |
| Robustness | Leave-one-event-out; tiers; edge profile (high-volume vs concentrated longshot) |
| Market verdict | Flagged tested participants vs population rate, exact binomial; BH across markets |
| Validation | Matched-twin placebo (empirical FDR), simulated outcomes, injected wallets (power), crypto control, timing placebo |

Full method: [docs/methodology.md](docs/methodology.md). Pre-move timing context: [docs/market-integrity-method.md](docs/market-integrity-method.md).

## Tech

Next.js 16, React 19 and TypeScript; public Polymarket APIs (Gamma and Data API v2), with no API keys; exact statistics written from scratch (Poisson-binomial, Benjamini–Hochberg, permutation-style p-values); optional local AI through Ollama (Gemma).

## Run it

Requires Node 22 or later.

```sh
npm install
npm run dev -- --port 3000
```

Open http://localhost:3000. Open any market and select its **Integrity test** tab, or go to **Integrity search** to search several markets and see the validation panel.

Build the reference library while the dev server is running. It takes a few hours, and you can stop and restart it at any time.

```sh
npm run library -- --discover
```

Optional local AI: install [Ollama](https://ollama.com) with a model. Settings live in `.env.local` (see `.env.example`).

Tests: `npm test` and `npm run typecheck`.

## Limits

- A flagged record means wins unlikely under market odds. Skill, research, or reading public news faster produce the same pattern.
- One-shot insiders are invisible: a fresh wallet with one informed bet has no record to test.
- One person using many wallets looks like many small, unremarkable records.
- Only positions held to resolution are scored; early exits are only partly covered by the timing test.
- Results apply only to the library this tool built.
