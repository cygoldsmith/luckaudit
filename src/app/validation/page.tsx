"use client";
import { useEffect, useState } from "react";
import {
  Check,
  Download,
  FlaskConical,
  Info,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import AppFrame from "@/components/app-frame";
import { download, requestJson } from "@/lib/client";
import { dateTime } from "@/lib/domain";
import type { ValidationResult } from "@/lib/validation";
export default function ValidationPage() {
  const [result, setResult] = useState<ValidationResult | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    requestJson<ValidationResult>(
      `/api/validation?refresh=${refresh ? 1 : 0}`,
      { signal: c.signal },
    )
      .then((data) => {
        if (!c.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [refresh]);
  return (
    <AppFrame active="validation">
      <main>
        <div className="page-heading">
          <div>
            <h1>Validation & reliability</h1>
            <p>
              Inspect what has been checked, what the benchmarks measure, and
              what remains unvalidated.
            </p>
          </div>
          <div className="heading-actions">
            <button
              className="outline-button"
              disabled={!result}
              onClick={() =>
                download(
                  "luckaudit-synthetic-validation.json",
                  JSON.stringify(result, null, 2),
                  "application/json",
                )
              }
            >
              <Download size={14} />
              Export results
            </button>
            <button
              className="primary-button"
              disabled={loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              {loading ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              Run benchmark
            </button>
          </div>
        </div>
        <div className="inline-notice warning">
          <Info size={16} />
          <span>
            <strong>Real-world false discovery rate: not measured.</strong> The
            current market signals and wallet-history detector are exploratory.
            This page does not certify that five percent or fewer real-wallet
            flags are false.
          </span>
        </div>
        {loading ? (
          <div className="loading-state" role="status">
            <FlaskConical className="spin" size={23} />
            Running the reproducible synthetic benchmark…
          </div>
        ) : error ? (
          <div className="empty-state" role="alert">
            <h2>Benchmark unavailable</h2>
            <p>{error}</p>
            <button
              className="outline-button"
              onClick={() => setRefresh((v) => v + 1)}
            >
              Retry
            </button>
          </div>
        ) : result ? (
          <>
            <div className="source-bar">
              <span className="source-pill">
                <span className="tiny-dot" />
                Synthetic benchmark
              </span>
              <span>Computed {dateTime(result.generatedAt)}</span>
              <span className="source-actions">
                Fixed seed {result.parameters.seed}
              </span>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Scope of these results</h2>
                  <p>{result.scope}</p>
                </div>
              </div>
              <div className="validation-parameters">
                <span>
                  Replicates<strong>{result.parameters.replicates}</strong>
                </span>
                <span>
                  Null wallets / replicate
                  <strong>{result.parameters.nullWallets}</strong>
                </span>
                <span>
                  Injections / power cell
                  <strong>{result.parameters.injectedPerCell}</strong>
                </span>
                <span>
                  BH target under this model
                  <strong>{(result.parameters.alpha * 100).toFixed(0)}%</strong>
                </span>
              </div>
            </section>
            <div className="validation-check-grid">
              {result.checks.map((check) => (
                <article className="panel" key={check.name}>
                  <div
                    className={`assessment-badge ${check.passed ? "within-baseline" : "insufficient"}`}
                  >
                    <Check size={14} />
                    {check.passed ? "Verified" : "Failed"}
                  </div>
                  <h2>{check.name}</h2>
                  <p>{check.detail}</p>
                </article>
              ))}
            </div>
            <section className="audit-stats validation-stats">
              <div className="metric">
                <span>All-null runs with any rejection</span>
                <strong>
                  {result.allNull.replicatesWithFlags} /{" "}
                  {result.parameters.replicates}
                </strong>
                <small>
                  Under an all-null model, FDR equals this event probability.
                </small>
              </div>
              <div className="metric">
                <span>Known-label mixture mean FDP</span>
                <strong>{(result.mixture.meanFdp * 100).toFixed(2)}%</strong>
                <small>
                  Standard error{" "}
                  {(result.mixture.standardError * 100).toFixed(2)} points ·{" "}
                  {result.mixture.prefiltered.toFixed(0)} wallets/run dropped by the pre-filter
                </small>
              </div>
              <div className="metric">
                <span>All-null rejection probability</span>
                <strong>{(result.allNull.rate * 100).toFixed(1)}%</strong>
                <small>
                  Wilson interval{" "}
                  {(result.allNull.interval[0] * 100).toFixed(1)}–
                  {(result.allNull.interval[1] * 100).toFixed(1)}%; only thirty
                  replicates
                </small>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Power on injected synthetic wallets</h2>
                  <p>
                    All null and injected wallets are tested together. Each cell
                    uses independent synthetic outcomes with a known odds
                    multiplier.
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Positions / wallet</th>
                      <th>Injected odds multiplier</th>
                      <th>Detected / injected</th>
                      <th>Recall</th>
                      <th>Detection share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.power.map((row) => (
                      <tr key={`${row.positions}-${row.oddsRatio}`}>
                        <td>{row.positions}</td>
                        <td>×{row.oddsRatio}</td>
                        <td>
                          {row.detected.toLocaleString()} /{" "}
                          {row.total.toLocaleString()}
                        </td>
                        <td>{(row.recall * 100).toFixed(1)}%</td>
                        <td>
                          <span className="power-track">
                            <i style={{ width: `${row.recall * 100}%` }} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel-footnote">
                These are detection rates for prescribed independent
                probabilities, not measured recall on real traders. Exact
                upper-tail p-values, the method&apos;s pre-filter (win-every-bet
                chance above 0.05 ÷ m) and BH at 5% decide flags.
              </p>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Market pre-move test on synthetic null markets</h2>
                  <p>
                    {result.marketTest.markets} markets with balanced random taker flow; the pre-move window is
                    placed at {result.marketTest.tests.toLocaleString()} random hours. With no early knowledge,
                    about 5% or fewer should reach p ≤ 0.05.
                  </p>
                </div>
              </div>
              <section className="audit-stats validation-stats">
                <div className="metric">
                  <span>Null windows with p ≤ 0.05</span>
                  <strong>{(result.marketTest.nullShare * 100).toFixed(1)}%</strong>
                  <small>Target: 5% or fewer</small>
                </div>
                {result.marketTest.power.map((row) => (
                  <div className="metric" key={row.multiple}>
                    <span>Planted buying {row.multiple}× cushion</span>
                    <strong>{(row.power * 100).toFixed(1)}%</strong>
                    <small>
                      {row.switched} of {row.markets} switch to unusual
                    </small>
                  </div>
                ))}
              </section>
              <p className="panel-footnote">
                Synthetic flows are independent across hours. Real markets can drift toward the eventual winner,
                which is what the random-time placebo on the library measures.
              </p>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Randomized diagnostic p-values</h2>
                  <p>
                    A uniform auxiliary draw resolves discrete mass for this
                    diagnostic only. Mid-p values are not assumed to be
                    uniformly distributed.
                  </p>
                </div>
              </div>
              <div
                className="p-histogram"
                role="img"
                aria-label="Ten bins of randomized p-values from synthetic null outcomes"
              >
                {result.allNull.histogram.map((count, i) => (
                  <div key={i}>
                    <span>{count.toLocaleString()}</span>
                    <i
                      style={{
                        height: `${Math.max(2, (count / Math.max(...result.allNull.histogram)) * 120)}px`,
                      }}
                    />
                    <small>
                      {(i / 10).toFixed(1)}–{((i + 1) / 10).toFixed(1)}
                    </small>
                  </div>
                ))}
              </div>
              <p className="panel-footnote">
                This checks the known synthetic null; it cannot validate whether
                market entry prices are calibrated probabilities.
              </p>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Real-market checks</h2>
                  <p>
                    These run on the reference library, not on synthetic data.
                  </p>
                </div>
              </div>
              <div className="validation-pending">
                {result.notRun.map((item) => (
                  <div key={item}>
                    <span className="audit-status">Library</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className="inline-notice">
                <Info size={15} />
                The nine settings were fixed before any real-market run. Measured
                false-alarm rates appear on the{" "}
                <a href="/integrity">Integrity search method check</a> once the
                library is built.
              </div>
            </section>
          </>
        ) : null}
        <footer className="page-footer">
          <span>
            Transparent assumptions · Reproducible calculations · Explicit
            validation scope
          </span>
        </footer>
      </main>
    </AppFrame>
  );
}
