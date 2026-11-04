import { consistencyScore, currentStreak, dateRangeQuerySchema, levelFromPoints, OPEN_STATUSES, uuid } from '@fav/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { many, one, type Tx } from '../db/database';
import { assertCompanyPermission, assertFavisAdmin, withUser } from '../lib/context';
import { badRequest, notFound } from '../lib/errors';
import { profileCompleteness } from './companies';

const params = z.object({ companyId: uuid });
const periodQuery = z.object({ period: z.enum(['week', 'month', 'year']).default('week') });

/** Indicadores de execução calculados das atividades (dados reais do sistema). */
async function executionStats(tx: Tx, companyId: string, from: string, to: string) {
  const company = await one<{ today: string; timezone: string }>(
    tx,
    `select (now() at time zone timezone)::date::text as today, timezone from companies where id = $1`,
    [companyId],
  );
  if (!company) throw notFound('Empresa não encontrada');
  const today = company.today;

  const byStatus = await many<{ status: string; total: number }>(
    tx,
    `select status, count(*) as total from activities
      where company_id = $1 and scheduled_date between $2 and $3 group by status`,
    [companyId, from, to],
  );
  const totals = await one<{
    planned: number;
    due: number;
    done: number;
    doneOnTime: number;
    overdue: number;
    storiesPlanned: number;
    storiesDone: number;
  }>(
    tx,
    `select count(*) filter (where status <> 'cancelada') as planned,
            count(*) filter (where status <> 'cancelada' and scheduled_date <= $4) as due,
            count(*) filter (where status = 'concluida') as done,
            count(*) filter (where status = 'concluida'
              and (completed_at at time zone $5)::date <= scheduled_date) as done_on_time,
            count(*) filter (where status = any($6) and scheduled_date < $4) as overdue,
            coalesce(sum(stories_count) filter (where status <> 'cancelada'), 0) as stories_planned,
            coalesce(sum(stories_count) filter (where status = 'concluida'), 0) as stories_done
       from activities where company_id = $1 and scheduled_date between $2 and $3`,
    [companyId, from, to, today, company.timezone, OPEN_STATUSES],
  );
  const pillars = await many<{ pillar: string; total: number }>(
    tx,
    `select pillar, count(*) as total from activities
      where company_id = $1 and scheduled_date between $2 and $3 and status <> 'cancelada'
      group by pillar order by total desc`,
    [companyId, from, to],
  );
  const campaignRow = await one<{ campaignRelated: number }>(
    tx,
    `select count(*) filter (where campaign_id is not null or pillar = 'campanha') as campaign_related
       from activities where company_id = $1 and scheduled_date between $2 and $3 and status <> 'cancelada'`,
    [companyId, from, to],
  );
  const t = totals!;
  return {
    today,
    period: { from, to },
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.total])),
    planned: t.planned,
    due: t.due,
    done: t.done,
    doneOnTime: t.doneOnTime,
    overdue: t.overdue,
    storiesPlanned: t.storiesPlanned,
    storiesDone: t.storiesDone,
    completionRate: t.due > 0 ? Math.round((Math.min(t.done, t.due) / t.due) * 1000) / 10 : null,
    pillars,
    campaignShare: t.planned > 0 ? Math.round(((campaignRow?.campaignRelated ?? 0) / t.planned) * 1000) / 10 : null,
  };
}

