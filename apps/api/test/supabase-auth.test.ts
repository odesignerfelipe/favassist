import { describe, expect, it } from 'vitest';
import { SupabaseAuthProvider } from '../src/auth/provider';
import { loadConfig } from '../src/config';

function providerWith(keys: { anon: string; service: string }) {
  const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
    return new Response(JSON.stringify({ id: 'u1', access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1' } }), {
      status: 200,
    });
  }) as typeof fetch;
  const p = new SupabaseAuthProvider(
    { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: keys.anon, SUPABASE_SERVICE_ROLE_KEY: keys.service, SUPABASE_JWT_SECRET: 's'.repeat(32) },
    fetchImpl,
  );
  return { p, calls };
}

describe('Supabase Auth — chaves novas e legadas', () => {
  it('chaves novas vão apenas no cabeçalho apikey', async () => {
    const { p, calls } = providerWith({ anon: 'sb_publishable_abc', service: 'sb_secret_xyz' });
    await p.login('a@b.dev', 'senha-1234567');
    await p.createUser({ email: 'n@b.dev', password: 'senha-1234567', fullName: 'Nova' });
    expect(calls[0]!.headers).toEqual({ apikey: 'sb_publishable_abc', 'content-type': 'application/json' });
    expect(calls[1]!.headers.apikey).toBe('sb_secret_xyz');
    expect(calls[1]!.headers.authorization).toBeUndefined();
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ email_confirm: true, user_metadata: { full_name: 'Nova' } });
  });

  it('chaves legadas (JWT) também seguem como Bearer', async () => {
    const { p, calls } = providerWith({ anon: 'eyJanon', service: 'eyJservice' });
    await p.login('a@b.dev', 'senha-1234567');
    expect(calls[0]!.headers.authorization).toBe('Bearer eyJanon');
  });

  it('aceita SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY na configuração', () => {
    const cfg = loadConfig({
      DATABASE_URL: 'postgres://x',
      AUTH_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
      SUPABASE_SECRET_KEY: 'sb_secret_xyz',
    });
    expect(cfg.SUPABASE_ANON_KEY).toBe('sb_publishable_abc');
    expect(cfg.SUPABASE_SERVICE_ROLE_KEY).toBe('sb_secret_xyz');
  });
});
