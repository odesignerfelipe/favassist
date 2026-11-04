import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Config } from '../config';
import type { Database, JwtClaims } from '../db/database';
import { AppError, unauthorized } from '../lib/errors';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** epoch (segundos) de expiração do access token */
  expiresAt: number;
  userId: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName: string;
}

/** Contrato comum: a API e o front não dependem de qual provedor está ativo. */
export interface AuthProvider {
  readonly name: 'local' | 'supabase';
  login(email: string, password: string, meta?: { userAgent?: string }): Promise<Session>;
  refresh(refreshToken: string, meta?: { userAgent?: string }): Promise<Session>;
  logout(refreshToken: string | undefined, accessToken?: string): Promise<void>;
  verifyAccessToken(token: string): Promise<JwtClaims>;
  createUser(input: CreateUserInput): Promise<string>;
  setPassword(userId: string, password: string): Promise<void>;
  verifyPassword(userId: string, password: string): Promise<boolean>;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const invalidCredentials = () => new AppError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos');

function toClaims(payload: JWTPayload): JwtClaims {
  if (!payload.sub) throw unauthorized();
  return { ...payload, sub: payload.sub, role: 'authenticated', email: payload.email as string | undefined };
}

// =============================================================================
// Provedor local: a API emite JWT HS256 com as mesmas claims do Supabase.
// =============================================================================
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;
  private readonly secret: Uint8Array;

  constructor(
    private readonly db: Database,
    private readonly cfg: Pick<Config, 'AUTH_JWT_SECRET' | 'AUTH_ACCESS_TTL_SECONDS' | 'AUTH_REFRESH_TTL_DAYS'>,
  ) {
    this.secret = new TextEncoder().encode(cfg.AUTH_JWT_SECRET);
  }

