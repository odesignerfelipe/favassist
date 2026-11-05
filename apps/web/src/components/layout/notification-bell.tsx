import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, ClipboardList, Hourglass } from 'lucide-react';
import { DropdownMenu as DM } from 'radix-ui';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

interface Notification {
  id: string;
  companyId: string;
  companyName: string | null;
  kind: 'tarefa_atribuida' | 'tarefa_aprovada' | 'tarefa_impedida' | 'aprovacao_pendente';
  title: string;
  body: string;
  activityId: string | null;
  readAt: string | null;
  createdAt: string;
}

const ICON = {
  tarefa_atribuida: { icon: ClipboardList, tone: 'text-accent-ink' },
  tarefa_aprovada: { icon: CheckCircle2, tone: 'text-success' },
  tarefa_impedida: { icon: AlertTriangle, tone: 'text-danger' },
  aprovacao_pendente: { icon: Hourglass, tone: 'text-warning' },
} as const;

/** Sino de notificações: atualiza a cada minuto e ao voltar para o app. */
export function NotificationBell({ className }: { className?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; items: Notification[] }>('/me/notifications', { limit: 30 }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled: !!user,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post('/me/notifications/read', ids ? { ids } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = q.data?.unread ?? 0;
  const items = q.data?.items ?? [];

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate([n.id]);
    const manages = user?.isFavisAdmin || can(n.companyId, 'activities.view_all');
    if (n.kind === 'aprovacao_pendente' || (manages && n.kind === 'tarefa_impedida')) {
      navigate(`/empresas/${n.companyId}${n.activityId ? `?atividade=${n.activityId}` : ''}`);
    } else if (n.activityId) {
      navigate(`/minhas-tarefas?atividade=${n.activityId}&empresa=${n.companyId}`);
    } else {
      navigate(manages ? `/empresas/${n.companyId}` : '/minhas-tarefas');
    }
  };

  return (
    <DM.Root onOpenChange={(o) => o && void q.refetch()}>
      <DM.Trigger
        className={cn('relative rounded-md p-2 text-foreground/80 hover:bg-surface-muted hover:text-foreground', className)}
        aria-label={unread ? `Notificações: ${unread} não lida(s)` : 'Notificações'}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-brand">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border bg-surface shadow-xl data-[state=open]:animate-fade-in"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="font-semibold">Notificações</p>
            {unread > 0 && (
              <button
                onClick={() => markRead.mutate(undefined)}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline"
              >
                <CheckCheck className="size-4" /> Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {!items.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação por enquanto.</p>}
            {items.map((n) => {
              const { icon: Icon, tone } = ICON[n.kind];
              return (
                <DM.Item
                  key={n.id}
                  onSelect={() => open(n)}
                  className={cn(
                    'flex cursor-pointer gap-3 border-b px-4 py-3 outline-none last:border-b-0 data-[highlighted]:bg-surface-muted',
                    !n.readAt && 'bg-accent-soft/50',
                  )}
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(user?.companies.length ?? 0) > 1 || user?.isFavisAdmin ? `${n.companyName} · ` : ''}
                      {formatDateTime(n.createdAt)}
                    </p>
                  </div>
                  {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Não lida" />}
                </DM.Item>
              );
            })}
          </div>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
