import type { ContentFormat, ContentPillar } from '@fav/shared';
import type { z } from 'zod';

/** Tudo o que a IA sabe sobre a empresa num pedido (montado pela API a partir do banco). */
export interface CompanyContext {
  company: { id: string; name: string; segment: string; timezone: string };
  profile: {
    businessDescription: string;
    targetAudience: string;
    products: string;
    services: string;
    differentiators: string;
    positioning: string;
    brandPersonality: string;
    toneOfVoice: string;
    businessGoals: string;
    marketingGoals: string;
    mainChallenges: string;
    businessHours: { weekday: number; closed: boolean; opens: string | null; closes: string | null }[];
    commercialDates: { date: string; name: string; notes: string }[];
    contentRestrictions: string;
    additionalInfo: string;
    campaignMixTarget: number;
  };
  campaigns: {
    id: string;
    name: string;
    objectives: string;
    startsOn: string;
    endsOn: string;
    products: string;
    offers: string;
    notes: string;
    contentShare: number;
  }[];
  /** Conteúdos recentes (memória estratégica) — para evitar repetição e aprender com a execução. */
  history: {
    date: string;
    title: string;
    pillar: ContentPillar;
    format: ContentFormat;
    status: string;
    blockerNote?: string | null;
  }[];
  /** Métricas reais de integrações autorizadas. Vazio quando não há integração. */
  metrics: { metric: string; value: number; periodStart: string; periodEnd: string; source: string }[];
  /** Tendências com fonte verificável. Vazio enquanto não houver fonte integrada. */
  trends: { title: string; source: string; url: string }[];
  /** Diretrizes globais da FAVIS (configuração da plataforma). */
  guidelines: string;
  period: { start: string; end: string };
  /** Pedido específico de quem solicitou. */
  instructions: string;
  /** Para pedidos de alternativa: a tarefa original e a dificuldade relatada. */
  alternativeFor?: { title: string; date: string; pillar: ContentPillar; format: ContentFormat; script: string; blocker: string };
}

export interface GenerateJsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface GenerateTextRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

/** Contrato de provedor de IA. Novos provedores implementam esta interface. */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** Retorna o JSON produzido pelo modelo (ainda não validado pelas regras de negócio). */
  generateJson<T>(req: GenerateJsonRequest<T>): Promise<{ data: unknown; usage?: ProviderUsage; model: string }>;
  generateText(req: GenerateTextRequest): Promise<{ text: string; usage?: ProviderUsage; model: string }>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'refusal' | 'truncated' | 'rate_limit' | 'auth' | 'timeout' | 'invalid_output' | 'unavailable',
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
