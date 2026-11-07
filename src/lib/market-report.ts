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
                "Explain a prediction-market integrity screen using only the supplied qualitative evidence. The market test asks whether buying in the six hours before the market's big move was more one-sided toward the eventual favored side than earlier windows. Unusual means unlikely if nobody knew early; it is an anomaly, not an accusation. Nothing unusual is not proof the market was clean. Never use the words insider, cheater, rigged or fair. Do not identify people or infer private information. Never invent news, timestamps or calculations. Numerical facts are shown by the app: do not include digits in prose. Use evidence IDs only in evidenceIds arrays. Give three concise findings, general alternative hypotheses and limitations. Keep title, text and other fields short. Return the requested JSON schema.",
            },
            {
              role: "user",
              content: JSON.stringify({
                headline: baseline.headline,
                evidence: [
                  ...(integrity && t
                    ? [
                        {
                          id: "I1",
                          observation:
                            t.verdict === "not-testable"
                              ? "Market test not testable"
                              : integrity.calibrated === false
                                ? "Market test not calibrated for this category"
                                : t.verdict === "unusual"
                                  ? "Pre-move buying was unusually one-sided at the five percent bar"
                                  : "Pre-move buying was not unusual compared with earlier windows",
                        },
                        {
                          id: "I2",
                          observation:
                            integrity.comparison.percentile === null
                              ? "No library comparison yet"
                              : integrity.comparison.percentile > 0.9
                                ? "More one-sided than most comparable markets"
                                : "Within the usual range of comparable markets",
                        },
                        {
                          id: "I3",
                          observation: integrity.wallets.rows.some((r) => r.label === "unusual-record")
                            ? "Some listed wallets have unusual records in other markets"
                            : "No listed wallet has an unusual record in other markets",
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
