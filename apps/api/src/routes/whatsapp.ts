import {
  sendDailySchema,
  simulatorInboundSchema,
  uuid,
  whatsappGroupCreateSchema,
  whatsappGroupUpdateSchema,
} from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buildUpdate, many, one } from '../db/database';
import { assertCompanyPermission, assertFavisAdmin, requireAuth, withUser } from '../lib/context';
import { badRequest, notFound } from '../lib/errors';

const params = z.object({ companyId: uuid });
const groupParams = z.object({ companyId: uuid, groupId: uuid });
const tags = ['WhatsApp (simulador)'];

export const whatsappRoutes: FastifyPluginAsyncZod = async (app) => {
  const { messaging } = app.deps;

  async function ensureGroup(companyId: string, groupId: string, req: Parameters<typeof withUser>[0]) {
    const g = await withUser(req, (tx) =>
      one(tx, 'select id from whatsapp_groups where company_id = $1 and id = $2', [companyId, groupId]),
    );
    if (!g) throw notFound('Grupo não encontrado');
  }

  app.get('/whatsapp/status', { schema: { tags, summary: 'Situação da conexão' } }, async (req) => {
    requireAuth(req);
    const settings = await withUser(req, (tx) =>
      one<{ messagingEnabled: boolean }>(tx, 'select messaging_enabled from platform_settings'),
    );
    return { ...(await messaging.status()), enabled: settings?.messagingEnabled ?? false };
  });

  app.get(
    '/companies/:companyId/whatsapp/groups',
    { schema: { tags, summary: 'Grupos vinculados à empresa', params } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'messaging.view');
      return withUser(req, (tx) =>
        many(
          tx,
          `select g.*,
                  (select max(sent_at) from whatsapp_messages m where m.group_id = g.id and m.status = 'enviada') as last_sent_at
             from whatsapp_groups g where g.company_id = $1 order by g.created_at`,
          [req.params.companyId],
        ),
      );
    },
  );

  app.post(
    '/companies/:companyId/whatsapp/groups',
    { schema: { tags, summary: 'Vincular grupo (Admin FAVIS)', params, body: whatsappGroupCreateSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      assertFavisAdmin(req);
      const b = req.body;
      const row = await withUser(req, (tx) =>
        one(
          tx,
          `insert into whatsapp_groups (company_id, provider, external_id, name, daily_send_time, send_weekdays, created_by)
           values ($1, $2, $3, $4, $5, $6, $7) returning *`,
          [req.params.companyId, messaging.providerName, b.externalId, b.name, b.dailySendTime, b.sendWeekdays, userId],
        ),
      );
      return reply.status(201).send(row);
    },
  );

  app.patch(
    '/companies/:companyId/whatsapp/groups/:groupId',
    { schema: { tags, summary: 'Configurar grupo / pausar automação', params: groupParams, body: whatsappGroupUpdateSchema } },
    async (req) => {
      assertFavisAdmin(req);
      const { sets, values } = buildUpdate(
        { ...req.body, sendWeekdays: undefined },
        { name: 'name', dailySendTime: 'daily_send_time', active: 'active', paused: 'paused' },
      );
      if (req.body.sendWeekdays) {
        values.push(req.body.sendWeekdays);
        sets.push(`send_weekdays = $${values.length}`);
      }
      if (!sets.length) throw badRequest('Nada para atualizar');
      const row = await withUser(req, (tx) =>
        one(
          tx,
          `update whatsapp_groups set ${sets.join(', ')} where company_id = $${values.length + 1} and id = $${values.length + 2} returning *`,
          [...values, req.params.companyId, req.params.groupId],
        ),
      );
      if (!row) throw notFound('Grupo não encontrado');
      return row;
    },
  );

  app.delete(
    '/companies/:companyId/whatsapp/groups/:groupId',
    { schema: { tags, summary: 'Desvincular grupo', params: groupParams } },
    async (req, reply) => {
      assertFavisAdmin(req);
      const res = await withUser(req, (tx) =>
        tx.query('delete from whatsapp_groups where company_id = $1 and id = $2', [req.params.companyId, req.params.groupId]),
      );
      if (!res.rowCount) throw notFound('Grupo não encontrado');
      return reply.status(204).send();
    },
  );

  app.post(
    '/companies/:companyId/whatsapp/groups/:groupId/send-daily',
    { schema: { tags, summary: 'Enviar cronograma do dia agora (simulado)', params: groupParams, body: sendDailySchema } },
    async (req) => {
      const { userId } = requireAuth(req);
      assertFavisAdmin(req);
      await ensureGroup(req.params.companyId, req.params.groupId, req);
      const date =
        req.body.date ??
        (await withUser(req, (tx) =>
          one<{ today: string }>(tx, `select (now() at time zone timezone)::date::text as today from companies where id = $1`, [
            req.params.companyId,
          ]),
        ))!.today;
      return messaging.sendDailySchedule(req.params.groupId, date, { trigger: 'manual', actorId: userId });
    },
  );

  app.post(
    '/companies/:companyId/whatsapp/groups/:groupId/send',
    {
      schema: {
        tags,
        summary: 'Enviar mensagem avulsa (simulado)',
        params: groupParams,
        body: z.object({ body: z.string().trim().min(1).max(4096) }),
      },
    },
    async (req) => {
      const { userId } = requireAuth(req);
      assertFavisAdmin(req);
      await ensureGroup(req.params.companyId, req.params.groupId, req);
      return messaging.sendManual(req.params.groupId, req.body.body, userId);
    },
  );

  app.post(
    '/companies/:companyId/whatsapp/groups/:groupId/simulate-inbound',
    {
      schema: {
        tags,
        summary: 'Simular mensagem recebida no grupo',
        params: groupParams,
        body: simulatorInboundSchema,
      },
    },
    async (req) => {
      assertFavisAdmin(req);
      await ensureGroup(req.params.companyId, req.params.groupId, req);
      return messaging.handleInbound(req.params.groupId, req.body.senderName, req.body.text);
    },
  );

  app.get(
    '/companies/:companyId/whatsapp/messages',
    {
      schema: {
        tags,
        summary: 'Histórico de mensagens',
        params,
        querystring: z.object({ groupId: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
      },
    },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'messaging.view');
      return withUser(req, (tx) =>
        many(
          tx,
          `select m.*, g.name as group_name from whatsapp_messages m left join whatsapp_groups g on g.id = m.group_id
            where m.company_id = $1 and ($2::uuid is null or m.group_id = $2)
            order by m.created_at desc limit $3`,
          [req.params.companyId, req.query.groupId ?? null, req.query.limit],
        ),
      );
    },
  );

  app.get(
    '/admin/whatsapp/messages',
    {
      schema: {
        tags,
        summary: 'Monitoramento de envios (todas as empresas)',
        querystring: z.object({
          status: z.enum(['pendente', 'enviada', 'falhou', 'ignorada', 'recebida']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
      },
    },
    async (req) => {
      assertFavisAdmin(req);
      return withUser(req, async (tx) => ({
        stats: await one(
          tx,
          `select count(*) filter (where status = 'enviada' and created_at > now() - interval '24 hours') as sent_24h,
                  count(*) filter (where status = 'falhou' and created_at > now() - interval '24 hours') as failed_24h,
                  count(*) filter (where status = 'pendente') as pending,
                  count(*) filter (where direction = 'entrada' and created_at > now() - interval '24 hours') as received_24h
             from whatsapp_messages`,
        ),
        messages: await many(
          tx,
          `select m.id, m.company_id, c.name as company_name, g.name as group_name, m.direction, m.kind, m.status,
                  m.body, m.attempts, m.last_error, m.created_at, m.sent_at, m.sender_name, m.reference_date
             from whatsapp_messages m join companies c on c.id = m.company_id
             left join whatsapp_groups g on g.id = m.group_id
            where ($1::text is null or m.status = $1)
            order by m.created_at desc limit $2`,
          [req.query.status ?? null, req.query.limit],
        ),
      }));
    },
  );
};
