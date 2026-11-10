import {
  AIProviderError,
  AnthropicProvider,
  generatePlan,
  type AIProvider,
  type CompanyContext,
  type ValidatedPlan,
} from '@fav/ai-engine';
import type { Config } from '../config';
import { many, one, type Database, type Tx } from '../db/database';
import type { AiBudget } from './ai-budget';

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string | null;
}

export function createAiProvider(cfg: Config): AIProvider | null {
  if (cfg.AI_PROVIDER === 'anthropic' && cfg.AI_API_KEY) {
    return new AnthropicProvider({ apiKey: cfg.AI_API_KEY, model: cfg.AI_MODEL, timeoutMs: cfg.AI_TIMEOUT_MS });
  }
  return null;
}

interface GenerationRow {
  id: string;
  companyId: string;
  kind: 'plano_semanal' | 'plano_mensal' | 'alternativa';
  periodStart: string;
  periodEnd: string;
  instructions: string;
  sourceActivityId: string | null;
  status: string;
  origin: 'manual' | 'automatico';
}

/** Orquestra o motor de IA com os dados do banco (memória estratégica por empresa). */
export class AiService {
  constructor(
    private readonly db: Database,
    private readonly provider: AIProvider | null,
    readonly budget: AiBudget | null = null,
  ) {}

  status(): AiStatus {
    return {
      configured: this.provider !== null,
      provider: this.provider?.name ?? 'none',
      model: this.provider?.model ?? null,
    };
  }

  get available() {
    return this.provider !== null;
  }

  /** Monta o contexto da empresa (consulta de sistema; a autorização ocorreu na rota). */
  async buildContext(tx: Tx, gen: GenerationRow): Promise<CompanyContext> {
    const settings = await one<{ aiHistoryDays: number; aiGuidelines: string }>(
      tx,
      'select ai_history_days, ai_guidelines from platform_settings where id = 1',
    );
    const company = await one<{ id: string; name: string; segment: string; timezone: string }>(
      tx,
      'select id, name, segment, timezone from companies where id = $1',
      [gen.companyId],
    );
    const profile = await one<CompanyContext['profile']>(
      tx,
      `select business_description, target_audience, products, services, differentiators, positioning,
              brand_personality, tone_of_voice, business_goals, marketing_goals, main_challenges,
              business_hours, commercial_dates, content_restrictions, additional_info, campaign_mix_target
         from company_profiles where company_id = $1`,
      [gen.companyId],
    );
    const campaigns = await many<CompanyContext['campaigns'][number]>(
      tx,
      `select id, name, objectives, starts_on, ends_on, products, offers, notes, content_share
         from campaigns
        where company_id = $1 and status = 'ativa' and starts_on <= $3 and ends_on >= $2
        order by starts_on`,
      [gen.companyId, gen.periodStart, gen.periodEnd],
    );
    const history = await many<CompanyContext['history'][number]>(
      tx,
      `select a.scheduled_date::text as date, a.title, a.pillar, a.format, a.status,
              (select u.message from activity_updates u where u.activity_id = a.id and u.to_status = 'impedida'
                order by u.created_at desc limit 1) as blocker_note
         from activities a
        where a.company_id = $1 and a.scheduled_date >= ($2::date - $3::int) and a.scheduled_date < $2
          and a.status <> 'cancelada'
        order by a.scheduled_date`,
      [gen.companyId, gen.periodStart, settings?.aiHistoryDays ?? 60],
    );
    const metrics = await many<CompanyContext['metrics'][number]>(
      tx,
      `select metric, value, period_start::text, period_end::text, source from social_metrics
        where company_id = $1 and period_end >= ($2::date - 90) order by period_end desc limit 50`,
      [gen.companyId, gen.periodStart],
    );

    let alternativeFor: CompanyContext['alternativeFor'];
    if (gen.kind === 'alternativa' && gen.sourceActivityId) {
      const a = await one<{ title: string; date: string; pillar: never; format: never; script: string; blocker: string }>(
        tx,
        `select title, scheduled_date::text as date, pillar, format, script,
                coalesce((select message from activity_updates where activity_id = activities.id and message <> ''
                  order by created_at desc limit 1), '') as blocker
           from activities where id = $1`,
        [gen.sourceActivityId],
      );
      if (a) alternativeFor = a;
    }

    if (!company || !profile) throw new Error('Empresa não encontrada para a geração');
    return {
      company,
      profile: { ...profile, campaignMixTarget: Number(profile.campaignMixTarget) },
      campaigns: campaigns.map((c) => ({ ...c, contentShare: Number(c.contentShare) })),
      history,
      metrics,
      trends: [],
      guidelines: settings?.aiGuidelines ?? '',
      period: { start: gen.periodStart, end: gen.periodEnd },
      instructions: gen.instructions,
      alternativeFor,
    };
  }

