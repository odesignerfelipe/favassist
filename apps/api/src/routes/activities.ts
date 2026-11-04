import {
  activityCreateSchema,
  activityListQuerySchema,
  activityStatusChangeSchema,
  activityUpdateCreateSchema,
  activityUpdateSchema,
  availableTransitions,
  can,
  canTransition,
  collaboratorCanTransition,
  evidenceCreateSchema,
  isoDate,
  OPEN_STATUSES,
  uuid,
  type ActivityStatus,
  type Actor,
} from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buildUpdate, many, one, type Tx } from '../db/database';
import { assertCompanyPermission, requireAuth, withUser } from '../lib/context';
import { badRequest, forbidden, notFound, unprocessable } from '../lib/errors';

const params = z.object({ companyId: uuid });
const itemParams = z.object({ companyId: uuid, activityId: uuid });
const tags = ['Atividades'];

const COLUMNS: Record<string, string> = {
  title: 'title',
  scheduledDate: 'scheduled_date',
  scheduledTime: 'scheduled_time',
  pillar: 'pillar',
  format: 'format',
  storiesCount: 'stories_count',
  objective: 'objective',
  script: 'script',
  talkingPoints: 'talking_points',
  recordingGuidelines: 'recording_guidelines',
  captionSuggestion: 'caption_suggestion',
  callToAction: 'call_to_action',
  assigneeId: 'assignee_id',
  campaignId: 'campaign_id',
  notes: 'notes',
};

export const ACTIVITY_SELECT = `
  select a.*, p.full_name as assignee_name, k.name as campaign_name,
         (select count(*) from activity_evidences e where e.activity_id = a.id) as evidences_count
    from activities a
    left join profiles p on p.id = a.assignee_id
    left join campaigns k on k.id = a.campaign_id`;

interface ActivityRow {
  id: string;
  companyId: string;
  status: ActivityStatus;
  assigneeId: string | null;
}

function transitionsFor(actor: Actor, activity: ActivityRow): ActivityStatus[] {
  const manage = can(actor, activity.companyId, 'activities.manage');
  if (!manage && activity.assigneeId !== actor.userId) return [];
  return availableTransitions(activity.status, {
    isCollaboratorOnly: !manage,
    canApprove: can(actor, activity.companyId, 'activities.approve'),
  });
}

async function getActivity(tx: Tx, companyId: string, activityId: string) {
  return one<ActivityRow & Record<string, unknown>>(tx, `${ACTIVITY_SELECT} where a.company_id = $1 and a.id = $2`, [
    companyId,
    activityId,
  ]);
}

/** Aplica a mudança de status com as regras de papel (o banco revalida). Reutilizado pelo checklist. */
export async function changeActivityStatus(
  tx: Tx,
  actor: Actor,
  companyId: string,
  activityId: string,
  to: ActivityStatus,
  message: string,
) {
  const current = await one<ActivityRow>(tx, 'select id, company_id, status, assignee_id from activities where company_id = $1 and id = $2 for update', [
    companyId,
    activityId,
  ]);
  if (!current) throw notFound('Atividade não encontrada');
  const from = current.status;
  if (from === to) return current;
  if (!canTransition(from, to)) throw unprocessable(`Não é possível mudar de "${from}" para "${to}"`);
  const manage = can(actor, companyId, 'activities.manage');
  if (!manage) {
    if (current.assigneeId !== actor.userId) throw forbidden('Esta tarefa não está atribuída a você');
    if (!collaboratorCanTransition(from, to)) throw forbidden('Você não pode aplicar este status');
  }
  if (to === 'aprovada' && from === 'pendente_aprovacao' && !can(actor, companyId, 'activities.approve')) {
    throw forbidden('Você não tem permissão para aprovar atividades');
  }
  if (to === 'impedida' && message.trim().length < 3) {
    throw unprocessable('Descreva a dificuldade que impediu a tarefa');
  }
  await tx.query('update activities set status = $1 where id = $2', [to, activityId]);
  await tx.query(
    `insert into activity_updates (company_id, activity_id, user_id, kind, from_status, to_status, message)
     values ($1, $2, $3, 'status', $4, $5, $6)`,
    [companyId, activityId, actor.userId, from, to, message],
  );
  return { ...current, status: to };
}

