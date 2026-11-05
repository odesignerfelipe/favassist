import {
  adminUserCreateSchema,
  adminUserUpdateSchema,
  manageableRoles,
  memberCreateSchema,
  memberUpdateSchema,
  uuid,
} from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buildUpdate, many, one } from '../db/database';
import { assertCompanyPermission, assertFavisAdmin, requireAuth, withUser } from '../lib/context';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';

const companyParams = z.object({ companyId: uuid });
const memberParams = z.object({ companyId: uuid, memberId: uuid });

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  const { auth, db } = app.deps;

  app.get(
    '/companies/:companyId/members',
    { schema: { tags: ['Equipe'], summary: 'Membros da empresa', params: companyParams } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'company.view');
      return withUser(req, (tx) =>
        many(
          tx,
          `select m.id, m.user_id, m.role, m.permissions, m.job_title, m.active, m.created_at,
                  p.full_name, p.email
             from company_members m join profiles p on p.id = m.user_id
            where m.company_id = $1
            order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end, p.full_name`,
          [req.params.companyId],
        ),
      );
    },
  );

  app.post(
    '/companies/:companyId/members',
    {
      schema: {
        tags: ['Equipe'],
        summary: 'Adicionar membro (cria o usuário se necessário)',
        params: companyParams,
        body: memberCreateSchema,
      },
    },
    async (req, reply) => {
      const actor = assertCompanyPermission(req, req.params.companyId, 'members.manage');
      const { email, fullName, role, jobTitle, permissions, password } = req.body;
      if (!manageableRoles(actor, req.params.companyId).includes(role)) {
        throw forbidden('Você não pode atribuir este papel');
      }

      // Usuário existente? (consulta de sistema: o e-mail pode ser de alguém de outra empresa)
      const existing = await db.asService((tx) =>
        one<{ id: string }>(tx, 'select id from profiles where lower(email) = lower($1)', [email]),
      );
      let userId = existing?.id;
      if (!userId) {
        if (!password) throw unprocessable('Informe uma senha inicial para o novo usuário', { field: 'password' });
        userId = await auth.createUser({ email, password, fullName });
      }

      const member = await withUser(req, (tx) =>
        one(
          tx,
          `insert into company_members (company_id, user_id, role, job_title, permissions)
           values ($1, $2, $3, $4, $5) returning *`,
          [req.params.companyId, userId, role, jobTitle, role === 'manager' ? permissions : {}],
        ),
      );
      return reply.status(201).send({ ...member, created: !existing });
    },
  );

  app.patch(
    '/companies/:companyId/members/:memberId',
    {
      schema: { tags: ['Equipe'], summary: 'Atualizar membro', params: memberParams, body: memberUpdateSchema },
    },
    async (req) => {
      const actor = assertCompanyPermission(req, req.params.companyId, 'members.manage');
      const allowed = manageableRoles(actor, req.params.companyId);
      const current = await withUser(req, (tx) =>
        one<{ role: string; userId: string }>(
          tx,
          'select role, user_id from company_members where id = $1 and company_id = $2',
          [req.params.memberId, req.params.companyId],
        ),
      );
      if (!current) throw notFound('Membro não encontrado');
      if (!allowed.includes(current.role as never) || (req.body.role && !allowed.includes(req.body.role))) {
        throw forbidden('Você não pode alterar este membro');
      }
      if (current.userId === actor.userId) throw unprocessable('Você não pode alterar o próprio vínculo');

      const { sets, values } = buildUpdate(req.body, {
        role: 'role',
        jobTitle: 'job_title',
        permissions: 'permissions',
        active: 'active',
      });
      if (!sets.length) throw badRequest('Nada para atualizar');
      return withUser(req, (tx) =>
        one(tx, `update company_members set ${sets.join(', ')} where id = $${values.length + 1} returning *`, [
          ...values,
          req.params.memberId,
        ]),
      );
    },
  );

  app.delete(
    '/companies/:companyId/members/:memberId',
    { schema: { tags: ['Equipe'], summary: 'Remover membro', params: memberParams } },
    async (req, reply) => {
      const actor = assertCompanyPermission(req, req.params.companyId, 'members.manage');
      const current = await withUser(req, (tx) =>
        one<{ role: string; userId: string }>(
          tx,
          'select role, user_id from company_members where id = $1 and company_id = $2',
          [req.params.memberId, req.params.companyId],
        ),
      );
      if (!current) throw notFound('Membro não encontrado');
      if (!manageableRoles(actor, req.params.companyId).includes(current.role as never)) throw forbidden();
      if (current.userId === actor.userId) throw unprocessable('Você não pode remover o próprio vínculo');
      await withUser(req, (tx) => tx.query('delete from company_members where id = $1', [req.params.memberId]));
      return reply.status(204).send();
    },
  );

  // ---------------- Usuários (Admin FAVIS) ----------------
  const tags = ['Administração'];

  app.get(
    '/admin/users',
    { schema: { tags, summary: 'Todos os usuários', querystring: z.object({ search: z.string().max(120).optional() }) } },
    async (req) => {
      assertFavisAdmin(req);
      const search = req.query.search?.trim();
      return withUser(req, (tx) =>
        many(
          tx,
          `select p.id, p.email, p.full_name, p.platform_role, p.active, p.created_at,
                  coalesce(json_agg(json_build_object('companyId', c.id, 'companyName', c.name, 'role', m.role))
                    filter (where m.id is not null), '[]') as memberships
             from profiles p
             left join company_members m on m.user_id = p.id
             left join companies c on c.id = m.company_id
            where ($1::text is null or p.full_name ilike '%' || $1 || '%' or p.email ilike '%' || $1 || '%')
            group by p.id
            order by p.full_name`,
          [search || null],
        ),
      );
    },
  );

  app.post(
    '/admin/users',
    { schema: { tags, summary: 'Criar usuário', body: adminUserCreateSchema } },
    async (req, reply) => {
      assertFavisAdmin(req);
      const exists = await db.asService((tx) =>
        one(tx, 'select 1 from profiles where lower(email) = lower($1)', [req.body.email]),
      );
      if (exists) throw conflict('Já existe um usuário com este e-mail');
      const id = await auth.createUser(req.body);
      const user = await withUser(req, async (tx) => {
        if (req.body.favisAdmin) await tx.query(`update profiles set platform_role = 'favis_admin' where id = $1`, [id]);
        return one(tx, 'select id, email, full_name, platform_role, active from profiles where id = $1', [id]);
      });
      return reply.status(201).send(user);
    },
  );

  app.patch(
    '/admin/users/:userId',
    {
      schema: { tags, summary: 'Atualizar usuário', params: z.object({ userId: uuid }), body: adminUserUpdateSchema },
    },
    async (req) => {
      assertFavisAdmin(req);
      const { userId: self } = requireAuth(req);
      const { fullName, favisAdmin, active, password } = req.body;
      if (req.params.userId === self && (favisAdmin === false || active === false)) {
        throw unprocessable('Você não pode remover o próprio acesso de administrador');
      }
      const user = await withUser(req, async (tx) => {
        const { sets, values } = buildUpdate(
          {
            fullName,
            active,
            platformRole: favisAdmin === undefined ? undefined : favisAdmin ? 'favis_admin' : null,
          },
          { fullName: 'full_name', active: 'active', platformRole: 'platform_role' },
        );
        if (sets.length) {
          await tx.query(`update profiles set ${sets.join(', ')} where id = $${values.length + 1}`, [
            ...values,
            req.params.userId,
          ]);
        }
        return one(tx, 'select id, email, full_name, platform_role, active from profiles where id = $1', [
          req.params.userId,
        ]);
      });
      if (!user) throw notFound('Usuário não encontrado');
      if (password) await auth.setPassword(req.params.userId, password);
      return user;
    },
  );
};