  async login(email: string, password: string, meta?: { userAgent?: string }): Promise<Session> {
    const row = await this.db.asService(async (tx) => {
      const r = await tx.query(
        `select u.id, u.email, c.password_hash, p.active
           from auth.users u
           join public.profiles p on p.id = u.id
           left join app_private.local_credentials c on c.user_id = u.id
          where lower(u.email) = lower($1)`,
        [email],
      );
      return r.rows[0] as { id: string; email: string; password_hash: string | null; active: boolean } | undefined;
    });
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !row.password_hash || !ok) throw invalidCredentials();
    if (!row.active) throw new AppError(403, 'usuario_inativo', 'Usuário desativado. Fale com a FAVIS.');
    return this.issue(row.id, row.email, meta?.userAgent);
  }

  async refresh(refreshToken: string, meta?: { userAgent?: string }): Promise<Session> {
    const hash = sha256(refreshToken);
    const found = await this.db.asService(async (tx) => {
      const r = await tx.query(
        `select t.id, t.user_id, t.revoked_at, t.expires_at < now() as expired, u.email, p.active
           from app_private.local_refresh_tokens t
           join auth.users u on u.id = t.user_id
           join public.profiles p on p.id = t.user_id
          where t.token_hash = $1
          for update of t`,
        [hash],
      );
      const t = r.rows[0];
      if (!t) return null;
      if (t.revoked_at) {
        // Reuso de token revogado: possível roubo → revoga todas as sessões do usuário
        await tx.query(
          `update app_private.local_refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`,
          [t.user_id],
        );
        return null;
      }
      if (t.expired || !t.active) return null;
      await tx.query(`update app_private.local_refresh_tokens set revoked_at = now() where id = $1`, [t.id]);
      return t as { id: string; user_id: string; email: string };
    });
    if (!found) throw unauthorized();
    return this.issue(found.user_id, found.email, meta?.userAgent, found.id);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.db.asService((tx) =>
      tx.query(
        `update app_private.local_refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null`,
        [sha256(refreshToken)],
      ),
    );
  }

  async verifyAccessToken(token: string): Promise<JwtClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        audience: 'authenticated',
        issuer: 'fav-assist',
      });
      return toClaims(payload);
    } catch {
      throw unauthorized();
    }
  }

  async createUser(input: CreateUserInput): Promise<string> {
    const hash = await hashPassword(input.password);
    return this.db.asService(async (tx) => {
      const r = await tx.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [
        input.email.toLowerCase(),
        { full_name: input.fullName },
      ]);
      const id = r.rows[0].id as string;
      await tx.query(`insert into app_private.local_credentials (user_id, password_hash) values ($1, $2)`, [id, hash]);
      return id;
    });
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    await this.db.asService(async (tx) => {
      await tx.query(
        `insert into app_private.local_credentials (user_id, password_hash) values ($1, $2)
         on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
        [userId, hash],
      );
      await tx.query(
        `update app_private.local_refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`,
        [userId],
      );
    });
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const r = await this.db.asService((tx) =>
      tx.query(`select password_hash from app_private.local_credentials where user_id = $1`, [userId]),
    );
    return verifyPassword(password, r.rows[0]?.password_hash ?? DUMMY_HASH);
  }

  private async issue(userId: string, email: string, userAgent?: string, previousId?: string): Promise<Session> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.cfg.AUTH_ACCESS_TTL_SECONDS;
    const accessToken = await new SignJWT({ email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setAudience('authenticated')
      .setIssuer('fav-assist')
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(this.secret);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.db.asService(async (tx) => {
      const r = await tx.query(
        `insert into app_private.local_refresh_tokens (user_id, token_hash, expires_at, user_agent)
         values ($1, $2, now() + make_interval(days => $3), $4) returning id`,
        [userId, sha256(refreshToken), this.cfg.AUTH_REFRESH_TTL_DAYS, userAgent?.slice(0, 300) ?? null],
      );
      if (previousId) {
        await tx.query(`update app_private.local_refresh_tokens set replaced_by = $1 where id = $2`, [
          r.rows[0].id,
          previousId,
        ]);
      }
    });
    return { accessToken, refreshToken, expiresAt, userId };
  }
}

// =============================================================================
// Provedor Supabase: proxy para o GoTrue + verificação do JWT do projeto.
// =============================================================================
export class SupabaseAuthProvider implements AuthProvider {
  readonly name = 'supabase' as const;
  private readonly url: string;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly secret?: Uint8Array;

  constructor(
    private readonly cfg: Pick<
      Config,
      'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY' | 'SUPABASE_JWT_SECRET'
    >,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.url = cfg.SUPABASE_URL!.replace(/\/$/, '');
    if (cfg.SUPABASE_JWT_SECRET) this.secret = new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET);
    else this.jwks = createRemoteJWKSet(new URL(`${this.url}/auth/v1/.well-known/jwks.json`));
  }

  private async call(path: string, init: { method: string; body?: unknown; bearer?: string; admin?: boolean }) {
    const key = init.admin ? this.cfg.SUPABASE_SERVICE_ROLE_KEY! : this.cfg.SUPABASE_ANON_KEY!;
    const res = await this.fetchImpl(`${this.url}/auth/v1${path}`, {
      method: init.method,
      headers: {
        apikey: key,
        'content-type': 'application/json',
        authorization: `Bearer ${init.bearer ?? key}`,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  }

  private toSession(json: Record<string, unknown>): Session {
    const user = json.user as { id: string } | undefined;
    return {
      accessToken: json.access_token as string,
      refreshToken: json.refresh_token as string,
      expiresAt: (json.expires_at as number) ?? Math.floor(Date.now() / 1000) + Number(json.expires_in ?? 3600),
      userId: user?.id ?? '',
    };
  }

  async login(email: string, password: string): Promise<Session> {
    const r = await this.call('/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (!r.ok) throw invalidCredentials();
    return this.toSession(r.json);
  }

  async refresh(refreshToken: string): Promise<Session> {
    const r = await this.call('/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
    if (!r.ok) throw unauthorized();
    return this.toSession(r.json);
  }

  async logout(_refreshToken: string | undefined, accessToken?: string): Promise<void> {
    if (accessToken) await this.call('/logout', { method: 'POST', bearer: accessToken }).catch(() => undefined);
  }

  async verifyAccessToken(token: string): Promise<JwtClaims> {
    try {
      const { payload } = this.secret
        ? await jwtVerify(token, this.secret, { audience: 'authenticated' })
        : await jwtVerify(token, this.jwks!, { audience: 'authenticated' });
      return toClaims(payload);
    } catch {
      throw unauthorized();
    }
  }

  async createUser(input: CreateUserInput): Promise<string> {
    const r = await this.call('/admin/users', {
      method: 'POST',
      admin: true,
      body: {
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.fullName },
      },
    });
    if (!r.ok) {
      throw new AppError(r.status === 422 ? 409 : 502, 'auth_erro', String(r.json.msg ?? 'Falha ao criar usuário'));
    }
    return (r.json as { id: string }).id;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const r = await this.call(`/admin/users/${userId}`, { method: 'PUT', admin: true, body: { password } });
    if (!r.ok) throw new AppError(502, 'auth_erro', 'Falha ao alterar a senha');
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const u = await this.call(`/admin/users/${userId}`, { method: 'GET', admin: true });
    const email = (u.json as { email?: string }).email;
    if (!email) return false;
    const r = await this.call('/token?grant_type=password', { method: 'POST', body: { email, password } });
    return r.ok;
  }
}

export function createAuthProvider(cfg: Config, db: Database): AuthProvider {
  return cfg.AUTH_PROVIDER === 'supabase' ? new SupabaseAuthProvider(cfg) : new LocalAuthProvider(db, cfg);
}
