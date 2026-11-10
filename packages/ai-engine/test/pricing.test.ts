import { describe, expect, it } from 'vitest';
import { estimateCostUsd, priceFor } from '../src/pricing';
import { toUsage } from '../src/providers/anthropic';

const zero = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWrite5mInputTokens: 0, cacheWrite1hInputTokens: 0 };

describe('Estimativa de custo da IA', () => {
  it('usa o preço público do Claude Opus 5.5 (US$ 4 / 20 por milhão)', () => {
    const { costUsd, priceKnown } = estimateCostUsd('claude-opus-5-5', { ...zero, inputTokens: 1_000_000, outputTokens: 100_000 });
    expect(priceKnown).toBe(true);
    expect(costUsd).toBeCloseTo(4 + 2, 6);
  });

  it('cache: leitura a US$ 0,20/M; gravação 1,25× (5 min) e 2× (1 h) o preço de entrada', () => {
    const { costUsd } = estimateCostUsd('claude-opus-5-5', {
      ...zero,
      cacheReadInputTokens: 1_000_000,
      cacheWrite5mInputTokens: 1_000_000,
      cacheWrite1hInputTokens: 1_000_000,
    });
    expect(costUsd).toBeCloseTo(0.2 + 5 + 8, 6);
  });

  it('modelo desconhecido nunca é subestimado (usa o maior preço da tabela)', () => {
    const unknown = priceFor('modelo-novo-x');
    expect(unknown.known).toBe(false);
    expect(unknown.price.output).toBeGreaterThanOrEqual(priceFor('claude-opus-5-5').price.output);
  });

  it('soma iteração a iteração quando o fallback do servidor atende (recusa + resgate)', () => {
    const u = toUsage({
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 3000,
        output_tokens: 1100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation: null,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        ],
      } as never,
    });
    expect(u.inputTokens).toBe(3000);
    expect(u.outputTokens).toBe(1100);
    // 1000×4 + 100×20 (Opus 5.5) + 2000×5 + 1000×25 (Opus 4.8), por milhão
    expect(u.costUsd).toBeCloseTo((4000 + 2000 + 10_000 + 25_000) / 1e6, 6);
    expect(u.priceKnown).toBe(true);
  });

  it('sem iterações, usa o total da resposta', () => {
    const u = toUsage({
      model: 'claude-opus-5-5',
      usage: { input_tokens: 500_000, output_tokens: 50_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, iterations: null } as never,
    });
    expect(u.costUsd).toBeCloseTo(2 + 1, 6);
  });
});
