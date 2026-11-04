import { zodResolver } from '@hookform/resolvers/zod';
import {
  activityCreateSchema,
  CONTENT_FORMAT_LABELS,
  CONTENT_FORMATS,
  CONTENT_PILLAR_LABELS,
  CONTENT_PILLARS,
  type ActivityCreateInput,
} from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Activity, Campaign, Member } from '@/lib/types';

type FormInput = z.input<typeof activityCreateSchema>;

const empty = (date: string): FormInput => ({
  title: '',
  scheduledDate: date,
  scheduledTime: null,
  pillar: 'relacionamento',
  format: 'stories',
  storiesCount: 1,
  objective: '',
  script: '',
  talkingPoints: '',
  recordingGuidelines: '',
  captionSuggestion: '',
  callToAction: '',
  assigneeId: null,
  campaignId: null,
  notes: '',
  status: 'planejada',
});

export function useCompanyLookups(companyId: string) {
  const members = useQuery({
    queryKey: ['members', companyId],
    queryFn: () => api.get<Member[]>(`/companies/${companyId}/members`),
  });
  const campaigns = useQuery({
    queryKey: ['campaigns', companyId],
    queryFn: () => api.get<Campaign[]>(`/companies/${companyId}/campaigns`),
  });
  return { members: members.data ?? [], campaigns: campaigns.data ?? [] };
}

export function invalidateActivityQueries(qc: ReturnType<typeof useQueryClient>, companyId: string) {
  void qc.invalidateQueries({ queryKey: ['activities', companyId] });
  void qc.invalidateQueries({ queryKey: ['activity'] });
  void qc.invalidateQueries({ queryKey: ['dashboard', companyId] });
  void qc.invalidateQueries({ queryKey: ['checklist'] });
  void qc.invalidateQueries({ queryKey: ['campaigns', companyId] });
}

export function ActivityFormDialog({
  companyId,
  open,
  onOpenChange,
  activity,
  defaultDate,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity?: Activity | null;
  defaultDate: string;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { members, campaigns } = useCompanyLookups(companyId);
  const form = useForm<FormInput, unknown, ActivityCreateInput>({
    resolver: zodResolver(activityCreateSchema),
    defaultValues: empty(defaultDate),
  });
  const errors = form.formState.errors;
  const format = form.watch('format');

  useEffect(() => {
    if (!open) return;
    form.reset(
      activity
        ? {
            title: activity.title,
            scheduledDate: activity.scheduledDate,
            scheduledTime: activity.scheduledTime,
            pillar: activity.pillar,
            format: activity.format,
            storiesCount: activity.storiesCount,
            objective: activity.objective,
            script: activity.script,
            talkingPoints: activity.talkingPoints,
            recordingGuidelines: activity.recordingGuidelines,
            captionSuggestion: activity.captionSuggestion,
            callToAction: activity.callToAction,
            assigneeId: activity.assigneeId,
            campaignId: activity.campaignId,
            notes: activity.notes,
            status: 'planejada',
          }
        : empty(defaultDate),
    );
  }, [open, activity, defaultDate, form]);

  const save = useMutation({
    mutationFn: (values: ActivityCreateInput) => {
      if (activity) {
        const { status: _ignored, ...rest } = values;
        return api.patch<Activity>(`/companies/${companyId}/activities/${activity.id}`, rest);
      }
      return api.post<Activity>(`/companies/${companyId}/activities`, values);
    },
    onSuccess: () => {
      toast.success(activity ? 'Atividade atualizada' : 'Atividade criada');
      invalidateActivityQueries(qc, companyId);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const nullable = { setValueAs: (v: string) => (v === '' ? null : v) };
  const activeMembers = members.filter((m) => m.active);
  const selectableCampaigns = campaigns.filter((c) => c.status === 'ativa' || c.id === activity?.campaignId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet" title={activity ? 'Editar atividade' : 'Nova atividade'} description="Planejamento e orientações de produção">
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Título" htmlFor="title" required error={errors.title?.message} className="sm:col-span-2">
              <Input {...form.register('title')} placeholder="Ex.: Bastidores da primeira fornada" />
            </Field>
            <Field label="Data" htmlFor="scheduledDate" required error={errors.scheduledDate?.message}>
              <Input type="date" {...form.register('scheduledDate')} />
            </Field>
            <Field label="Horário recomendado" htmlFor="scheduledTime" error={errors.scheduledTime?.message}>
              <Input type="time" {...form.register('scheduledTime', nullable)} />
            </Field>
            <Field label="Categoria (pilar)" htmlFor="pillar" required>
              <Select {...form.register('pillar')}>
                {CONTENT_PILLARS.map((p) => (
                  <option key={p} value={p}>
                    {CONTENT_PILLAR_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Formato" htmlFor="format" required>
              <Select {...form.register('format')}>
                {CONTENT_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {CONTENT_FORMAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>
            {format === 'stories' && (
              <Field label="Quantidade de Stories" htmlFor="storiesCount" error={errors.storiesCount?.message}>
                <Input type="number" min={0} max={30} {...form.register('storiesCount', { valueAsNumber: true })} />
              </Field>
            )}
            <Field label="Responsável" htmlFor="assigneeId">
              <Select {...form.register('assigneeId', nullable)}>
                <option value="">Sem responsável</option>
                {activeMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Campanha" htmlFor="campaignId" hint="Opcional — conteúdo ligado a uma campanha ativa">
              <Select {...form.register('campaignId', nullable)}>
                <option value="">Nenhuma</option>
                {selectableCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!activity && (
              <Field label="Status inicial" htmlFor="status">
                <Select {...form.register('status')}>
                  <option value="planejada">Planejada</option>
                  <option value="pendente_aprovacao">Pendente de aprovação</option>
                  {can(companyId, 'activities.approve') && <option value="aprovada">Aprovada</option>}
                </Select>
              </Field>
            )}
            <Field label="Objetivo estratégico" htmlFor="objective" className="sm:col-span-2">
              <Textarea rows={2} {...form.register('objective')} placeholder="O que este conteúdo deve gerar?" />
            </Field>
            <Field label="Roteiro" htmlFor="script" className="sm:col-span-2" hint="Passo a passo do que gravar/mostrar">
              <Textarea rows={5} {...form.register('script')} />
            </Field>
            <Field label="Sugestões de falas" htmlFor="talkingPoints" className="sm:col-span-2">
              <Textarea rows={3} {...form.register('talkingPoints')} />
            </Field>
            <Field label="Orientações de gravação" htmlFor="recordingGuidelines" className="sm:col-span-2">
              <Textarea rows={2} {...form.register('recordingGuidelines')} placeholder="Luz, enquadramento, áudio, duração…" />
            </Field>
            <Field label="Sugestão de legenda" htmlFor="captionSuggestion" className="sm:col-span-2">
              <Textarea rows={2} {...form.register('captionSuggestion')} />
            </Field>
            <Field label="Chamada para ação" htmlFor="callToAction" className="sm:col-span-2" error={errors.callToAction?.message}>
              <Input {...form.register('callToAction')} placeholder="Ex.: Responda a enquete" />
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
              {activity ? 'Salvar alterações' : 'Criar atividade'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
