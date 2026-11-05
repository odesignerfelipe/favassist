import { ACTIVITY_STATUS_LABELS, CONTENT_PILLAR_LABELS, type ActivityStatus } from '@fav/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, ClipboardList, FileText, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActivityDetailSheet } from '@/components/activity/activity-detail';
import { PILLAR_DOT, StatusBadge } from '@/components/activity/badges';
import { Button } from '@/components/ui/button';
import {
  Avatar,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Progress,
  Segmented,
  StatCard,
} from '@/components/ui/display';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CompanyDashboard } from '@/lib/types';
import { formatDate, formatDateTime, monthRange, pct, weekRange } from '@/lib/utils';
import { useCompanyId } from './CompanyLayout';

export default function OverviewPage() {
  const companyId = useCompanyId();
  const { can } = useAuth();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [openId, setOpenId] = useState<string | null>(null);
  const range = period === 'week' ? weekRange(new Date()) : monthRange(new Date());
  const q = useQuery({
    queryKey: ['dashboard', companyId, range.from, range.to],
    queryFn: () => api.get<CompanyDashboard>(`/companies/${companyId}/dashboard`, range),
    refetchInterval: 30_000, // acompanhamento em tempo quase real
  });

  if (q.isLoading) return <LoadingBlock rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const totalPillars = d.pillars.reduce((s, p) => s + p.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Período"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'Esta semana' },
            { value: 'month', label: 'Este mês' },
          ]}
        />
        <div className="flex gap-2">
          {can(companyId, 'ai.use') && (
            <Button variant="secondary" asChild>
              <Link to="ia">
                <Sparkles /> Planejar com IA
              </Link>
            </Button>
          )}
          {can(companyId, 'activities.manage') && (
            <Button asChild>
              <Link to="calendario">
                <CalendarPlus /> Abrir calendário
              </Link>
            </Button>
          )}
        </div>
      </div>

      {d.profileCompleteness < 60 && (
        <Card className="flex flex-col gap-3 border-warning/30 bg-warning-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 size-5 text-warning" />
            <div>
              <p className="font-medium">Diagnóstico {d.profileCompleteness}% preenchido</p>
              <p className="text-sm text-muted-foreground">Quanto mais completo, mais personalizado fica o planejamento.</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link to="diagnostico">Completar diagnóstico</Link>
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Execução no período"
          value={pct(d.completionRate)}
          hint={d.due ? `${d.done} de ${d.due} tarefas vencidas` : 'Nenhuma tarefa vencida ainda'}
          tone={d.completionRate !== null && d.completionRate >= 80 ? 'success' : undefined}
        />
        <StatCard label="Planejadas" value={d.planned} hint={`${d.storiesPlanned} Stories previstos`} />
        <StatCard label="Concluídas" value={d.done} hint={`${d.doneOnTime} no prazo · ${d.storiesDone} Stories`} />
        <StatCard label="Atrasadas" value={d.overdue} tone={d.overdue ? 'danger' : undefined} hint="Abertas com data passada" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Próximos 7 dias</CardTitle>
              <CardDescription>Atividades abertas</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="calendario">
                Calendário <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-3">
            {d.upcoming.length ? (
              <ul className="divide-y">
                {d.upcoming.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-surface-muted/50">
                      <div className="w-14 shrink-0 text-center">
                        <p className="text-xs uppercase text-muted-foreground">{formatDate(a.scheduledDate, 'EEE')}</p>
                        <p className="text-lg font-semibold leading-tight">{formatDate(a.scheduledDate, 'd')}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {a.scheduledTime ?? 'Sem horário'} · {a.assigneeName ?? 'Sem responsável'}
                        </p>
                      </div>
                      <StatusBadge status={a.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={ClipboardList}
                title="Nada planejado para os próximos dias"
                description="Crie atividades no calendário ou gere um planejamento com a IA."
              />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Equilíbrio de conteúdo</CardTitle>
                <CardDescription>
                  Campanha: {pct(d.campaignShare)} · referência {d.campaignMixTarget}%
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {totalPillars ? (
                <>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                    {d.pillars.map((p) => (
                      <div key={p.pillar} className={PILLAR_DOT[p.pillar]} style={{ width: `${(p.total / totalPillars) * 100}%` }} />
                    ))}
                  </div>
                  <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    {d.pillars.map((p) => (
                      <li key={p.pillar} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span className={`size-2 rounded-full ${PILLAR_DOT[p.pillar]}`} />
                          {CONTENT_PILLAR_LABELS[p.pillar]}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{p.total}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Sem atividades no período.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status no período</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(d.byStatus).length ? (
                Object.entries(d.byStatus).map(([s, n]) => (
                  <span key={s} className="inline-flex items-center gap-1.5 text-sm">
                    <StatusBadge status={s as ActivityStatus} />
                    <span className="tabular-nums">{n}</span>
                  </span>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Sem atividades no período.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Equipe</CardTitle>
          </CardHeader>
          <CardContent>
            {d.byAssignee.length ? (
              <ul className="flex flex-col gap-4">
                {d.byAssignee.map((m) => (
                  <li key={m.assigneeId ?? 'none'} className="flex items-center gap-3">
                    <Avatar name={m.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{m.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {m.done}/{m.total}
                          {m.overdue > 0 && <span className="text-danger"> · {m.overdue} atrasada(s)</span>}
                        </span>
                      </div>
                      <Progress value={m.total ? (m.done / m.total) * 100 : 0} className="mt-1.5" label={`Progresso de ${m.name}`} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sem atividades atribuídas no período.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dificuldades e movimentações</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.blockers.map((b) => (
              <button key={b.id} onClick={() => setOpenId(b.id)} className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-left">
                <p className="text-sm font-medium text-danger">Impedida: {b.title}</p>
                {b.lastMessage && <p className="mt-0.5 text-sm">{b.lastMessage}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {b.assigneeName ?? 'Sem responsável'} · {formatDate(b.scheduledDate)}
                </p>
              </button>
            ))}
            <ul className="flex flex-col gap-2.5">
              {d.recentActivity.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="font-medium">{r.userName ?? 'Sistema'}</span>{' '}
                  <span className="text-muted-foreground">
                    {r.toStatus ? `→ ${ACTIVITY_STATUS_LABELS[r.toStatus]}` : r.kind === 'dificuldade' ? 'relatou dificuldade' : 'comentou'} em
                  </span>{' '}
                  {r.title}
                  <span className="block text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                </li>
              ))}
            </ul>
            {!d.blockers.length && !d.recentActivity.length && <p className="text-sm text-muted-foreground">Nenhuma movimentação recente.</p>}
          </CardContent>
        </Card>
      </div>

      <ActivityDetailSheet companyId={companyId} activityId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
