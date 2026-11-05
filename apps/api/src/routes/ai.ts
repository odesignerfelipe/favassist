import type { ValidatedPlan } from '@fav/ai-engine';
import { aiAlternativeRequestSchema, aiApplySchema, aiPlanRequestSchema, can, uuid } from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { many, one } from '../db/database';
import { assertCompanyPermission, requireAuth, withUser } from '../lib/context';
import { forbidden, notFound, unavailable, unprocessable } from '../lib/errors';

const params = z.object({ companyId: uuid });
const genParams = z.object({ companyId: uuid, generationId: uuid });
const tags = ['Inteligência artificial'];

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  const { ai, queue } = app.deps;

  async function ensureAiEnabled(req: Parameters<typeof withUser>[0]) {
    if (!ai.available) {
      throw unavailable('A inteligência artificial não está configurada. Defina AI_PROVIDER e AI_API_KEY no servidor.');
    }
    const s = await withUser(req, (tx) => one<{ aiEnabled: boolean }>(tx, 'select ai_enabled from platform_settings'));
    if (!s?.aiEnabled) throw unavailable('A geração por IA está desativada nas configurações da FAVIS.');
  }

  app.get('/ai/status', { schema: { tags, summary: 'Situação do provedor de IA' } }, async (req) => {
    requireAuth(req);
    const s = await withUser(req, (tx) => one<{ aiEnabled: boolean }>(tx, 'select ai_enabled from platform_settings'));
    return { ...ai.status(), enabled: s?.aiEnabled ?? false, queue: queue.mode };
  });

  app.post(
    '/companies/:companyId/ai/plans',
    { schema: { tags, summary: 'Solicitar planejamento semanal/mensal', params, body: aiPlanRequestSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      assertCompanyPermission(req, req.params.companyId, 'ai.use');
      await ensureAiEnabled(req);
      const b = req.body;
      const days = (Date.parse(b.periodEnd) - Date.parse(b.periodStart)) / 86_400_000;
      if (days > 31) throw unprocessable('O período máximo é de 31 dias');
      const gen = await withUser(req, (tx) =>
        one<{ id: string }>(
          tx,
          `insert into ai_generations (company_id, requested_by, kind, period_start, period_end, instructions)
           values ($1, $2, $3, $4, $5, $6) returning *`,
          [req.params.companyId, userId, b.kind, b.periodStart, b.periodEnd, b.instructions],
        ),
      );
      await queue.enqueueAiGeneration(gen!.id);
      return reply.status(202).send(gen);
    },
  );

  app.post(
    '/companies/:companyId/ai/alternatives',
    { schema: { tags, summary: 'Pedir alternativa para tarefa inviável', params, body: aiAlternativeRequestSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      assertCompanyPermission(req, req.params.companyId, 'ai.use');
      await ensureAiEnabled(req);
      const gen = await withUser(req, async (tx) => {
        const a = await one<{ scheduledDate: string }>(
          tx,
          'select scheduled_date::text from activities where company_id = $1 and id = $2',
          [req.params.companyId, req.body.activityId],
        );
        if (!a) throw notFound('Atividade não encontrada');
        return one<{ id: string }>(
          tx,
          `insert into ai_generations (company_id, requested_by, kind, period_start, period_end, instructions, source_activity_id)
           values ($1, $2, 'alternativa', $3, $3, $4, $5) returning *`,
          [req.params.companyId, userId, a.scheduledDate, req.body.instructions, req.body.activityId],
        );
      });
      await queue.enqueueAiGeneration(gen!.id);
      return reply.status(202).send(gen);
    },
  );

  app.get(
    '/companies/:companyId/ai/generations',
    { schema: { tags, summary: 'Histórico de gerações', params } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'ai.use');
      return withUser(req, (tx) =>
        many(
          tx,
          `select g.id, g.kind, g.period_start, g.period_end, g.status, g.provider, g.model, g.error,
                  g.created_at, g.completed_at, g.applied_at, p.full_name as requested_by_name,
                  jsonb_array_length(coalesce(g.output -> 'items', '[]'::jsonb)) as items_count,
                  jsonb_array_length(g.warnings) as warnings_count
             from ai_generations g left join profiles p on p.id = g.requested_by
            where g.company_id = $1 order by g.created_at desc limit 50`,
          [req.params.companyId],
        ),
      );
    },
  );

  app.get(
    '/companies/:companyId/ai/generations/:generationId',
    { schema: { tags, summary: 'Resultado de uma geração', params: genParams } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'ai.use');
      const gen = await withUser(req, (tx) =>
        one(tx, 'select * from ai_generations where company_id = $1 and id = $2', [
          req.params.companyId,
          req.params.generationId,
        ]),
      );
      if (!gen) throw notFound('Geração não encontrada');
      return gen;
    },
  );

  app.post(
    '/companies/:companyId/ai/generations/:generationId/apply',
    { schema: { tags, summary: 'Aplicar itens ao calendário', params: genParams, body: aiApplySchema } },
    async (req) => {
      const { userId } = requireAuth(req);
      const actor = assertCompanyPermission(req, req.params.companyId, 'activities.manage');
      if (!can(actor, req.params.companyId, 'ai.use')) throw forbidden();
      return withUser(req, async (tx) => {
        const gen = await one<{ id: string; status: string; output: (ValidatedPlan & { appliedIndexes?: number[] }) | null }>(
          tx,
          'select id, status, output from ai_generations where company_id = $1 and id = $2 for update',
          [req.params.companyId, req.params.generationId],
        );
        if (!gen) throw notFound('Geração não encontrada');
        if (!gen.output || !['concluida', 'aplicada'].includes(gen.status)) {
          throw unprocessable('Esta geração ainda não tem resultado para aplicar');
        }
        const applied = new Set(gen.output.appliedIndexes ?? []);
        const created: string[] = [];
        for (const index of req.body.itemIndexes) {
          const item = gen.output.items[index];
          if (!item) throw unprocessable(`Item ${index} inexistente`);
          if (applied.has(index)) continue;
          const checks = [...item.needs_verification, ...item.flags];
          const notes = [
            item.rationale ? `Por que este conteúdo: ${item.rationale}` : '',
            checks.length ? `⚠ Verificar antes de publicar:\n- ${checks.join('\n- ')}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          const row = await one<{ id: string }>(
            tx,
            `insert into activities (company_id, campaign_id, title, scheduled_date, scheduled_time, pillar, format,
               stories_count, objective, script, talking_points, recording_guidelines, caption_suggestion,
               call_to_action, assignee_id, status, notes, ai_generated, ai_generation_id, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pendente_aprovacao',$16,true,$17,$18)
             returning id`,
            [
              req.params.companyId,
              item.campaign_id,
              item.title.slice(0, 160),
              item.date,
              item.time,
              item.pillar,
              item.format,
              item.stories_count,
              item.objective,
              item.script,
              item.talking_points.map((t) => `• ${t}`).join('\n'),
              item.recording_guidelines,
              item.caption_suggestion.slice(0, 2200),
              item.call_to_action.slice(0, 500),
              req.body.assigneeId,
              notes,
              gen.id,
              userId,
            ],
          );
          created.push(row!.id);
          applied.add(index);
        }
        await tx.query(
          `update ai_generations set status = 'aplicada', applied_at = now(),
                  output = jsonb_set(output, '{appliedIndexes}', $2::jsonb) where id = $1`,
          [gen.id, JSON.stringify([...applied].sort((a, b) => a - b))],
        );
        return { created: created.length, activityIds: created };
      });
    },
  );
};
