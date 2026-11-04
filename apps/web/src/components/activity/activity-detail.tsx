import { ACTIVITY_STATUS_LABELS, type ActivityStatus } from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Link2, MessageSquarePlus, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, ErrorState, LoadingBlock } from '@/components/ui/display';
import { Input, Label, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Activity } from '@/lib/types';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { invalidateActivityQueries } from './activity-form';
import { formatLabel, PillarTag, StatusBadge } from './badges';

const ACTION_LABEL: Partial<Record<ActivityStatus, string>> = {
  em_andamento: 'Iniciar',
  concluida: 'Concluir',
  impedida: 'Registrar dificuldade',
  aprovada: 'Aprovar',
  pendente_aprovacao: 'Enviar para aprovação',
  planejada: 'Voltar para planejada',
  cancelada: 'Cancelar',
};

function actionLabel(from: ActivityStatus, to: ActivityStatus) {
  if (from === 'concluida' && to === 'em_andamento') return 'Reabrir';
  if (from === 'cancelada' && to === 'planejada') return 'Restaurar';
  if (from === 'em_andamento' && to === 'aprovada') return 'Pausar';
  return ACTION_LABEL[to] ?? ACTIVITY_STATUS_LABELS[to];
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t px-5 py-4 first:border-t-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function TextBlock({ text, empty = 'Não informado' }: { text: string; empty?: string }) {
  return text.trim() ? (
    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</p>
  ) : (
    <p className="text-sm text-muted-foreground">{empty}</p>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}

export function ActivityDetailSheet({
  companyId,
  activityId,
  onClose,
  onEdit,
}: {
  companyId: string;
  activityId: string | null;
  onClose: () => void;
  onEdit?: (a: Activity) => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can(companyId, 'activities.manage');
  const [pending, setPending] = useState<ActivityStatus | null>(null);
  const [message, setMessage] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [comment, setComment] = useState('');

  const q = useQuery({
    queryKey: ['activity', activityId],
    queryFn: () => api.get<Activity>(`/companies/${companyId}/activities/${activityId}`),
    enabled: !!activityId,
  });
  const a = q.data;
  const base = `/companies/${companyId}/activities/${activityId}`;
  const refresh = () => invalidateActivityQueries(qc, companyId);

  const changeStatus = useMutation({
    mutationFn: (v: { status: ActivityStatus; message: string }) => api.post<Activity>(`${base}/status`, v),
    onSuccess: (_d, v) => {
      toast.success(v.status === 'concluida' ? 'Tarefa concluída! 🎉' : `Status: ${ACTIVITY_STATUS_LABELS[v.status]}`);
      setPending(null);
      setMessage('');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const addEvidence = useMutation({
    mutationFn: () => api.post(`${base}/evidences`, { kind: 'link', url: evidenceUrl.trim() }),
    onSuccess: () => {
      toast.success('Evidência registrada');
      setEvidenceUrl('');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const addComment = useMutation({
    mutationFn: () => api.post(`${base}/updates`, { kind: 'comentario', message: comment.trim() }),
    onSuccess: () => {
      setComment('');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(base),
    onSuccess: () => {
      toast.success('Atividade excluída');
      refresh();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const alternative = useMutation({
    mutationFn: () => api.post(`/companies/${companyId}/ai/alternatives`, { activityId }),
    onSuccess: () => toast.success('Pedido enviado à IA. Acompanhe na aba IA.'),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onAction = (to: ActivityStatus) => {
    if (to === 'impedida' || to === 'cancelada') {
      setPending(to);
      return;
    }
    changeStatus.mutate({ status: to, message: '' });
  };

  return (
    <Dialog open={!!activityId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="sheet" title={a?.title ?? 'Atividade'} description={a ? `${formatDate(a.scheduledDate, "EEEE, d 'de' MMMM")}${a.scheduledTime ? ` · ${a.scheduledTime}` : ''}` : undefined}>
        {q.isLoading && <DialogBody><LoadingBlock rows={4} /></DialogBody>}
        {q.error && <DialogBody><ErrorState error={q.error} onRetry={() => void q.refetch()} /></DialogBody>}
        {a && (
          <div className="pb-6">
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
              <StatusBadge status={a.status} />
              <PillarTag pillar={a.pillar} />
              <Badge>{formatLabel(a.format, a.storiesCount)}</Badge>
              {a.campaignName && <Badge tone="accent">{a.campaignName}</Badge>}
              {a.aiGenerated && (
                <Badge tone="info">
                  <Sparkles className="size-3" /> IA
                </Badge>
              )}
            </div>
            <p className="px-5 pt-2 text-sm text-muted-foreground">
              Responsável: <span className="font-medium text-foreground">{a.assigneeName ?? 'sem responsável'}</span>
            </p>

            {/* Ações de status */}
            {!!a.availableTransitions?.length && (
              <div className="mx-5 mt-4 rounded-lg border bg-surface-muted/60 p-3">
                <div className="flex flex-wrap gap-2">
                  {a.availableTransitions.map((to) => (
                    <Button
                      key={to}
                      size="sm"
                      variant={to === 'concluida' ? 'primary' : to === 'cancelada' ? 'ghost' : 'secondary'}
                      onClick={() => onAction(to)}
                      loading={changeStatus.isPending && changeStatus.variables?.status === to}
                    >
                      {to === 'concluida' && <Check />}
                      {actionLabel(a.status, to)}
                    </Button>
                  ))}
                </div>
                {pending && (
                  <form
                    className="mt-3 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      changeStatus.mutate({ status: pending, message });
                    }}
                  >
                    <Label htmlFor="status-msg">{pending === 'impedida' ? 'O que impediu a tarefa?' : 'Motivo do cancelamento'}</Label>
                    <Textarea id="status-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" loading={changeStatus.isPending}>
                        Confirmar
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
                        Voltar
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-2 px-5 pt-3">
                {onEdit && (
                  <Button size="sm" variant="secondary" onClick={() => onEdit(a)}>
                    <Pencil /> Editar
                  </Button>
                )}
                {a.status === 'impedida' && can(companyId, 'ai.use') && (
                  <Button size="sm" variant="secondary" onClick={() => alternative.mutate()} loading={alternative.isPending}>
                    <Sparkles /> Pedir alternativa à IA
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => window.confirm('Excluir esta atividade?') && remove.mutate()}
                  loading={remove.isPending}
                >
                  <Trash2 /> Excluir
                </Button>
              </div>
            )}

            <div className="mt-4 border-t">
              <Section title="Objetivo">
                <TextBlock text={a.objective} />
              </Section>
              <Section title="Roteiro">
                <TextBlock text={a.script} />
              </Section>
              <Section title="Sugestões de falas" action={<CopyButton text={a.talkingPoints} />}>
                <TextBlock text={a.talkingPoints} />
              </Section>
              <Section title="Orientações de gravação">
                <TextBlock text={a.recordingGuidelines} />
              </Section>
              <Section title="Legenda" action={<CopyButton text={a.captionSuggestion} />}>
                <TextBlock text={a.captionSuggestion} />
              </Section>
              <Section title="Chamada para ação">
                <TextBlock text={a.callToAction} />
              </Section>
              {a.notes.trim() && (
                <Section title="Observações">
                  <TextBlock text={a.notes} />
                </Section>
              )}

              <Section title={`Evidências (${a.evidences?.length ?? 0})`}>
                <ul className="mb-3 flex flex-col gap-2">
                  {a.evidences?.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-sm">
                      <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
                            {e.url} <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <p>{e.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {e.createdByName} · {formatDateTime(e.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {a.status !== 'cancelada' && (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (evidenceUrl.trim()) addEvidence.mutate();
                    }}
                  >
                    <Input
                      type="url"
                      inputMode="url"
                      placeholder="Cole o link do Story/post publicado"
                      value={evidenceUrl}
                      onChange={(e) => setEvidenceUrl(e.target.value)}
                      aria-label="Link da evidência"
                    />
                    <Button type="submit" variant="secondary" loading={addEvidence.isPending}>
                      Adicionar
                    </Button>
                  </form>
                )}
              </Section>

              <Section title="Histórico">
                <form
                  className="mb-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (comment.trim().length >= 2) addComment.mutate();
                  }}
                >
                  <Input placeholder="Escreva um comentário" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comentário" />
                  <Button type="submit" variant="secondary" size="icon" aria-label="Enviar comentário" loading={addComment.isPending}>
                    {!addComment.isPending && <MessageSquarePlus />}
                  </Button>
                </form>
                <ol className="flex flex-col gap-3">
                  {a.updates?.map((u) => (
                    <li key={u.id} className="flex gap-3 text-sm">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', u.kind === 'dificuldade' || u.toStatus === 'impedida' ? 'bg-danger' : u.toStatus === 'concluida' ? 'bg-success' : 'bg-border')} />
                      <div>
                        <p>
                          <span className="font-medium">{u.userName ?? 'Sistema'}</span>{' '}
                          {u.kind === 'status' && u.toStatus ? (
                            <span className="text-muted-foreground">mudou para {ACTIVITY_STATUS_LABELS[u.toStatus]}</span>
                          ) : u.kind === 'dificuldade' ? (
                            <span className="text-muted-foreground">relatou uma dificuldade</span>
                          ) : (
                            <span className="text-muted-foreground">comentou</span>
                          )}
                        </p>
                        {u.message && <p className="mt-0.5 whitespace-pre-wrap">{u.message}</p>}
                        <p className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                  {!a.updates?.length && <p className="text-sm text-muted-foreground">Nenhuma movimentação ainda.</p>}
                </ol>
              </Section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
