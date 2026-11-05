import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from '@fav/shared';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, PlugZap } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, StatCard } from '@/components/ui/display';
import { api } from '@/lib/api';
import { useCompanyId } from './CompanyLayout';

interface MetricsResponse {
  integrations: { platform: SocialPlatform; status: string; handle?: string }[];
  metrics: { metric: string; value: number }[];
  note: string | null;
}

const METRIC_LABELS: Record<string, string> = {
  alcance: 'Alcance',
  visualizacoes: 'Visualizações',
  interacoes: 'Interações',
  seguidores: 'Seguidores',
  engajamento: 'Engajamento',
  cliques: 'Cliques',
  conversoes: 'Conversões rastreáveis',
};

export default function MetricsPage() {
  const companyId = useCompanyId();
  const q = useQuery({ queryKey: ['metrics', companyId], queryFn: () => api.get<MetricsResponse>(`/companies/${companyId}/metrics`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 md:grid-cols-3">
        {d.integrations.map((i) => (
          <Card key={i.platform} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{SOCIAL_PLATFORM_LABELS[i.platform]}</p>
              <p className="text-sm text-muted-foreground">{i.handle || 'Conta não vinculada'}</p>
            </div>
            <Badge tone={i.status === 'conectada' ? 'success' : i.status === 'erro' ? 'danger' : 'neutral'}>
              {i.status === 'nao_conectada' ? 'Não conectada' : i.status}
            </Badge>
          </Card>
        ))}
      </div>
      {d.metrics.length ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {d.metrics.map((m) => (
            <StatCard key={m.metric} label={METRIC_LABELS[m.metric] ?? m.metric} value={m.value.toLocaleString('pt-BR')} hint="Últimos 30 dias" />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="Ainda não há métricas para exibir"
          description={
            <>
              Alcance, visualizações, interações e crescimento aparecerão aqui quando uma integração autorizada (Instagram, Facebook ou
              Perfil da Empresa no Google) for conectada. Nenhum número é estimado ou inventado.
            </>
          }
          action={
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <PlugZap className="size-4" /> Integrações previstas na próxima etapa (ver ROADMAP.md)
            </span>
          }
        />
      )}
    </div>
  );
}
