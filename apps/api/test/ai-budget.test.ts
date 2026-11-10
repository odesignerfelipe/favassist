import { AIProviderError } from '@fav/ai-engine';
import { ScriptedProvider } from '@fav/ai-engine/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, client, createAdmin, createTestApp, login, todayIn, type TestContext } from './helpers';

/**
 * Controle de consumo de IA por empresa: teto de referência US$ 10/mês, alerta em 80%,
 * bloqueio de chamadas AUTOMÁTICAS no teto (manuais seguem), registro por chamada.
 * Cada chamada do provedor roteirizado "custa" US$ 3 para facilitar as contas.
 */
let ctx: TestContext;
let admin: ReturnType<typeof client>;
let companyId: string;
const today = todayIn();

const plan = () => ({
  summary: 'Semana de relacionamento',
  strategy_rationale: 'Teste de consumo',
  warnings: [],
  items: [
    {
      date: today,
      time: '10:00',
      title: 'Bom dia com a equipe',
      pillar: 'relacionamento',
      format: 'stories',
      stories_count: 2,
      objective: 'Aproximar',
      script: 'Roteiro',
      talking_points: ['Oi, pessoal!'],
      recording_guidelines: 'Luz natural',
      caption_suggestion: '',
      call_to_action: 'Responda',
      campaign_id: null,
      rationale: 'Motivo',
      needs_verification: [],
    },
  ],
});
const COST = { model: 'scripted', costUsd: 3, priceKnown: true, inputTokens: 1000, outputTokens: 500 };
const responses: unknown[] = [];
const provider = new ScriptedProvider(responses, ['Resposta da IA para o grupo'], COST);

async function requestPlan() {
  responses.push(plan());
  const r = await admin.post(`/companies/${companyId}/ai/plans`, { kind: 'plano_semanal', periodStart: today, periodEnd: addDays(today, 6) });
  expect(r.status).toBe(202);
  await ctx.queue.drain();
  return (await admin.get(`/companies/${companyId}/ai/generations/${r.body.id}`)).body;
}

async function automaticGeneration() {
  responses.push(plan());
  const id = await ctx.deps.db.asService(async (tx) => {
    const r = await tx.query(
      `insert into ai_generations (company_id, kind, period_start, period_end, origin)
       values ($1, 'plano_semanal', $2, $3, 'automatico') returning id`,
      [companyId, today, addDays(today, 6)],
    );
    return r.rows[0].id as string;
  });
  await ctx.deps.ai.runGeneration(id);
  return (await admin.get(`/companies/${companyId}/ai/generations/${id}`)).body;
}

const budget = async () => (await admin.get(`/companies/${companyId}/ai/budget`)).body;
const events = () =>
  ctx.deps.db.asService(async (tx) => (await tx.query('select * from ai_usage_events where company_id = $1 order by created_at', [companyId])).rows);

beforeAll(async () => {
  ctx = await createTestApp({ aiProvider: provider });
  const a = await createAdmin(ctx);
  admin = client(ctx, (await login(ctx, a.email, a.password)).token);
  companyId = (await admin.post('/companies', { name: 'Padaria Consumo' })).body.id;
});
afterAll(async () => ctx?.close());

