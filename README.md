# LuckAudit

**Is that Polymarket trader lucky, or too lucky?**

Anyone who only bets on favorites wins most of the time, so a high win rate on its own proves nothing. LuckAudit asks a fairer question: given the odds a trader paid, how likely is it that they won this often by chance? It then uses those answers to show which markets drew an unusual number of traders with records luck can't explain.

Built at **HackBU 2026 – NYCAIRR** for the **Markets & Networks** track.

## What you can do

- **Look up a wallet.** Paste a wallet address, @username or Polymarket profile link and see whether its record is unusually good for the odds it took.
- **Check a market.** Open any market, live or finished, and see whether unusually many of its traders have records that are hard to explain by luck.
- **Compare markets.** Check a list of markets, or a whole category of open or closed markets, at once.
- **See how it works.** The Method page explains the approach in plain English, how often it's wrong, and what it can't catch.

## How it works, briefly

1. We collected every trade from 5,000 finished Polymarket markets over the last six months.
2. For each trader, we compare how often their bets won with how often they *should* have won at the prices they paid. Cheap bets that keep winning are what stand out.
3. A trader is flagged only when their record is very unlikely to be luck, even after accounting for the thousands of traders we checked.
4. A market is judged by how many of its traders are flagged, compared with what's normal for that type of market. A market's own price movements never decide the result.

We also tested the tool on thousands of fake traders built from random real bets. It flagged none of them.

## What a flag means

A flag means a record is unlikely under the market's odds. That can come from skill, fast reactions to public news, automated trading, or inside information, and the tool can't tell which. **It is never an accusation.** Traders are shown only by shortened wallet address.

## Limits

- A trader with only a few bets can't be judged, so a one-time insider using a new wallet won't show up.
- One person using many wallets looks like many ordinary traders.
- Results describe the markets in our library: finished Polymarket markets with at least $10,000 traded over the past six months.

