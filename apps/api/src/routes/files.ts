import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../lib/errors';
import { ALLOWED_TYPES, LocalFileStorage } from '../storage';

const EXT_TO_MIME = Object.fromEntries(Object.entries(ALLOWED_TYPES).map(([mime, t]) => [t.ext, mime]));

/**
 * Entrega de arquivos do armazenamento LOCAL por link assinado e temporário.
 * Em produção (Supabase Storage) os links apontam direto para o Supabase e esta rota não é usada.
 */
export const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/files/:a/:b/:name',
    {
      schema: {
        tags: ['Arquivos'],
        summary: 'Arquivo de evidência (link assinado)',
        security: [],
        params: z.object({ a: z.string(), b: z.string(), name: z.string() }),
        querystring: z.object({ exp: z.coerce.number(), sig: z.string().max(100) }),
      },
    },
    async (req, reply) => {
      const storage = app.deps.storage;
      if (!(storage instanceof LocalFileStorage)) throw notFound('Arquivo não encontrado');
      const path = `${req.params.a}/${req.params.b}/${req.params.name}`;
      const file = await storage.open(path, req.query.exp, req.query.sig);
      if (!file) throw notFound('Link inválido ou expirado');
      const ext = req.params.name.split('.').pop() ?? '';
      return reply
        .header('content-type', EXT_TO_MIME[ext] ?? 'application/octet-stream')
        .header('content-length', file.size)
        .header('cache-control', 'private, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .send(file.stream);
    },
  );
};
