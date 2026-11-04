import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, LoadingBlock, PageHeader, Switch } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import type { PlatformSettings } from '@/lib/types';

interface SettingsResponse {
  settings: PlatformSettings;
  ai: { configured: boolean; provider: string; model: string | null };
  messaging: { provider: string; simulated: boolean; detail: string; connected: boolean };
  queue: 'bullmq' | 'inline';
  auth: 'local' | 'supabase';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<SettingsResponse>('/admin/settings') });
  const [s, setS] = useState<PlatformSettings | null>(null);
  useEffect(() => {
    if (q.data) setS({ ...q.data.settings, aiDefaultCampaignMix: Number(q.data.settings.aiDefaultCampaignMix) });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api.put('/admin/settings', {
        aiEnabled: s!.aiEnabled,
        aiDefaultCampaignMix: s!.aiDefaultCampaignMix,
        aiHistoryDays: s!.aiHistoryDays,
        aiGuidelines: s!.aiGuidelines,
        messagingEnabled: s!.messagingEnabled,
        messagingDefaultSendTime: s!.messagingDefaultSendTime,
      }),
    onSuccess: () => {
      toast.success('Configurações salvas');
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isLoading || !s) return q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <LoadingBlock />;
  const d = q.data!;

  return (
    <div>
      <PageHeader eyebrow="FAVIS" title="Configurações" description="Inteligência artificial, automações e status dos serviços" />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Inteligência artificial</CardTitle>
                <CardDescription>Diretrizes aplicadas a todos os planejamentos</CardDescription>
              </div>
              <Switch checked={s.aiEnabled} onCheckedChange={(v) => setS({ ...s, aiEnabled: v })} aria-label="IA habilitada" />
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label={`Participação padrão de campanhas: ${Math.round(s.aiDefaultCampaignMix * 100)}%`} htmlFor="mix">
                <input type="range" min={0} max={1} step={0.05} value={s.aiDefaultCampaignMix} onChange={(e) => setS({ ...s, aiDefaultCampaignMix: Number(e.target.value) })} className="mt-2 w-full accent-[rgb(var(--accent))]" />
              </Field>
              <Field label="Histórico considerado (dias)" htmlFor="history" hint="Memória estratégica usada para evitar repetições">
                <Input type="number" min={7} max={365} value={s.aiHistoryDays} onChange={(e) => setS({ ...s, aiHistoryDays: Number(e.target.value) })} />
              </Field>
              <Field label="Diretrizes da FAVIS para a IA" htmlFor="guidelines" className="sm:col-span-2" hint="Ex.: priorizar conteúdos gravados pelo próprio dono; linguagem sem jargões">
                <Textarea rows={5} maxLength={4000} value={s.aiGuidelines} onChange={(e) => setS({ ...s, aiGuidelines: e.target.value })} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Automações do WhatsApp</CardTitle>
                <CardDescription>Desligar aqui pausa todos os envios de todas as empresas</CardDescription>
              </div>
              <Switch checked={s.messagingEnabled} onCheckedChange={(v) => setS({ ...s, messagingEnabled: v })} aria-label="Envios habilitados" />
            </CardHeader>
            <CardContent>
              <Field label="Horário padrão para novos grupos" htmlFor="sendtime">
                <Input type="time" className="w-36" value={s.messagingDefaultSendTime} onChange={(e) => setS({ ...s, messagingDefaultSendTime: e.target.value })} />
              </Field>
            </CardContent>
          </Card>
          <div>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Salvar configurações
            </Button>
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Status dos serviços</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Row label="Provedor de IA">
              {d.ai.configured ? (
                <Badge tone="success">
                  {d.ai.provider} · {d.ai.model}
                </Badge>
              ) : (
                <Badge tone="warning">Não configurado</Badge>
              )}
            </Row>
            <Row label="WhatsApp">
              <Badge tone="info">{d.messaging.simulated ? 'Simulador' : d.messaging.provider}</Badge>
            </Row>
            <Row label="Filas">
              <Badge tone={d.queue === 'bullmq' ? 'success' : 'warning'}>{d.queue === 'bullmq' ? 'Redis/BullMQ' : 'Inline (sem Redis)'}</Badge>
            </Row>
            <Row label="Autenticação">
              <Badge>{d.auth === 'supabase' ? 'Supabase Auth' : 'Local'}</Badge>
            </Row>
            <p className="pt-3 text-xs text-muted-foreground">
              Chaves e credenciais são definidas apenas em variáveis de ambiente do servidor e nunca chegam ao navegador.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
