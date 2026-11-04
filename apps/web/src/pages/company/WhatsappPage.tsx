import { WEEKDAY_LABELS } from '@fav/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, MessageSquare, Pause, Play, Plus, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { SendOutcome, WhatsappGroup, WhatsappMessage } from '@/lib/types';
import { cn, formatDateTime, todayISO } from '@/lib/utils';
import { useCompanyId } from './CompanyLayout';

const OUTCOME_TEXT: Record<SendOutcome['status'], string> = {
  enviada: 'Cronograma enviado (simulado)',
  duplicada: 'Já enviado — nada foi duplicado',
  ignorada: 'Envio não realizado',
  falhou: 'Falha no envio — registrada para nova tentativa',
};

export const MSG_STATUS_TONE = { pendente: 'neutral', enviada: 'success', falhou: 'danger', ignorada: 'warning', recebida: 'info' } as const;

function GroupDialog({ companyId, group, open, onOpenChange }: { companyId: string; group: WhatsappGroup | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [time, setTime] = useState('08:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setExternalId(group?.externalId ?? '');
    setTime(group?.dailySendTime ?? '08:00');
    setDays(group?.sendWeekdays ?? [1, 2, 3, 4, 5, 6]);
  }, [open, group]);
  const save = useMutation({
    mutationFn: () =>
      group
        ? api.patch(`/companies/${companyId}/whatsapp/groups/${group.id}`, { name, dailySendTime: time, sendWeekdays: days })
        : api.post(`/companies/${companyId}/whatsapp/groups`, { name, externalId, dailySendTime: time, sendWeekdays: days }),
    onSuccess: () => {
      toast.success(group ? 'Grupo atualizado' : 'Grupo vinculado');
      void qc.invalidateQueries({ queryKey: ['wa-groups', companyId] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={group ? 'Configurar grupo' : 'Vincular grupo'} description="Cada grupo pertence a uma única empresa.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <Field label="Nome do grupo" htmlFor="g-name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {!group && (
              <Field label="Identificador do grupo" htmlFor="g-ext" required hint="No simulador, use qualquer identificador único (ex.: grupo-padaria). Na integração real será o ID do grupo no WhatsApp.">
                <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
              </Field>
            )}
            <Field label="Horário do envio diário" htmlFor="g-time" hint="No fuso horário da empresa">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-36" />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Dias de envio</legend>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={days.includes(d)}
                    onClick={() => setDays((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d].sort()))}
                    className={cn('rounded-md border px-3 py-1.5 text-sm', days.includes(d) ? 'border-accent bg-accent-soft text-accent' : 'text-muted-foreground')}
                  >
                    {WEEKDAY_LABELS[d]}
                  </button>
                ))}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!days.length}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WhatsappPage() {
  const companyId = useCompanyId();
  const { user } = useAuth();
  const isAdmin = !!user?.isFavisAdmin;
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; group: WhatsappGroup | null }>({ open: false, group: null });
  const [selected, setSelected] = useState<string | null>(null);
  const [inbound, setInbound] = useState('');

  const status = useQuery({ queryKey: ['wa-status'], queryFn: () => api.get<{ simulated: boolean; detail: string; enabled: boolean }>('/whatsapp/status') });
  const groups = useQuery({ queryKey: ['wa-groups', companyId], queryFn: () => api.get<WhatsappGroup[]>(`/companies/${companyId}/whatsapp/groups`) });
  const groupId = selected ?? groups.data?.[0]?.id ?? null;
  const messages = useQuery({
    queryKey: ['wa-messages', companyId, groupId],
    queryFn: () => api.get<WhatsappMessage[]>(`/companies/${companyId}/whatsapp/messages`, { groupId: groupId ?? undefined }),
    enabled: !!groupId,
    refetchInterval: 15_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['wa-messages', companyId] });
    void qc.invalidateQueries({ queryKey: ['wa-groups', companyId] });
  };

  const sendDaily = useMutation({
    mutationFn: (id: string) => api.post<SendOutcome>(`/companies/${companyId}/whatsapp/groups/${id}/send-daily`, { date: todayISO() }),
    onSuccess: (r) => {
      (r.status === 'enviada' ? toast.success : r.status === 'falhou' ? toast.error : toast.info)(`${OUTCOME_TEXT[r.status]}${r.reason ? `: ${r.reason}` : ''}`);
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const togglePause = useMutation({
    mutationFn: (g: WhatsappGroup) => api.patch(`/companies/${companyId}/whatsapp/groups/${g.id}`, { paused: !g.paused }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const simulate = useMutation({
    mutationFn: () => api.post(`/companies/${companyId}/whatsapp/groups/${groupId}/simulate-inbound`, { senderName: user?.fullName.split(' ')[0] ?? 'Equipe', text: inbound }),
    onSuccess: () => {
      setInbound('');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 border-info/20 bg-info-soft p-4">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-info" />
        <div className="text-sm">
          <p className="font-medium text-info">Modo simulador</p>
          <p className="mt-0.5">
            {status.data?.detail ?? 'Nenhum número real conectado.'} As mensagens abaixo mostram exatamente o que seria enviado ao grupo.
            {status.data && !status.data.enabled && ' Os envios estão desativados nas configurações gerais.'}
          </p>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Grupos vinculados</h2>
            {isAdmin && (
              <Button size="sm" variant="secondary" onClick={() => setDialog({ open: true, group: null })}>
                <Plus /> Vincular
              </Button>
            )}
          </div>
          {groups.isLoading && <LoadingBlock rows={2} />}
          {groups.error && <ErrorState error={groups.error} />}
          {groups.data && !groups.data.length && (
            <EmptyState icon={MessageSquare} title="Nenhum grupo vinculado" description={isAdmin ? 'Vincule o grupo do cliente para enviar os cronogramas diários.' : 'A equipe FAVIS fará a vinculação do grupo.'} />
          )}
          {groups.data?.map((g) => (
            <Card key={g.id} className={cn('cursor-pointer p-4 transition-colors', g.id === groupId && 'border-foreground/30 ring-1 ring-foreground/10')} onClick={() => setSelected(g.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {g.dailySendTime} · {g.sendWeekdays.map((d) => WEEKDAY_LABELS[d]).join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground">Último envio: {formatDateTime(g.lastSentAt)}</p>
                </div>
                {g.paused ? <Badge tone="warning">Pausado</Badge> : !g.active ? <Badge>Inativo</Badge> : <Badge tone="success">Ativo</Badge>}
              </div>
              {isAdmin && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" onClick={() => sendDaily.mutate(g.id)} loading={sendDaily.isPending && sendDaily.variables === g.id}>
                    <Send /> Enviar cronograma de hoje
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => togglePause.mutate(g)}>
                    {g.paused ? <Play /> : <Pause />} {g.paused ? 'Retomar' : 'Pausar'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, group: g })}>
                    Configurar
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>

        <Card className="flex min-h-[420px] flex-col">
          <CardHeader className="border-b pb-4">
            <CardTitle>Conversa simulada</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col-reverse gap-3 overflow-y-auto bg-surface-muted/40" aria-live="polite">
            {!groupId && <p className="m-auto text-sm text-muted-foreground">Selecione um grupo.</p>}
            {messages.data && !messages.data.length && <p className="m-auto text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>}
            {messages.data?.map((m) => (
              <div key={m.id} className={cn('flex max-w-[85%] flex-col', m.direction === 'saida' ? 'self-end items-end' : 'self-start items-start')}>
                {m.direction === 'entrada' && <span className="mb-0.5 text-xs font-medium text-muted-foreground">{m.senderName}</span>}
                <div className={cn('whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm shadow-xs', m.direction === 'saida' ? 'rounded-br-md bg-[#dcf8c6] text-zinc-900' : 'rounded-bl-md bg-surface')}>
                  {m.body}
                </div>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {formatDateTime(m.createdAt)}
                  {m.direction === 'saida' && <Badge tone={MSG_STATUS_TONE[m.status]} className="py-0 text-[10px]">{m.status}</Badge>}
                  {m.lastError && <span className="text-danger">{m.lastError}</span>}
                </span>
              </div>
            ))}
          </CardContent>
          {isAdmin && groupId && (
            <form
              className="flex gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (inbound.trim()) simulate.mutate();
              }}
            >
              <Input value={inbound} onChange={(e) => setInbound(e.target.value)} placeholder='Simular mensagem do cliente, ex.: "cronograma de hoje"' aria-label="Mensagem simulada" />
              <Button type="submit" loading={simulate.isPending} aria-label="Enviar mensagem simulada">
                {!simulate.isPending && <Send />}
              </Button>
            </form>
          )}
        </Card>
      </div>
      <GroupDialog companyId={companyId} group={dialog.group} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </div>
  );
}
