# Review of the supplied statistical method spec

> **Status (2026-11-07):** superseded. The app now implements the team's Market Integrity Search method (`market-integrity-search-v1`, see [market-integrity-method.md](market-integrity-method.md)), and the Monte Carlo baseline mentioned below has been removed. The review is kept because its caveats, especially §3 on the pre-filter and §1 on dependence, still apply to the new method.

Reference: “Luck Auditor — Statistical Method Spec,” attributed by the user to Cyrus Goldsmith, November 6, 2026.

This is a review and implementation gap assessment, not a claim that the new method has been implemented or preregistered. The running application still uses `hold-to-resolution-v1.1`: an exploratory, fixed-history Monte Carlo P&L baseline. It does not yet compute cohort-wide calibrated Poisson-binomial tests, BH/BY adjustments, timing tests, or population validation.

## Verified worked example

For entry probabilities `[.08, .12, .10, .15, .30, .45, .20, .10, .25, .12]` and eight wins, direct dynamic programming gives:

- Expected wins: `1.87`.
- Exact upper-tail probability: `0.000019267416`.
- Fitted common odds multiplier: approximately `22.74535`.
- First-rank BH comparison at alpha 0.05 and m=2,000: `0.000025`.
- Best attainable tail probability: `0.000000011664`.

The supplied numerical example is consistent with these calculations.

## Methodological decisions needed before implementation

### 1. A 5% target is conditional, not an unconditional promise

BH requires valid null p-values and appropriate dependence assumptions. BY addresses arbitrary dependence **between valid p-values**; it cannot repair misspecified per-wallet p-values. One observation per parent event does not establish independence between different events. Repeated sports results, announcements about the same entity, and related political outcomes can remain dependent.

The dashboard should distinguish the selected procedure, nominal target, assumptions, and observed validation diagnostics. It should not describe an unvalidated procedure as guaranteed to limit real-world false discoveries to 5%.

