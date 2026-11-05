import type { AIProvider } from '@fav/ai-engine';
import { SimulatorProvider } from '@fav/messaging';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app';
import { LocalAuthProvider } from '../src/auth/provider';
import { loadConfig } from '../src/config';
import { Database } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { InlineJobQueue } from '../src/queue';
import { AiService } from '../src/services/ai';
import { MessagingService } from '../src/services/messaging';
import { LocalFileStorage } from '../src/storage';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_SECRET = 'test-secret-0123456789-0123456789-abcdef';

export function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    ...extra,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    AUTH_PROVIDER: 'local',
    AUTH_JWT_SECRET: TEST_SECRET,
    APP_URL: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  });
}

export interface TestContext {
  app: FastifyInstance;
  deps: AppDeps;
  queue: InlineJobQueue;
  simulator: SimulatorProvider;
  close(): Promise<void>;
}

export async function createTestApp(
  opts: { aiProvider?: AIProvider | null; reset?: boolean; env?: Record<string, string> } = {},
): Promise<TestContext> {
  const cfg = testConfig(opts.env);
  if (opts.reset !== false) await migrate(cfg.DATABASE_URL, { localAuth: true, reset: true });
  const db = new Database(cfg.DATABASE_URL, { max: 5 });
  const ai = new AiService(db, opts.aiProvider ?? null);
  const simulator = new SimulatorProvider();
  const messaging = new MessagingService(db, simulator, {
    appUrl: cfg.APP_URL,
    maxAttempts: 3,
    ai: opts.aiProvider ?? null,
  });
  const queue = new InlineJobQueue((e) => console.error(e));
  queue.setHandlers({ aiGeneration: (id) => ai.runGeneration(id) });
  const storage = new LocalFileStorage(mkdtempSync(join(tmpdir(), 'fav-uploads-')), TEST_SECRET);
  await storage.ensureReady();
  const deps: AppDeps = { cfg, db, auth: new LocalAuthProvider(db, cfg), ai, messaging, queue, storage };
  const app = await buildApp(deps, { logger: false });
  return {
    app,
    deps,
    queue,
    simulator,
    async close() {
      await app.close();
      await queue.close();
      await db.close();
    },
  };
}

export async function createAdmin(ctx: TestContext, email = 'admin@favis.test', password = 'senha-admin-123') {
  const id = await ctx.deps.auth.createUser({ email, password, fullName: 'Admin FAVIS' });
  await ctx.deps.db.asService((tx) => tx.query(`update profiles set platform_role = 'favis_admin' where id = $1`, [id]));
  return { id, email, password };
}

export async function login(ctx: TestContext, email: string, password: string) {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou (${res.statusCode}): ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'fav_rt');
  return { token: res.json().accessToken as string, refreshCookie: cookie!.value, me: res.json().user };
}

/** Cliente HTTP autenticado sobre app.inject */
export function client(ctx: TestContext, token: string) {
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const res = await ctx.app.inject({
      method,
      url: `/api${url}`,
      payload: payload as never,
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: res.statusCode, body: res.body ? (res.json() as any) : null };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload: unknown = {}) => call('POST', url, payload),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    put: (url: string, payload: unknown) => call('PUT', url, payload),
    del: (url: string) => call('DELETE', url),
  };
}

export const todayIn = (tz = 'America/Sao_Paulo') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
