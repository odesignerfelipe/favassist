import {
  companyCreateSchema,
  companyPermissions,
  companyProfileSchema,
  companyUpdateSchema,
  slugify,
  uuid,
} from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buildUpdate, many, one } from '../db/database';
import { assertCompanyPermission, assertFavisAdmin, requireAuth, withUser } from '../lib/context';
import { badRequest, notFound } from '../lib/errors';

const params = z.object({ companyId: uuid });
const tags = ['Empresas'];

const PROFILE_COLUMNS: Record<string, string> = {
  businessDescription: 'business_description',
  targetAudience: 'target_audience',
  products: 'products',
  services: 'services',
  differentiators: 'differentiators',
  positioning: 'positioning',
  brandPersonality: 'brand_personality',
  toneOfVoice: 'tone_of_voice',
  businessGoals: 'business_goals',
  marketingGoals: 'marketing_goals',
  mainChallenges: 'main_challenges',
  businessHours: 'business_hours',
  commercialDates: 'commercial_dates',
  contentRestrictions: 'content_restrictions',
  additionalInfo: 'additional_info',
  campaignMixTarget: 'campaign_mix_target',
};

/** Percentual de preenchimento do diagnóstico (campos textuais essenciais). */
export function profileCompleteness(p: Record<string, unknown>): number {
  const keys = [
    'businessDescription',
    'targetAudience',
    'products',
    'services',
    'differentiators',
    'positioning',
    'brandPersonality',
    'toneOfVoice',
    'businessGoals',
    'marketingGoals',
    'mainChallenges',
    'contentRestrictions',
  ];
  const filled = keys.filter((k) => typeof p[k] === 'string' && (p[k] as string).trim().length > 0).length;
  const hours = Array.isArray(p.businessHours) && p.businessHours.length > 0 ? 1 : 0;
  return Math.round(((filled + hours) / (keys.length + 1)) * 100);
}

export const companyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/companies', { schema: { tags, summary: 'Empresas visíveis ao usuário' } }, async (req) => {
    requireAuth(req);
    return withUser(req, (tx) =>
      many(
        tx,
        `select c.id, c.name, c.slug, c.segment, c.status, c.timezone, c.created_at,
                (select count(*) from company_members m where m.company_id = c.id and m.active) as members_count,
                (select count(*) from campaigns k where k.company_id = c.id and k.status = 'ativa'
                   and current_date between k.starts_on and k.ends_on) as active_campaigns,
                (select count(*) from activities a where a.company_id = c.id
                   and a.scheduled_date between current_date and current_date + 6
                   and a.status <> 'cancelada') as upcoming_activities
           from companies c
          order by c.name`,
      ),
    );
  });

  app.post(
    '/companies',
    { schema: { tags, summary: 'Cadastrar empresa (Admin FAVIS)', body: companyCreateSchema } },
    async (req, reply) => {
      const { userId } = requireAuth(req);
      assertFavisAdmin(req);
      const slug = req.body.slug ?? slugify(req.body.name);
      if (!slug) throw badRequest('Não foi possível gerar o identificador da empresa');
      const company = await withUser(req, (tx) =>
        one(
          tx,
          `insert into companies (name, slug, segment, timezone, created_by)
           values ($1, $2, $3, $4, $5) returning *`,
          [req.body.name, slug, req.body.segment, req.body.timezone, userId],
        ),
      );
      return reply.status(201).send(company);
    },
  );

  app.get('/companies/:companyId', { schema: { tags, summary: 'Detalhes da empresa', params } }, async (req) => {
    const actor = assertCompanyPermission(req, req.params.companyId, 'company.view');
    const company = await withUser(req, (tx) => one(tx, 'select * from companies where id = $1', [req.params.companyId]));
    if (!company) throw notFound('Empresa não encontrada');
    return { ...company, permissions: [...companyPermissions(actor, req.params.companyId)] };
  });

  app.patch(
    '/companies/:companyId',
    { schema: { tags, summary: 'Atualizar empresa (Admin FAVIS)', params, body: companyUpdateSchema } },
    async (req) => {
      assertFavisAdmin(req);
      const { sets, values } = buildUpdate(req.body, {
        name: 'name',
        segment: 'segment',
        timezone: 'timezone',
        status: 'status',
      });
      if (!sets.length) throw badRequest('Nada para atualizar');
      const row = await withUser(req, (tx) =>
        one(tx, `update companies set ${sets.join(', ')} where id = $${values.length + 1} returning *`, [
          ...values,
          req.params.companyId,
        ]),
      );
      if (!row) throw notFound('Empresa não encontrada');
      return row;
    },
  );

  app.get(
    '/companies/:companyId/profile',
    { schema: { tags: ['Diagnóstico'], summary: 'Diagnóstico estratégico', params } },
    async (req) => {
      assertCompanyPermission(req, req.params.companyId, 'company.view');
      const profile = await withUser(req, (tx) =>
        one<Record<string, unknown>>(
          tx,
          `select p.*, u.full_name as updated_by_name
             from company_profiles p left join profiles u on u.id = p.updated_by
            where p.company_id = $1`,
          [req.params.companyId],
        ),
      );
      if (!profile) throw notFound('Diagnóstico não encontrado');
      return { ...profile, completeness: profileCompleteness(profile) };
    },
  );

  app.put(
    '/companies/:companyId/profile',
    { schema: { tags: ['Diagnóstico'], summary: 'Salvar diagnóstico estratégico', params, body: companyProfileSchema } },
    async (req) => {
      const { userId } = requireAuth(req);
      assertCompanyPermission(req, req.params.companyId, 'profile.edit');
      const { sets, values } = buildUpdate(req.body, PROFILE_COLUMNS);
      const profile = await withUser(req, (tx) =>
        one<Record<string, unknown>>(
          tx,
          `update company_profiles set ${sets.join(', ')}, updated_by = $${values.length + 1}
            where company_id = $${values.length + 2} returning *`,
          [...values, userId, req.params.companyId],
        ),
      );
      if (!profile) throw notFound('Diagnóstico não encontrado');
      return { ...profile, completeness: profileCompleteness(profile) };
    },
  );
};
