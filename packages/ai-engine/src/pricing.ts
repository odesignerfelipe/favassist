/**
 * Tabela de preços públicos da API da Anthropic (US$ por milhão de tokens) para ESTIMAR
 * o custo de cada chamada. A cobrança oficial é a do console da Anthropic; esta estimativa
 * serve para o controle interno de consumo por empresa.
 * Gravações em cache: 1,25× o preço de entrada (5 min) e 2× (1 h).
 */
export const PRICE_TABLE_DATE = '2026-11-03';

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

/** Modelo desconhecido: estima pelo maior preço da tabela (nunca subestima). */
const FALLBACK_PRICE: ModelPrice = { input: 10, output: 50, cacheRead: 1 };

export function priceFor(model: string): { price: ModelPrice; known: boolean } {
  // Aceita sufixos de data/variantes (ex.: "claude-opus-5-5-fast" não existe na API, mas por segurança)
  const id = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`) || model.startsWith(`${k}@`));
  return id ? { price: PRICES[id]!, known: true } : { price: FALLBACK_PRICE, known: false };
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWrite5mInputTokens: number;
  cacheWrite1hInputTokens: number;
}

/** Custo estimado em US$ de uma chamada (um modelo). */
export function estimateCostUsd(model: string, t: TokenCounts): { costUsd: number; priceKnown: boolean } {
  const { price, known } = priceFor(model);
  const perToken =
    t.inputTokens * price.input +
    t.outputTokens * price.output +
    t.cacheReadInputTokens * price.cacheRead +
    t.cacheWrite5mInputTokens * price.input * 1.25 +
    t.cacheWrite1hInputTokens * price.input * 2;
  return { costUsd: Math.round((perToken / 1_000_000) * 1e6) / 1e6, priceKnown: known };
}
