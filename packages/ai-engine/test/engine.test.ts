import { describe, expect, it } from 'vitest';
import { buildPlanUserPrompt, generatePlan, similarity, validatePlan, type CompanyContext, type PlanOutput } from '../src';
import { ScriptedProvider } from '../src/testing';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';

const ctx = (over: Partial<CompanyContext> = {}): CompanyContext => ({
  company: { id: 'c1', name: 'Padaria Aurora', segment: 'Padaria artesanal', timezone: 'America/Sao_Paulo' },
  profile: {
    businessDescription: 'Padaria de fermentação natural no bairro.',
    targetAudience: 'Famílias do bairro',
    products: 'Pão de fermentação natural, croissant',
    services: 'Encomendas para eventos',
    differentiators: 'Fermentação de 48h',
    positioning: '',
    brandPersonality: 'Acolhedora',
    toneOfVoice: 'Próximo e alegre',
    businessGoals: 'Aumentar encomendas',
    marketingGoals: 'Mais interações nos Stories',
    mainChallenges: 'Equipe pequena',
    businessHours: [{ weekday: 1, closed: false, opens: '07:00', closes: '19:00' }],
    commercialDates: [{ date: '2026-11-27', name: 'Black Friday', notes: '' }],
    contentRestrictions: 'Não mostrar clientes sem autorização',
    additionalInfo: '',
    campaignMixTarget: 0.3,
  },
  campaigns: [
    {
      id: CAMPAIGN_ID,
      name: 'Panetone artesanal',
      objectives: 'Vender encomendas de Natal',
      startsOn: '2026-11-01',
      endsOn: '2026-12-24',
      products: 'Panetone',
      offers: 'Panetone 1kg por R$ 89,90',
      notes: '',
      contentShare: 0.3,
    },
  ],
  history: [{ date: '2026-11-02', title: 'Bastidores da fermentação natural', pillar: 'bastidores', format: 'stories', status: 'concluida' }],
  metrics: [],
  trends: [],
  guidelines: '',
  period: { start: '2026-11-09', end: '2026-11-14' },
  instructions: '',
  ...over,
});

const item = (over: Partial<PlanOutput['items'][number]> = {}): PlanOutput['items'][number] => ({
  date: '2026-11-10',
  time: '09:00',
  title: 'Como escolher o pão ideal',
  pillar: 'autoridade',
  format: 'stories',
  stories_count: 3,
  objective: 'Educar',
  script: 'Mostre três tipos de pão.',
  talking_points: ['Bom dia!'],
  recording_guidelines: 'Luz natural',
  caption_suggestion: '',
  call_to_action: 'Responda a enquete',
  campaign_id: null,
  rationale: 'Autoridade',
  needs_verification: [],
  ...over,
});

const plan = (items: PlanOutput['items']): PlanOutput => ({ summary: 's', strategy_rationale: 'r', items, warnings: [] });

describe('salvaguardas', () => {
  it('aceita preço informado pela empresa e sinaliza preço inventado', () => {
    const r = validatePlan(
      plan([
        item({ title: 'Panetone chegou', pillar: 'campanha', campaign_id: CAMPAIGN_ID, script: 'Panetone por R$ 89,90' }),
        item({ date: '2026-11-11', title: 'Croissant especial', pillar: 'conversao', script: 'Croissant por R$ 12,00 com 20% de desconto' }),
      ]),
      ctx(),
    );
    expect(r.items[0]!.flags).toEqual([]);
    expect(r.items[1]!.flags.join()).toContain('R$ 12,00');
    expect(r.items[1]!.flags.join()).toContain('20%');
    expect(r.items[1]!.needs_verification.length).toBe(1);
  });

  it('sinaliza promoções quando nenhuma campanha tem ofertas', () => {
    const r = validatePlan(plan([item({ script: 'Hoje tem promoção com frete grátis!' })]), ctx({ campaigns: [] }));
    expect(r.items[0]!.flags.join()).toMatch(/promoção/i);
  });

  it('remove campanha inexistente e sinaliza data fora do período', () => {
    const r = validatePlan(plan([item({ date: '2026-12-01', campaign_id: 'falsa' })]), ctx());
    expect(r.items[0]!.campaign_id).toBeNull();
    expect(r.items[0]!.flags).toHaveLength(2);
  });

  it('detecta repetição com o histórico', () => {
    const r = validatePlan(plan([item({ title: 'Bastidores da fermentação natural do pão' })]), ctx());
    expect(r.items[0]!.flags.join()).toContain('parecido');
    expect(similarity('Bastidores da fermentação', 'Receita de bolo')).toBe(0);
  });

  it('avisa sobre desequilíbrio do mix de campanha', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ date: `2026-11-1${i}`, title: `Panetone ${['A', 'B', 'C', 'D', 'E'][i]} ${i}x sabor`, pillar: 'campanha', campaign_id: CAMPAIGN_ID }),
    );
    const r = validatePlan(plan(items), ctx());
    expect(r.mix.campaignShare).toBe(1);
    expect(r.warnings.join()).toContain('Participação de campanha em 100%');
  });
});

describe('motor de planejamento', () => {
  it('tenta novamente quando o formato é inválido e então valida', async () => {
    const provider = new ScriptedProvider([{ summary: 'faltando campos' }, plan([item()])]);
    const r = await generatePlan(provider, ctx());
    expect(r.attempts).toBe(2);
    expect(r.plan.items).toHaveLength(1);
    expect(provider.calls[1]!.user).toContain('# Correção');
  });

  it('falha de forma explícita após esgotar as tentativas', async () => {
    const provider = new ScriptedProvider([{}, {}]);
    await expect(generatePlan(provider, ctx())).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('o prompt inclui diagnóstico, campanha com ofertas confirmadas e proíbe tendências sem fonte', () => {
    const prompt = buildPlanUserPrompt(ctx());
    expect(prompt).toContain('Fermentação de 48h');
    expect(prompt).toContain('R$ 89,90');
    expect(prompt).toContain('Não cite tendências');
    expect(prompt).toContain('Black Friday');
  });
});
