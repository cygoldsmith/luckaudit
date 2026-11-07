import { auditWallet } from "./analysis";
import { getWallet } from "./polymarket";
import { benjaminiHochberg } from "./integrity/core";
import { libraryQ } from "./integrity/data";
import { SETTINGS } from "./integrity/settings";
import type { MarketAudit, ParticipantAudit } from "./market-types";

/**
 * Record tests for the largest participants, corrected as one group: the
 * wallets scanned together are one family (pre-filter at α/m, then BH).
 */
export async function scanParticipants(
  audit: MarketAudit,
  count = 3,
): Promise<ParticipantAudit[]> {
  const qOf = await libraryQ(),
    selected = audit.participants.slice(0, count),
    results: ParticipantAudit[] = new Array(selected.length);
  let next = 0;
  async function worker() {
    while (next < selected.length) {
      const index = next++,
        participant = selected[index];
      try {
        const bundle = await getWallet(participant.address);
        const r = auditWallet(bundle, qOf).record;
        results[index] = {
          address: participant.address,
          label: r.label,
          observations: r.observations,
          wins: r.wins,
          expected: r.expected,
          luckRatio: r.luckRatio,
          p: r.p,
          allWinChance: r.allWinChance,
          q: null,
          reason: r.reasons.join(" "),
          provenance: bundle.provenance,
        };
      } catch (e) {
        results[index] = {
          address: participant.address,
          label: "unavailable",
          observations: 0,
          wins: 0,
          expected: 0,
          luckRatio: null,
          p: null,
          allWinChance: null,
          q: null,
          reason: e instanceof Error ? e.message : "Wallet history unavailable.",
        };
      }
    }
  }
  await Promise.all([worker(), worker()]);
  correctGroup(results);
  return results;
}

/** Wallets tested together are one family: pre-filter at α/m, then BH at α. */
export function correctGroup(results: ParticipantAudit[]) {
  const alpha = SETTINGS.alpha,
    eligible = results.filter(
      (r) => r.p !== null && r.observations >= SETTINGS.walletRecord.minBets && r.label !== "incomplete-history",
    ),
    bar = eligible.length ? alpha / eligible.length : alpha;
  const tested = eligible.filter((r) => {
    if ((r.allWinChance ?? 1) > bar + 1e-15) {
      r.label = "record-too-short";
      r.reason = `Record too short for a group of ${eligible.length}: winning every bet by luck exceeds ${bar.toPrecision(2)}.`;
      return false;
    }
    return true;
  });
  if (tested.length) {
    const bh = benjaminiHochberg(tested.map((r) => r.p!), alpha);
    tested.forEach((r, i) => {
      r.q = bh.q[i];
      r.label = bh.rejected[i] ? "unusual-record" : "nothing-unusual";
    });
  }
  return results;
}
