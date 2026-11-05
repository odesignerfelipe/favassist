import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/ui/display';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import type { AuditLog } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';

const ENTITY: Record<string, string> = {
  companies: 'Empresa',
  company_members: 'Membro',
  company_profiles: 'Diagnóstico',
  campaigns: 'Campanha',
  activities: 'Atividade',
  activity_evidences: 'Evidência',
  profiles: 'Usuário',
  platform_settings: 'Configurações',
  whatsapp_groups: 'Grupo WhatsApp',
  social_accounts: 'Conta social',
};
const ACTION = { insert: { label: 'criou', tone: 'success' }, update: { label: 'alterou', tone: 'info' }, delete: { label: 'excluiu', tone: 'danger' } } as const;

function summarize(log: AuditLog): string {
  if (log.action !== 'update') return '';
  return Object.keys(log.changes).slice(0, 4).join(', ');
}

export default function AuditPage() {
  const [entity, setEntity] = useState('');
  const q = useQuery({ queryKey: ['audit', entity], queryFn: () => api.get<AuditLog[]>('/admin/audit-logs', { entity: entity || undefined, limit: 150 }) });
  return (
    <div>
      <PageHeader
        eyebrow="FAVIS"
        title="Auditoria"
        description="Registro automático de todas as alterações (quem, o quê e quando)"
        actions={
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="h-9 w-52 text-sm" aria-label="Filtrar por tipo">
            <option value="">Todos os registros</option>
            {Object.entries(ENTITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        }
      />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.length && <EmptyState icon={ScrollText} title="Nenhum registro" />}
      {!!q.data?.length && (
        <Card className="divide-y">
          {q.data.map((l) => (
            <details key={l.id} className="p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{l.actorName ?? 'Sistema'}</span>
                <Badge tone={ACTION[l.action].tone}>{ACTION[l.action].label}</Badge>
                <span>{ENTITY[l.entity] ?? l.entity}</span>
                {summarize(l) && <span className="text-muted-foreground">({summarize(l)})</span>}
                {l.companyName && <span className="text-muted-foreground">· {l.companyName}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(l.createdAt)}</span>
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-muted p-3 text-xs">{JSON.stringify(l.changes, null, 2)}</pre>
            </details>
          ))}
        </Card>
      )}
    </div>
  );
}
