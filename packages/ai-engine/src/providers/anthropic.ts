import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  AIProviderError,
  type AIProvider,
  type GenerateJsonRequest,
  type GenerateTextRequest,
  type ProviderUsage,
} from '../types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Fallback do lado do servidor: se o classificador de segurança recusar a
 * solicitação, a própria API reexecuta em um modelo recomendado para a categoria.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Desative em plataformas que não suportam fallback do servidor. */
  serverFallback?: boolean;
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly serverFallback: boolean;

  constructor(opts: AnthropicProviderOptions) {
    this.model = opts.model ?? ANTHROPIC_DEFAULT_MODEL;
    this.serverFallback = opts.serverFallback ?? true;
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 600_000, maxRetries: 2 });
  }

  private fallbackParams() {
    return this.serverFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {};
  }

  async generateJson<T>(req: GenerateJsonRequest<T>) {
    try {
      // Streaming: planejamentos mensais podem gerar respostas longas.
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: req.maxTokens ?? 64_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: betaZodOutputFormat(req.schema) },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
        ...this.fallbackParams(),
      });
      const message = await stream.finalMessage();
      this.assertCompleted(message.stop_reason, message.stop_details);
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AIProviderError('A resposta da IA não é um JSON válido', 'invalid_output', true);
      }
      return { data, usage: toUsage(message.usage), model: message.model };
    } catch (err) {
      throw mapError(err);
    }
  }

  async generateText(req: GenerateTextRequest) {
    try {
      const message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 2048,
        output_config: { effort: 'low' },
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        ...this.fallbackParams(),
      });
      this.assertCompleted(message.stop_reason, message.stop_details);
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { text, usage: toUsage(message.usage), model: message.model };
    } catch (err) {
      throw mapError(err);
    }
  }

  private assertCompleted(stopReason: string | null, stopDetails: unknown) {
    if (stopReason === 'refusal') {
      const category = (stopDetails as { category?: string } | null)?.category ?? 'não informada';
      throw new AIProviderError(`A IA recusou a solicitação (categoria: ${category})`, 'refusal', false);
    }
    if (stopReason === 'max_tokens') {
      throw new AIProviderError('A resposta da IA foi interrompida por limite de tamanho', 'truncated', true);
    }
  }
}

function toUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
}): ProviderUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens ?? undefined,
  };
}

/** Erros tipados do SDK → erros do motor (do mais específico ao mais geral). */
function mapError(err: unknown): Error {
  if (err instanceof AIProviderError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AIProviderError('Chave da API de IA inválida ou sem permissão', 'auth', false);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AIProviderError('Limite de uso da IA atingido. Tente novamente em instantes.', 'rate_limit', true);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIProviderError('A IA demorou demais para responder', 'timeout', true);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AIProviderError(`Solicitação recusada pela API de IA: ${err.message}`, 'unavailable', false);
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
    return new AIProviderError('Serviço de IA indisponível no momento', 'unavailable', true);
  }
  if (err instanceof Anthropic.APIError) {
    return new AIProviderError(`Erro da API de IA (${err.status ?? '?'})`, 'unavailable', true);
  }
  return err instanceof Error ? err : new Error(String(err));
}
