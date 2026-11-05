import { randomUUID } from 'node:crypto';
import { CONTENT_FORMAT_LABELS, type ContentFormat } from '@fav/shared';

// =============================================================================
// Camada abstrata de comunicação (WhatsApp e futuros canais).
// Não conhece banco de dados nem regras de negócio: apenas envia e compõe mensagens.
// =============================================================================

export interface SendRequest {
  /** Identificador do grupo no provedor */
  groupExternalId: string;
  text: string;
  /** Chave de idempotência (o provedor real deve usá-la para evitar duplicidade) */
  idempotencyKey: string;
}

export interface ConnectionStatus {
  connected: boolean;
  provider: string;
  detail: string;
  /** true quando nenhum número real está conectado */
  simulated: boolean;
}

export interface MessagingProvider {
  readonly name: string;
  send(req: SendRequest): Promise<{ providerMessageId: string }>;
  status(): Promise<ConnectionStatus>;
}

export class MessagingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Simulador: registra o envio sem tocar em nenhuma rede.
 * `failureRate` permite exercitar tentativas e tratamento de erros.
 */
export class SimulatorProvider implements MessagingProvider {
  readonly name = 'simulator';
  readonly sent: (SendRequest & { providerMessageId: string })[] = [];

  constructor(
    private readonly failureRate = 0,
    private readonly random: () => number = Math.random,
  ) {}

  async send(req: SendRequest) {
    if (!req.text.trim()) throw new MessagingError('Mensagem vazia', false);
    if (this.random() < this.failureRate) {
      throw new MessagingError('Falha simulada de envio (SIMULATOR_FAILURE_RATE)', true);
    }
    const providerMessageId = `sim_${randomUUID()}`;
    this.sent.push({ ...req, providerMessageId });
    return { providerMessageId };
  }

  async status(): Promise<ConnectionStatus> {
    return {
      connected: true,
      provider: this.name,
      simulated: true,
      detail: 'Simulador ativo. Nenhum número de WhatsApp real está conectado.',
    };
  }
}

export function createMessagingProvider(name: 'simulator', opts: { failureRate?: number } = {}): MessagingProvider {
  switch (name) {
    case 'simulator':
      return new SimulatorProvider(opts.failureRate ?? 0);
  }
}

// =============================================================================
// Composição de mensagens
// =============================================================================

export interface ScheduleItem {
  time: string | null;
  title: string;
  format: ContentFormat;
  storiesCount: number;
  assigneeName: string | null;
  callToAction: string;
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function formatDateBR(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  const [y, m, day] = iso.split('-');
  return { weekday: WEEKDAYS[d.getUTCDay()]!, date: `${day}/${m}/${y}` };
}

/** Cronograma diário humanizado, identificado como assistente virtual da FAVIS. */
export function composeDailySchedule(input: {
  companyName: string;
  date: string;
  items: ScheduleItem[];
  appUrl: string;
}): string {
  const { weekday, date } = formatDateBR(input.date);
  const header = `Bom dia, equipe ${input.companyName}! ☀️\nAqui é o assistente virtual de marketing da FAVIS. Este é o planejamento de hoje, ${weekday} (${date}):`;
  if (!input.items.length) {
    return `${header}\n\nHoje não há conteúdos programados. Aproveitem para responder as mensagens e interações dos seguidores. 😉\n\nPlanejamento completo: ${input.appUrl}`;
  }
  const lines = input.items.map((i, n) => {
    const fmt = i.format === 'stories' ? `${i.storiesCount} Stories` : CONTENT_FORMAT_LABELS[i.format];
    const who = i.assigneeName ? ` — ${i.assigneeName}` : '';
    const cta = i.callToAction ? `\n   ➜ Chamada: ${i.callToAction}` : '';
    return `${n + 1}. ${i.time ? `${i.time} · ` : ''}${i.title} (${fmt})${who}${cta}`;
  });
  return [
    header,
    '',
    ...lines,
    '',
    'Roteiro, falas e orientações de gravação estão no app. Ao concluir, marque a tarefa por lá. 💪',
    input.appUrl,
  ].join('\n');
}

export type InboundIntent = 'cronograma' | 'concluido' | 'dificuldade' | 'ajuda' | 'saudacao' | 'outro';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Classificação simples por regras (funciona sem IA). */
export function interpretInbound(text: string): InboundIntent {
  const t = normalize(text);
  if (/\b(ajuda|comandos|menu|como funciona)\b/.test(t)) return 'ajuda';
  if (/\b(cronograma|planejamento|agenda|tarefas?|o que (tem|temos|postar))\b.*\b(hoje|dia)\b|\b(hoje)\b.*\b(postar|tarefas?)\b|^(cronograma|planejamento|agenda)\b/.test(t)) {
    return 'cronograma';
  }
  if (/\b(conclu[iu]|feito|finalizei|postei|publiquei|pronto)\b/.test(t)) return 'concluido';
  if (/\b(nao (consegui|deu|vou conseguir)|dificuldade|problema|impedid|sem tempo)\b/.test(t)) return 'dificuldade';
  if (/^(oi|ola|bom dia|boa tarde|boa noite)\b/.test(t)) return 'saudacao';
  return 'outro';
}

/** Respostas padrão por intenção (usadas quando a IA não está configurada ou como base). */
export function composeRuleReply(
  intent: InboundIntent,
  input: { senderName: string; companyName: string; appUrl: string; todaySchedule?: string },
): string | null {
  const first = input.senderName.split(' ')[0];
  switch (intent) {
    case 'cronograma':
      return input.todaySchedule ?? null;
    case 'concluido':
      return `Que ótimo, ${first}! 🎉 Para contar nos indicadores, marque a tarefa como concluída no app e, se puder, anexe o link do conteúdo: ${input.appUrl}`;
    case 'dificuldade':
      return `Obrigado por avisar, ${first}. Registre a dificuldade na tarefa pelo app (${input.appUrl}) — assim a equipe da FAVIS consegue ajustar o planejamento ou sugerir uma alternativa.`;
    case 'ajuda':
      return `Sou o assistente virtual de marketing da FAVIS 🤖. Posso enviar o planejamento do dia (escreva "cronograma de hoje") e lembrar como registrar tarefas. Detalhes completos no app: ${input.appUrl}`;
    case 'saudacao':
      return `Olá, ${first}! Aqui é o assistente virtual de marketing da FAVIS. Escreva "cronograma de hoje" para ver o planejamento do dia.`;
    default:
      return null;
  }
}
