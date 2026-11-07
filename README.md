# LuckAudit

**Was the trading right before the news unusual?**

Pick any resolved Polymarket market. LuckAudit checks whether buying in the 6 hours before the market's big price move was unusually one-sided toward the side that then won. It also checks whether the wallets doing that buying have winning records elsewhere that are hard to explain by luck. Every answer comes with a measured error rate.

Built at **HackBU 2026 – NYCAIRR**, track: **Markets & Networks** (transparency and fairness in financial and information systems).

## What it does

Every market report has three parts:

1. **Market test.** Compares the 6 hours before the big move with every earlier 6-hour window in the same market and gives a p-value.
2. **Wallet check.** For the 20 wallets that backed the winning side hardest before the move, it asks whether each one has a record in other markets that luck alone would rarely produce, using an exact Poisson-binomial test.
3. **Comparison.** Shows how this market ranks against similar markets in a reference library, as a percentile.

Each market gets one of three verdicts: **Unusual pre-move buying**, **Nothing unusual detected**, or **Not testable**.

You can also search **several markets at once**. The tool then applies a Benjamini–Hochberg correction so that extra searches don't create false alarms.

## Responsible AI and fair use

The event's theme is AI responsibility. These rules are built into the tool:

- **An anomaly, not an accusation.** The words "insider," "cheater," "rigged" and "fair" never appear as labels. "Nothing unusual" is not proof a market was clean.
- **Measured error rates.** Two placebo tests, one with fake news times and one with fake wallets, measure how often the tool raises false alarms. That rate is shown next to every verdict.
- **Settings fixed in advance.** The nine method settings in `src/lib/integrity/settings.ts` were written down before running on real markets, so they couldn't be tuned to produce dramatic verdicts. The only later changes were the library's $10k volume floor and its size. Both changed which markets enter the library, never how a market is tested, and both are recorded in the commit history.
- **Resolved markets only.** Live markets are never labeled.
- **Privacy.** Wallets are shown as shortened addresses, with no attempt to link them to people.
- **Local AI only.** Optional plain-English explanations run on a local model through Ollama. No data is sent to an outside AI service, and the AI can only cite evidence the statistics computed.

## How it works

| Step | What happens |
| --- | --- |
| Find the big move | The largest one-hour price change of 10+ points that lasts, and that no single wallet caused (no wallet made more than 25% of that hour's dollars) |
| Score one-sidedness | Aggressive buying of the favored side minus the reverse, cushioned by the market's typical volume |
| Market p-value | (1 + earlier windows scoring at least as high) ÷ (1 + earlier windows) |
| Wallet records | Bets of $10+ at 3¢–50¢ held to resolution, one per event. Fair chance = max(price, how often that price range actually won) |
| Corrections | One market: p ≤ 0.05. Several markets or wallets: Benjamini–Hochberg at 5% |
| Reference library | Resolved markets from the last 180 days with at least $10k volume, in politics and world events, awards, and company or government announcements |

Full method: [docs/market-integrity-method.md](docs/market-integrity-method.md). Wallet test details: [docs/methodology.md](docs/methodology.md).

## Tech

Next.js 16, React 19 and TypeScript; public Polymarket APIs (Gamma and Data API v2), with no API keys; exact statistics written from scratch (Poisson-binomial, Benjamini–Hochberg, permutation-style p-values); optional local AI through Ollama (Gemma).

## Run it

Requires Node 22 or later.

```sh
npm install
npm run dev -- --port 3000
```

Open http://localhost:3000. Open a resolved market and select its **Integrity test** tab, or go to **Integrity search** to search several markets.

Build the reference library while the dev server is running. It takes a few hours, and you can stop and restart it at any time.

```sh
npm run library -- --discover
```

Optional local AI: install [Ollama](https://ollama.com) with a model. Settings live in `.env.local` (see `.env.example`).

Tests: `npm test` and `npm run typecheck`.

## Limits

- "Unusual" means unlikely if nobody knew early. Fast readers of public news, or good forecasters, can produce the same pattern.
- A careful insider who trades small can stay invisible.
- Markets where the information arrived gradually have no sudden move, so they can't be tested.
- One person using many wallets looks like many small traders.
- Results apply only to resolved markets and the library this tool built.
