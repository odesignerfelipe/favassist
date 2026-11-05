import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoginGuard } from '../src/auth/login-guard';
import { createAdmin, createTestApp, type TestContext } from './helpers';

describe('LoginGuard (unidade)', () => {
  it('bloqueia após N falhas, libera ao fim da janela e zera no sucesso', () => {
    let now = 1_000_000;
    const g = new LoginGuard(3, 60_000, () => now);
    expect(g.blockedFor('A@x.com')).toBe(0);
    g.recordFailure('a@x.com');
    g.recordFailure('a@x.com');
    expect(g.blockedFor('a@x.com')).toBe(0);
    g.recordFailure(' A@X.com ');
    expect(g.blockedFor('a@x.com')).toBeGreaterThan(0);
    expect(g.blockedFor('b@x.com')).toBe(0);
    now += 60_001;
    expect(g.blockedFor('a@x.com')).toBe(0);
    g.recordFailure('a@x.com');
    g.recordSuccess('a@x.com');
    g.recordFailure('a@x.com');
    g.recordFailure('a@x.com');
    expect(g.blockedFor('a@x.com')).toBe(0);
  });
});

describe('Segurança do login (atrás de 2 proxies: Traefik → nginx → API)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ env: { TRUST_PROXY_HOPS: '2', LOGIN_MAX_FAILURES_PER_EMAIL: '5' } });
    await createAdmin(ctx, 'alvo@favis.test', 'senha-correta-123');
  });
  afterAll(async () => ctx?.close());

  // Cabeçalho como chega à API: o cliente pode forjar o início; Traefik acrescenta o IP real; nginx acrescenta o do Traefik
  const viaProxies = (forged: string, realIp: string) => `${forged}, ${realIp}, 10.0.0.2`;
  const attempt = (email: string, password: string, xff: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
      headers: { 'x-forwarded-for': xff },
      remoteAddress: '10.0.0.3',
    });

  it('X-Forwarded-For forjado não contorna o limite por IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      // e-mails diferentes para não acionar o bloqueio por e-mail; IP forjado muda a cada tentativa
      const res = await attempt(`inexistente${i}@favis.test`, 'errada-123', viaProxies(`203.0.113.${i}`, '198.51.100.7'));
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('outro cliente real (IP diferente) não é afetado', async () => {
    const res = await attempt('alvo@favis.test', 'senha-correta-123', viaProxies('198.51.100.7', '198.51.100.8'));
    expect(res.statusCode).toBe(200);
  });

  it('bloqueia o e-mail após falhas vindas de IPs diferentes, inclusive com a senha certa', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await attempt('alvo@favis.test', 'errada-123', viaProxies('1.1.1.1', `192.0.2.${i + 10}`));
      expect(res.statusCode).toBe(401);
    }
    const blocked = await attempt('alvo@favis.test', 'senha-correta-123', viaProxies('1.1.1.1', '192.0.2.50'));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('muitas_tentativas');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // e-mail diferente continua liberado
    const other = await attempt('outro@favis.test', 'qualquer-123', viaProxies('1.1.1.1', '192.0.2.51'));
    expect(other.statusCode).toBe(401);
  });
});
