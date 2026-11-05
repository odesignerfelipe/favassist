import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Executor de migrações para PostgreSQL próprio (dev, testes, VPS).
 * Em projetos Supabase, prefira `supabase db push` (mesmos arquivos de supabase/migrations).
 *
 * Ordem:
 *  1. db/local/000_supabase_compat.sql — só se o schema `auth` não existir (Postgres puro)
 *  2. db/local/001_local_auth.sql      — só com AUTH_PROVIDER=local
 *  3. supabase/migrations/*.sql        — em ordem de nome
 * Cada arquivo é aplicado uma única vez (registro em fav_meta.migrations), dentro de transação.
 */

export function findRepoRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  if (process.env.FAV_REPO_ROOT) return resolve(process.env.FAV_REPO_ROOT);
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'supabase', 'migrations'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Pasta supabase/migrations não encontrada (defina FAV_REPO_ROOT)');
}

export interface MigrateOptions {
  localAuth: boolean;
  reset?: boolean;
  log?: (msg: string) => void;
}

export async function migrate(connectionString: string, opts: MigrateOptions): Promise<string[]> {
  const log = opts.log ?? (() => undefined);
  const root = findRepoRoot();
  const client = new pg.Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  const applied: string[] = [];
  try {
    if (opts.reset) {
      log('Reiniciando o banco (reset)…');
      await client.query(`
        drop schema if exists fav_meta cascade;
        drop schema if exists app_private cascade;
        drop schema if exists app cascade;
        drop schema if exists public cascade;
        drop schema if exists auth cascade;
        create schema public;
        grant usage on schema public to public;
      `);
    }

    await client.query(`
      create schema if not exists fav_meta;
      create table if not exists fav_meta.migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);
    const done = new Set((await client.query('select name from fav_meta.migrations')).rows.map((r) => r.name as string));

    const authExists = (await client.query(`select 1 from pg_namespace where nspname = 'auth'`)).rowCount === 1;
    const files: { name: string; path: string }[] = [];
    const compat = 'local/000_supabase_compat.sql';
    if (!authExists || done.has(compat)) files.push({ name: compat, path: join(root, 'db', compat) });
    if (opts.localAuth) {
      files.push({ name: 'local/001_local_auth.sql', path: join(root, 'db', 'local/001_local_auth.sql') });
    }
    const migDir = join(root, 'supabase', 'migrations');
    for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
      files.push({ name: f, path: join(migDir, f) });
    }

    for (const file of files) {
      if (done.has(file.name)) continue;
      log(`Aplicando ${file.name}`);
      const sql = readFileSync(file.path, 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into fav_meta.migrations (name) values ($1)', [file.name]);
        await client.query('commit');
        applied.push(file.name);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Falha na migração ${file.name}: ${(err as Error).message}`);
      }
    }
    log(applied.length ? `${applied.length} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
    return applied;
  } finally {
    await client.end();
  }
}

// Execução via CLI: pnpm db:migrate
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definida. Consulte .env.example');
    process.exit(1);
  }
  migrate(url, {
    localAuth: (process.env.AUTH_PROVIDER ?? 'local') === 'local',
    reset: process.argv.includes('--reset'),
    log: (m) => console.log(m),
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