/** Expressão SQL do início do período (semana ISO, mês ou ano) a partir do parâmetro informado. */
function periodStart(period: 'week' | 'month' | 'year', param: string) {
  return `date_trunc('${period}', ${param}::date)::date`;
}

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/companies/:companyId/dashboard',
    {
      schema: { tags: ['Dashboard'], summary: 'Painel operacional da empresa', params, querystring: dateRangeQuerySchema },
    },
    async (req) => {
      const { companyId } = req.params;
      assertCompanyPermission(req, companyId, 'activities.view_all');
      const { from, to } = req.query;
      if (to < from) throw badRequest('Período inválido');
      return withUser(req, async (tx) => {
        const stats = await executionStats(tx, companyId, from, to);
        const profile = await one<Record<string, unknown>>(tx, 'select * from company_profiles where company_id = $1', [
          companyId,
        ]);
        const byAssignee = await many(
          tx,
          `select a.assignee_id, coalesce(p.full_name, 'Sem responsável') as name,
                  count(*) filter (where a.status <> 'cancelada') as total,
                  count(*) filter (where a.status = 'concluida') as done,
                  count(*) filter (where a.status = any($5) and a.scheduled_date < $4) as overdue,
                  count(*) filter (where a.status = 'impedida') as blocked
             from activities a left join profiles p on p.id = a.assignee_id
            where a.company_id = $1 and a.scheduled_date between $2 and $3
            group by a.assignee_id, p.full_name order by total desc`,
          [companyId, from, to, stats.today, OPEN_STATUSES],
        );
        const blockers = await many(
          tx,
          `select a.id, a.title, a.scheduled_date, p.full_name as assignee_name,
                  (select u.message from activity_updates u where u.activity_id = a.id and u.message <> ''
                    order by u.created_at desc limit 1) as last_message
             from activities a left join profiles p on p.id = a.assignee_id
            where a.company_id = $1 and a.status = 'impedida'
            order by a.scheduled_date limit 10`,
          [companyId],
        );
        const upcoming = await many(
          tx,
          `select a.id, a.title, a.scheduled_date, a.scheduled_time, a.pillar, a.format, a.status,
                  p.full_name as assignee_name
             from activities a left join profiles p on p.id = a.assignee_id
            where a.company_id = $1 and a.scheduled_date between $2 and ($2::date + 6) and a.status = any($3)
            order by a.scheduled_date, a.scheduled_time nulls last limit 12`,
          [companyId, stats.today, OPEN_STATUSES],
        );
        const campaigns = await many(
          tx,
          `select id, name, starts_on, ends_on, content_share from campaigns
            where company_id = $1 and status = 'ativa' and ends_on >= $2 order by starts_on`,
          [companyId, stats.today],
        );
        const recentActivity = await many(
          tx,
          `select u.id, u.kind, u.to_status, u.message, u.created_at, a.title, p.full_name as user_name
             from activity_updates u join activities a on a.id = u.activity_id
             left join profiles p on p.id = u.user_id
            where u.company_id = $1 order by u.created_at desc limit 8`,
          [companyId],
        );
        return {
          ...stats,
          campaignMixTarget: profile ? Math.round(Number(profile.campaignMixTarget) * 100) : 30,
          profileCompleteness: profile ? profileCompleteness(profile) : 0,
          byAssignee,
          blockers,
          upcoming,
          activeCampaigns: campaigns,
          recentActivity,
        };
      });
    },
  );

  app.get(
    '/admin/dashboard',
    { schema: { tags: ['Dashboard'], summary: 'Painel geral FAVIS', querystring: dateRangeQuerySchema } },
    async (req) => {
      assertFavisAdmin(req);
      const { from, to } = req.query;
      return withUser(req, async (tx) => {
        const counts = await one(
          tx,
          `select (select count(*) from companies where status = 'ativa') as companies,
                  (select count(*) from profiles where active) as users,
                  (select count(*) from campaigns where status = 'ativa' and current_date between starts_on and ends_on)
                    as active_campaigns,
                  (select count(*) from whatsapp_messages where direction = 'saida' and status = 'enviada'
                    and created_at > now() - interval '7 days') as messages_sent_7d,
                  (select count(*) from whatsapp_messages where direction = 'saida' and status = 'falhou'
                    and created_at > now() - interval '7 days') as messages_failed_7d,
                  (select count(*) from ai_generations where created_at > now() - interval '30 days') as ai_generations_30d`,
        );
        const companies = await many<Record<string, unknown> & { upcoming7d: number; overdue: number; blocked: number }>(
          tx,
          `select c.id, c.name, c.segment,
                  count(a.*) filter (where a.scheduled_date between $1 and $2 and a.status <> 'cancelada') as planned,
                  count(a.*) filter (where a.scheduled_date between $1 and least($2, current_date)
                    and a.status <> 'cancelada') as due,
                  count(a.*) filter (where a.scheduled_date between $1 and $2 and a.status = 'concluida') as done,
                  count(a.*) filter (where a.status = any($3) and a.scheduled_date < current_date) as overdue,
                  count(a.*) filter (where a.status = 'impedida') as blocked,
                  count(a.*) filter (where a.scheduled_date between current_date and current_date + 6
                    and a.status <> 'cancelada') as upcoming7d
             from companies c left join activities a on a.company_id = c.id
            where c.status = 'ativa'
            group by c.id order by c.name`,
          [from, to, OPEN_STATUSES],
        );
        const alerts = companies.flatMap((c) => {
          const list: { companyId: unknown; companyName: unknown; kind: string; message: string }[] = [];
          if (c.upcoming7d === 0)
            list.push({ companyId: c.id, companyName: c.name, kind: 'sem_planejamento', message: 'Sem atividades planejadas para os próximos 7 dias' });
          if (c.overdue > 0)
            list.push({ companyId: c.id, companyName: c.name, kind: 'atrasos', message: `${c.overdue} tarefa(s) atrasada(s)` });
          if (c.blocked > 0)
            list.push({ companyId: c.id, companyName: c.name, kind: 'impedidas', message: `${c.blocked} tarefa(s) impedida(s)` });
          return list;
        });
        return {
          period: { from, to },
          totals: counts,
          companies: companies.map((c) => ({
            ...c,
            completionRate:
              (c.due as number) > 0 ? Math.round((Math.min(c.done as number, c.due as number) / (c.due as number)) * 1000) / 10 : null,
          })),
          alerts,
        };
      });
    },
  );

  // ---------------- Gamificação ----------------
  app.get(
    '/companies/:companyId/gamification',
    {
      schema: { tags: ['Gamificação'], summary: 'Ranking e evolução da equipe', params, querystring: periodQuery },
    },
    async (req) => {
      const { companyId } = req.params;
      assertCompanyPermission(req, companyId, 'company.view');
      const period = req.query.period;
      return withUser(req, async (tx) => {
        const tz = await one<{ today: string; timezone: string }>(
          tx,
          `select (now() at time zone timezone)::date::text as today, timezone from companies where id = $1`,
          [companyId],
        );
        if (!tz) throw notFound('Empresa não encontrada');
        const start = (await one<{ start: string }>(tx, `select ${periodStart(period, '$1')}::text as start`, [
          tz.today,
        ]))!.start;

        const members = await many<{
          userId: string;
          name: string;
          role: string;
          totalPoints: number;
          periodPoints: number;
          due: number;
          completedOnTime: number;
          withEvidence: number;
          activeDays: string[];
          achievements: string[];
        }>(
          tx,
          `select m.user_id, p.full_name as name, m.role,
                  coalesce((select sum(points) from point_events e where e.user_id = m.user_id and e.company_id = $1), 0)
                    as total_points,
                  coalesce((select sum(points) from point_events e where e.user_id = m.user_id and e.company_id = $1
                    and (e.created_at at time zone $4)::date >= $2), 0) as period_points,
                  (select count(*) from activities a where a.assignee_id = m.user_id and a.company_id = $1
                    and a.scheduled_date between $2 and $3 and a.status <> 'cancelada') as due,
                  (select count(*) from point_events e where e.user_id = m.user_id and e.company_id = $1
                    and e.reason = 'conclusao' and (e.metadata ->> 'no_prazo')::boolean
                    and (e.created_at at time zone $4)::date >= $2) as completed_on_time,
                  (select count(*) from point_events e where e.user_id = m.user_id and e.company_id = $1
                    and e.reason = 'evidencia' and (e.created_at at time zone $4)::date >= $2) as with_evidence,
                  coalesce((select array_agg(distinct (e.created_at at time zone $4)::date::text)
                     from point_events e where e.user_id = m.user_id and e.company_id = $1 and e.reason = 'conclusao'
                      and e.created_at > now() - interval '120 days'), '{}') as active_days,
                  coalesce((select array_agg(code) from user_achievements ua
                     where ua.user_id = m.user_id and ua.company_id = $1), '{}') as achievements
             from company_members m join profiles p on p.id = m.user_id
            where m.company_id = $1 and m.active`,
          [companyId, start, tz.today, tz.timezone],
        );
        const ranking = members
          .map((m) => {
            const streak = currentStreak(m.activeDays, tz.today);
            return {
              userId: m.userId,
              name: m.name,
              role: m.role,
              totalPoints: m.totalPoints,
              periodPoints: m.periodPoints,
              level: levelFromPoints(m.totalPoints),
              due: m.due,
              completedOnTime: m.completedOnTime,
              withEvidence: m.withEvidence,
              streak,
              achievements: m.achievements,
              score: consistencyScore({
                due: m.due,
                completedOnTime: m.completedOnTime,
                completedWithEvidence: m.withEvidence,
                streak,
              }),
            };
          })
          .filter((m) => m.due > 0 || m.totalPoints > 0)
          .sort((a, b) => b.score - a.score || b.periodPoints - a.periodPoints);
        const achievements = await many(tx, 'select * from achievements order by points');
        return { period, from: start, to: tz.today, ranking, achievements };
      });
    },
  );

  app.get(
    '/admin/gamification/companies',
    { schema: { tags: ['Gamificação'], summary: 'Ranking de empresas (execução)', querystring: periodQuery } },
    async (req) => {
      assertFavisAdmin(req);
      const period = req.query.period;
      return withUser(req, async (tx) => {
        const rows = await many<{ id: string; name: string; due: number; onTime: number; done: number }>(
          tx,
          `select c.id, c.name,
                  count(a.*) filter (where a.status <> 'cancelada') as due,
                  count(a.*) filter (where a.status = 'concluida') as done,
                  count(a.*) filter (where a.status = 'concluida'
                    and (a.completed_at at time zone c.timezone)::date <= a.scheduled_date) as on_time
             from companies c
             left join activities a on a.company_id = c.id
              and a.scheduled_date between ${periodStart(period, '$1')} and $1
            where c.status = 'ativa'
            group by c.id order by c.name`,
          [new Date().toISOString().slice(0, 10)],
        );
        return rows
          .map((r) => ({
            ...r,
            executionRate: r.due > 0 ? Math.round((r.done / r.due) * 1000) / 10 : null,
            onTimeRate: r.due > 0 ? Math.round((r.onTime / r.due) * 1000) / 10 : null,
          }))
          .sort((a, b) => (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1));
      });
    },
  );
};

