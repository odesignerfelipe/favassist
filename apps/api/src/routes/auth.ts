import { changePasswordSchema, companyPermissions, loginSchema, updateMeSchema } from '@fav/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Session } from '../auth/provider';
import { many } from '../db/database';
import { loadAuthContext, requireAuth, withUser } from '../lib/context';
import { AppError, unauthorized, unprocessable } from '../lib/errors';
import { LoginGuard } from '../auth/login-guard';

export const REFRESH_COOKIE = 'fav_rt';

function setRefreshCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.server.deps.cfg.COOKIE_SECURE ?? req.server.deps.cfg.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: req.server.deps.cfg.AUTH_REFRESH_TTL_DAYS * 86_400,
  });
}

/** Dados do usuário logado: perfil, empresas e permissões efetivas em cada uma. */
export async function buildMe(req: FastifyRequest) {
  const auth = requireAuth(req);
  const companyIds = auth.actor.memberships.map((m) => m.companyId);
  const companies = companyIds.length
    ? await withUser(req, (tx) =>
        many<{ id: string; name: string; slug: string; segment: string }>(
          tx,
          `select id, name, slug, segment from companies where id = any($1) order by name`,
          [companyIds],
        ),
      )
    : [];
  return {
    id: auth.userId,
    email: auth.profile.email,
    fullName: auth.profile.fullName,
    isFavisAdmin: auth.actor.isFavisAdmin,
    companies: companies.map((c) => {
      const m = auth.actor.memberships.find((x) => x.companyId === c.id)!;
      return { ...c, role: m.role, permissions: [...companyPermissions(auth.actor, c.id)] };
    }),
  };
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { auth, db, cfg } = app.deps;
  const guard = new LoginGuard(cfg.LOGIN_MAX_FAILURES_PER_EMAIL);

  async function respondWithSession(req: FastifyRequest, reply: FastifyReply, session: Session) {
    const claims = await auth.verifyAccessToken(session.accessToken);
    const ctx = await loadAuthContext(db, claims);
    if (!ctx) throw unauthorized('Usuário desativado');
    req.auth = ctx;
    setRefreshCookie(req, reply, session.refreshToken);
    return { accessToken: session.accessToken, expiresAt: session.expiresAt, user: await buildMe(req) };
  }

  app.post(
    '/auth/login',
    {
      schema: { tags: ['Autenticação'], summary: 'Entrar com e-mail e senha', body: loginSchema, security: [] },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const wait = guard.blockedFor(req.body.email);
      if (wait > 0) {
        reply.header('retry-after', wait);
        throw new AppError(429, 'muitas_tentativas', 'Muitas tentativas de login para este e-mail. Aguarde alguns minutos e tente novamente.');
      }
      let session;
      try {
        session = await auth.login(req.body.email, req.body.password, { userAgent: req.headers['user-agent'] });
      } catch (err) {
        if (err instanceof AppError && err.code === 'credenciais_invalidas') guard.recordFailure(req.body.email);
        throw err;
      }
      guard.recordSuccess(req.body.email);
      return respondWithSession(req, reply, session);
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: { tags: ['Autenticação'], summary: 'Renovar sessão (cookie httpOnly)', security: [] },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const token = req.cookies[REFRESH_COOKIE];
      if (!token) throw unauthorized();
      try {
        const session = await auth.refresh(token, { userAgent: req.headers['user-agent'] });
        return await respondWithSession(req, reply, session);
      } catch (err) {
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
        throw err;
      }
    },
  );

  app.post('/auth/logout', { schema: { tags: ['Autenticação'], summary: 'Sair', security: [] } }, async (req, reply) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    await auth.logout(req.cookies[REFRESH_COOKIE], bearer);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.get('/auth/me', { schema: { tags: ['Autenticação'], summary: 'Usuário atual' } }, async (req) => buildMe(req));

  app.patch(
    '/auth/me',
    { schema: { tags: ['Autenticação'], summary: 'Atualizar meu nome', body: updateMeSchema } },
    async (req) => {
      const { userId } = requireAuth(req);
      await withUser(req, (tx) => tx.query('update profiles set full_name = $1 where id = $2', [req.body.fullName, userId]));
      req.auth!.profile.fullName = req.body.fullName;
      return buildMe(req);
    },
  );

  app.post(
    '/auth/me/password',
    {
      schema: { tags: ['Autenticação'], summary: 'Alterar minha senha', body: changePasswordSchema },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { userId } = requireAuth(req);
      if (!(await auth.verifyPassword(userId, req.body.currentPassword))) {
        throw unprocessable('Senha atual incorreta');
      }
      await auth.setPassword(userId, req.body.newPassword);
      return { ok: true };
    },
  );
};
