import { Queue, Worker } from 'bullmq';
import { loadConfig } from './config';
import { createDeps } from './container';
import { QUEUE_AI, QUEUE_MESSAGING, redisConnection } from './queue';

/**
 * Worker de tarefas assíncronas (BullMQ):
 *  - fav-ai: gerações de planejamento por IA
 *  - fav-messaging: verificação a cada minuto dos cronogramas diários a enviar
 */
const cfg = loadConfig();
if (!cfg.REDIS_URL) {
  console.error('O worker exige REDIS_URL. Sem Redis, a API executa a IA em modo inline e o envio diário fica manual.');
  process.exit(1);
}
const deps = createDeps(cfg, { forceInlineQueue: true });
const connection = redisConnection(cfg.REDIS_URL);
const log = (msg: string, extra?: unknown) => console.log(`[worker ${new Date().toISOString()}] ${msg}`, extra ?? '');

const aiWorker = new Worker(
  QUEUE_AI,
  async (job) => {
    log(`Gerando planejamento ${job.data.generationId}`);
    await deps.ai.runGeneration(job.data.generationId as string);
  },
  { connection, concurrency: 2 },
);

const messagingQueue = new Queue(QUEUE_MESSAGING, { connection });
await messagingQueue.upsertJobScheduler('dispatch-daily', { every: 60_000 }, { name: 'dispatch-daily' });

const messagingWorker = new Worker(
  QUEUE_MESSAGING,
  async () => {
    const r = await deps.messaging.dispatchDue();
    if (r.checked) log(`Cronogramas processados: ${r.checked}`, r.results.map((x) => `${x.groupId}:${x.status}`));
  },
  { connection, concurrency: 1 },
);

for (const w of [aiWorker, messagingWorker]) {
  w.on('failed', (job, err) => log(`Falha no job ${job?.name} (${job?.id}): ${err.message}`));
  w.on('error', (err) => log(`Erro no worker: ${err.message}`));
}
log('Worker iniciado.');

const shutdown = async () => {
  await Promise.all([aiWorker.close(), messagingWorker.close(), messagingQueue.close()]);
  await deps.db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