Primary reference: [Benjamini & Yekutieli, 2001](https://www.math.tau.ac.il/~ybenja/depApr27.pdf).

### 2. Calibration needs separation and uncertainty accounting

`max(p, c_hat(p))` is no smaller than either supplied number. It is not necessarily an upper bound on a position's true conditional win probability. The fitted curve is estimated, can be noisy, and reuses outcomes from the population being tested. An event-level held-out or cross-fitted calibration design would reduce leakage, but does not by itself prove validity. Confidence intervals should also respect event clustering.

Deduplicating market-token observations within a bin does not make all observations independent: complementary tokens and related markets may still share outcomes. Record distinct events, distinct markets, and market-token observations separately.

Proposed implementation policy: preserve raw and calibrated probabilities, show support and uncertainty, and label results exploratory unless the full null and error-rate claims have been justified.

### 3. The proposed minimum-attainable-p filter is not equivalent to “could never pass BH”

BH can reject at rank k using `k * alpha / m`, which can be much larger than `alpha / m`. For example, if 100 p-values and their attainable minima are all 0.01, ordinary BH at 0.05 rejects all 100, while the proposed first filtering step drops them all because 0.01 exceeds 0.0005. This counterexample shows a power loss and an incorrect “could never be flagged” description; it does not itself demonstrate FDR inflation.

Outcome-blind filtering is not automatically null-independent, especially when calibration and position selection also depend on outcomes. Use a justified discrete-testing filter or omit the filter in the primary implementation, retaining all wallets that meet the prespecified coverage and position-count criteria. Specify how filtered wallets enter placebo and power denominators.

Primary reference: [Bourgon, Gentleman & Huber, 2010](https://pmc.ncbi.nlm.nih.gov/articles/2906865/).

### 4. Summing neg-risk entry prices requires a common information time

Probabilities of mutually exclusive outcomes can be summed when they refer to the same information set. Different first-entry prices observed at different times need not satisfy that condition. Adaptive selection of the held basket also matters.

Before enabling merged Yes baskets, specify a common reference time and basket selection rule, and define calibration and timing indicators for the composite observation. A simpler initial implementation can restrict scoring to one directional position per event and explicitly report excluded baskets.

### 5. Two separately adjusted families do not establish one 5% guarantee for the displayed tiers

Separate Test 1 and Test 2 BH runs at 0.05 control their respective families only under their assumptions. Their union, including timing-only weak flags, does not automatically inherit a 5% bound. Subsequent LOEO and intersection-based tier selection also needs a separately stated error-rate interpretation.

Options include reporting the families separately, allocating a total error budget across them, or defining a joint family or an appropriate hierarchical procedure before inspecting results. BY badges and LOEO stability should remain explicit, separate fields.

### 6. Placebo A is useful but the proposed ratio is a diagnostic, not directly measured real-wallet FDR

Borrowed real positions are not known null observations. Independent matching can also alter which shocks and events are shared across wallets. Rerunning BH on a synthetic population changes the thresholds relative to a real population containing alternatives.

Report mean placebo flags, their distribution and Monte Carlo uncertainty, match coverage, and the ratio to real flags as a **matched-placebo flag ratio**. If real flags are zero, report that ratio as unavailable, not zero. Do not automatically cap a ratio exceeding one or present it as a posterior probability that an individual flag is false.

Thirty replicates do not imply a fixed one-wallet precision: the uncertainty depends on the variability of the replicate counts. For a directly measurable FDR experiment, use fully specified simulations with known null and injected labels, run the complete procedure, compute the false-discovery proportion within each replicate, and average those proportions. Such experiments still validate only the simulated models.

Preserving event dependence requires a specified joint resampling design, not only a per-position price match. Synthetic wallets must not accidentally receive repeated scored events. Unmatched positions and any resulting sample loss need explicit treatment.

### 7. Placebo B should not require a flat mid-p histogram

Exact discrete p-values are generally super-uniform, not continuously uniform. Mid-p values are not generally uniform either. A randomized diagnostic p-value, `P(S > O) + U * P(S = O)` with independent uniform U, can have the uniform null distribution under a correct simple null. Keep ordinary exact upper-tail p-values for flagging.

In an all-null simulation, FDR equals the probability of any rejection, not the expected number of rejected wallets divided by the number of real-data flags. Record both quantities, but do not confuse them.

Primary reference: [Habiger, 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC4239670/).

### 8. Timing rules need a few explicit definitions

- The supplied lower/upper clamp appears as `[0.0.99]`; it is ambiguous. Do not silently choose a lower bound. Capping a true reference rate of one at 0.99 can make the null less conservative.
- Define canonical jump starts, overlapping-jump suppression, and minimum price-series coverage. A last-trade price can be stale in an illiquid market.
- Compute each wallet's comparison rate using the same wallet-specific self-impact eligibility rule applied to its own timing indicator.
- Define the timing observation for merged baskets before scoring them.
- The empirical comparator rate is estimated, not known; uncertainty and shared-event dependence must be reflected in validation and reporting.

### 9. Crypto-price markets are a comparison group, not a certified insider-free control

Public-news speed, order-flow access, manipulation, and other information differences can matter. A lower or higher flag rate in this category is descriptive evidence about the procedure, not proof of what produced a flag. If the same wallets appear in both category groups, category-rate comparisons also need a defined unit and treatment of overlap.

### 10. Registration and execution history must be truthful

Real-wallet outcomes have already been inspected while developing the current app. A new parameter file or commit cannot retroactively preregister those analyses. A new study can freeze a design for a clearly identified future or unexamined holdout, with development observations excluded where appropriate. Record actual timestamps, commit identifiers, later amendments, and the dataset boundary; never backdate them.

No preregistration commit was made as part of this review.

## Implementation changes relative to the current application

| Area | Current application | Supplied method requires |
| --- | --- | --- |
| Cohort discovery | Live profit/volume leaderboard | Outcome-independent, category/window-defined market cohort |
| Ingestion | Wallet-keyed histories with explicit caps | Per-market full trade tapes and coverage manifests |
| Position scoring | Reconciled purchases; sales excluded | Defined netting, partial-sale cost basis, first-entry odds and event collapse |
| Probability model | Raw weighted entry odds | Supported calibration curve, uncertainty and conservative q |
| Main statistic | Simulated subset P&L | Exact Poisson-binomial win-count tail and odds multiplier |
| Multiplicity | No population-level significance claim | Defined testing family, BH/BY and documented filter policy |
| Timing | Not implemented | Jump rules, comparator rates and a separate timing test |
| Robustness | Event grouping and limitations | LOEO, preregistered tiers and descriptive edge profiles |
| Validation | Deterministic calculation tests and recorded cases | Matched placebos, all-null simulations, injected power, category comparison and timing placebos |
| UI | Trader leaderboard and wallet investigations | Ranked statistical results, wallet cards, calibration and validation panel; market browser as the entry point |

Local Ollama can remain the explanation layer. It must consume final computed study results and validation metrics; it must not invent p-values, q-values, tiers, or an empirical error-rate estimate. Monte Carlo remains useful for validation and visual explanations, but should not substitute for the specified exact Test 1 calculation.
