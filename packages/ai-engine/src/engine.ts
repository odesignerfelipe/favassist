import { validatePlan, type ValidatedPlan } from './guardrails';
import { ASSISTANT_SYSTEM_PROMPT, buildPlanUserPrompt, PLANNER_SYSTEM_PROMPT } from './prompt';
import { planOutputSchema } from './schema';
import { AIProviderError, type AIProvider, type CompanyContext, type ProviderUsage } from './types';

export interface PlanResult {
  plan: ValidatedPlan;
  model: string;
  provider: string;
  attempts: number;
  usage: ProviderUsage[];
  /** Contexto resumido usado na geração (para auditoria/memória). */
  contextSummary: Record<string, unknown>;
}

/**
 * Gera um planejamento: prompt estruturado → provedor → validação de formato
 * (com uma nova tentativa informando os erros) → salvaguardas de negócio.
 */
export async function generatePlan(
  provider: AIProvider,
  ctx: CompanyContext,
  opts: { maxAttempts?: number; maxTokens?: number } = {},
): Promise<PlanResult> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const usage: ProviderUsage[] = [];
  let user = buildPlanUserPrompt(ctx);
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Awaited<ReturnType<AIProvider['generateJson']>>;
    try {
      res = await provider.generateJson({
        system: PLANNER_SYSTEM_PROMPT,
        user,
        schema: planOutputSchema,
        maxTokens: opts.maxTokens,
      });
    } catch (err) {
      // Tentativas anteriores já foram cobradas: o erro carrega todo o consumo
      if (err instanceof AIProviderError) err.usage = [...usage, ...err.usage];
      throw err;
    }
    if (res.usage) usage.push(res.usage);
    const parsed = planOutputSchema.safeParse(res.data);
    if (parsed.success) {
      return {
        plan: validatePlan(parsed.data, ctx),
        model: res.model,
        provider: provider.name,
        attempts: attempt,
        usage,
        contextSummary: summarizeContext(ctx),
      };
    }
    lastError = parsed.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    user = `${buildPlanUserPrompt(ctx)}\n\n# Correção\nA resposta anterior não seguiu o formato: ${lastError}. Responda novamente com o JSON completo e válido.`;
  }
  throw new AIProviderError(`A IA não retornou um planejamento válido: ${lastError}`, 'invalid_output', true, usage);
}

/** Resposta curta para mensagens recebidas (ex.: WhatsApp). */
export async function generateAssistantReply(
  provider: AIProvider,
  input: { companyName: string; toneOfVoice: string; scheduleSummary: string; message: string; senderName: string },
): Promise<{ text: string; usage: ProviderUsage[] }> {
  const res = await provider.generateText({
    system: ASSISTANT_SYSTEM_PROMPT,
    user:
      `Empresa: ${input.companyName}\nTom de voz: ${input.toneOfVoice || '(não informado)'}\n` +
      `Cronograma de hoje:\n${input.scheduleSummary || '(sem tarefas hoje)'}\n\n` +
      `Mensagem de ${input.senderName}: ${input.message}`,
    maxTokens: 1024,
  });
  return { text: res.text.trim(), usage: res.usage ? [res.usage] : [] };
}

function summarizeContext(ctx: CompanyContext): Record<string, unknown> {
  return {
    period: ctx.period,
    campaigns: ctx.campaigns.map((c) => ({ id: c.id, name: c.name, contentShare: c.contentShare })),
    historyItems: ctx.history.length,
    metricsAvailable: ctx.metrics.length,
    trendsAvailable: ctx.trends.length,
    campaignMixTarget: ctx.profile.campaignMixTarget,
    instructions: ctx.instructions,
    alternativeFor: ctx.alternativeFor?.title ?? null,
  };
}
