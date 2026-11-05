import { ScriptedProvider } from '@fav/ai-engine/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, client, createAdmin, createTestApp, login, todayIn, type TestContext } from './helpers';

let ctx: TestContext;
let admin: ReturnType<typeof client>;
let companyId: string;
let campaignId: string;
const today = todayIn();

const item = (over: Record<string, unknown>) => ({
  date: today,
  time: '10:00',
  title: 'Conteúdo',
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
  ...over,
});

beforeAll(async () => {
  // A 1ª resposta vem em formato inválido para exercitar a nova tentativa
  const provider = new ScriptedProvider([
    { summary: 'incompleto' },
    {
      summary: 'Semana de aproximação com o público',
      strategy_rationale: '1 de 3 conteúdos na campanha',
      warnings: [],
      items: [
        item({ title: 'Bom dia com a equipe', pillar: 'relacionamento' }),
        item({ title: 'Panetone saindo do forno', pillar: 'campanha', campaign_id: 'CAMPAIGN', script: 'Panetone por R$ 89,90' }),
        item({ date: addDays(today, 1), title: 'Dica de conservação', pillar: 'autoridade', script: 'Hoje com 50% de desconto' }),
      ],
    },
  ]);
  ctx = await createTestApp({ aiProvider: provider });
  const a = await createAdmin(ctx);
  admin = client(ctx, (await login(ctx, a.email, a.password)).token);
  companyId = (await admin.post('/companies', { name: 'Padaria IA' })).body.id;
  campaignId = (
    await admin.post(`/companies/${companyId}/campaigns`, {
      name: 'Panetone',
      startsOn: today,
      endsOn: addDays(today, 20),
      offers: 'Panetone por R$ 89,90',
    })
  ).body.id;
  // Substitui o marcador pelo ID real da campanha na resposta roteirizada
  const scripted = (provider as unknown as { responses: { items?: { campaign_id: string | null }[] }[] }).responses;
  for (const r of scripted) for (const i of r.items ?? []) if (i.campaign_id === 'CAMPAIGN') i.campaign_id = campaignId;
});
afterAll(async () => ctx?.close());

describe('IA — planejamento', () => {
  it('gera em segundo plano, valida e sinaliza informação não confirmada', async () => {
    const req = await admin.post(`/companies/${companyId}/ai/plans`, {
      kind: 'plano_semanal',
      periodStart: today,
      periodEnd: addDays(today, 6),
    });
    expect(req.status).toBe(202);
    await ctx.queue.drain();

    const gen = await admin.get(`/companies/${companyId}/ai/generations/${req.body.id}`);
    expect(gen.body.status).toBe('concluida');
    expect(gen.body.usage.attempts).toBe(2);
    const items = gen.body.output.items;
    expect(items).toHaveLength(3);
    expect(items[1].flags).toEqual([]); // preço informado na campanha → ok
    expect(items[2].flags.join()).toContain('50%'); // desconto inventado → sinalizado
    expect(gen.body.contextSnapshot.campaigns[0].id).toBe(campaignId);

    const apply = await admin.post(`/companies/${companyId}/ai/generations/${req.body.id}/apply`, { itemIndexes: [0, 2] });
    expect(apply.body.created).toBe(2);
    const again = await admin.post(`/companies/${companyId}/ai/generations/${req.body.id}/apply`, { itemIndexes: [0] });
    expect(again.body.created).toBe(0); // não duplica

    const cal = await admin.get(`/companies/${companyId}/activities?from=${today}&to=${addDays(today, 6)}`);
    expect(cal.body).toHaveLength(2);
    expect(cal.body.every((a: { status: string; aiGenerated: boolean }) => a.status === 'pendente_aprovacao' && a.aiGenerated)).toBe(true);
    expect(cal.body.find((a: { title: string }) => a.title === 'Dica de conservação').notes).toContain('Verificar antes de publicar');
  });
});

describe('WhatsApp — despacho automático', () => {
  it('envia uma vez quando o horário chega e respeita a pausa global', async () => {
    const g = await admin.post(`/companies/${companyId}/whatsapp/groups`, {
      name: 'Grupo IA',
      externalId: 'grupo-ia',
      dailySendTime: '00:00',
      sendWeekdays: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(g.status).toBe(201);
    const first = await ctx.deps.messaging.dispatchDue();
    expect(first.results.map((r) => r.status)).toEqual(['enviada']);
    const second = await ctx.deps.messaging.dispatchDue();
    expect(second.checked).toBe(0);

    const settings = (await admin.get('/admin/settings')).body.settings;
    const off = await admin.put('/admin/settings', {
      aiEnabled: settings.aiEnabled,
      aiDefaultCampaignMix: settings.aiDefaultCampaignMix,
      aiHistoryDays: settings.aiHistoryDays,
      aiGuidelines: settings.aiGuidelines,
      messagingEnabled: false,
      messagingDefaultSendTime: settings.messagingDefaultSendTime,
    });
    expect(off.status).toBe(200);
    const manual = await admin.post(`/companies/${companyId}/whatsapp/groups/${g.body.id}/send-daily`, { date: addDays(today, 1) });
    expect(manual.body.status).toBe('ignorada');
  });
});
