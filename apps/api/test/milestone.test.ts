import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, client, createAdmin, createTestApp, login, todayIn, type TestContext } from './helpers';

/**
 * MARCO 1 — fluxo completo pela API:
 * admin → empresa → diagnóstico → campanha → equipe → atividades → colaborador conclui
 * → dashboard reflete → simulação de envio pelo WhatsApp.
 */
let ctx: TestContext;
let admin: ReturnType<typeof client>;
let owner: ReturnType<typeof client>;
let collab: ReturnType<typeof client>;
const state: Record<string, string> = {};
const today = todayIn();

beforeAll(async () => {
  ctx = await createTestApp();
  const a = await createAdmin(ctx);
  admin = client(ctx, (await login(ctx, a.email, a.password)).token);
});
afterAll(async () => ctx?.close());

describe('autenticação', () => {
  it('rejeita senha errada sem revelar se o e-mail existe', async () => {
    const r1 = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@favis.test', password: 'x' } });
    const r2 = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nao@existe.dev', password: 'x' } });
    expect(r1.statusCode).toBe(401);
    expect(r2.json().message).toBe(r1.json().message);
  });

  it('renova a sessão pelo cookie httpOnly e detecta reuso do refresh token', async () => {
    const s = await login(ctx, 'admin@favis.test', 'senha-admin-123');
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { fav_rt: s.refreshCookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.isFavisAdmin).toBe(true);
    const reuse = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { fav_rt: s.refreshCookie } });
    expect(reuse.statusCode).toBe(401);
  });

  it('rotas protegidas exigem token', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/companies' });
    expect(r.statusCode).toBe(401);
  });
});

