import { MEMBER_ROLE_LABELS } from '@fav/shared';
import { useQuery } from '@tanstack/react-query';
import { Award, Flame, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingBlock, Progress, Segmented } from '@/components/ui/display';
import { api } from '@/lib/api';
import type { Gamification } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { useCompanyId } from './CompanyLayout';

export default function RankingPage() {
  const companyId = useCompanyId();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const q = useQuery({
    queryKey: ['gamification', companyId, period],
    queryFn: () => api.get<Gamification>(`/companies/${companyId}/gamification`, { period }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          O ranking valoriza constância e qualidade: tarefas no prazo, evidências registradas e sequência de dias ativos — não apenas quantidade.
        </p>
        <Segmented
          label="Período"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'Semana' },
            { value: 'month', label: 'Mês' },
            { value: 'year', label: 'Ano' },
          ]}
        />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.ranking.length && (
        <EmptyState icon={Trophy} title="Ranking ainda vazio" description="Os pontos aparecem quando as tarefas atribuídas começam a ser concluídas." />
      )}
      {!!q.data?.ranking.length && (
        <Card className="divide-y">
          {q.data.ranking.map((r, i) => (
            <div key={r.userId} className="flex flex-wrap items-center gap-4 p-4">
              <span className={cn('w-6 text-center text-lg font-semibold tabular-nums', i === 0 ? 'text-warning' : 'text-muted-foreground')}>{i + 1}</span>
              <Avatar name={r.name} className="size-10" />
              <div className="min-w-40 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-sm text-muted-foreground">
                  {MEMBER_ROLE_LABELS[r.role]} · Nível {r.level.level} · {r.totalPoints} pts
                </p>
                <Progress value={r.level.progress * 100} className="mt-1.5 max-w-56" label="Progresso até o próximo nível" />
              </div>
              <div className="grid grid-cols-3 gap-4 text-center text-sm">
                <div>
                  <p className="font-semibold tabular-nums">
                    {r.completedOnTime}/{r.due}
                  </p>
                  <p className="text-xs text-muted-foreground">no prazo</p>
                </div>
                <div>
                  <p className="flex items-center justify-center gap-1 font-semibold tabular-nums">
                    <Flame className="size-3.5 text-warning" /> {r.streak}
                  </p>
                  <p className="text-xs text-muted-foreground">dias seguidos</p>
                </div>
                <div>
                  <p className="font-semibold tabular-nums">{r.score}</p>
                  <p className="text-xs text-muted-foreground">consistência</p>
                </div>
              </div>
              {!!r.achievements.length && (
                <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
                  {r.achievements.map((code) => (
                    <Badge key={code} tone="accent">
                      <Award className="size-3" /> {q.data!.achievements.find((a) => a.code === code)?.name ?? code}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      {q.data && (
        <Card>
          <CardHeader>
            <CardTitle>Conquistas disponíveis</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {q.data.achievements.map((a) => (
              <div key={a.code} className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 font-medium">
                  <Award className="size-4 text-accent" /> {a.name}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {q.data && <p className="text-xs text-muted-foreground">Período: {formatDate(q.data.from)} a {formatDate(q.data.to)}</p>}
    </div>
  );
}
