import { PRICE_TABLE_DATE } from '@fav/ai-engine';
import { aiBudgetUpdateSchema, uuid } from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { many, one } from '../db/database';
import { assertCompanyPermission, assertFavisAdmin, requireAuth, withUser } from '../lib/context';
import { notFound } from '../lib/errors';
import { classify } from '../services/ai-budget';

const tags = ['Inteligência artificial'];
const params = z.object({ companyId: uuid });

const NOTE =
  'Custo ESTIMADO pela tabela pública de preços da Anthropic. A cobrança oficial é a do console da Anthropic. ' +
  'O teto é uma referência interna: ao atingi-lo, chamadas automáticas são bloqueadas; as manuais seguem com aviso.';

export const aiUsageRoutes: FastifyPluginAsyncZod = async (app) => {
  const { ai } = app.deps;

  // Situação do mês para quem usa a IA na empresa (exibida na tela de IA)
  app.get(
    '/companies/:companyId/ai/budget',
    { schema: { tags, summary: 'Consumo de IA da empresa no mês', params } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'ai.use');
      const status = ai.budget ? await withUser(req, (tx) => ai.budget!.status(tx, req.params.companyId)) : null;
      if (!status) throw notFound('Empresa não encontrada');
      return { ...status, note: NOTE };
    },
  );

  // Painel FAVIS: consumo de todas as empresas no mês corrente (fuso de cada empresa)
  app.get('/admin/ai-usage', { schema: { tags: ['Administração'], summary: 'Consumo de IA por empresa' } }, async (req) => {
    assertFavisAdmin(req);
    return withUser(req, async (tx) => {
      const rows = await many<{
        companyId: string;
        companyName: string;
        month: string;
        budgetUsd: number;
        customBudget: boolean;
        alertPct: number;
        spentUsd: number;
        calls: number;
        failedCalls: number;
        automaticCalls: number;
        inputTokens: number;
        outputTokens: number;
        unknownPrice: number;
      }>(
        tx,
        `with c as (
           select c.id, c.name, c.timezone, c.ai_monthly_budget_usd is not null as custom,
                  coalesce(c.ai_monthly_budget_usd, s.ai_default_monthly_budget_usd) as budget, s.ai_budget_alert_pct,
                  date_trunc('month', now() at time zone c.timezone)::date as month
             from companies c cross join platform_settings s where s.id = 1
         )
         select c.id as company_id, c.name as company_name, c.month::text, c.budget::float8 as budget_usd,
                c.custom as custom_budget, c.ai_budget_alert_pct as alert_pct,
                coalesce(sum(e.cost_usd), 0)::float8 as spent_usd,
                count(e.id)::int as calls,
                count(e.id) filter (where not e.succeeded)::int as failed_calls,
                count(e.id) filter (where e.origin = 'automatico')::int as automatic_calls,
                coalesce(sum(e.input_tokens + e.cache_read_tokens + e.cache_write_tokens), 0)::int as input_tokens,
                coalesce(sum(e.output_tokens), 0)::int as output_tokens,
                count(e.id) filter (where not e.price_known)::int as unknown_price
           from c
           left join ai_usage_events e
             on e.company_id = c.id and e.created_at >= (c.month::timestamp at time zone c.timezone)
          group by c.id, c.name, c.month, c.budget, c.custom, c.ai_budget_alert_pct
          order by spent_usd desc, c.name`,
      );
      const companies = rows.map((r) => {
        const { level, usedPct } = classify(r.spentUsd, r.budgetUsd, r.alertPct);
        return { ...r, spentUsd: Math.round(r.spentUsd * 1e4) / 1e4, level, usedPct, automaticBlocked: level === 'limite' };
      });
      const alerts = await many(
        tx,
        `select a.company_id, c.name as company_name, a.month::text, a.level, a.spent_usd::float8, a.budget_usd::float8, a.created_at
           from ai_budget_alerts a join companies c on c.id = a.company_id
          order by a.created_at desc limit 20`,
      );
      const settings = await one<{ aiDefaultMonthlyBudgetUsd: number; aiBudgetAlertPct: number }>(
        tx,
        'select ai_default_monthly_budget_usd::float8, ai_budget_alert_pct from platform_settings where id = 1',
      );
      return {
        companies,
        alerts,
        totals: {
          spentUsd: Math.round(companies.reduce((s, c) => s + c.spentUsd, 0) * 1e4) / 1e4,
          calls: companies.reduce((s, c) => s + c.calls, 0),
          companiesAtLimit: companies.filter((c) => c.level === 'limite').length,
          companiesOnAlert: companies.filter((c) => c.level === 'alerta').length,
        },
        defaults: settings,
        priceTableDate: PRICE_TABLE_DATE,
        note: NOTE,
      };
    });
  });

  app.put(
    '/admin/companies/:companyId/ai-budget',
    { schema: { tags: ['Administração'], summary: 'Definir teto mensal de IA da empresa', params, body: aiBudgetUpdateSchema } },
    async (req) => {
      requireAuth(req);
      assertFavisAdmin(req);
      const row = await withUser(req, (tx) =>
        one<{ id: string }>(tx, 'update companies set ai_monthly_budget_usd = $2 where id = $1 returning id', [
          req.params.companyId,
          req.body.monthlyBudgetUsd,
        ]),
      );
      if (!row) throw notFound('Empresa não encontrada');
      return withUser(req, (tx) => ai.budget!.status(tx, req.params.companyId));
    },
  );
};
