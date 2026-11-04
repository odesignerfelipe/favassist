import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActivityDetailSheet } from '@/components/activity/activity-detail';
import { formatLabel, PillarTag, StatusBadge } from '@/components/activity/badges';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Progress } from '@/components/ui/display';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Activity, Checklist } from '@/lib/types';
import { cn, formatDate, shiftISO, todayISO } from '@/lib/utils';

function TaskItem({ a, onOpen, showDate, multiCompany }: { a: Activity; onOpen: (a: Activity) => void; showDate?: boolean; multiCompany: boolean }) {
  const qc = useQueryClient();
  const done = a.status === 'concluida';
  const canComplete = a.availableTransitions?.includes('concluida');
  const complete = useMutation({
    mutationFn: () => api.post(`/companies/${a.companyId}/activities/${a.id}/status`, { status: 'concluida', message: '' }),
    onSuccess: () => {
      toast.success('Tarefa concluída! 🎉');
      void qc.invalidateQueries({ queryKey: ['checklist'] });
      void qc.invalidateQueries({ queryKey: ['dashboard', a.companyId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <li>
      <Card className={cn('flex items-start gap-3 p-4 transition-colors', done && 'bg-success-soft/40')}>
        <button
          onClick={() => canComplete && complete.mutate()}
          disabled={!canComplete || complete.isPending}
          className={cn('mt-0.5 shrink-0 rounded-full transition-transform active:scale-90', canComplete ? 'text-muted-foreground hover:text-success' : 'cursor-default')}
          aria-label={done ? 'Concluída' : `Concluir: ${a.title}`}
        >
          {done ? <CheckCircle2 className="size-6 text-success" /> : <Circle className={cn('size-6', complete.isPending && 'animate-pulse')} />}
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(a)}>
          <p className={cn('font-medium', done && 'text-muted-foreground line-through')}>{a.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {showDate && `${formatDate(a.scheduledDate, 'EEE, d MMM')} · `}
            {a.scheduledTime ?? 'Sem horário'} · {formatLabel(a.format, a.storiesCount)}
            {multiCompany && a.companyName ? ` · ${a.companyName}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            <PillarTag pillar={a.pillar} />
          </div>
          {a.callToAction && !done && <p className="mt-2 text-sm">➜ {a.callToAction}</p>}
          <span className="mt-2 inline-block text-sm text-accent">Ver roteiro e orientações</span>
        </button>
      </Card>
    </li>
  );
}

export default function ChecklistPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [open, setOpen] = useState<Activity | null>(null);
  const q = useQuery({ queryKey: ['checklist', date], queryFn: () => api.get<Checklist>('/me/checklist', { date }), refetchInterval: 60_000 });
  const multi = (user?.companies.length ?? 0) > 1;
  const isToday = date === todayISO();
  const d = q.data;
  const doneToday = d?.today.filter((a) => a.status === 'concluida').length ?? 0;
  const totalToday = d?.today.length ?? 0;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={`Olá, ${user?.fullName.split(' ')[0] ?? ''}`}
        title={isToday ? 'Suas tarefas de hoje' : `Tarefas de ${formatDate(date, "d 'de' MMMM")}`}
        description={formatDate(date, "EEEE, d 'de' MMMM")}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon" onClick={() => setDate(shiftISO(date, -1))} aria-label="Dia anterior">
              <ChevronLeft />
            </Button>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setDate(todayISO())}>
                Hoje
              </Button>
            )}
            <Button variant="secondary" size="icon" onClick={() => setDate(shiftISO(date, 1))} aria-label="Próximo dia">
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {d && (
        <div className="flex flex-col gap-8">
          {totalToday > 0 && (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">Progresso do dia</span>
                <span className="tabular-nums text-muted-foreground">
                  {doneToday} de {totalToday}
                </span>
              </div>
              <Progress value={(doneToday / totalToday) * 100} label="Progresso do dia" />
            </Card>
          )}

          {!!d.overdue.length && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-danger">Atrasadas ({d.overdue.length})</h2>
              <ul className="flex flex-col gap-3">
                {d.overdue.map((a) => (
                  <TaskItem key={a.id} a={a} onOpen={setOpen} showDate multiCompany={multi} />
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{isToday ? 'Hoje' : 'No dia'}</h2>
            {d.today.length ? (
              <ul className="flex flex-col gap-3">
                {d.today.map((a) => (
                  <TaskItem key={a.id} a={a} onOpen={setOpen} multiCompany={multi} />
                ))}
              </ul>
            ) : (
              <EmptyState icon={PartyPopper} title="Nenhuma tarefa para este dia" description="Quando houver conteúdos atribuídos a você, eles aparecem aqui." />
            )}
            {totalToday > 0 && doneToday === totalToday && (
              <p className="mt-4 text-center text-sm font-medium text-success">Tudo concluído. Excelente trabalho! 🎉</p>
            )}
          </section>

          {!!d.upcoming.length && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Próximos dias</h2>
              <ul className="flex flex-col gap-3">
                {d.upcoming.map((a) => (
                  <TaskItem key={a.id} a={a} onOpen={setOpen} showDate multiCompany={multi} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {open && <ActivityDetailSheet companyId={open.companyId} activityId={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}
