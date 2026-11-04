import { zodResolver } from '@hookform/resolvers/zod';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES, campaignCreateSchema, type CampaignInput, type CampaignStatus } from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, Progress, type BadgeTone } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Campaign } from '@/lib/types';
import { formatDate, shiftISO, todayISO } from '@/lib/utils';
import { useCompanyId } from './CompanyLayout';

type FormInput = z.input<typeof campaignCreateSchema>;
const TONE: Record<CampaignStatus, BadgeTone> = { rascunho: 'neutral', ativa: 'success', pausada: 'warning', encerrada: 'neutral' };

function CampaignDialog({ companyId, campaign, open, onOpenChange }: { companyId: string; campaign: Campaign | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<FormInput, unknown, CampaignInput>({ resolver: zodResolver(campaignCreateSchema) });
  const e = form.formState.errors;
  useEffect(() => {
    if (!open) return;
    form.reset(
      campaign
        ? { ...campaign, contentShare: Number(campaign.contentShare) }
        : { name: '', objectives: '', startsOn: todayISO(), endsOn: shiftISO(todayISO(), 30), products: '', offers: '', notes: '', status: 'ativa', contentShare: 0.3 },
    );
  }, [open, campaign, form]);
  const save = useMutation({
    mutationFn: (v: CampaignInput) =>
      campaign ? api.patch(`/companies/${companyId}/campaigns/${campaign.id}`, v) : api.post(`/companies/${companyId}/campaigns`, v),
    onSuccess: () => {
      toast.success(campaign ? 'Campanha atualizada' : 'Campanha cadastrada');
      void qc.invalidateQueries({ queryKey: ['campaigns', companyId] });
      void qc.invalidateQueries({ queryKey: ['dashboard', companyId] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const share = Math.round(Number(form.watch('contentShare') ?? 0.3) * 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet" title={campaign ? 'Editar campanha' : 'Nova campanha'}>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="name" required error={e.name?.message} className="sm:col-span-2">
              <Input {...form.register('name')} />
            </Field>
            <Field label="Início" htmlFor="startsOn" required error={e.startsOn?.message}>
              <Input type="date" {...form.register('startsOn')} />
            </Field>
            <Field label="Término" htmlFor="endsOn" required error={e.endsOn?.message}>
              <Input type="date" {...form.register('endsOn')} />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select {...form.register('status')}>
                {CAMPAIGN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CAMPAIGN_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Participação no planejamento: ${share}%`} htmlFor="contentShare" hint="Referência para a IA (padrão 30%)">
              <input type="range" min={0} max={1} step={0.05} className="mt-2 w-full accent-[rgb(var(--accent))]" {...form.register('contentShare', { valueAsNumber: true })} />
            </Field>
            <Field label="Objetivos" htmlFor="objectives" className="sm:col-span-2">
              <Textarea {...form.register('objectives')} />
            </Field>
            <Field label="Produtos" htmlFor="products" className="sm:col-span-2">
              <Textarea rows={2} {...form.register('products')} />
            </Field>
            <Field label="Ofertas confirmadas" htmlFor="offers" className="sm:col-span-2" hint="Preços e condições REAIS. A IA nunca inventa ofertas — só usa o que estiver aqui.">
              <Textarea rows={2} {...form.register('offers')} />
            </Field>
            <Field label="Observações" htmlFor="notes" className="sm:col-span-2">
              <Textarea rows={2} {...form.register('notes')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CampaignsPage() {
  const companyId = useCompanyId();
  const { can } = useAuth();
  const canManage = can(companyId, 'campaigns.manage');
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; campaign: Campaign | null }>({ open: false, campaign: null });
  const q = useQuery({ queryKey: ['campaigns', companyId], queryFn: () => api.get<Campaign[]>(`/companies/${companyId}/campaigns`) });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/companies/${companyId}/campaigns/${id}`),
    onSuccess: () => {
      toast.success('Campanha excluída');
      void qc.invalidateQueries({ queryKey: ['campaigns', companyId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground">A IA considera as campanhas ativas sem transformar todo o planejamento em divulgação.</p>
        {canManage && (
          <Button onClick={() => setDialog({ open: true, campaign: null })}>
            <Plus /> Nova campanha
          </Button>
        )}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.length && (
        <EmptyState icon={Megaphone} title="Nenhuma campanha cadastrada" description="Cadastre campanhas com período, produtos e ofertas confirmadas." />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((c) => (
          <Card key={c.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{c.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {formatDate(c.startsOn)} – {formatDate(c.endsOn, "d 'de' MMM yyyy")}
                </p>
              </div>
              <Badge tone={TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
            </div>
            {c.objectives && <p className="mt-3 line-clamp-2 text-sm">{c.objectives}</p>}
            {c.offers && (
              <p className="mt-2 line-clamp-2 text-sm">
                <span className="text-muted-foreground">Ofertas: </span>
                {c.offers}
              </p>
            )}
            <div className="mt-4 flex items-center gap-3 text-sm">
              <Progress value={c.activitiesCount ? (c.completedCount / c.activitiesCount) * 100 : 0} label="Execução da campanha" />
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {c.completedCount}/{c.activitiesCount}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Participação-alvo: {Math.round(Number(c.contentShare) * 100)}%</p>
            {canManage && (
              <div className="mt-4 flex gap-2 border-t pt-3">
                <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, campaign: c })}>
                  <Pencil /> Editar
                </Button>
                <Button variant="ghost" size="sm" className="text-danger" onClick={() => window.confirm(`Excluir a campanha "${c.name}"?`) && remove.mutate(c.id)}>
                  <Trash2 /> Excluir
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <CampaignDialog companyId={companyId} campaign={dialog.campaign} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </div>
  );
}
