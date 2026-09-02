/**
 * Pricing/cost regression tests for the API usage ledger.
 *
 * These lock in the *rates* and the *shape of the cost maths*, because both
 * are easy to break silently: a wrong unit (characters vs UTF-8 bytes,
 * seconds vs hours) produces a plausible-looking number that is wrong by
 * orders of magnitude, and a missing rate silently reports $0.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "clyra-usage-pricing-"));
process.env.CLYRA_USAGE_DATA_DIR = root;
delete process.env.CLYRA_USAGE_PRICING_JSON;

const { recordApiUsage, getApiUsageSummary, clearApiUsage } = await import("../lib/api-usage-ledger.mjs");

let assertions = 0;
const near = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} (got ${actual}, want ${expected})`);
  assertions += 1;
};
const check = (value, message) => { assert.ok(value, message); assertions += 1; };

const cost = async (input) => (await recordApiUsage(input)).costUsd;

try {
  await clearApiUsage();

  // ── Token pricing ───────────────────────────────────────────────────
  near(
    await cost({ provider: "anthropic", model: "claude-haiku-4-5", feature: "t", usage: { inputTokens: 1e6, outputTokens: 1e6 } }),
    6, "haiku: $1/M in + $5/M out",
  );
  near(
    await cost({ provider: "anthropic", model: "claude-haiku-4-5", feature: "t", usage: { cachedInputTokens: 1e6 } }),
    0.1, "haiku cached input is 10% of input",
  );
  near(
    await cost({ provider: "anthropic", model: "claude-haiku-4-5", feature: "t", usage: { cacheWriteTokens: 1e6 } }),
    1.25, "haiku cache write is 125% of input",
  );
  near(
    await cost({ provider: "deepseek", model: "deepseek-v4-flash", feature: "t", usage: { inputTokens: 1e6, outputTokens: 1e6 } }),
    0.42, "deepseek flash: 0.14 + 0.28",
  );
  near(
    await cost({ provider: "gemini", model: "gemini-3.1-flash-lite", feature: "t", usage: { inputTokens: 1e6, outputTokens: 1e6 } }),
    1.75, "gemini flash-lite: 0.25 + 1.50",
  );

  // ── Fish Audio: byte-metered TTS ────────────────────────────────────
  near(
    await cost({ provider: "fish-audio", model: "s2-pro", feature: "t", usage: {}, units: { inputUtf8Bytes: 1e6 } }),
    15, "fish TTS: $15 per million UTF-8 bytes",
  );
  // A multi-byte script must cost more than the same number of characters
  // in ASCII — this is the specific bug that pricing by characters causes.
  const japanese = "こんにちは世界";               // 7 chars, 21 UTF-8 bytes
  const ascii = "helloworld!";                     // 11 chars, 11 UTF-8 bytes
  const jpCost = await cost({ provider: "fish-audio", model: "s2-pro", feature: "t", usage: {},
    units: { inputUtf8Bytes: Buffer.byteLength(japanese, "utf8") } });
  const asciiCost = await cost({ provider: "fish-audio", model: "s2-pro", feature: "t", usage: {},
    units: { inputUtf8Bytes: Buffer.byteLength(ascii, "utf8") } });
  check(jpCost > asciiCost, "a shorter multi-byte string still costs more than a longer ASCII one");
  near(jpCost, 21 * 15 / 1e6, "japanese priced on its 21 bytes, not its 7 characters");
  // Falling back to characters when bytes were not measured must not throw.
  near(
    await cost({ provider: "fish-audio", model: "s2-pro", feature: "t", usage: {}, units: { inputCharacters: 100 } }),
    100 * 15 / 1e6, "character fallback prices when bytes are absent",
  );

  // ── Fish Audio: duration-metered ASR ────────────────────────────────
  near(
    await cost({ provider: "fish-audio", model: "transcribe-1", feature: "t", usage: {}, units: { audioSeconds: 3600 } }),
    0.36, "fish ASR: $0.36 per audio hour",
  );
  near(
    await cost({ provider: "fish-audio", model: "transcribe-1", feature: "t", usage: {}, units: { audioSeconds: 0.1 } }),
    (1 / 3600) * 0.36, "sub-second audio bills as a full second",
  );
  near(
    await cost({ provider: "fish-audio", model: "transcribe-1", feature: "t", usage: {}, units: { audioSeconds: 10.2 } }),
    (11 / 3600) * 0.36, "10.2s rounds up to 11s",
  );

  // ── Per-request pricing ─────────────────────────────────────────────
  near(
    await cost({ provider: "fish-audio", model: "voice-design-1", feature: "t", usage: {}, units: { requests: 3 } }),
    0.03, "voice design: $0.01 per request",
  );
  near(
    await cost({ provider: "fish-audio", model: "voice-design-1", feature: "t", usage: {} }),
    0.01, "per-request pricing defaults to one request",
  );

  // ── Unpriced stays null, never a misleading $0 ──────────────────────
  const unknown = await recordApiUsage({ provider: "who", model: "what", feature: "t", usage: { inputTokens: 5000 } });
  check(unknown.costUsd === null, "an unknown model has no cost rather than $0");
  check(unknown.costStatus === "unpriced", "an unknown model is flagged unpriced");

  // A provider-reported cost always wins over computed rates.
  const reported = await recordApiUsage({ provider: "anthropic", model: "claude-haiku-4-5", feature: "t",
    usage: { inputTokens: 1e6 }, costUsd: 0.42 });
  near(reported.costUsd, 0.42, "an explicit provider cost overrides the rate table");
  check(reported.costStatus === "provider-reported", "explicit cost is flagged provider-reported");

  // ── No free-tier rates ──────────────────────────────────────────────
  // A free allowance is a quota, not a price. Recording $0 for it would
  // understate real spend the moment the allowance runs out and would make
  // the ledger disagree with the provider's invoice, so every known model
  // must carry its paid rate.
  near(
    await cost({ provider: "fish-audio", model: "s2.1-pro-free", feature: "t", usage: {}, units: { inputUtf8Bytes: 1e6 } }),
    15, "a 'free' model tier is still costed at the paid rate",
  );

  // ── Summary keeps unpriced visible ──────────────────────────────────
  const summary = await getApiUsageSummary();
  check(summary.total.unpricedRequests >= 1, "the summary counts unpriced requests separately");
  check(summary.total.costUsd > 0, "the summary totals real cost");

  console.log(`usage-pricing-unit-tests: ${assertions} assertions passed`);
} finally {
  await rm(root, { recursive: true, force: true });
}
