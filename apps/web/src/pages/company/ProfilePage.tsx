import { zodResolver } from '@hookform/resolvers/zod';
import { companyProfileSchema, WEEKDAY_LABELS, type CompanyProfileInput } from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, LoadingBlock, Progress } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CompanyProfile } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { useCompanyId } from './CompanyLayout';

type FormInput = z.input<typeof companyProfileSchema>;

const WEEK = [1, 2, 3, 4, 5, 6, 7];

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const companyId = useCompanyId();
  const { can } = useAuth();
  const readOnly = !can(companyId, 'profile.edit');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['profile', companyId],
    queryFn: () => api.get<CompanyProfile>(`/companies/${companyId}/profile`),
  });

  const form = useForm<FormInput, unknown, CompanyProfileInput>({ resolver: zodResolver(companyProfileSchema) });
  const dates = useFieldArray({ control: form.control, name: 'commercialDates' });
  const hours = useFieldArray({ control: form.control, name: 'businessHours' });

  useEffect(() => {
    if (!q.data) return;
    const p = q.data;
    form.reset({
      businessDescription: p.businessDescription,
      targetAudience: p.targetAudience,
      products: p.products,
      services: p.services,
      differentiators: p.differentiators,
      positioning: p.positioning,
      brandPersonality: p.brandPersonality,
      toneOfVoice: p.toneOfVoice,
      businessGoals: p.businessGoals,
      marketingGoals: p.marketingGoals,
      mainChallenges: p.mainChallenges,
      contentRestrictions: p.contentRestrictions,
      additionalInfo: p.additionalInfo,
      campaignMixTarget: Number(p.campaignMixTarget),
      commercialDates: p.commercialDates,
      businessHours: WEEK.map(
        (weekday) => p.businessHours.find((h) => h.weekday === weekday) ?? { weekday, closed: weekday === 7, opens: null, closes: null },
      ),
    });
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: (v: CompanyProfileInput) => api.put<CompanyProfile>(`/companies/${companyId}/profile`, v),
    onSuccess: (data) => {
      qc.setQueryData(['profile', companyId], data);
      void qc.invalidateQueries({ queryKey: ['dashboard', companyId] });
      toast.success('Diagnóstico salvo');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isLoading) return <LoadingBlock rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const text = (name: keyof FormInput, label: string, opts: { rows?: number; hint?: string; full?: boolean; placeholder?: string } = {}) => (
    <Field label={label} htmlFor={name} hint={opts.hint} className={opts.full ? 'sm:col-span-2' : undefined} error={form.formState.errors[name]?.message as string | undefined}>
      <Textarea rows={opts.rows ?? 3} readOnly={readOnly} placeholder={opts.placeholder} {...form.register(name)} />
    </Field>
  );
  const mix = Math.round(Number(form.watch('campaignMixTarget') ?? 0.3) * 100);

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="flex flex-col gap-5 pb-24" noValidate>
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Diagnóstico {q.data!.completeness}% completo</p>
            <p className="text-sm text-muted-foreground">
              Estas informações alimentam a IA. Atualizado em {formatDateTime(q.data!.updatedAt)}
              {q.data!.updatedByName ? ` por ${q.data!.updatedByName}` : ''}.
            </p>
          </div>
          <Progress value={q.data!.completeness} className="sm:w-48" label="Preenchimento do diagnóstico" />
        </div>
      </Card>

      <Section title="Negócio" description="O que a empresa faz e oferece">
        {text('businessDescription', 'Descrição do negócio', { full: true, rows: 4 })}
        {text('products', 'Produtos')}
        {text('services', 'Serviços')}
        {text('differentiators', 'Diferenciais competitivos')}
        {text('positioning', 'Posicionamento')}
      </Section>

      <Section title="Público e marca">
        {text('targetAudience', 'Público-alvo', { full: true })}
        {text('brandPersonality', 'Personalidade da marca', { placeholder: 'Ex.: acolhedora, divertida, especialista' })}
        {text('toneOfVoice', 'Tom de comunicação', { placeholder: 'Ex.: próximo, sem gírias, com humor leve' })}
      </Section>

      <Section title="Objetivos">
        {text('businessGoals', 'Objetivos comerciais')}
        {text('marketingGoals', 'Metas de marketing')}
        {text('mainChallenges', 'Principais dificuldades', { full: true })}
      </Section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Horários de funcionamento</CardTitle>
            <CardDescription>Usados para sugerir horários de publicação</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col divide-y">
            {hours.fields.map((f, i) => {
              const closed = form.watch(`businessHours.${i}.closed`);
              return (
                <div key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-10 text-sm font-medium">{WEEKDAY_LABELS[f.weekday]}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[rgb(var(--accent))]" disabled={readOnly} {...form.register(`businessHours.${i}.closed`)} />
                    Fechado
                  </label>
                  {!closed && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        className="h-9 w-32"
                        aria-label={`Abertura ${WEEKDAY_LABELS[f.weekday]}`}
                        readOnly={readOnly}
                        {...form.register(`businessHours.${i}.opens`, { setValueAs: (v: string) => v || null })}
                      />
                      <span className="text-muted-foreground">até</span>
                      <Input
                        type="time"
                        className="h-9 w-32"
                        aria-label={`Fechamento ${WEEKDAY_LABELS[f.weekday]}`}
                        readOnly={readOnly}
                        {...form.register(`businessHours.${i}.closes`, { setValueAs: (v: string) => v || null })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Datas comerciais relevantes</CardTitle>
            <CardDescription>Datas que o planejamento deve considerar</CardDescription>
          </div>
          {!readOnly && (
            <Button type="button" variant="secondary" size="sm" onClick={() => dates.append({ date: '', name: '', notes: '' })}>
              <Plus /> Adicionar
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!dates.fields.length && <p className="text-sm text-muted-foreground">Nenhuma data cadastrada.</p>}
          {dates.fields.map((f, i) => (
            <div key={f.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[160px_1fr_1fr_auto] sm:items-end">
              <Field label="Data" htmlFor={`cd-date-${i}`} error={form.formState.errors.commercialDates?.[i]?.date?.message}>
                <Input type="date" readOnly={readOnly} {...form.register(`commercialDates.${i}.date`)} />
              </Field>
              <Field label="Nome" htmlFor={`cd-name-${i}`} error={form.formState.errors.commercialDates?.[i]?.name?.message}>
                <Input readOnly={readOnly} placeholder="Ex.: Dia das Mães" {...form.register(`commercialDates.${i}.name`)} />
              </Field>
              <Field label="Observações" htmlFor={`cd-notes-${i}`}>
                <Input readOnly={readOnly} {...form.register(`commercialDates.${i}.notes`)} />
              </Field>
              {!readOnly && (
                <Button type="button" variant="ghost" size="icon" onClick={() => dates.remove(i)} aria-label="Remover data">
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Section title="Restrições e informações adicionais">
        {text('contentRestrictions', 'Restrições de conteúdo', { full: true, hint: 'O que nunca deve ser publicado ou dito' })}
        {text('additionalInfo', 'Informações adicionais fornecidas pelo cliente', { full: true, rows: 4 })}
        <Field
          label={`Participação de campanhas no planejamento: ${mix}%`}
          htmlFor="campaignMixTarget"
          className="sm:col-span-2"
          hint="Referência ajustável (padrão 30%). O restante é distribuído entre relacionamento, bastidores, engajamento, autoridade, prova social e conversão."
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={readOnly}
            className="w-full accent-[rgb(var(--accent))]"
            {...form.register('campaignMixTarget', { valueAsNumber: true })}
          />
        </Field>
      </Section>

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-surface/95 px-4 py-3 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-3">
            {form.formState.isDirty && <span className="text-sm text-muted-foreground">Alterações não salvas</span>}
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
              Salvar diagnóstico
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
