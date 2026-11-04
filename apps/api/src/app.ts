import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AuthProvider } from './auth/provider';
import type { Config } from './config';
import type { Database } from './db/database';
import { loadAuthContext } from './lib/context';
import { AppError, fromPgError } from './lib/errors';
import type { JobQueue } from './queue';
import { registerRoutes } from './routes';
import type { AiService } from './services/ai';
import type { MessagingService } from './services/messaging';

export interface AppDeps {
  cfg: Config;
  db: Database;
  auth: AuthProvider;
  ai: AiService;
  messaging: MessagingService;
  queue: JobQueue;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const { cfg } = deps;
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: cfg.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            transport: cfg.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
    trustProxy: true,
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: cfg.APP_URL.split(',').map((s) => s.trim()), credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'FAV Assist API',
        description: 'API REST do FAV Assist — by FAVIS Design Studio',
        version: '0.1.0',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // Autenticação: se houver Bearer, valida e carrega o contexto.
  // Rotas protegidas exigem req.auth via requireAuth().
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const claims = await deps.auth.verifyAccessToken(header.slice(7));
    const ctx = await loadAuthContext(deps.db, claims);
    if (!ctx) throw new AppError(401, 'nao_autenticado', 'Usuário inexistente ou desativado');
    req.auth = ctx;
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error.validation) {
      return reply.status(400).send({
        error: 'requisicao_invalida',
        message: 'Dados inválidos',
        details: error.validation.map((v) => ({
          path: (v.instancePath || '').replace(/^\//, '').replace(/\//g, '.'),
          message: v.message,
        })),
      });
    }
    const appError = error instanceof AppError ? error : fromPgError(error);
    if (appError) {
      return reply
        .status(appError.statusCode)
        .send({ error: appError.code, message: appError.message, details: appError.details });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: 'requisicao_invalida', message: error.message });
    }
    req.log.error({ err: error }, 'Erro não tratado');
    return reply.status(500).send({ error: 'erro_interno', message: 'Erro interno. Tente novamente.' });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: 'nao_encontrado', message: 'Rota não encontrada' }),
  );

  await app.register(registerRoutes, { prefix: '/api' });
  return app;
}
