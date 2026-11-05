import { MEMBER_ROLE_LABELS } from '@fav/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function AccountPage() {
  const { user, reload } = useAuth();
  const [name, setName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  useEffect(() => setName(user?.fullName ?? ''), [user?.fullName]);

  const saveName = useMutation({
    mutationFn: () => api.patch('/auth/me', { fullName: name }),
    onSuccess: async () => {
      await reload();
      toast.success('Nome atualizado');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const savePassword = useMutation({
    mutationFn: () => api.post('/auth/me/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      toast.success('Senha alterada. Outras sessões foram encerradas.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Minha conta" description={user?.email} />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                saveName.mutate();
              }}
            >
              <Field label="Nome" htmlFor="name" className="flex-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} />
              </Field>
              <Button type="submit" variant="secondary" loading={saveName.isPending} disabled={name.trim().length < 2 || name === user?.fullName}>
                Salvar
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Acessos</CardTitle>
              <CardDescription>Empresas e papéis vinculados à sua conta</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {user?.isFavisAdmin && <Badge tone="accent" className="w-fit">Administrador FAVIS</Badge>}
            {user?.companies.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>{c.name}</span>
                <Badge>{MEMBER_ROLE_LABELS[c.role]}</Badge>
              </div>
            ))}
            {!user?.isFavisAdmin && !user?.companies.length && <p className="text-sm text-muted-foreground">Nenhuma empresa vinculada.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alterar senha</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                savePassword.mutate();
              }}
            >
              <Field label="Senha atual" htmlFor="current">
                <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
              <Field label="Nova senha" htmlFor="new" hint="Mínimo de 10 caracteres">
                <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
              <Button type="submit" className="w-fit" loading={savePassword.isPending} disabled={!current || next.length < 10}>
                Alterar senha
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
