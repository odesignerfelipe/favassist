import { can, type Actor, type MemberRole, type Permission } from '@fav/shared';
import type { FastifyRequest } from 'fastify';
import type { Database, JwtClaims, Tx } from '../db/database';
import { forbidden, notFound, unauthorized } from './errors';

export interface AuthContext {
  userId: string;
  claims: JwtClaims;
  actor: Actor;
  profile: { email: string; fullName: string; platformRole: string | null; active: boolean };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Executa no banco com a identidade do usuário da requisição (RLS aplicada). */
export function withUser<T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return req.server.deps.db.asUser(requireAuth(req).claims, fn);
}

/** Garante que o usuário pertence à empresa (404 se não) e possui a permissão (403 se não). */
export function assertCompanyPermission(req: FastifyRequest, companyId: string, permission: Permission): Actor {
  const { actor } = requireAuth(req);
  const isMember = actor.memberships.some((m) => m.companyId === companyId && m.active);
  if (!actor.isFavisAdmin && !isMember) throw notFound('Empresa não encontrada');
  if (!can(actor, companyId, permission)) throw forbidden();
  return actor;
}

export function assertFavisAdmin(req: FastifyRequest): Actor {
  const { actor } = requireAuth(req);
  if (!actor.isFavisAdmin) throw forbidden('Acesso exclusivo da equipe FAVIS');
  return actor;
}

/** Carrega perfil e vínculos ativos do usuário (consulta de sistema, só do próprio usuário). */
export async function loadAuthContext(db: Database, claims: JwtClaims): Promise<AuthContext | null> {
  return db.asService(async (tx) => {
    const p = await tx.query(
      `select email, full_name, platform_role, active from public.profiles where id = $1`,
      [claims.sub],
    );
    const profile = p.rows[0];
    if (!profile || !profile.active) return null;
    const m = await tx.query(
      `select m.company_id, m.role, m.permissions, m.active
         from public.company_members m
         join public.companies c on c.id = m.company_id
        where m.user_id = $1 and m.active and c.status = 'ativa'`,
      [claims.sub],
    );
    return {
      userId: claims.sub,
      claims,
      profile: {
        email: profile.email,
        fullName: profile.full_name,
        platformRole: profile.platform_role,
        active: profile.active,
      },
      actor: {
        userId: claims.sub,
        isFavisAdmin: profile.platform_role === 'favis_admin',
        memberships: m.rows.map((r) => ({
          companyId: r.company_id as string,
          role: r.role as MemberRole,
          permissions: r.permissions as Record<string, boolean>,
          active: r.active as boolean,
        })),
      },
    };
  });
}
