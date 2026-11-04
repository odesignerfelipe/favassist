import pg from 'pg';

// Tipos: datas/horários como string (sem fuso implícito), numeric/int8 como number.
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1083, (v) => v.slice(0, 5)); // time → HH:MM
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(20, (v) => Number(v)); // int8 (contagens)

export type Tx = pg.PoolClient;

export interface JwtClaims {
  sub: string;
  role: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Acesso ao banco.
 * - asUser: transação com `SET LOCAL ROLE authenticated` + claims do JWT → RLS aplicada
 *   (mesmo mecanismo do PostgREST/Supabase).
 * - asService: transação com o papel de conexão (uso exclusivo de rotinas de sistema).
 */
export class Database {
  readonly pool: pg.Pool;

  constructor(connectionString: string, opts: { ssl?: boolean; max?: number } = {}) {
    this.pool = new pg.Pool({
      connectionString,
      max: opts.max ?? 10,
      ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  async asUser<T>(claims: JwtClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      await tx.query(
        `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify(claims), claims.sub],
      );
      await tx.query('set local role authenticated');
      return fn(tx);
    });
  }

  async asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  private async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

// ---------- utilitários de consulta ----------

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function camelize<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out as T;
}

export async function many<T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await tx.query(sql, params);
  return res.rows.map((r) => camelize<T>(r));
}

export async function one<T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await many<T>(tx, sql, params);
  return rows[0] ?? null;
}

/**
 * Monta "col = $n" a partir de um objeto parcial (chaves camelCase → snake_case),
 * aceitando apenas colunas da lista permitida.
 */
export function buildUpdate(
  input: Record<string, unknown>,
  allowed: Record<string, string>,
  startIndex = 1,
): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (input[key] === undefined) continue;
    const value = input[key];
    values.push(value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
    sets.push(`${column} = $${startIndex + values.length - 1}`);
  }
  return { sets, values };
}
