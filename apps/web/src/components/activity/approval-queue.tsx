import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/display';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Activity } from '@/lib/types';
import { formatDate, shiftISO, todayISO } from '@/lib/utils';
import { invalidateActivityQueries } from './activity-form';
import { formatLabel, PillarTag } from './badges';

/** Tarefas aguardando aprovação (ex.: planejamento gerado pela IA). Some quando não há pendências. */
export function ApprovalQueue({ companyId, onOpen }: { companyId: string; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canApprove = can(companyId, 'activities.approve');
  const range = { from: shiftISO(todayISO(), -60), to: shiftISO(todayISO(), 120) };
  const q = useQuery({
    queryKey: ['activities', companyId, 'approval-queue'],
    queryFn: () => api.get<Activity[]>(`/companies/${companyId}/activities`, { ...range, status: 'pendente_aprovacao' }),
  });

  const approve = useMutation({
    mutationFn: async (ids: string[]) => {
      // Sequencial: cada aprovação passa pelas regras de permissão e de status na API
      for (const id of ids) {
        await api.post(`/companies/${companyId}/activities/${id}/status`, { status: 'aprovada', message: '' });
      }
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? 'Atividade aprovada' : `${n} atividades aprovadas`);
      invalidateActivityQueries(qc, companyId);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      invalidateActivityQueries(qc, companyId);
    },
  });

  const items = q.data ?? [];
  if (!items.length) return null;

  return (
    <Card className="border-warning/30">
      <CardHeader>
        <div>
          <CardTitle>Aguardando aprovação ({items.length})</CardTitle>
          <CardDescription>
            {canApprove
              ? 'Revise e aprove para que entrem no cronograma da equipe e no envio diário.'
              : 'Estas atividades precisam da aprovação do proprietário ou da FAVIS.'}
          </CardDescription>
        </div>
        {canApprove && items.length > 1 && (
          <Button
            size="sm"
            variant="secondary"
            loading={approve.isPending}
            onClick={() => window.confirm(`Aprovar as ${items.length} atividades pendentes?`) && approve.mutate(items.map((a) => a.id))}
          >
            <CheckCheck /> Aprovar todas
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-2">
        <ul className="divide-y">
          {items.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => onOpen(a.id)} className="min-w-0 flex-1 text-left">
                <p className="flex items-center gap-1.5 truncate font-medium">
                  {a.aiGenerated && (
                    <Badge tone="info" className="shrink-0">
                      <Sparkles className="size-3" /> IA
                    </Badge>
                  )}
                  <span className="truncate">{a.title}</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  <span>
                    {formatDate(a.scheduledDate, 'EEE, d MMM')}
                    {a.scheduledTime ? ` · ${a.scheduledTime}` : ''}
                  </span>
                  <PillarTag pillar={a.pillar} />
                  <span>{formatLabel(a.format, a.storiesCount)}</span>
                </p>
              </button>
              {canApprove && (
                <Button size="sm" variant="ghost" onClick={() => approve.mutate([a.id])} disabled={approve.isPending} aria-label={`Aprovar ${a.title}`}>
                  <Check /> Aprovar
                </Button>
              )}
            </li>
          ))}
        </ul>
        {items.length > 8 && <p className="pt-2 text-sm text-muted-foreground">+{items.length - 8} no calendário (filtre por "Pendente de aprovação").</p>}
      </CardContent>
    </Card>
  );
}
