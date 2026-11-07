import assert from "node:assert/strict";
import test from "node:test";
import { humanNumber, oddsPhrase } from "../src/lib/plain-report";

test("odds read as everyday language", () => {
  assert.equal(oddsPhrase(0.024), "about 2 in 100");
  assert.equal(oddsPhrase(0.36), "about 4 in 10");
  assert.equal(oddsPhrase(0.000019), "roughly 1 in 53 thousand");
  assert.equal(oddsPhrase(2.3e-10), "roughly 1 in 4.3 billion");
  assert.equal(oddsPhrase(0.8), "more often than not");
  assert.equal(humanNumber(180), "180");
  assert.equal(humanNumber(4_347_826_087), "4.3 billion");
});
