import {
  localAiStatus,
  localGenerationSchema,
  parseLocalJson,
  reportSchema,
} from "./report";
import { marketReport } from "./market-analysis";
import type { MarketAudit, MarketBundle } from "./market-types";
import type { Report } from "./domain";
import type { IntegrityReport } from "./integrity/data";
const cache = new Map<string, Report>(),
  pending = new Map<string, Promise<Report>>();
export async function explainMarket(
  bundle: MarketBundle,
  audit: MarketAudit,
  integrity: IntegrityReport | null,
): Promise<Report> {
  const status = await localAiStatus();
  if (!status.available) throw new Error(status.reason);
  const key = `${bundle.market.condition}:${bundle.provenance.fetchedAt}:${status.model}:${integrity?.test.p ?? "none"}`;
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;
  const job = (async () => {
    const baseline = marketReport(bundle, audit, integrity);
    const allowed = new Set([...audit.signals.map((s) => s.id), ...(integrity ? ["I1", "I2", "I3"] : [])]);
    const t = integrity?.test;
    const response = await fetch(
      `${new URL(process.env.OLLAMA_URL || "http://127.0.0.1:11434").origin}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model: status.model,
          stream: false,
          think: false,
          format: localGenerationSchema(),
          options: { temperature: 0.1, num_predict: 1500, num_ctx: 8192 },
          messages: [
            {
              role: "system",
              content:
                "Explain a prediction-market integrity screen using only the supplied qualitative evidence. The verdict counts how many of the market's participating wallets have records elsewhere that are unlikely under market odds, compared with the population rate. Such a record is consistent with skill, speed, or information; it is an anomaly, not an accusation. A typical result is not proof the market was clean. Never use the words insider, cheater, rigged or fair. Do not identify people or infer private information. Never invent news, timestamps or calculations. Numerical facts are shown by the app: do not include digits in prose. Use evidence IDs only in evidenceIds arrays. Give three concise findings, general alternative hypotheses and limitations. Keep title, text and other fields short. Return the requested JSON schema.",
            },
            {
              role: "user",
              content: JSON.stringify({
                headline: baseline.headline,
                evidence: [
                  ...(integrity
                    ? [
                        {
                          id: "I1",
                          observation:
                            integrity.participation.verdict === "not-testable"
                              ? "Too few participants have testable records elsewhere"
                              : integrity.participation.verdict === "elevated"
                                ? "More participants have anomalous records elsewhere than the population rate predicts"
                                : "Participants with anomalous records elsewhere are within the population rate",
                        },
                        {
                          id: "I2",
                          observation:
                            integrity.population.empiricalFdr === null
                              ? "False-flag rate not yet measured"
                              : "A matched-twin placebo measures how often random wallets would be flagged",
                        },
                        {
                          id: "I3",
                          observation:
                            !t || t.verdict === "not-testable"
                              ? "Pre-move timing not testable"
                              : t.verdict === "unusual"
                                ? "Pre-move buying was one-sided compared with earlier windows (context only)"
                                : "Pre-move buying was not unusual compared with earlier windows (context only)",
                        },
                      ]
                    : []),
                  {
                    id: "M1",
                    observation:
                      audit.summary.topFiveShare === null
                        ? "Concentration unavailable"
                        : audit.summary.topFiveShare > 0.5
                          ? "Largest-wallet group accounts for a majority of observed turnover"
                          : "Turnover is distributed beyond the largest-wallet group",
                  },
                  {
                    id: "M2",
                    observation: bundle.tape.coverage.trades
                      ? "Trade endpoint reached its final page"
                      : "Partial trade tape",
                  },
                ],
                limitations: audit.limitations.slice(0, 6),
              }),
            },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error("Local model request failed.");
    const raw = await response.json(),
      output = reportSchema.parse(parseLocalJson(raw.message?.content || "{}"));
    if (
      output.findings.some((f) =>
        f.evidenceIds.some((id) => !allowed.has(id)),
      ) ||
      /insider|cheat|rigged|fair|proven skill|statistically significant/i.test(
        JSON.stringify(output),
      )
    )
      throw new Error(
        "Local explanation contained unsupported claims or references.",
      );
    const result: Report = {
      ...output,
      mode: "ai",
      generatedAt: new Date().toISOString(),
      model: status.model,
      headline: baseline.headline,
      findings: [...baseline.findings, ...output.findings],
      limitations: [
        ...new Set([...baseline.limitations, ...output.limitations]),
      ],
    };
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  })();
  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