describe('Controle de consumo de IA', () => {
  it('começa com o teto padrão de US$ 10 e nada gasto', async () => {
    const b = await budget();
    expect(b).toMatchObject({ spentUsd: 0, budgetUsd: 10, customBudget: false, alertPct: 80, level: 'ok', automaticBlocked: false });
    expect(b.note).toContain('ESTIMADO');
  });

  it('registra cada chamada com tokens, custo, origem e funcionalidade', async () => {
    const gen = await requestPlan();
    expect(gen.status).toBe('concluida');
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      generation_id: gen.id,
      feature: 'planejamento',
      origin: 'manual',
      input_tokens: 1000,
      output_tokens: 500,
      succeeded: true,
    });
    expect(Number(rows[0].cost_usd)).toBe(3);
    expect((await budget()).spentUsd).toBe(3);
  });

  it('alerta ao passar de 80% (uma única vez por mês)', async () => {
    await requestPlan(); // 6
    expect((await budget()).level).toBe('ok');
    await requestPlan(); // 9 → 90%
    const b = await budget();
    expect(b).toMatchObject({ level: 'alerta', usedPct: 90, automaticBlocked: false });
    const alerts = await ctx.deps.db.asService(async (tx) => (await tx.query('select level from ai_budget_alerts where company_id = $1', [companyId])).rows);
    expect(alerts).toEqual([{ level: 'alerta' }]);
  });

  it('no teto, a geração MANUAL continua (com aviso) e a AUTOMÁTICA é bloqueada sem chamar a IA', async () => {
    const manual = await requestPlan(); // 12 → teto
    expect(manual.status).toBe('concluida');
    expect(await budget()).toMatchObject({ level: 'limite', automaticBlocked: true });

    const before = (await events()).length;
    const callsBefore = provider.calls.length;
    const auto = await automaticGeneration();
    expect(auto.status).toBe('falhou');
    expect(auto.error).toContain('Limite mensal de IA');
    expect((await events()).length).toBe(before);
    expect(provider.calls.length).toBe(callsBefore);
    responses.length = 0;

    const levels = await ctx.deps.db.asService(
      async (tx) => (await tx.query('select level from ai_budget_alerts where company_id = $1 order by level', [companyId])).rows,
    );
    expect(levels).toEqual([{ level: 'alerta' }, { level: 'limite' }]);
  });

  it('no teto, o assistente do WhatsApp responde sem IA (resposta padrão) e não gasta', async () => {
    const g = await admin.post(`/companies/${companyId}/whatsapp/groups`, { name: 'Grupo Consumo', externalId: 'grupo-consumo' });
    expect(g.status).toBe(201);
    const before = (await events()).length;
    const r = await admin.post(`/companies/${companyId}/whatsapp/groups/${g.body.id}/simulate-inbound`, {
      senderName: 'Ana Souza',
      text: 'Qual cor vocês acham melhor para a vitrine nova?',
    });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('Resposta da IA para o grupo');
    expect((await events()).length).toBe(before);
  });

  it('o administrador ajusta o teto da empresa e a automação volta a funcionar', async () => {
    const put = await admin.put(`/admin/companies/${companyId}/ai-budget`, { monthlyBudgetUsd: 50 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ budgetUsd: 50, customBudget: true, level: 'ok' });

    const auto = await automaticGeneration();
    expect(auto.status).toBe('concluida');
    const last = (await events()).at(-1);
    expect(last).toMatchObject({ origin: 'automatico', feature: 'planejamento' });

    const back = await admin.put(`/admin/companies/${companyId}/ai-budget`, { monthlyBudgetUsd: null });
    expect(back.body).toMatchObject({ budgetUsd: 10, customBudget: false, level: 'limite' });
    expect((await admin.put(`/admin/companies/${companyId}/ai-budget`, { monthlyBudgetUsd: -1 })).status).toBe(400);
  });

  it('chamadas que falham mas foram cobradas também entram na conta', async () => {
    await admin.put(`/admin/companies/${companyId}/ai-budget`, { monthlyBudgetUsd: 100 });
    responses.push(new AIProviderError('A IA recusou a solicitação', 'refusal', false, [{ ...COST, costUsd: 0.5 }]));
    const r = await admin.post(`/companies/${companyId}/ai/plans`, { kind: 'plano_semanal', periodStart: today, periodEnd: addDays(today, 6) });
    await ctx.queue.drain().catch(() => {});
    const gen = (await admin.get(`/companies/${companyId}/ai/generations/${r.body.id}`)).body;
    expect(gen.status).toBe('falhou');
    const last = (await events()).at(-1);
    expect(last).toMatchObject({ succeeded: false, generation_id: r.body.id });
    expect(Number(last.cost_usd)).toBe(0.5);
  });

  it('painel FAVIS mostra consumo, alertas e totais; o padrão da plataforma é configurável', async () => {
    const p = await admin.get('/admin/ai-usage');
    expect(p.status).toBe(200);
    const row = p.body.companies.find((c: { companyId: string }) => c.companyId === companyId);
    expect(row).toMatchObject({ companyName: 'Padaria Consumo', calls: 6, failedCalls: 1, automaticCalls: 1, budgetUsd: 100 });
    // 4 manuais × 3 + 1 automática × 3 + 1 recusa × 0,50
    expect(row.spentUsd).toBeCloseTo(15.5, 4);
    expect(p.body.alerts.length).toBeGreaterThanOrEqual(2);
    expect(p.body.defaults).toEqual({ aiDefaultMonthlyBudgetUsd: 10, aiBudgetAlertPct: 80 });

    const s = (await admin.get('/admin/settings')).body.settings;
    const put = await admin.put('/admin/settings', {
      aiEnabled: s.aiEnabled,
      aiDefaultCampaignMix: Number(s.aiDefaultCampaignMix),
      aiHistoryDays: s.aiHistoryDays,
      aiGuidelines: s.aiGuidelines,
      messagingEnabled: s.messagingEnabled,
      messagingDefaultSendTime: s.messagingDefaultSendTime.slice(0, 5),
      aiDefaultMonthlyBudgetUsd: 15,
      aiBudgetAlertPct: 70,
    });
    expect(put.status).toBe(200);
    expect((await admin.get('/admin/ai-usage')).body.defaults).toEqual({ aiDefaultMonthlyBudgetUsd: 15, aiBudgetAlertPct: 70 });
  });

  it('isolamento: colaborador e gestor de outra empresa não veem o consumo', async () => {
    const m = await admin.post(`/companies/${companyId}/members`, {
      email: 'colab@consumo.dev',
      fullName: 'Colaborador Consumo',
      role: 'collaborator',
      password: 'senha-colab-123',
    });
    expect(m.status).toBe(201);
    const colab = client(ctx, (await login(ctx, 'colab@consumo.dev', 'senha-colab-123')).token);
    expect((await colab.get(`/companies/${companyId}/ai/budget`)).status).toBe(403);
    expect((await colab.get('/admin/ai-usage')).status).toBe(403);
    expect((await colab.put(`/admin/companies/${companyId}/ai-budget`, { monthlyBudgetUsd: 1000 })).status).toBe(403);

    // RLS no banco: mesmo consultando direto, o colaborador não lê os eventos
    const visible = await ctx.deps.db.asService(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: m.body.userId, role: 'authenticated' })]);
      return (await tx.query('select count(*)::int as n from ai_usage_events')).rows[0].n;
    });
    expect(visible).toBe(0);

    const other = (await admin.post('/companies', { name: 'Outra Empresa' })).body.id;
    const o = await admin.post(`/companies/${other}/members`, {
      email: 'dono@outra.dev',
      fullName: 'Dono Outra',
      role: 'owner',
      password: 'senha-dono-123',
    });
    expect(o.status).toBe(201);
    const owner2 = client(ctx, (await login(ctx, 'dono@outra.dev', 'senha-dono-123')).token);
    // 404: a API não revela a existência de empresas de terceiros
    expect([403, 404]).toContain((await owner2.get(`/companies/${companyId}/ai/budget`)).status);
    expect((await owner2.get(`/companies/${other}/ai/budget`)).body).toMatchObject({ spentUsd: 0, budgetUsd: 15 });
  });
});
