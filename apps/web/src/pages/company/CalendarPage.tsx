import { ACTIVITY_STATUS_LABELS, ACTIVITY_STATUSES, type ActivityStatus } from '@fav/shared';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActivityDetailSheet } from '@/components/activity/activity-detail';
import { ActivityFormDialog, useCompanyLookups } from '@/components/activity/activity-form';
import { formatLabel, PILLAR_DOT, StatusBadge } from '@/components/activity/badges';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Segmented, Skeleton } from '@/components/ui/display';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Activity } from '@/lib/types';
import { cn, toISODate, todayISO } from '@/lib/utils';
import { useCompanyId } from './CompanyLayout';

type View = 'day' | 'week' | 'month';

function rangeFor(view: View, cursor: Date) {
  if (view === 'day') return { from: toISODate(cursor), to: toISODate(cursor) };
  if (view === 'week') {
    return { from: toISODate(startOfWeek(cursor, { weekStartsOn: 1 })), to: toISODate(endOfWeek(cursor, { weekStartsOn: 1 })) };
  }
  // Mês: grade completa (semanas inteiras)
  return {
    from: toISODate(startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })),
    to: toISODate(endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })),
  };
}

function ActivityChip({ a, onOpen, compact }: { a: Activity; onOpen: (id: string) => void; compact?: boolean }) {
  return (
    <button
      onClick={() => onOpen(a.id)}
      className={cn(
        'group flex w-full items-start gap-1.5 rounded-md border bg-surface px-2 py-1.5 text-left text-xs shadow-xs transition-colors hover:border-foreground/20',
        a.status === 'concluida' && 'bg-success-soft/60',
        a.status === 'impedida' && 'border-danger/30 bg-danger-soft/60',
        a.status === 'cancelada' && 'opacity-50 line-through',
      )}
      title={`${a.title} — ${ACTIVITY_STATUS_LABELS[a.status]}`}
    >
      <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', PILLAR_DOT[a.pillar])} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium">{a.title}</span>
        {!compact && (
          <span className="block truncate text-muted-foreground">
            {a.scheduledTime ?? '—'} · {a.assigneeName ?? 'sem resp.'}
          </span>
        )}
      </span>
    </button>
  );
}

function ActivityRow({ a, onOpen }: { a: Activity; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(a.id)} className="flex w-full items-center gap-3 rounded-lg border bg-surface p-3 text-left shadow-xs hover:border-foreground/20">
      <div className="w-12 shrink-0 text-sm font-medium tabular-nums">{a.scheduledTime ?? '—'}</div>
      <span className={cn('size-2 shrink-0 rounded-full', PILLAR_DOT[a.pillar])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{a.title}</p>
        <p className="truncate text-sm text-muted-foreground">
          {formatLabel(a.format, a.storiesCount)} · {a.assigneeName ?? 'Sem responsável'}
          {a.campaignName ? ` · ${a.campaignName}` : ''}
        </p>
      </div>
      <StatusBadge status={a.status} />
    </button>
  );
}

