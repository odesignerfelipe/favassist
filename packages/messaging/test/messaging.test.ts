import { describe, expect, it } from 'vitest';
import { composeDailySchedule, composeRuleReply, interpretInbound, SimulatorProvider } from '../src';

describe('simulador', () => {
  it('envia e registra', async () => {
    const p = new SimulatorProvider();
    const r = await p.send({ groupExternalId: 'g1', text: 'Olá', idempotencyKey: 'k' });
    expect(r.providerMessageId).toMatch(/^sim_/);
    expect(p.sent).toHaveLength(1);
    expect((await p.status()).simulated).toBe(true);
  });
  it('simula falhas recuperáveis', async () => {
    const p = new SimulatorProvider(1, () => 0);
    await expect(p.send({ groupExternalId: 'g1', text: 'x', idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true });
  });
});

describe('composição', () => {
  it('cronograma identifica o assistente virtual e lista tarefas', () => {
    const text = composeDailySchedule({
      companyName: 'Aurora',
      date: '2026-11-04',
      appUrl: 'https://app',
      items: [{ time: '09:00', title: 'Bastidores', format: 'stories', storiesCount: 3, assigneeName: 'Ana', callToAction: 'Responda' }],
    });
    expect(text).toContain('assistente virtual de marketing da FAVIS');
    expect(text).toContain('quarta-feira (04/11/2026)');
    expect(text).toContain('1. 09:00 · Bastidores (3 Stories) — Ana');
  });
  it('dia sem tarefas', () => {
    expect(composeDailySchedule({ companyName: 'A', date: '2026-11-04', appUrl: 'u', items: [] })).toContain('não há conteúdos');
  });
  it('interpreta intenções', () => {
    expect(interpretInbound('Qual o cronograma de hoje?')).toBe('cronograma');
    expect(interpretInbound('Postei o story!')).toBe('concluido');
    expect(interpretInbound('Não consegui gravar hoje')).toBe('dificuldade');
    expect(interpretInbound('Bom dia!')).toBe('saudacao');
    expect(interpretInbound('qual o preço do pão?')).toBe('outro');
    expect(composeRuleReply('ajuda', { senderName: 'Ana Souza', companyName: 'A', appUrl: 'u' })).toContain('assistente virtual');
  });
});
