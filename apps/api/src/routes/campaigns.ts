import { CAMPAIGN_STATUSES, campaignCreateSchema, campaignUpdateSchema, uuid } from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buildUpdate, many, one } from '../db/database';
import { assertCompanyPermission, requireAuth, withUser } from '../lib/context';
import { badRequest, notFound, unprocessable } from '../lib/errors';

const params = z.object({ companyId: uuid });
const itemParams = z.object({ companyId: uuid, campaignId: uuid });
const tags = ['Campanhas'];

const COLUMNS: Record<string, string> = {
  name: 'name',
  objectives: 'objectives',
  startsOn: 'starts_on',
  endsOn: 'ends_on',
  products: 'products',
  offers: 'offers',
  notes: 'notes',
  status: 'status',
  contentShare: 'content_share',
};

const SELECT = `
  select k.*,
         (select count(*) from activities a where a.campaign_id = k.id and a.status <> 'cancelada') as activities_count,
         (select count(*) from activities a where a.campaign_id = k.id and a.status = 'concluida') as completed_count
    from campaigns k`;

export const campaignRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/companies/:companyId/campaigns',
    {
      schema: {
        tags,
        summary: 'Listar campanhas',
        params,
        querystring: z.object({ status: z.enum(CAMPAIGN_STATUSES).optional() }),
      },
    },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'company.view');
      return withUser(req, (tx) =>
        many(
          tx,
          `${SELECT} where k.company_id = $1 and ($2::text is null or k.status = $2)
           order by (k.status = 'ativa') desc, k.starts_on desc`,
          [req.params.companyId, req.query.status ?? null],
        ),
      );
    },
  );

  app.post(
    '/companies/:companyId/campaigns',
    { schema: { tags, summary: 'Cadastrar campanha', params, body: campaignCreateSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      assertCompanyPermission(req, req.params.companyId, 'campaigns.manage');
      const b = req.body;
      const row = await withUser(req, (tx) =>
        one(
          tx,
          `insert into campaigns (company_id, name, objectives, starts_on, ends_on, products, offers, notes,
                                  status, content_share, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
          [
            req.params.companyId,
            b.name,
            b.objectives,
            b.startsOn,
            b.endsOn,
            b.products,
            b.offers,
            b.notes,
            b.status,
            b.contentShare,
            userId,
          ],
        ),
      );
      return reply.status(201).send(row);
    },
  );

  app.get(
    '/companies/:companyId/campaigns/:campaignId',
    { schema: { tags, summary: 'Detalhes da campanha', params: itemParams } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'company.view');
      const row = await withUser(req, (tx) =>
        one(tx, `${SELECT} where k.company_id = $1 and k.id = $2`, [req.params.companyId, req.params.campaignId]),
      );
      if (!row) throw notFound('Campanha não encontrada');
      return row;
    },
  );

  app.patch(
    '/companies/:companyId/campaigns/:campaignId',
    { schema: { tags, summary: 'Atualizar campanha', params: itemParams, body: campaignUpdateSchema } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'campaigns.manage');
      const { sets, values } = buildUpdate(req.body, COLUMNS);
      if (!sets.length) throw badRequest('Nada para atualizar');
      const row = await withUser(req, (tx) =>
        one(
          tx,
          `update campaigns set ${sets.join(', ')}
            where company_id = $${values.length + 1} and id = $${values.length + 2} returning *`,
          [...values, req.params.companyId, req.params.campaignId],
        ),
      );
      if (!row) throw notFound('Campanha não encontrada');
      return row;
    },
  );

  app.delete(
    '/companies/:companyId/campaigns/:campaignId',
    { schema: { tags, summary: 'Excluir campanha', params: itemParams } },
    async (req, reply) => {
      assertCompanyPermission(req, req.params.companyId, 'campaigns.manage');
      const linked = await withUser(req, (tx) =>
        one<{ n: number }>(tx, `select count(*) as n from activities where campaign_id = $1 and status = 'concluida'`, [
          req.params.campaignId,
        ]),
      );
      if (linked && linked.n > 0) {
        throw unprocessable('Campanha com atividades concluídas não pode ser excluída. Altere o status para "encerrada".');
      }
      const res = await withUser(req, (tx) =>
        tx.query('delete from campaigns where company_id = $1 and id = $2', [req.params.companyId, req.params.campaignId]),
      );
      if (!res.rowCount) throw notFound('Campanha não encontrada');
      return reply.status(204).send();
    },
  );
};
