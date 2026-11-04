import { Queue } from 'bullmq';

/**
 * Filas de tarefas assíncronas.
 * - BullMQ (Redis) em produção: o worker (src/worker.ts) consome os jobs.
 * - Inline (sem Redis): executa no próprio processo da API, em segundo plano.
 */
export const QUEUE_AI = 'fav-ai';
export const QUEUE_MESSAGING = 'fav-messaging';

export interface JobHandlers {
  aiGeneration: (generationId: string) => Promise<void>;
}

export interface JobQueue {
  readonly mode: 'bullmq' | 'inline';
  enqueueAiGeneration(generationId: string): Promise<void>;
  close(): Promise<void>;
}

export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export class BullJobQueue implements JobQueue {
  readonly mode = 'bullmq' as const;
  private readonly ai: Queue;

  constructor(redisUrl: string) {
    this.ai = new Queue(QUEUE_AI, { connection: redisConnection(redisUrl) });
  }

  async enqueueAiGeneration(generationId: string) {
    await this.ai.add(
      'generate-plan',
      { generationId },
      { jobId: generationId, attempts: 2, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 500, removeOnFail: 1000 },
    );
  }

  async close() {
    await this.ai.close();
  }
}

export class InlineJobQueue implements JobQueue {
  readonly mode = 'inline' as const;
  private readonly running = new Set<Promise<void>>();
  private handlers?: JobHandlers;

  constructor(private readonly onError: (err: unknown) => void = () => undefined) {}

  setHandlers(handlers: JobHandlers) {
    this.handlers = handlers;
  }

  async enqueueAiGeneration(generationId: string) {
    const handler = this.handlers?.aiGeneration;
    if (!handler) throw new Error('Fila inline sem handler registrado');
    const p = handler(generationId)
      .catch(this.onError)
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  /** Aguarda tarefas em andamento (usado nos testes e no desligamento). */
  async drain() {
    await Promise.all([...this.running]);
  }

  async close() {
    await this.drain();
  }
}
