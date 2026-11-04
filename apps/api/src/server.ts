import { buildApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './container';

const cfg = loadConfig();
const deps = createDeps(cfg, { onJobError: (err) => console.error('Falha em tarefa em segundo plano:', err) });
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} recebido, encerrando…`);
  await app.close();
  await deps.queue.close();
  await deps.db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
  app.log.info(`Documentação da API: http://localhost:${cfg.API_PORT}/api/docs`);
  if (deps.queue.mode === 'inline') app.log.warn('REDIS_URL não definida: filas em modo inline (sem envio diário automático).');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
