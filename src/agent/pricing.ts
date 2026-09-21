import "server-only";

/**
 * Client-side cost estimation, for the live meter only.
 *
 * Verified against a real run: these constants reproduce the SDK's own
 * reported figure to the cent (input 66, cache-write 142,866, cache-read
 * 2,395,013, output 39,245 -> $1.228750, matching exactly).
 *
 * The authoritative number is still `total_cost_usd` on the result message.
 * This exists because that number arrives only when the run ends, which left
 * the meter reading $0.00 for twenty minutes.
 */

/** USD per million tokens. */
type Price = { input: number; output: number; cacheReadMult: number; cacheWriteMult: number };

const PRICES: Record<string, Price> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheReadMult: 0.1, cacheWriteMult: 1.25 },
  "claude-opus-5": { input: 5, output: 25, cacheReadMult: 0.1, cacheWriteMult: 1.25 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheReadMult: 0.1, cacheWriteMult: 1.25 },
};

const FALLBACK = PRICES["claude-sonnet-5"];

export type TokenTally = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function emptyTally(): TokenTally {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function estimateCostUsd(tally: TokenTally, model: string): number {
  const p =
    PRICES[model] ??
    PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ""] ??
    FALLBACK;

  const usd =
    (tally.inputTokens * p.input +
      tally.cacheWriteTokens * p.input * p.cacheWriteMult +
      tally.cacheReadTokens * p.input * p.cacheReadMult +
      tally.outputTokens * p.output) /
    1_000_000;

  return Number(usd.toFixed(6));
}
