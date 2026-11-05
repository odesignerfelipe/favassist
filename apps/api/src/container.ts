import { createMessagingProvider } from '@fav/messaging';
import type { AppDeps } from './app';
import { createAuthProvider } from './auth/provider';
import type { Config } from './config';
import { Database } from './db/database';
import { BullJobQueue, InlineJobQueue, type JobQueue } from './queue';
import { AiService, createAiProvider } from './services/ai';
import { MessagingService } from './services/messaging';
import { randomBytes } from 'node:crypto';
import { LocalFileStorage, SupabaseFileStorage, type FileStorage } from './storage';

export function createStorage(cfg: Config): FileStorage {
  const provider = cfg.STORAGE_PROVIDER ?? (cfg.AUTH_PROVIDER === 'supabase' ? 'supabase' : 'local');
  if (provider === 'supabase') {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('STORAGE_PROVIDER=supabase exige SUPABASE_URL e SUPABASE_SECRET_KEY');
    }
    return new SupabaseFileStorage(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, cfg.STORAGE_BUCKET, cfg.UPLOAD_MAX_MB * 1024 * 1024);
  }
  // Links locais assinados com o segredo da API (ou um segredo efêmero, válido até reiniciar)
  return new LocalFileStorage(cfg.STORAGE_LOCAL_DIR, cfg.AUTH_JWT_SECRET ?? randomBytes(32).toString('hex'));
}

/** Monta as dependências da aplicação a partir da configuração. */
export function createDeps(cfg: Config, opts: { forceInlineQueue?: boolean; onJobError?: (e: unknown) => void } = {}): AppDeps {
  const db = new Database(cfg.DATABASE_URL, { ssl: cfg.DATABASE_SSL });
  const aiProvider = createAiProvider(cfg);
  const ai = new AiService(db, aiProvider);
  const messaging = new MessagingService(
    db,
    createMessagingProvider(cfg.MESSAGING_PROVIDER, { failureRate: cfg.SIMULATOR_FAILURE_RATE }),
    { appUrl: cfg.APP_URL.split(',')[0]!.trim(), maxAttempts: cfg.MESSAGING_MAX_ATTEMPTS, ai: aiProvider },
  );
  let queue: JobQueue;
  if (cfg.REDIS_URL && !opts.forceInlineQueue) {
    queue = new BullJobQueue(cfg.REDIS_URL);
  } else {
    const inline = new InlineJobQueue(opts.onJobError);
    inline.setHandlers({ aiGeneration: (id) => ai.runGeneration(id) });
    queue = inline;
  }
  return { cfg, db, auth: createAuthProvider(cfg, db), ai, messaging, queue, storage: createStorage(cfg) };
}