describe('marco 1', () => {
  it('1-2. admin cadastra a empresa', async () => {
    const r = await admin.post('/companies', { name: 'Padaria Aurora', segment: 'Padaria artesanal' });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe('padaria-aurora');
    state.company = r.body.id;
    const dup = await admin.post('/companies', { name: 'Padaria Aurora' });
    expect(dup.status).toBe(409);
  });

  it('valida entradas com mensagens claras', async () => {
    const r = await admin.post('/companies', { name: 'A' });
    expect(r.status).toBe(400);
    expect(r.body.details[0].path).toBe('name');
  });

  it('3. configura o diagnóstico estratégico', async () => {
    const r = await admin.put(`/companies/${state.company}/profile`, {
      businessDescription: 'Padaria de fermentação natural',
      targetAudience: 'Famílias do bairro',
      products: 'Pães, croissants',
      toneOfVoice: 'Próximo e alegre',
      businessHours: [{ weekday: 1, closed: false, opens: '07:00', closes: '19:00' }],
      commercialDates: [{ date: addDays(today, 10), name: 'Aniversário da padaria' }],
      campaignMixTarget: 0.3,
    });
    expect(r.status).toBe(200);
    expect(r.body.completeness).toBeGreaterThan(30);
    expect(r.body.businessHours[0].opens).toBe('07:00');
  });

  it('4. cadastra campanha', async () => {
    const r = await admin.post(`/companies/${state.company}/campaigns`, {
      name: 'Panetone artesanal',
      startsOn: today,
      endsOn: addDays(today, 30),
      offers: 'Panetone 1kg por R$ 89,90',
    });
    expect(r.status).toBe(201);
    state.campaign = r.body.id;
  });

  it('6. monta a equipe (proprietário e colaborador)', async () => {
    const o = await admin.post(`/companies/${state.company}/members`, {
      email: 'dona@aurora.dev',
      fullName: 'Dona Aurora',
      role: 'owner',
      password: 'senha-dona-123',
    });
    expect(o.status).toBe(201);
    owner = client(ctx, (await login(ctx, 'dona@aurora.dev', 'senha-dona-123')).token);

    const c = await owner.post(`/companies/${state.company}/members`, {
      email: 'caio@aurora.dev',
      fullName: 'Caio Colaborador',
      role: 'collaborator',
      password: 'senha-caio-123',
    });
    expect(c.status).toBe(201);
    state.collabUser = c.body.userId;
    const s = await login(ctx, 'caio@aurora.dev', 'senha-caio-123');
    collab = client(ctx, s.token);
    expect(s.me.companies[0].role).toBe('collaborator');

    const forbidden = await owner.post(`/companies/${state.company}/members`, {
      email: 'outro@aurora.dev',
      fullName: 'Outro Dono',
      role: 'owner',
      password: 'senha-outro-123',
    });
    expect(forbidden.status).toBe(403);
  });

  it('5. cria atividades no calendário e atribui responsável', async () => {
    const a = await owner.post(`/companies/${state.company}/activities`, {
      title: 'Bastidores da fornada',
      scheduledDate: today,
      scheduledTime: '09:00',
      pillar: 'bastidores',
      storiesCount: 3,
      script: 'Mostre a massa saindo do forno',
      callToAction: 'Responda a enquete',
      assigneeId: state.collabUser,
      status: 'aprovada',
    });
    expect(a.status).toBe(201);
    expect(a.body.assigneeName).toBe('Caio Colaborador');
    state.activity = a.body.id;

    const b = await owner.post(`/companies/${state.company}/activities`, {
      title: 'Panetone chegou',
      scheduledDate: addDays(today, 1),
      pillar: 'campanha',
      campaignId: state.campaign,
    });
    expect(b.status).toBe(201);
    state.unassigned = b.body.id;

    const cal = await owner.get(`/companies/${state.company}/activities?from=${today}&to=${addDays(today, 6)}`);
    expect(cal.body).toHaveLength(2);
  });

  it('7. colaborador vê apenas as próprias tarefas e o checklist do dia', async () => {
    const list = await collab.get(`/companies/${state.company}/activities?from=${today}&to=${addDays(today, 6)}`);
    expect(list.body.map((x: { id: string }) => x.id)).toEqual([state.activity]);
    const check = await collab.get(`/me/checklist?date=${today}`);
    expect(check.body.today).toHaveLength(1);
    expect(check.body.today[0].availableTransitions).toEqual(['em_andamento', 'concluida', 'impedida']);
    expect((await collab.get(`/companies/${state.company}/activities/${state.unassigned}`)).status).toBe(404);
    expect((await collab.patch(`/companies/${state.company}/activities/${state.activity}`, { title: 'Outro título' })).status).toBe(403);
    expect((await collab.get(`/companies/${state.company}/dashboard?from=${today}&to=${today}`)).status).toBe(403);
  });

  it('8. colaborador envia evidência e conclui a tarefa', async () => {
    const ev = await collab.post(`/companies/${state.company}/activities/${state.activity}/evidences`, {
      kind: 'link',
      url: 'https://instagram.com/stories/aurora/1',
    });
    expect(ev.status).toBe(201);
    const blocked = await collab.post(`/companies/${state.company}/activities/${state.activity}/status`, { status: 'impedida' });
    expect(blocked.status).toBe(422);
    const done = await collab.post(`/companies/${state.company}/activities/${state.activity}/status`, { status: 'concluida' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('concluida');
    expect(done.body.completedAt).toBeTruthy();
  });

  it('9. dashboard e gamificação refletem a execução', async () => {
    const d = await owner.get(`/companies/${state.company}/dashboard?from=${today}&to=${addDays(today, 6)}`);
    expect(d.status).toBe(200);
    expect(d.body.done).toBe(1);
    expect(d.body.due).toBe(1);
    expect(d.body.completionRate).toBe(100);
    expect(d.body.campaignShare).toBe(50);
    expect(d.body.recentActivity[0].toStatus).toBe('concluida');

    const g = await owner.get(`/companies/${state.company}/gamification?period=week`);
    const caio = g.body.ranking.find((r: { name: string }) => r.name === 'Caio Colaborador');
    expect(caio.totalPoints).toBe(18); // 10 no prazo + 3 evidência + 5 conquista
    expect(caio.streak).toBe(1);
    expect(caio.achievements).toContain('primeira_tarefa');

    const adminDash = await admin.get(`/admin/dashboard?from=${today}&to=${addDays(today, 6)}`);
    expect(adminDash.body.companies[0].done).toBe(1);
  });

  it('10. simula o envio do planejamento pelo WhatsApp, sem duplicidade', async () => {
    const g = await admin.post(`/companies/${state.company}/whatsapp/groups`, {
      name: 'Aurora — Marketing',
      externalId: 'grupo-aurora-01',
    });
    expect(g.status).toBe(201);
    state.group = g.body.id;

    const s1 = await admin.post(`/companies/${state.company}/whatsapp/groups/${state.group}/send-daily`, { date: today });
    expect(s1.body.status).toBe('enviada');
    const s2 = await admin.post(`/companies/${state.company}/whatsapp/groups/${state.group}/send-daily`, { date: today });
    expect(s2.body.status).toBe('duplicada');
    expect(ctx.simulator.sent).toHaveLength(1);
    expect(ctx.simulator.sent[0]!.text).toContain('assistente virtual de marketing da FAVIS');
    expect(ctx.simulator.sent[0]!.text).toContain('Bastidores da fornada');

    const reply = await admin.post(`/companies/${state.company}/whatsapp/groups/${state.group}/simulate-inbound`, {
      senderName: 'Caio',
      text: 'qual o cronograma de hoje?',
    });
    expect(reply.body.intent).toBe('cronograma');
    expect(reply.body.outcome.status).toBe('enviada');

    const msgs = await owner.get(`/companies/${state.company}/whatsapp/messages`);
    expect(msgs.body).toHaveLength(3);
    expect((await collab.get(`/companies/${state.company}/whatsapp/messages`)).status).toBe(403);
    expect((await owner.post(`/companies/${state.company}/whatsapp/groups/${state.group}/send-daily`, {})).status).toBe(403);
  });

  it('pausa de automação impede o envio automático', async () => {
    await admin.patch(`/companies/${state.company}/whatsapp/groups/${state.group}`, { paused: true });
    const r = await ctx.deps.messaging.sendDailySchedule(state.group!, addDays(today, 1), { trigger: 'automatico' });
    expect(r.status).toBe('ignorada');
  });

  it('isolamento: proprietário não acessa outra empresa', async () => {
    const other = await admin.post('/companies', { name: 'Outra Empresa' });
    expect((await owner.get(`/companies/${other.body.id}`)).status).toBe(404);
    expect((await owner.get(`/companies/${other.body.id}/activities?from=${today}&to=${today}`)).status).toBe(404);
    const mine = await owner.get('/companies');
    expect(mine.body).toHaveLength(1);
  });

  it('auditoria registra as alterações', async () => {
    const logs = await owner.get(`/companies/${state.company}/audit-logs?entity=activities`);
    expect(logs.status).toBe(200);
    expect(logs.body.some((l: { action: string; actorName: string }) => l.action === 'update' && l.actorName === 'Caio Colaborador')).toBe(true);
    expect((await collab.get(`/companies/${state.company}/audit-logs`)).status).toBe(403);
  });

  it('IA desativada responde com orientação clara (sem simular geração)', async () => {
    const r = await owner.post(`/companies/${state.company}/ai/plans`, {
      kind: 'plano_semanal',
      periodStart: today,
      periodEnd: addDays(today, 6),
    });
    expect(r.status).toBe(503);
    expect(r.body.message).toContain('não está configurada');
  });
});