export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/companies/:companyId/activities',
    { schema: { tags, summary: 'Atividades do período (calendário)', params, querystring: activityListQuerySchema } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'activities.execute');
      const q = req.query;
      if (q.to < q.from) throw badRequest('Período inválido');
      // Colaboradores recebem só as próprias tarefas (garantido pela RLS)
      return withUser(req, (tx) =>
        many(
          tx,
          `${ACTIVITY_SELECT}
            where a.company_id = $1 and a.scheduled_date between $2 and $3
              and ($4::text is null or a.status = $4)
              and ($5::uuid is null or a.assignee_id = $5)
              and ($6::uuid is null or a.campaign_id = $6)
            order by a.scheduled_date, a.scheduled_time nulls last, a.created_at`,
          [req.params.companyId, q.from, q.to, q.status ?? null, q.assigneeId ?? null, q.campaignId ?? null],
        ),
      );
    },
  );

  app.post(
    '/companies/:companyId/activities',
    { schema: { tags, summary: 'Criar atividade', params, body: activityCreateSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      const actor = assertCompanyPermission(req, req.params.companyId, 'activities.manage');
      const b = req.body;
      if (b.status === 'aprovada' && !can(actor, req.params.companyId, 'activities.approve')) {
        throw forbidden('Você não tem permissão para criar atividades já aprovadas');
      }
      const row = await withUser(req, async (tx) => {
        const created = await one<{ id: string }>(
          tx,
          `insert into activities (company_id, title, scheduled_date, scheduled_time, pillar, format, stories_count,
             objective, script, talking_points, recording_guidelines, caption_suggestion, call_to_action,
             assignee_id, campaign_id, notes, status, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
          [
            req.params.companyId,
            b.title,
            b.scheduledDate,
            b.scheduledTime,
            b.pillar,
            b.format,
            b.storiesCount,
            b.objective,
            b.script,
            b.talkingPoints,
            b.recordingGuidelines,
            b.captionSuggestion,
            b.callToAction,
            b.assigneeId,
            b.campaignId,
            b.notes,
            b.status,
            userId,
          ],
        );
        return getActivity(tx, req.params.companyId, created!.id);
      });
      return reply.status(201).send(row);
    },
  );

  app.get(
    '/companies/:companyId/activities/:activityId',
    { schema: { tags, summary: 'Detalhes da atividade', params: itemParams } },
    async (req) => {
      const actor = assertCompanyPermission(req, req.params.companyId, 'activities.execute');
      return withUser(req, async (tx) => {
        const activity = await getActivity(tx, req.params.companyId, req.params.activityId);
        if (!activity) throw notFound('Atividade não encontrada');
        const updates = await many(
          tx,
          `select u.*, p.full_name as user_name from activity_updates u left join profiles p on p.id = u.user_id
            where u.activity_id = $1 order by u.created_at desc`,
          [activity.id],
        );
        const evidences = await many(
          tx,
          `select e.*, p.full_name as created_by_name from activity_evidences e left join profiles p on p.id = e.created_by
            where e.activity_id = $1 order by e.created_at desc`,
          [activity.id],
        );
        return { ...activity, updates, evidences, availableTransitions: transitionsFor(actor, activity) };
      });
    },
  );

  app.patch(
    '/companies/:companyId/activities/:activityId',
    { schema: { tags, summary: 'Editar atividade', params: itemParams, body: activityUpdateSchema } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'activities.manage');
      const { sets, values } = buildUpdate(req.body, COLUMNS);
      if (!sets.length) throw badRequest('Nada para atualizar');
      return withUser(req, async (tx) => {
        const res = await tx.query(
          `update activities set ${sets.join(', ')} where company_id = $${values.length + 1} and id = $${values.length + 2}`,
          [...values, req.params.companyId, req.params.activityId],
        );
        if (!res.rowCount) throw notFound('Atividade não encontrada');
        return getActivity(tx, req.params.companyId, req.params.activityId);
      });
    },
  );

  app.delete(
    '/companies/:companyId/activities/:activityId',
    { schema: { tags, summary: 'Excluir atividade', params: itemParams } },
    async (req, reply) => {
      assertCompanyPermission(req, req.params.companyId, 'activities.manage');
      const res = await withUser(req, (tx) =>
        tx.query('delete from activities where company_id = $1 and id = $2', [req.params.companyId, req.params.activityId]),
      );
      if (!res.rowCount) throw notFound('Atividade não encontrada');
      return reply.status(204).send();
    },
  );

  app.post(
    '/companies/:companyId/activities/:activityId/status',
    { schema: { tags, summary: 'Mudar status', params: itemParams, body: activityStatusChangeSchema } },
    async (req) => {
      const actor = assertCompanyPermission(req, req.params.companyId, 'activities.execute');
      return withUser(req, async (tx) => {
        await changeActivityStatus(tx, actor, req.params.companyId, req.params.activityId, req.body.status, req.body.message);
        const activity = await getActivity(tx, req.params.companyId, req.params.activityId);
        return { ...activity!, availableTransitions: transitionsFor(actor, activity!) };
      });
    },
  );

  app.post(
    '/companies/:companyId/activities/:activityId/updates',
    { schema: { tags, summary: 'Comentar ou registrar dificuldade', params: itemParams, body: activityUpdateCreateSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      assertCompanyPermission(req, req.params.companyId, 'activities.execute');
      const row = await withUser(req, async (tx) => {
        const activity = await getActivity(tx, req.params.companyId, req.params.activityId);
        if (!activity) throw notFound('Atividade não encontrada');
        return one(
          tx,
          `insert into activity_updates (company_id, activity_id, user_id, kind, message)
           values ($1, $2, $3, $4, $5) returning *`,
          [req.params.companyId, req.params.activityId, userId, req.body.kind, req.body.message],
        );
      });
      return reply.status(201).send(row);
    },
  );

  app.post(
    '/companies/:companyId/activities/:activityId/evidences',
    { schema: { tags, summary: 'Enviar evidência (link ou texto)', params: itemParams, body: evidenceCreateSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      assertCompanyPermission(req, req.params.companyId, 'activities.execute');
      const b = req.body;
      const row = await withUser(req, async (tx) => {
        const activity = await getActivity(tx, req.params.companyId, req.params.activityId);
        if (!activity) throw notFound('Atividade não encontrada');
        return one(
          tx,
          `insert into activity_evidences (company_id, activity_id, kind, url, description, created_by)
           values ($1, $2, $3, $4, $5, $6) returning *`,
          [req.params.companyId, req.params.activityId, b.kind, b.kind === 'link' ? b.url : null, b.description, userId],
        );
      });
      return reply.status(201).send(row);
    },
  );

  app.delete(
    '/companies/:companyId/activities/:activityId/evidences/:evidenceId',
    {
      schema: {
        tags,
        summary: 'Remover evidência',
        params: z.object({ companyId: uuid, activityId: uuid, evidenceId: uuid }),
      },
    },
    async (req, reply) => {
      assertCompanyPermission(req, req.params.companyId, 'activities.execute');
      const res = await withUser(req, (tx) =>
        tx.query('delete from activity_evidences where id = $1 and activity_id = $2', [
          req.params.evidenceId,
          req.params.activityId,
        ]),
      );
      if (!res.rowCount) throw notFound('Evidência não encontrada');
      return reply.status(204).send();
    },
  );

  // ---------------- Checklist pessoal ----------------
  app.get(
    '/me/checklist',
    {
      schema: {
        tags: ['Checklist'],
        summary: 'Minhas tarefas do dia, atrasadas e próximas',
        querystring: z.object({ date: isoDate }),
      },
    },
    async (req) => {
      const { userId, actor } = requireAuth(req);
      const date = req.query.date;
      return withUser(req, async (tx) => {
        const base = `${ACTIVITY_SELECT.replace('select a.*,', 'select a.*, c.name as company_name,')}
          join companies c on c.id = a.company_id
          where a.assignee_id = $1`;
        const today = await many<ActivityRow>(
          tx,
          `${base} and a.scheduled_date = $2 and a.status <> 'cancelada'
           order by a.scheduled_time nulls last, a.created_at`,
          [userId, date],
        );
        const overdue = await many<ActivityRow>(
          tx,
          `${base} and a.scheduled_date < $2 and a.status = any($3)
           order by a.scheduled_date, a.scheduled_time nulls last`,
          [userId, date, OPEN_STATUSES],
        );
        const upcoming = await many<ActivityRow>(
          tx,
          `${base} and a.scheduled_date > $2 and a.scheduled_date <= ($2::date + 7) and a.status = any($3)
           order by a.scheduled_date, a.scheduled_time nulls last`,
          [userId, date, OPEN_STATUSES],
        );
        const withTransitions = (rows: ActivityRow[]) =>
          rows.map((r) => ({ ...r, availableTransitions: transitionsFor(actor, r) }));
        return { date, today: withTransitions(today), overdue: withTransitions(overdue), upcoming: withTransitions(upcoming) };
      });
    },
  );
};
