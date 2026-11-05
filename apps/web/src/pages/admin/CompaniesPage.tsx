import { zodResolver } from '@hookform/resolvers/zod';
import { companyCreateSchema, slugify, type CompanyCreateInput } from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import type { Company } from '@/lib/types';

type FormInput = z.input<typeof companyCreateSchema>;

function NewCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<FormInput, unknown, CompanyCreateInput>({
    resolver: zodResolver(companyCreateSchema),
    defaultValues: { name: '', segment: '', timezone: 'America/Sao_Paulo' },
  });
  const name = form.watch('name');
  const create = useMutation({
    mutationFn: (v: CompanyCreateInput) => api.post<Company>('/companies', v),
    onSuccess: (c) => {
      toast.success('Empresa cadastrada. Agora preencha o diagnóstico.');
      void qc.invalidateQueries({ queryKey: ['companies'] });
      form.reset();
      onOpenChange(false);
      navigate(`/empresas/${c.id}/diagnostico`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Nova empresa" description="Depois do cadastro, configure o diagnóstico e a equipe.">
        <form onSubmit={form.handleSubmit((v) => create.mutate({ ...v, slug: v.slug || undefined }))} noValidate>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Nome da empresa" htmlFor="name" required error={form.formState.errors.name?.message} hint={name ? `Identificador: ${slugify(name)}` : undefined}>
              <Input {...form.register('name')} autoFocus />
            </Field>
            <Field label="Segmento de atuação" htmlFor="segment" error={form.formState.errors.segment?.message}>
              <Input {...form.register('segment')} placeholder="Ex.: Padaria artesanal" />
            </Field>
            <Field label="Fuso horário" htmlFor="timezone" hint="Usado para horários de envio e prazos">
              <Input {...form.register('timezone')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CompaniesPage() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['companies'], queryFn: () => api.get<Company[]>('/companies') });
  const toggle = useMutation({
    mutationFn: (c: Company) => api.patch(`/companies/${c.id}`, { status: c.status === 'ativa' ? 'inativa' : 'ativa' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['companies'] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const list = (q.data ?? []).filter((c) => `${c.name} ${c.segment}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader
        eyebrow="FAVIS"
        title="Empresas"
        description="Clientes atendidos pela FAVIS"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Nova empresa
          </Button>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar empresa" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar empresa" />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.length && (
        <EmptyState icon={Building2} title="Nenhuma empresa cadastrada" description="Cadastre o primeiro cliente para começar." action={<Button onClick={() => setOpen(true)}><Plus /> Nova empresa</Button>} />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => (
          <Card key={c.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <Link to={`/empresas/${c.id}`} className="min-w-0 hover:underline">
                <h2 className="truncate font-semibold">{c.name}</h2>
              </Link>
              <Badge tone={c.status === 'ativa' ? 'success' : 'warning'}>{c.status === 'ativa' ? 'Ativa' : 'Inativa'}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{c.segment || 'Segmento não informado'}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-surface-muted/70 p-2">
                <dt className="text-xs text-muted-foreground">Equipe</dt>
                <dd className="font-semibold tabular-nums">{c.membersCount}</dd>
              </div>
              <div className="rounded-lg bg-surface-muted/70 p-2">
                <dt className="text-xs text-muted-foreground">Campanhas</dt>
                <dd className="font-semibold tabular-nums">{c.activeCampaigns}</dd>
              </div>
              <div className="rounded-lg bg-surface-muted/70 p-2">
                <dt className="text-xs text-muted-foreground">Próx. 7 dias</dt>
                <dd className="font-semibold tabular-nums">{c.upcomingActivities}</dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2 border-t pt-3">
              <Button variant="secondary" size="sm" asChild>
                <Link to={`/empresas/${c.id}`}>Abrir</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => window.confirm(`${c.status === 'ativa' ? 'Desativar' : 'Reativar'} ${c.name}?`) && toggle.mutate(c)}>
                {c.status === 'ativa' ? 'Desativar' : 'Reativar'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <NewCompanyDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
