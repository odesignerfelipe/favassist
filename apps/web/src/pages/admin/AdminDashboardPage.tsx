import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Building2, CalendarX2, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, LoadingBlock, PageHeader, Progress, StatCard } from '@/components/ui/display';
import { api } from '@/lib/api';
import type { AdminDashboard } from '@/lib/types';
import { formatDate, pct, weekRange } from '@/lib/utils';

const ALERT_ICON = { sem_planejamento: CalendarX2, atrasos: Clock, impedidas: AlertTriangle } as Record<string, typeof Clock>;

export default function AdminDashboardPage() {
  const range = weekRange(new Date());
  const q = useQuery({
    queryKey: ['admin-dashboard', range.from],
    queryFn: () => api.get<AdminDashboard>('/admin/dashboard', range),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <PageHeader
        eyebrow="FAVIS"
        title="Visão geral"
        description={`Semana de ${formatDate(range.from)} a ${formatDate(range.to)}`}
        actions={
          <Button asChild>
            <Link to="/admin/empresas">
              <Building2 /> Empresas
            </Link>
          </Button>
        }
      />
      {q.isLoading && <LoadingBlock rows={4} />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Empresas ativas" value={q.data.totals.companies} hint={`${q.data.totals.users} usuários ativos`} />
            <StatCard label="Campanhas em andamento" value={q.data.totals.activeCampaigns} />
            <StatCard
              label="Mensagens (7 dias)"
              value={q.data.totals.messagesSent7d}
              hint={q.data.totals.messagesFailed7d ? `${q.data.totals.messagesFailed7d} falha(s)` : 'Sem falhas'}
              tone={q.data.totals.messagesFailed7d ? 'warning' : undefined}
            />
            <StatCard label="Planejamentos por IA (30 dias)" value={q.data.totals.aiGenerations30d} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Execução por empresa</CardTitle>
                  <CardDescription>Tarefas vencidas na semana × concluídas</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {!q.data.companies.length ? (
                  <EmptyState icon={Building2} title="Nenhuma empresa cadastrada" action={<Button asChild><Link to="/admin/empresas">Cadastrar empresa</Link></Button>} />
                ) : (
                  <ul className="divide-y">
                    {q.data.companies.map((c) => (
                      <li key={c.id}>
                        <Link to={`/empresas/${c.id}`} className="flex items-center gap-4 py-3 hover:bg-surface-muted/40">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{c.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {c.done}/{c.due} vencidas concluídas · {c.planned} planejadas
                              {c.overdue ? <span className="text-danger"> · {c.overdue} atrasada(s)</span> : null}
                            </p>
                          </div>
                          <div className="w-28 shrink-0">
                            <p className="mb-1 text-right text-sm font-semibold tabular-nums">{pct(c.completionRate)}</p>
                            <Progress value={c.completionRate ?? 0} label={`Execução de ${c.name}`} />
                          </div>
                          <ArrowRight className="size-4 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Alertas</CardTitle>
                  <CardDescription>O que precisa de atenção</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {!q.data.alerts.length && <p className="text-sm text-muted-foreground">Nenhum alerta. Tudo em dia. ✅</p>}
                {q.data.alerts.map((a, i) => {
                  const Icon = ALERT_ICON[a.kind] ?? AlertTriangle;
                  return (
                    <Link key={i} to={`/empresas/${a.companyId}`} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-surface-muted/50">
                      <Icon className={a.kind === 'sem_planejamento' ? 'mt-0.5 size-4 text-warning' : 'mt-0.5 size-4 text-danger'} />
                      <div className="text-sm">
                        <p className="font-medium">{a.companyName}</p>
                        <p className="text-muted-foreground">{a.message}</p>
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
