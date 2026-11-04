import { CONTENT_PILLAR_LABELS } from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfMonth, nextMonday, startOfMonth, addMonths } from 'date-fns';
import { AlertTriangle, Bot, CheckCircle2, Clock, Sparkles, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCompanyLookups } from '@/components/activity/activity-form';
import { formatLabel, PillarTag } from '@/components/activity/badges';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, EmptyState, ErrorState, LoadingBlock, Segmented } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import type { AiGeneration, AiGenerationSummary } from '@/lib/types';
import { formatDate, formatDateTime, shiftISO, toISODate } from '@/lib/utils';
import { useCompanyId } from './CompanyLayout';

interface AiStatus {
  configured: boolean;
  enabled: boolean;
  provider: string;
  model: string | null;
  queue: string;
}

const STATUS: Record<AiGenerationSummary['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'accent' }> = {
  pendente: { label: 'Na fila', tone: 'neutral' },
  processando: { label: 'Gerando…', tone: 'info' },
  concluida: { label: 'Pronto para revisão', tone: 'success' },
  falhou: { label: 'Falhou', tone: 'danger' },
  aplicada: { label: 'Aplicado', tone: 'accent' },
};

function ReviewDialog({ companyId, generationId, onClose }: { companyId: string; generationId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { members } = useCompanyLookups(companyId);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [assignee, setAssignee] = useState('');
  const q = useQuery({
    queryKey: ['ai-generation', generationId],
    queryFn: () => api.get<AiGeneration>(`/companies/${companyId}/ai/generations/${generationId}`),
    enabled: !!generationId,
  });
  const g = q.data;
  const applied = new Set(g?.output?.appliedIndexes ?? []);
  const sel = selected ?? new Set((g?.output?.items ?? []).map((it, i) => (!it.flags.length && !applied.has(i) ? i : -1)).filter((i) => i >= 0));

  const apply = useMutation({
    mutationFn: () =>
      api.post<{ created: number }>(`/companies/${companyId}/ai/generations/${generationId}/apply`, {
        itemIndexes: [...sel].filter((i) => !applied.has(i)),
        assigneeId: assignee || null,
      }),
    onSuccess: (r) => {
      toast.success(`${r.created} atividade(s) adicionada(s) ao calendário como "pendente de aprovação"`);
      void qc.invalidateQueries({ queryKey: ['ai-generations', companyId] });
      void qc.invalidateQueries({ queryKey: ['ai-generation', generationId] });
      void qc.invalidateQueries({ queryKey: ['activities', companyId] });
      void qc.invalidateQueries({ queryKey: ['dashboard', companyId] });
      setSelected(null);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggle = (i: number) => {
    const next = new Set(sel);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  };

  return (
    <Dialog open={!!generationId} onOpenChange={(o) => { if (!o) { setSelected(null); onClose(); } }}>
      <DialogContent variant="sheet" title="Revisar planejamento" description={g ? `${formatDate(g.periodStart)} – ${formatDate(g.periodEnd)}` : undefined} className="sm:max-w-2xl">
        {q.isLoading && <DialogBody><LoadingBlock /></DialogBody>}
        {g?.output && (
          <>
            <DialogBody className="flex flex-col gap-4">
              <div>
                <p className="font-medium">{g.output.summary}</p>
                <p className="mt-1 text-sm text-muted-foreground">{g.output.strategyRationale}</p>
              </div>
              {!!g.output.warnings.length && (
                <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-warning">
                    <AlertTriangle className="size-4" /> Pontos de atenção
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {g.output.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="flex flex-col gap-3">
                {g.output.items.map((it, i) => (
                  <li key={i} className="rounded-lg border p-3">
                    <label className="flex cursor-pointer items-start gap-3">
                      <Checkbox checked={sel.has(i) || applied.has(i)} disabled={applied.has(i)} onCheckedChange={() => toggle(i)} className="mt-0.5" aria-label={`Selecionar ${it.title}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{it.title}</span>
                          {applied.has(i) && <Badge tone="accent">Já aplicado</Badge>}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                          <span>
                            {formatDate(it.date, "EEE, d MMM")}
                            {it.time ? ` · ${it.time}` : ''}
                          </span>
                          <PillarTag pillar={it.pillar} />
                          <span>{formatLabel(it.format, it.stories_count)}</span>
                        </p>
                        <p className="mt-1.5 text-sm">{it.objective}</p>
                        <details className="mt-1.5 text-sm">
                          <summary className="cursor-pointer text-accent">Ver roteiro e orientações</summary>
                          <div className="mt-2 space-y-2 whitespace-pre-wrap text-foreground/90">
                            <p>{it.script}</p>
                            {!!it.talking_points.length && <ul className="list-disc pl-5">{it.talking_points.map((t, j) => <li key={j}>{t}</li>)}</ul>}
                            <p className="text-muted-foreground">Gravação: {it.recording_guidelines}</p>
                            <p className="text-muted-foreground">CTA: {it.call_to_action}</p>
                            <p className="text-muted-foreground">Por quê: {it.rationale}</p>
                          </div>
                        </details>
                        {[...it.flags, ...it.needs_verification].length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-[13px] text-warning">
                            {[...new Set([...it.flags, ...it.needs_verification])].map((f, j) => (
                              <li key={j} className="flex gap-1.5">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {f}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            </DialogBody>
            <DialogFooter className="sm:items-center">
              <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="sm:mr-auto sm:w-56" aria-label="Responsável pelas atividades">
                <option value="">Sem responsável (definir depois)</option>
                {members.filter((m) => m.active).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                  </option>
                ))}
              </Select>
              <Button onClick={() => apply.mutate()} loading={apply.isPending} disabled={![...sel].some((i) => !applied.has(i))}>
                Adicionar {[...sel].filter((i) => !applied.has(i)).length} ao calendário
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AiPage() {
  const companyId = useCompanyId();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'plano_semanal' | 'plano_mensal'>('plano_semanal');
  const [start, setStart] = useState(() => toISODate(nextMonday(new Date())));
  const [instructions, setInstructions] = useState('');
  const [reviewing, setReviewing] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<AiStatus>('/ai/status') });
  const gens = useQuery({
    queryKey: ['ai-generations', companyId],
    queryFn: () => api.get<AiGenerationSummary[]>(`/companies/${companyId}/ai/generations`),
    refetchInterval: (query) => (query.state.data?.some((g) => g.status === 'pendente' || g.status === 'processando') ? 4000 : false),
  });

  const end = kind === 'plano_semanal' ? shiftISO(start, 6) : toISODate(endOfMonth(new Date(`${start}T12:00:00`)));
  const request = useMutation({
    mutationFn: () => api.post(`/companies/${companyId}/ai/plans`, { kind, periodStart: start, periodEnd: end, instructions }),
    onSuccess: () => {
      toast.success('Pedido enviado. O planejamento aparecerá abaixo quando estiver pronto.');
      setInstructions('');
      void qc.invalidateQueries({ queryKey: ['ai-generations', companyId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const available = status.data?.configured && status.data.enabled;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" /> Novo planejamento
            </CardTitle>
            <CardDescription>A IA usa o diagnóstico, campanhas ativas e o histórico da empresa.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status.data && !available && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
              <p className="font-medium text-warning">IA indisponível</p>
              <p className="mt-0.5">
                {!status.data.configured
                  ? 'Nenhum provedor de IA está configurado no servidor (AI_PROVIDER / AI_API_KEY). O calendário funciona normalmente sem IA.'
                  : 'A geração por IA está desativada nas configurações da FAVIS.'}
              </p>
            </div>
          )}
          <Segmented
            label="Tipo"
            value={kind}
            onChange={(k) => {
              setKind(k);
              if (k === 'plano_mensal') setStart(toISODate(startOfMonth(addMonths(new Date(), 1))));
              else setStart(toISODate(nextMonday(new Date())));
            }}
            options={[
              { value: 'plano_semanal', label: 'Semanal' },
              { value: 'plano_mensal', label: 'Mensal' },
            ]}
          />
          <Field label="Início" htmlFor="ai-start" hint={`Período: ${formatDate(start)} a ${formatDate(end)}`}>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Orientações (opcional)" htmlFor="ai-instructions" hint="Ex.: priorizar bastidores, 1 conteúdo por dia útil">
            <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} />
          </Field>
          <Button onClick={() => request.mutate()} loading={request.isPending} disabled={!available}>
            <Sparkles /> Gerar planejamento
          </Button>
          {status.data?.configured && (
            <p className="text-xs text-muted-foreground">
              Provedor: {status.data.provider} · {status.data.model}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Histórico de planejamentos</h2>
        {gens.isLoading && <LoadingBlock />}
        {gens.error && <ErrorState error={gens.error} onRetry={() => void gens.refetch()} />}
        {gens.data && !gens.data.length && (
          <EmptyState icon={Bot} title="Nenhum planejamento gerado" description="Os planejamentos gerados ficam salvos aqui como memória estratégica da empresa." />
        )}
        {gens.data?.map((g) => (
          <Card key={g.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="rounded-lg bg-surface-muted p-2">
              {g.status === 'falhou' ? <XCircle className="size-4 text-danger" /> : g.status === 'concluida' || g.status === 'aplicada' ? <CheckCircle2 className="size-4 text-success" /> : <Clock className="size-4 animate-pulse text-info" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {g.kind === 'plano_mensal' ? 'Plano mensal' : g.kind === 'plano_semanal' ? 'Plano semanal' : 'Alternativa para tarefa'} ·{' '}
                {formatDate(g.periodStart)} – {formatDate(g.periodEnd)}
              </p>
              <p className="text-sm text-muted-foreground">
                {g.requestedByName ?? '—'} · {formatDateTime(g.createdAt)}
                {g.itemsCount ? ` · ${g.itemsCount} conteúdos` : ''}
                {g.warningsCount ? ` · ${g.warningsCount} aviso(s)` : ''}
              </p>
              {g.error && <p className="mt-1 text-sm text-danger">{g.error}</p>}
            </div>
            <Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge>
            {(g.status === 'concluida' || g.status === 'aplicada') && (
              <Button variant="secondary" size="sm" onClick={() => setReviewing(g.id)}>
                Revisar
              </Button>
            )}
          </Card>
        ))}
        <p className="text-xs text-muted-foreground">
          Distribuição de referência: {Object.values(CONTENT_PILLAR_LABELS).length - 1} pilares estratégicos + campanhas ativas (padrão 30%).
          Itens com preços, descontos ou resultados não confirmados são sinalizados para revisão.
        </p>
      </div>
      <ReviewDialog companyId={companyId} generationId={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}
