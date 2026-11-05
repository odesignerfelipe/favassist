import { uuid } from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { many, one } from '../db/database';
import { requireAuth, withUser } from '../lib/context';

const tags = ['Notificações'];

/** Notificações do próprio usuário (a RLS garante que ninguém vê as de outra pessoa). */
export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/notifications',
    {
      schema: {
        tags,
        summary: 'Minhas notificações e total não lido',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
      },
    },
    async (req) => {
      requireAuth(req);
      return withUser(req, async (tx) => ({
        unread: (await one<{ n: number }>(tx, 'select count(*) as n from notifications where read_at is null'))!.n,
        items: await many(
          tx,
          `select n.id, n.company_id, c.name as company_name, n.kind, n.title, n.body, n.activity_id,
                  n.read_at, n.created_at
             from notifications n left join companies c on c.id = n.company_id
            order by n.created_at desc limit $1`,
          [req.query.limit],
        ),
      }));
    },
  );

  app.post(
    '/me/notifications/read',
    {
      schema: {
        tags,
        summary: 'Marcar como lidas (todas, ou só os ids informados)',
        body: z.object({ ids: z.array(uuid).max(100).optional() }),
      },
    },
    async (req) => {
      requireAuth(req);
      const ids = req.body.ids ?? null;
      const res = await withUser(req, (tx) =>
        tx.query(
          `update notifications set read_at = now()
            where read_at is null and ($1::uuid[] is null or id = any($1))`,
          [ids],
        ),
      );
      return { updated: res.rowCount ?? 0 };
    },
  );
};
