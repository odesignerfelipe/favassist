import type { ProviderUsage } from '@fav/ai-engine';
import { one, type Database, type Tx } from '../db/database';

export type AiFeature = 'planejamento' | 'alternativa' | 'assistente_whatsapp';
export type AiOrigin = 'manual' | 'automatico';
export type BudgetLevel = 'ok' | 'alerta' | 'limite';

export interface BudgetStatus {
  /** Primeiro dia do mês corrente no fuso da empresa (AAAA-MM-DD). */
  month: string;
  spentUsd: number;
  budgetUsd: number;
  /** true = teto próprio da empresa; false = padrão da plataforma. */
  customBudget: boolean;
  alertPct: number;
  usedPct: number;
  level: BudgetLevel;
  /** Chamadas automáticas bloqueadas (teto atingido). As manuais continuam, com aviso. */
  automaticBlocked: boolean;
}

export interface UsageRecord {
  companyId: string;
  generationId?: string | null;
  feature: AiFeature;
  origin: AiOrigin;
  provider: string;
  succeeded: boolean;
  usage: ProviderUsage[];
  /** Modelo configurado, usado quando o provedor não informa qual atendeu. */
  model: string;
}

const STATUS_SQL = `
  with c as (
    select c.id, c.timezone, c.ai_monthly_budget_usd is not null as custom,
           coalesce(c.ai_monthly_budget_usd, s.ai_default_monthly_budget_usd) as budget,
           s.ai_budget_alert_pct as alert_pct,
           date_trunc('month', now() at time zone c.timezone)::date as month
      from companies c cross join platform_settings s
     where c.id = $1 and s.id = 1
  )
  select c.month::text, c.budget::float8 as budget_usd, c.custom as custom_budget, c.alert_pct,
         coalesce((select sum(e.cost_usd) from ai_usage_events e
                    where e.company_id = c.id and e.created_at >= (c.month::timestamp at time zone c.timezone)), 0)::float8
           as spent_usd
    from c`;

export function classify(spentUsd: number, budgetUsd: number, alertPct: number): { level: BudgetLevel; usedPct: number } {
  if (budgetUsd <= 0) return { level: 'limite', usedPct: 100 }; // teto zero = automações de IA desligadas
  const usedPct = Math.round((spentUsd / budgetUsd) * 1000) / 10;
  if (spentUsd >= budgetUsd) return { level: 'limite', usedPct };
  if (usedPct >= alertPct) return { level: 'alerta', usedPct };
  return { level: 'ok', usedPct };
}

/**
 * Controle de consumo de IA por empresa: teto mensal de referência (padrão US$ 10),
 * alertas e bloqueio das chamadas automáticas ao atingir o teto.
 * O custo é ESTIMADO pela tabela pública de preços; a cobrança oficial é a da Anthropic.
 */
export class AiBudget {
  constructor(
    private readonly db: Database,
    private readonly log: (msg: string, data: Record<string, unknown>) => void = () => {},
  ) {}

  /** Situação do mês. Use dentro de withUser (RLS) ou asService. */
  async status(tx: Tx, companyId: string): Promise<BudgetStatus | null> {
    const r = await one<{ month: string; budgetUsd: number; customBudget: boolean; alertPct: number; spentUsd: number }>(
      tx,
      STATUS_SQL,
      [companyId],
    );
    if (!r) return null;
    const { level, usedPct } = classify(r.spentUsd, r.budgetUsd, r.alertPct);
    return {
      month: r.month,
      spentUsd: Math.round(r.spentUsd * 1e4) / 1e4,
      budgetUsd: r.budgetUsd,
      customBudget: r.customBudget,
      alertPct: r.alertPct,
      usedPct,
      level,
      automaticBlocked: level === 'limite',
    };
  }

  /** Antes de uma chamada automática: pode chamar a IA? */
  async allowAutomatic(companyId: string): Promise<{ allowed: boolean; status: BudgetStatus | null }> {
    const status = await this.db.asService((tx) => this.status(tx, companyId));
    return { allowed: !!status && !status.automaticBlocked, status };
  }

  /** Registra o consumo (uma linha por chamada) e emite alertas ao cruzar os limites. */
  async record(rec: UsageRecord): Promise<BudgetStatus | null> {
    const calls = rec.usage.length ? rec.usage : [];
    if (!calls.length) return null;
    return this.db.asService(async (tx) => {
      for (const u of calls) {
        await tx.query(
          `insert into ai_usage_events (company_id, generation_id, feature, origin, provider, model,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, price_known, succeeded)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            rec.companyId,
            rec.generationId ?? null,
            rec.feature,
            rec.origin,
            rec.provider.slice(0, 40),
            (u.model ?? rec.model).slice(0, 80),
            u.inputTokens ?? 0,
            u.outputTokens ?? 0,
            u.cacheReadInputTokens ?? 0,
            u.cacheWriteInputTokens ?? 0,
            u.costUsd ?? 0,
            u.priceKnown ?? u.costUsd !== undefined,
            rec.succeeded,
          ],
        );
      }
      const status = await this.status(tx, rec.companyId);
      if (status && status.level !== 'ok') {
        const levels = status.level === 'limite' ? ['alerta', 'limite'] : ['alerta'];
        for (const level of levels) {
          const created = await tx.query(
            `insert into ai_budget_alerts (company_id, month, level, spent_usd, budget_usd)
             values ($1, $2, $3, $4, $5) on conflict do nothing`,
            [rec.companyId, status.month, level, status.spentUsd, status.budgetUsd],
          );
          if (created.rowCount) {
            this.log(level === 'limite' ? 'Teto mensal de IA atingido' : 'Consumo de IA acima do alerta', {
              companyId: rec.companyId,
              spentUsd: status.spentUsd,
              budgetUsd: status.budgetUsd,
            });
          }
        }
      }
      return status;
    });
  }
}
