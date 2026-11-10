import { platformSettingsSchema, SOCIAL_PLATFORMS, uuid } from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { many, one } from '../db/database';
import { assertCompanyPermission, assertFavisAdmin, requireAuth, withUser } from '../lib/context';

const auditQuery = z.object({
  companyId: uuid.optional(),
  entity: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, ai, messaging, queue, cfg } = app.deps;

  app.get('/health', { schema: { tags: ['Sistema'], summary: 'Saúde do serviço', security: [] } }, async (_req, reply) => {
    const database = await db.ping();
    const body = {
      status: database ? 'ok' : 'degradado',
      database,
      queue: queue.mode,
      auth: cfg.AUTH_PROVIDER,
      ai: ai.status(),
      messaging: messaging.providerName,
      version: '0.1.0',
    };
    return reply.status(database ? 200 : 503).send(body);
  });

  // ---------- Configurações globais ----------
  app.get('/admin/settings', { schema: { tags: ['Administração'], summary: 'Configurações da plataforma' } }, async (req) => {
    assertFavisAdmin(req);
    const settings = await withUser(req, (tx) => one(tx, 'select * from platform_settings where id = 1'));
    return {
      settings,
      ai: ai.status(),
      messaging: await messaging.status(),
      queue: queue.mode,
      auth: cfg.AUTH_PROVIDER,
    };
  });

  app.put(
    '/admin/settings',
    { schema: { tags: ['Administração'], summary: 'Salvar configurações', body: platformSettingsSchema } },
    async (req) => {
      const { userId } = requireAuth(req);
      assertFavisAdmin(req);
      const b = req.body;
      return withUser(req, (tx) =>
        one(
          tx,
          `update platform_settings
              set ai_enabled = $1, ai_default_campaign_mix = $2, ai_history_days = $3, ai_guidelines = $4,
                  messaging_enabled = $5, messaging_default_send_time = $6, updated_by = $7,
                  ai_default_monthly_budget_usd = coalesce($8, ai_default_monthly_budget_usd),
                  ai_budget_alert_pct = coalesce($9, ai_budget_alert_pct)
            where id = 1 returning *`,
          [
            b.aiEnabled,
            b.aiDefaultCampaignMix,
            b.aiHistoryDays,
            b.aiGuidelines,
            b.messagingEnabled,
            b.messagingDefaultSendTime,
            userId,
            b.aiDefaultMonthlyBudgetUsd ?? null,
            b.aiBudgetAlertPct ?? null,
          ],
        ),
      );
    },
  );

  // ---------- Auditoria ----------
  const AUDIT_SQL = `
    select l.id, l.company_id, c.name as company_name, l.actor_id, p.full_name as actor_name,
           l.action, l.entity, l.entity_id, l.changes, l.created_at
      from audit_logs l
      left join profiles p on p.id = l.actor_id
      left join companies c on c.id = l.company_id
     where ($1::uuid is null or l.company_id = $1) and ($2::text is null or l.entity = $2)
     order by l.created_at desc limit $3`;

  app.get(
    '/admin/audit-logs',
    { schema: { tags: ['Auditoria'], summary: 'Logs de auditoria (todas as empresas)', querystring: auditQuery } },
    async (req) => {
      assertFavisAdmin(req);
      const q = req.query;
      return withUser(req, (tx) => many(tx, AUDIT_SQL, [q.companyId ?? null, q.entity ?? null, q.limit]));
    },
  );

  app.get(
    '/companies/:companyId/audit-logs',
    {
      schema: {
        tags: ['Auditoria'],
        summary: 'Logs de auditoria da empresa',
        params: z.object({ companyId: uuid }),
        querystring: auditQuery.omit({ companyId: true }),
      },
    },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'audit.view');
      return withUser(req, (tx) =>
        many(tx, AUDIT_SQL, [req.params.companyId, req.query.entity ?? null, req.query.limit]),
      );
    },
  );

  // ---------- Métricas (somente integrações autorizadas) ----------
  app.get(
    '/companies/:companyId/metrics',
    { schema: { tags: ['Métricas'], summary: 'Integrações e métricas reais', params: z.object({ companyId: uuid }) } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'company.view');
      return withUser(req, async (tx) => {
        const accounts = await many<{ platform: string }>(
          tx,
          'select id, platform, handle, status, last_sync_at, last_error from social_accounts where company_id = $1',
          [req.params.companyId],
        );
        const metrics = await many(
          tx,
          `select metric, sum(value) as value, min(period_start) as period_start, max(period_end) as period_end
             from social_metrics where company_id = $1 and period_end >= current_date - 30
            group by metric order by metric`,
          [req.params.companyId],
        );
        return {
          integrations: SOCIAL_PLATFORMS.map((platform) => {
            const acc = accounts.find((a) => a.platform === platform);
            return acc ?? { platform, status: 'nao_conectada' };
          }),
          metrics,
          note: metrics.length
            ? null
            : 'Nenhuma métrica disponível. Os indicadores aparecerão quando uma integração autorizada for conectada.',
        };
      });
    },
  );
};
