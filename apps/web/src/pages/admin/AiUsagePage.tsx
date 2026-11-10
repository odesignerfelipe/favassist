import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Progress, StatCard, type BadgeTone } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import type { AiBudgetLevel, AiUsageCompany, AiUsageOverview } from '@/lib/types';
import { formatDateTime, formatUsd } from '@/lib/utils';

export const BUDGET_LEVEL: Record<AiBudgetLevel, { label: string; tone: BadgeTone }> = {
  ok: { label: 'Dentro do teto', tone: 'success' },
  alerta: { label: 'Alerta de consumo', tone: 'warning' },
  limite: { label: 'Teto atingido', tone: 'danger' },
};

const usd = formatUsd;

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} mi` : n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n));

function BudgetDialog({ company, defaultBudget, onClose }: { company: AiUsageCompany; defaultBudget: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(company.customBudget ? String(company.budgetUsd) : '');
  const save = useMutation({
    mutationFn: (monthlyBudgetUsd: number | null) => api.put(`/admin/companies/${company.companyId}/ai-budget`, { monthlyBudgetUsd }),
    onSuccess: () => {
      toast.success('Teto atualizado');
      void qc.invalidateQueries({ queryKey: ['admin-ai-usage'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Teto de IA — ${company.companyName}`} description="Referência mensal interna. Não altera limites da conta Anthropic.">
        <DialogBody>
          <Field
            label="Teto mensal (US$)"
            htmlFor="company-budget"
            hint={`Deixe em branco para usar o padrão da plataforma (${usd(defaultBudget)}). Use 0 para desligar as chamadas automáticas.`}
          >
            <Input id="company-budget" type="number" min={0} max={10000} step={0.5} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(value.trim() === '' ? null : Number(value))}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AiUsagePage() {
  const [editing, setEditing] = useState<AiUsageCompany | null>(null);
  const q = useQuery({ queryKey: ['admin-ai-usage'], queryFn: () => api.get<AiUsageOverview>('/admin/ai-usage'), refetchInterval: 60_000 });
  const d = q.data;
  // Empresas sem consumo e no padrão ficam agrupadas numa linha, para destacar quem gasta
  const active = d?.companies.filter((c) => c.calls > 0 || c.level !== 'ok' || c.customBudget) ?? [];
  const idle = d?.companies.filter((c) => !active.includes(c)) ?? [];

  return (
    <div>
      <PageHeader eyebrow="FAVIS" title="Consumo de IA" description="Custo estimado por empresa no mês corrente, alertas e tetos" />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {d && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Custo estimado no mês" value={usd(d.totals.spentUsd)} />
            <StatCard label="Chamadas à IA" value={d.totals.calls} />
            <StatCard label="Empresas em alerta" value={d.totals.companiesOnAlert} tone={d.totals.companiesOnAlert ? 'warning' : undefined} />
            <StatCard label="Empresas no teto" value={d.totals.companiesAtLimit} tone={d.totals.companiesAtLimit ? 'danger' : undefined} hint="Automações de IA pausadas" />
          </div>

          {!d.companies.length ? (
            <EmptyState icon={Bot} title="Nenhuma empresa cadastrada" />
          ) : (
            <Card className="divide-y">
              {!active.length && <p className="p-4 text-sm text-muted-foreground">Nenhum consumo de IA registrado neste mês.</p>}
              {active.map((c) => (
                <div key={c.companyId} className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link to={`/empresas/${c.companyId}/ia`} className="font-medium hover:underline">
                      {c.companyName}
                    </Link>
                    <Badge tone={BUDGET_LEVEL[c.level].tone}>{BUDGET_LEVEL[c.level].label}</Badge>
                    <span className="ml-auto text-sm tabular-nums">
                      {usd(c.spentUsd)} <span className="text-muted-foreground">de {usd(c.budgetUsd)}</span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`Editar teto de ${c.companyName}`}>
                      <Pencil /> Teto
                    </Button>
                  </div>
                  <Progress value={c.usedPct} label={`Consumo de ${c.companyName}`} />
                  <p className="text-xs text-muted-foreground">
                    {c.calls} chamada(s){c.automaticCalls ? ` · ${c.automaticCalls} automática(s)` : ''}
                    {c.failedCalls ? ` · ${c.failedCalls} com falha` : ''} · {tokens(c.inputTokens)} tokens de entrada ·{' '}
                    {tokens(c.outputTokens)} de saída · teto {c.customBudget ? 'próprio' : 'padrão'}
                    {c.unknownPrice ? ' · ⚠ modelo fora da tabela de preços (estimado pelo maior preço)' : ''}
                  </p>
                </div>
              ))}
              {!!idle.length && (
                <details className="group p-4">
                  <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
                    {idle.length} empresa(s) sem consumo neste mês, no teto padrão de {usd(d.defaults.aiDefaultMonthlyBudgetUsd)} ▾
                  </summary>
                  <ul className="mt-3 flex flex-col gap-1">
                    {idle.map((c) => (
                      <li key={c.companyId} className="flex items-center gap-2 text-sm">
                        <Link to={`/empresas/${c.companyId}/ia`} className="hover:underline">
                          {c.companyName}
                        </Link>
                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(c)} aria-label={`Editar teto de ${c.companyName}`}>
                          <Pencil /> Teto
                        </Button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          )}

          {!!d.alerts.length && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Alertas recentes</h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {d.alerts.map((a) => (
                  <li key={`${a.companyId}-${a.month}-${a.level}`} className="flex flex-wrap items-center gap-2">
                    <Badge tone={BUDGET_LEVEL[a.level].tone}>{a.level === 'limite' ? 'Teto atingido' : 'Alerta'}</Badge>
                    <span>{a.companyName}</span>
                    <span className="text-muted-foreground">
                      {usd(a.spentUsd)} de {usd(a.budgetUsd)} · {formatDateTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            {d.note} Tabela de preços de {d.priceTableDate}. Padrão da plataforma: {usd(d.defaults.aiDefaultMonthlyBudgetUsd)} por empresa,
            alerta em {d.defaults.aiBudgetAlertPct}% (altere em Configurações).
          </p>
        </div>
      )}
      {editing && d && <BudgetDialog company={editing} defaultBudget={d.defaults.aiDefaultMonthlyBudgetUsd} onClose={() => setEditing(null)} />}
    </div>
  );
}