  /** Executa uma geração pendente (chamado pelo worker ou pela fila inline). */
  async runGeneration(generationId: string): Promise<void> {
    const claimed = await this.db.asService(async (tx) => {
      const gen = await one<GenerationRow>(
        tx,
        `update ai_generations set status = 'processando', started_at = now(), error = null
          where id = $1 and status in ('pendente', 'falhou')
          returning id, company_id, kind, period_start::text, period_end::text, instructions, source_activity_id, status, origin`,
        [generationId],
      );
      if (!gen) return null;
      return { gen, ctx: await this.buildContext(tx, gen) };
    });
    if (!claimed) return;
    const { gen, ctx } = claimed;

    if (!this.provider) {
      await this.fail(gen.id, 'Nenhum provedor de IA configurado (AI_PROVIDER=none)');
      return;
    }
    // Teto mensal atingido: gerações automáticas não chamam a IA (as manuais seguem, com aviso na tela)
    if (gen.origin === 'automatico' && this.budget) {
      const { allowed } = await this.budget.allowAutomatic(gen.companyId);
      if (!allowed) {
        await this.fail(gen.id, 'Limite mensal de IA da empresa atingido: geração automática não executada.');
        return;
      }
    }
    const usageBase = {
      companyId: gen.companyId,
      generationId: gen.id,
      feature: gen.kind === 'alternativa' ? ('alternativa' as const) : ('planejamento' as const),
      origin: gen.origin,
      provider: this.provider.name,
      model: this.provider.model,
    };
    try {
      const result = await generatePlan(this.provider, ctx, {
        maxTokens: gen.kind === 'plano_mensal' ? 96_000 : 48_000,
      });
      await this.budget?.record({ ...usageBase, succeeded: true, usage: result.usage });
      await this.db.asService((tx) =>
        tx.query(
          `update ai_generations
              set status = 'concluida', completed_at = now(), provider = $2, model = $3,
                  output = $4, warnings = $5, usage = $6, context_snapshot = $7
            where id = $1`,
          [
            gen.id,
            result.provider,
            result.model,
            JSON.stringify(result.plan satisfies ValidatedPlan),
            JSON.stringify(result.plan.warnings),
            JSON.stringify({ attempts: result.attempts, calls: result.usage }),
            JSON.stringify(result.contextSummary),
          ],
        ),
      );
    } catch (err) {
      if (err instanceof AIProviderError) await this.budget?.record({ ...usageBase, succeeded: false, usage: err.usage });
      const message = err instanceof AIProviderError ? err.message : 'Erro inesperado ao gerar o planejamento';
      await this.fail(gen.id, message);
      if (err instanceof AIProviderError && err.retryable) throw err; // BullMQ tenta novamente
    }
  }

  private async fail(id: string, message: string) {
    await this.db.asService((tx) =>
      tx.query(`update ai_generations set status = 'falhou', error = $2, completed_at = now() where id = $1`, [id, message]),
    );
  }
}
