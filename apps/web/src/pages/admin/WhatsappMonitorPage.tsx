import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, StatCard } from '@/components/ui/display';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import type { WhatsappMessage } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { MSG_STATUS_TONE } from '../company/WhatsappPage';

const KIND: Record<WhatsappMessage['kind'], string> = {
  cronograma_diario: 'Cronograma diário',
  manual: 'Mensagem manual',
  resposta: 'Resposta automática',
  recebida: 'Recebida',
};

export default function WhatsappMonitorPage() {
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['wa-monitor', status],
    queryFn: () =>
      api.get<{ stats: { sent24h: number; failed24h: number; pending: number; received24h: number }; messages: WhatsappMessage[] }>(
        '/admin/whatsapp/messages',
        { status: status || undefined },
      ),
    refetchInterval: 20_000,
  });

  return (
    <div>
      <PageHeader eyebrow="FAVIS" title="Monitoramento do WhatsApp" description="Envios e respostas de todas as empresas (simulador)" />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Enviadas (24h)" value={q.data.stats.sent24h} />
            <StatCard label="Falhas (24h)" value={q.data.stats.failed24h} tone={q.data.stats.failed24h ? 'danger' : undefined} />
            <StatCard label="Pendentes" value={q.data.stats.pending} />
            <StatCard label="Recebidas (24h)" value={q.data.stats.received24h} />
          </div>
          <div className="flex justify-end">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-48 text-sm" aria-label="Filtrar status">
              <option value="">Todos os status</option>
              <option value="enviada">Enviadas</option>
              <option value="falhou">Falhas</option>
              <option value="pendente">Pendentes</option>
              <option value="ignorada">Ignoradas</option>
              <option value="recebida">Recebidas</option>
            </Select>
          </div>
          {!q.data.messages.length ? (
            <EmptyState icon={MessageSquare} title="Nenhuma mensagem registrada" description="Vincule grupos nas páginas das empresas para iniciar os envios." />
          ) : (
            <Card className="divide-y">
              {q.data.messages.map((m) => (
                <details key={m.id} className="group p-4">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={MSG_STATUS_TONE[m.status]}>{m.status}</Badge>
                    <Link to={`/empresas/${m.companyId}/whatsapp`} className="font-medium hover:underline">
                      {m.companyName}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {m.groupName ?? 'grupo removido'} · {KIND[m.kind]}
                      {m.attempts > 1 ? ` · ${m.attempts} tentativas` : ''}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                  </summary>
                  {m.lastError && <p className="mt-2 text-sm text-danger">Erro: {m.lastError}</p>}
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-muted p-3 font-sans text-sm">{m.body}</pre>
                </details>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