export default function CalendarPage() {
  const companyId = useCompanyId();
  const { can } = useAuth();
  const canManage = can(companyId, 'activities.manage');
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'week' : 'month'));
  const [cursor, setCursor] = useState(new Date());
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState<ActivityStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; activity?: Activity | null; date: string }>({ open: false, date: todayISO() });
  const { members } = useCompanyLookups(companyId);

  const range = rangeFor(view, cursor);
  const q = useQuery({
    queryKey: ['activities', companyId, range.from, range.to, assignee, status],
    queryFn: () =>
      api.get<Activity[]>(`/companies/${companyId}/activities`, {
        ...range,
        assigneeId: assignee || undefined,
        status: status || undefined,
      }),
  });

  const byDate = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of q.data ?? []) map.set(a.scheduledDate, [...(map.get(a.scheduledDate) ?? []), a]);
    return map;
  }, [q.data]);

  const move = (dir: 1 | -1) =>
    setCursor((c) => (view === 'day' ? addDays(c, dir) : view === 'week' ? addWeeks(c, dir) : addMonths(c, dir)));
  const title =
    view === 'day'
      ? format(cursor, "EEEE, d 'de' MMMM", { locale: ptBR })
      : view === 'week'
        ? `${format(startOfWeek(cursor, { weekStartsOn: 1 }), "d MMM", { locale: ptBR })} – ${format(endOfWeek(cursor, { weekStartsOn: 1 }), "d MMM yyyy", { locale: ptBR })}`
        : format(cursor, 'MMMM yyyy', { locale: ptBR });
  const today = todayISO();
  const days = eachDayOfInterval({ start: new Date(`${range.from}T12:00:00`), end: new Date(`${range.to}T12:00:00`) });
  const newAt = (date: string) => setForm({ open: true, activity: null, date });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => move(-1)} aria-label="Anterior">
            <ChevronLeft />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => move(1)} aria-label="Próximo">
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>
            Hoje
          </Button>
          <h2 className="ml-1 whitespace-nowrap text-lg font-semibold capitalize" aria-live="polite">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Visualização"
            value={view}
            onChange={setView}
            options={[
              { value: 'day', label: 'Dia' },
              { value: 'week', label: 'Semana' },
              { value: 'month', label: 'Mês' },
            ]}
          />
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-9 w-auto text-sm" aria-label="Filtrar por responsável">
            <option value="">Todos os responsáveis</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ActivityStatus | '')} className="h-9 w-auto text-sm" aria-label="Filtrar por status">
            <option value="">Todos os status</option>
            {ACTIVITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ACTIVITY_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          {canManage && (
            <Button onClick={() => newAt(view === 'day' ? toISODate(cursor) : today)}>
              <Plus /> Nova atividade
            </Button>
          )}
        </div>
      </div>

      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}

      {view === 'month' && (
        <div className="overflow-hidden rounded-xl border bg-surface">
          <div className="grid grid-cols-7 border-b bg-surface-muted/60 text-center text-xs font-medium uppercase text-muted-foreground">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const iso = toISODate(day);
              const items = byDate.get(iso) ?? [];
              const inMonth = isSameMonth(day, cursor);
              return (
                <div
                  key={iso}
                  className={cn('group relative min-h-16 border-b border-r p-1 sm:min-h-28 sm:p-1.5 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-surface-muted/40')}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <button
                      onClick={() => {
                        setCursor(day);
                        setView('day');
                      }}
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums hover:bg-surface-muted',
                        !inMonth && 'text-muted-foreground/60',
                        iso === today && 'bg-brand font-semibold text-brand-foreground hover:bg-brand',
                      )}
                      aria-label={`Ver ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                    >
                      {format(day, 'd')}
                    </button>
                    {canManage && (
                      <button
                        onClick={() => newAt(iso)}
                        className="hidden rounded p-0.5 text-muted-foreground opacity-0 hover:bg-surface-muted group-hover:opacity-100 sm:block"
                        aria-label={`Nova atividade em ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {/* Celular: pontos; telas maiores: chips */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {items.slice(0, 4).map((a) => (
                      <span key={a.id} className={cn('size-1.5 rounded-full', PILLAR_DOT[a.pillar])} />
                    ))}
                  </div>
                  <div className="hidden flex-col gap-1 sm:flex">
                    {items.slice(0, 3).map((a) => (
                      <ActivityChip key={a.id} a={a} onOpen={setOpenId} compact />
                    ))}
                    {items.length > 3 && (
                      <button className="text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => { setCursor(day); setView('day'); }}>
                        +{items.length - 3} mais
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'week' && (
        <div className="grid gap-3 lg:grid-cols-7 lg:gap-2">
          {days.map((day) => {
            const iso = toISODate(day);
            const items = byDate.get(iso) ?? [];
            return (
              <div key={iso} className={cn('rounded-xl border bg-surface p-2', iso === today && 'ring-2 ring-ring/30')}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-sm">
                    <span className="font-medium capitalize">{format(day, 'EEE', { locale: ptBR })}</span>{' '}
                    <span className="text-muted-foreground">{format(day, 'd/MM')}</span>
                  </p>
                  {canManage && (
                    <button onClick={() => newAt(iso)} className="rounded p-1 text-muted-foreground hover:bg-surface-muted" aria-label={`Nova atividade em ${format(day, 'd/MM')}`}>
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {q.isLoading ? <Skeleton className="h-10" /> : items.map((a) => <ActivityChip key={a.id} a={a} onOpen={setOpenId} />)}
                  {!q.isLoading && !items.length && <p className="px-1 pb-1 text-xs text-muted-foreground">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'day' && (
        <div className="flex flex-col gap-2">
          {q.isLoading && <Skeleton className="h-16" />}
          {(byDate.get(toISODate(cursor)) ?? []).map((a) => (
            <ActivityRow key={a.id} a={a} onOpen={setOpenId} />
          ))}
          {!q.isLoading && !(byDate.get(toISODate(cursor)) ?? []).length && (
            <EmptyState
              icon={Sparkles}
              title="Nenhuma atividade neste dia"
              action={canManage ? <Button variant="secondary" onClick={() => newAt(toISODate(cursor))}><Plus /> Criar atividade</Button> : undefined}
            />
          )}
        </div>
      )}

      <ActivityDetailSheet
        companyId={companyId}
        activityId={openId}
        onClose={() => setOpenId(null)}
        onEdit={(a) => {
          setOpenId(null);
          setForm({ open: true, activity: a, date: a.scheduledDate });
        }}
      />
      <ActivityFormDialog
        companyId={companyId}
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        activity={form.activity}
        defaultDate={form.date}
      />
    </div>
  );
}
