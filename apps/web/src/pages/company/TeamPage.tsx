import { zodResolver } from '@hookform/resolvers/zod';
import {
  MANAGER_CONFIGURABLE_PERMISSIONS,
  MANAGER_DEFAULTS,
  MEMBER_ROLE_LABELS,
  memberCreateSchema,
  PERMISSION_LABELS,
  type MemberCreateInput,
  type MemberRole,
} from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, ErrorState, LoadingBlock, Switch } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Member } from '@/lib/types';
import { useCompanyId } from './CompanyLayout';

type FormInput = z.input<typeof memberCreateSchema>;

function useManageableRoles(companyId: string): MemberRole[] {
  const { user, company, can } = useAuth();
  if (user?.isFavisAdmin) return ['owner', 'manager', 'collaborator'];
  if (!can(companyId, 'members.manage')) return [];
  const role = company(companyId)?.role;
  return role === 'owner' ? ['manager', 'collaborator'] : role === 'manager' ? ['collaborator'] : [];
}

function AddMemberDialog({ companyId, open, onOpenChange, roles }: { companyId: string; open: boolean; onOpenChange: (o: boolean) => void; roles: MemberRole[] }) {
  const qc = useQueryClient();
  const form = useForm<FormInput, unknown, MemberCreateInput>({ resolver: zodResolver(memberCreateSchema) });
  const e = form.formState.errors;
  useEffect(() => {
    if (open) form.reset({ email: '', fullName: '', role: roles[roles.length - 1] ?? 'collaborator', jobTitle: '', permissions: {}, password: undefined });
  }, [open, roles, form]);
  const save = useMutation({
    mutationFn: (v: MemberCreateInput) => api.post<{ created: boolean }>(`/companies/${companyId}/members`, v),
    onSuccess: (r) => {
      toast.success(r.created ? 'Usuário criado e adicionado à equipe' : 'Usuário existente adicionado à equipe');
      void qc.invalidateQueries({ queryKey: ['members', companyId] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Adicionar à equipe" description="Se o e-mail ainda não tiver acesso, um usuário será criado com a senha inicial.">
        <form onSubmit={form.handleSubmit((v) => save.mutate({ ...v, password: v.password || undefined }))} noValidate>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Nome completo" htmlFor="fullName" required error={e.fullName?.message}>
              <Input {...form.register('fullName')} />
            </Field>
            <Field label="E-mail" htmlFor="email" required error={e.email?.message}>
              <Input type="email" {...form.register('email')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Papel" htmlFor="role" required>
                <Select {...form.register('role')}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {MEMBER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cargo" htmlFor="jobTitle">
                <Input {...form.register('jobTitle')} placeholder="Ex.: Atendimento" />
              </Field>
            </div>
            <Field label="Senha inicial" htmlFor="password" error={e.password?.message} hint="Obrigatória para novos usuários (mín. 10 caracteres). Oriente a troca no primeiro acesso.">
              <Input type="password" autoComplete="new-password" {...form.register('password', { setValueAs: (v: string) => v || undefined })} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog({ companyId, member, onClose }: { companyId: string; member: Member | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (member) setPerms(Object.fromEntries(MANAGER_CONFIGURABLE_PERMISSIONS.map((p) => [p, member.permissions[p] ?? MANAGER_DEFAULTS[p]])));
  }, [member]);
  const save = useMutation({
    mutationFn: () => api.patch(`/companies/${companyId}/members/${member!.id}`, { permissions: perms }),
    onSuccess: () => {
      toast.success('Permissões atualizadas');
      void qc.invalidateQueries({ queryKey: ['members', companyId] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Permissões de ${member?.fullName ?? ''}`} description="Gerentes sempre veem todas as atividades e executam as próprias tarefas.">
        <DialogBody className="flex flex-col divide-y">
          {MANAGER_CONFIGURABLE_PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center justify-between gap-4 py-3 text-sm">
              {PERMISSION_LABELS[p]}
              <Switch checked={!!perms[p]} onCheckedChange={(v) => setPerms((s) => ({ ...s, [p]: v }))} aria-label={PERMISSION_LABELS[p]} />
            </label>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  const companyId = useCompanyId();
  const { user } = useAuth();
  const roles = useManageableRoles(companyId);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const q = useQuery({ queryKey: ['members', companyId], queryFn: () => api.get<Member[]>(`/companies/${companyId}/members`) });
  const toggle = useMutation({
    mutationFn: (m: Member) => api.patch(`/companies/${companyId}/members/${m.id}`, { active: !m.active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members', companyId] }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground">Pessoas com acesso a esta empresa.</p>
        {roles.length > 0 && (
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> Adicionar pessoa
          </Button>
        )}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.length && <EmptyState icon={Users} title="Nenhum membro ainda" description="Adicione o proprietário e os colaboradores da empresa." />}
      {!!q.data?.length && (
        <Card className="divide-y">
          {q.data.map((m) => {
            const manageable = roles.includes(m.role) && m.userId !== user?.id;
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                <Avatar name={m.fullName} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.fullName} {!m.active && <Badge tone="warning">Inativo</Badge>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {m.email}
                    {m.jobTitle ? ` · ${m.jobTitle}` : ''}
                  </p>
                </div>
                <Badge tone={m.role === 'owner' ? 'accent' : m.role === 'manager' ? 'info' : 'neutral'}>{MEMBER_ROLE_LABELS[m.role]}</Badge>
                {manageable && (
                  <div className="flex items-center gap-1">
                    {m.role === 'manager' && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                        <Settings2 /> Permissões
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => toggle.mutate(m)}>
                      {m.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
      <AddMemberDialog companyId={companyId} open={adding} onOpenChange={setAdding} roles={roles} />
      <PermissionsDialog companyId={companyId} member={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
