import type { BoardTokens } from '../types'

// Anthropic first-party list prices in USD per million tokens (cached 2026-10-06).
// Cache writes are billed at 1.25x input (5-minute TTL). Order matters: the
// first prefix that matches the model id wins.
type Price = { input: number; output: number; cacheRead: number; window: number }

const PRICES: ReadonlyArray<readonly [prefix: string, price: Price]> = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25, window: 1_000_000 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.25, window: 1_000_000 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1, window: 1_000_000 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1, window: 1_000_000 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2, window: 1_000_000 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5, window: 1_000_000 }],
  ['claude-opus-4', { input: 5, output: 25, cacheRead: 0.5, window: 1_000_000 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2, window: 1_000_000 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2, window: 1_000_000 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheRead: 0.3, window: 1_000_000 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01, window: 1_000_000 }],
  ['claude-haiku-4', { input: 1, output: 5, cacheRead: 0.1, window: 200_000 }],
]

const ALIASES: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}

/** Strips provider prefixes (`anthropic.`, `us.anthropic.`) and suffixes (`[1m]`, `@date`). */
const normalize = (model: string): string => {
  const bare = model.toLowerCase().replace(/^.*anthropic\./, '').replace(/[[@].*$/, '')

  return ALIASES[bare] ?? bare
}

const priceOf = (model: string): Price | undefined => {
  const id = normalize(model)

  return PRICES.find(([prefix]) => id.startsWith(prefix))?.[1]
}

/** Cost of one response's tokens; null when the model has no known price. */
export const costOf = (model: string, tokens: BoardTokens): number | null => {
  const price = priceOf(model)

  if (price === undefined) {
    return null
  }

  const millions =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheRead * price.cacheRead +
    tokens.cacheWrite * price.input * 1.25

  return millions / 1_000_000
}

/** Context window of the model in tokens, or `fallback` when unknown. */
export const windowOf = (model: string, fallback: number): number =>
  priceOf(model)?.window ?? fallback
