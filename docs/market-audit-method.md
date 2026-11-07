# Market page: descriptive activity and the integrity test

The market page has one test and several descriptive views.

## The test: Integrity test tab

Whether buying in the 6 hours before a resolved market's big move was unusually one-sided toward the favored side is answered only by the market integrity test. It uses the prespecified settings in `src/lib/integrity/settings.ts`, aggressor-flow scores, an empirical p-value against every earlier 6-hour window, and a measured false-alarm rate. See [market-integrity-method.md](market-integrity-method.md). Live markets are never labeled.

The earlier screen has been removed. It flagged any 10-point rise within 60 minutes that held for two observed hours, and it listed first purchases in the prior six hours. Its rules differed from setting #2 and it produced no p-value, so the two could disagree.

## Descriptive views (no verdicts)

- **Concentration (M1).** Share of observed wallet-side turnover held by the five largest wallets, plus HHI. The tape includes maker and taker rows, so turnover is not exchange volume.
- **Coverage (M2).** Whether the trade endpoint reached its last page.
- **Timeline, large trades, participants.** Fetched records only, with no inferred prices.

## Participant scan

The scan tests the records of up to five of the largest participants **together**. It applies the method's pre-filter (0.05 ÷ m) and then Benjamini–Hochberg across the scanned wallets, so scanning five wallets does not give five chances at a false flag. A participant's record comes from other markets; it is not a finding about this market. See [methodology.md](methodology.md).

## Evidence report

The computed report cites integrity evidence (I1 market test, I2 library comparison, I3 wallet check) alongside M1–M2. The local AI explanation receives the same evidence in qualitative form. Any output that cites an unknown evidence ID, or uses the words insider, cheat, rigged or fair, is rejected.

## Validation

`/validation` runs synthetic benchmarks with known labels. These cover:

- the exact wallet test with the pre-filter and BH (false discovery proportion and power);
- the market test on null markets with balanced random flow (share with p ≤ 0.05), and its power under planted buying at 1× and 3× the cushion;
- the method document's worked examples.

Real-market false-alarm rates come from the random-time and fake-wallet placebos on the reference library (`/integrity` → Method check).
