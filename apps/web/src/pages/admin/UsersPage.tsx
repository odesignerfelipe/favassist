import { MEMBER_ROLE_LABELS } from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, ErrorState, LoadingBlock, PageHeader, Switch } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AdminUser } from '@/lib/types';

function NewUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ fullName: '', email: '', password: '', favisAdmin: false });
  const create = useMutation({
    mutationFn: () => api.post('/admin/users', v),
    onSuccess: () => {
      toast.success('Usuário criado');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      setV({ fullName: '', email: '', password: '', favisAdmin: false });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Novo usuário" description="Para vincular a uma empresa, use a aba Equipe da empresa.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <Field label="Nome completo" htmlFor="u-name" required>
              <Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
            </Field>
            <Field label="E-mail" htmlFor="u-email" required>
              <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
            </Field>
            <Field label="Senha inicial" htmlFor="u-pass" required hint="Mínimo de 10 caracteres">
              <Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
            </Field>
            <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
              <span>
                <span className="font-medium">Administrador FAVIS</span>
                <span className="block text-muted-foreground">Acesso global a todas as empresas</span>
              </span>
              <Switch checked={v.favisAdmin} onCheckedChange={(c) => setV({ ...v, favisAdmin: c })} aria-label="Administrador FAVIS" />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Criar usuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['admin-users', search], queryFn: () => api.get<AdminUser[]>('/admin/users', { search }) });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: () => {
      toast.success('Usuário atualizado');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const resetPassword = (u: AdminUser) => {
    const password = window.prompt(`Nova senha para ${u.fullName} (mínimo 10 caracteres):`);
    if (password) update.mutate({ id: u.id, body: { password } });
  };

  return (
    <div>
      <PageHeader
        eyebrow="FAVIS"
        title="Usuários"
        description="Todas as pessoas com acesso à plataforma"
        actions={
          <Button onClick={() => setOpen(true)}>
            <UserPlus /> Novo usuário
          </Button>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar usuário" />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <Card className="divide-y">
          {q.data.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 p-4">
              <Avatar name={u.fullName || u.email} className="size-9" />
              <div className="min-w-48 flex-1">
                <p className="font-medium">
                  {u.fullName || '—'} {u.platformRole === 'favis_admin' && <Badge tone="accent"><ShieldCheck className="size-3" /> Admin FAVIS</Badge>}{' '}
                  {!u.active && <Badge tone="warning">Inativo</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{u.email}</p>
                {!!u.memberships.length && (
                  <p className="mt-1 text-xs text-muted-foreground">{u.memberships.map((m) => `${m.companyName} (${MEMBER_ROLE_LABELS[m.role]})`).join(' · ')}</p>
                )}
              </div>
              {u.id !== me?.id && (
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: u.id, body: { favisAdmin: u.platformRole !== 'favis_admin' } })}>
                    {u.platformRole === 'favis_admin' ? 'Remover admin' : 'Tornar admin'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: u.id, body: { active: !u.active } })}>
                    {u.active ? 'Desativar' : 'Reativar'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => resetPassword(u)}>
                    <KeyRound /> Senha
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <NewUserDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
