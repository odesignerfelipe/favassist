import { AIProviderError, generateAssistantReply, type AIProvider } from '@fav/ai-engine';
import {
  composeDailySchedule,
  composeRuleReply,
  interpretInbound,
  MessagingError,
  type MessagingProvider,
  type ScheduleItem,
} from '@fav/messaging';
import { many, one, type Database, type Tx } from '../db/database';
import { unprocessable } from '../lib/errors';
import type { AiBudget } from './ai-budget';

interface GroupRow {
  id: string;
  companyId: string;
  companyName: string;
  externalId: string;
  name: string;
  active: boolean;
  paused: boolean;
  toneOfVoice: string;
}

export interface SendOutcome {
  status: 'enviada' | 'falhou' | 'duplicada' | 'ignorada';
  messageId: string | null;
  reason?: string;
}

/**
 * Regras de envio do WhatsApp (independentes do provedor).
 * A autorização do usuário é verificada nas rotas; aqui as operações são de sistema.
 */
export class MessagingService {
  constructor(
    private readonly db: Database,
    private readonly provider: MessagingProvider,
    private readonly opts: { appUrl: string; maxAttempts: number; ai: AIProvider | null; aiBudget?: AiBudget | null },
  ) {}

  get providerName() {
    return this.provider.name;
  }

  status() {
    return this.provider.status();
  }

  private async loadGroup(tx: Tx, groupId: string) {
    return one<GroupRow>(
      tx,
      `select g.id, g.company_id, c.name as company_name, g.external_id, g.name, g.active, g.paused,
              coalesce(p.tone_of_voice, '') as tone_of_voice
         from whatsapp_groups g
         join companies c on c.id = g.company_id
         left join company_profiles p on p.company_id = g.company_id
        where g.id = $1`,
      [groupId],
    );
  }

  private async scheduleItems(tx: Tx, companyId: string, date: string): Promise<ScheduleItem[]> {
    return many<ScheduleItem>(
      tx,
      `select a.scheduled_time as time, a.title, a.format, a.stories_count, p.full_name as assignee_name, a.call_to_action
         from activities a left join profiles p on p.id = a.assignee_id
        where a.company_id = $1 and a.scheduled_date = $2 and a.status not in ('cancelada', 'pendente_aprovacao')
        order by a.scheduled_time nulls last, a.created_at`,
      [companyId, date],
    );
  }

  private async messagingEnabled(tx: Tx) {
    const s = await one<{ messagingEnabled: boolean }>(tx, 'select messaging_enabled from platform_settings where id = 1');
    return s?.messagingEnabled ?? false;
  }

  /**
   * Envia o cronograma do dia para um grupo, uma única vez por grupo/data (dedupe_key única).
   * Reenvia automaticamente apenas mensagens que falharam, até o limite de tentativas.
   */
  async sendDailySchedule(
    groupId: string,
    date: string,
    opts: { trigger: 'automatico' | 'manual'; actorId?: string },
  ): Promise<SendOutcome> {
    const prepared = await this.db.asService(async (tx) => {
      const group = await this.loadGroup(tx, groupId);
      if (!group) throw unprocessable('Grupo não encontrado');
      if (!(await this.messagingEnabled(tx))) return { skip: 'Envios desativados na configuração geral' } as const;
      if (!group.active) return { skip: 'Grupo desativado' } as const;
      if (group.paused && opts.trigger === 'automatico') return { skip: 'Automação pausada para este grupo' } as const;

      const body = composeDailySchedule({
        companyName: group.companyName,
        date,
        items: await this.scheduleItems(tx, group.companyId, date),
        appUrl: this.opts.appUrl,
      });
      const dedupeKey = `daily:${group.id}:${date}`;
      const inserted = await one<{ id: string }>(
        tx,
        `insert into whatsapp_messages (company_id, group_id, direction, kind, body, status, dedupe_key, provider,
                                        reference_date, created_by)
         values ($1, $2, 'saida', 'cronograma_diario', $3, 'pendente', $4, $5, $6, $7)
         on conflict (dedupe_key) do nothing returning id`,
        [group.companyId, group.id, body, dedupeKey, this.provider.name, date, opts.actorId ?? null],
      );
      if (inserted) return { group, messageId: inserted.id, body };

      // Já existe: só reenviamos se falhou e ainda há tentativas
      const existing = await one<{ id: string; status: string; attempts: number }>(
        tx,
        `select id, status, attempts from whatsapp_messages where dedupe_key = $1 for update`,
        [dedupeKey],
      );
      if (existing && existing.status === 'falhou' && existing.attempts < this.opts.maxAttempts) {
        await tx.query(`update whatsapp_messages set status = 'pendente', body = $2 where id = $1`, [existing.id, body]);
        return { group, messageId: existing.id, body };
      }
      return { duplicate: existing?.id ?? null, status: existing?.status } as const;
    });

    if ('skip' in prepared) return { status: 'ignorada', messageId: null, reason: prepared.skip };
    if ('duplicate' in prepared) {
      return {
        status: 'duplicada',
        messageId: prepared.duplicate ?? null,
        reason:
          prepared.status === 'falhou'
            ? 'Limite de tentativas atingido para este cronograma'
            : 'O cronograma desta data já foi enviado para este grupo',
      };
    }
    return this.deliver(prepared.messageId, prepared.group.externalId, prepared.body);
  }

  private async deliver(messageId: string, groupExternalId: string, body: string): Promise<SendOutcome> {
    try {
      const res = await this.provider.send({ groupExternalId, text: body, idempotencyKey: messageId });
      await this.db.asService((tx) =>
        tx.query(
          `update whatsapp_messages set status = 'enviada', provider_message_id = $2, sent_at = now(),
                  attempts = attempts + 1, last_error = null where id = $1`,
          [messageId, res.providerMessageId],
        ),
      );
      return { status: 'enviada', messageId };
    } catch (err) {
      const reason = err instanceof MessagingError ? err.message : 'Erro inesperado no envio';
      await this.db.asService((tx) =>
        tx.query(
          `update whatsapp_messages set status = 'falhou', attempts = attempts + 1, last_error = $2 where id = $1`,
          [messageId, reason],
        ),
      );
      return { status: 'falhou', messageId, reason };
    }
  }

  /** Mensagem avulsa enviada pela equipe FAVIS. */
  async sendManual(groupId: string, body: string, actorId: string): Promise<SendOutcome> {
    const prepared = await this.db.asService(async (tx) => {
      const group = await this.loadGroup(tx, groupId);
      if (!group) throw unprocessable('Grupo não encontrado');
      if (!(await this.messagingEnabled(tx))) throw unprocessable('Envios desativados na configuração geral');
      if (!group.active) throw unprocessable('Grupo desativado');
      const msg = await one<{ id: string }>(
        tx,
        `insert into whatsapp_messages (company_id, group_id, direction, kind, body, status, provider, created_by)
         values ($1, $2, 'saida', 'manual', $3, 'pendente', $4, $5) returning id`,
        [group.companyId, group.id, body, this.provider.name, actorId],
      );
      return { group, messageId: msg!.id };
    });
    return this.deliver(prepared.messageId, prepared.group.externalId, body);
  }

  /**
   * Mensagem recebida no grupo (simulada nesta etapa): registra e responde
   * por regras; perguntas abertas usam a IA quando configurada.
   */
  async handleInbound(groupId: string, senderName: string, text: string) {
    const ctx = await this.db.asService(async (tx) => {
      const group = await this.loadGroup(tx, groupId);
      if (!group) throw unprocessable('Grupo não encontrado');
      await tx.query(
        `insert into whatsapp_messages (company_id, group_id, direction, kind, body, status, provider, sender_name)
         values ($1, $2, 'entrada', 'recebida', $3, 'recebida', $4, $5)`,
        [group.companyId, group.id, text, this.provider.name, senderName],
      );
      const today = await one<{ today: string }>(
        tx,
        `select (now() at time zone timezone)::date::text as today from companies where id = $1`,
        [group.companyId],
      );
      const items = await this.scheduleItems(tx, group.companyId, today!.today);
      return { group, today: today!.today, items, enabled: await this.messagingEnabled(tx) };
    });

    const { group } = ctx;
    if (!ctx.enabled || !group.active || group.paused) {
      return { intent: null, reply: null, outcome: { status: 'ignorada', messageId: null, reason: 'Respostas pausadas' } };
    }
    const intent = interpretInbound(text);
    const todaySchedule = composeDailySchedule({
      companyName: group.companyName,
      date: ctx.today,
      items: ctx.items,
      appUrl: this.opts.appUrl,
    });
    let reply = composeRuleReply(intent, {
      senderName,
      companyName: group.companyName,
      appUrl: this.opts.appUrl,
      todaySchedule,
    });
    // Resposta por IA é uma chamada AUTOMÁTICA: respeita o teto mensal da empresa
    const budget = this.opts.aiBudget;
    if (!reply && this.opts.ai && (!budget || (await budget.allowAutomatic(group.companyId)).allowed)) {
      const ai = this.opts.ai;
      const base = {
        companyId: group.companyId,
        feature: 'assistente_whatsapp' as const,
        origin: 'automatico' as const,
        provider: ai.name,
        model: ai.model,
      };
      try {
        const res = await generateAssistantReply(ai, {
          companyName: group.companyName,
          toneOfVoice: group.toneOfVoice,
          scheduleSummary: ctx.items.map((i) => `- ${i.time ?? ''} ${i.title}`).join('\n'),
          message: text,
          senderName,
        });
        reply = res.text || null;
        await budget?.record({ ...base, succeeded: true, usage: res.usage });
      } catch (err) {
        if (err instanceof AIProviderError) await budget?.record({ ...base, succeeded: false, usage: err.usage }).catch(() => {});
        reply = null;
      }
    }
    reply ??=
      `Recebi sua mensagem, ${senderName.split(' ')[0]}! Sou o assistente virtual de marketing da FAVIS e vou encaminhar para a equipe responder. ` +
      `Enquanto isso, o planejamento completo está no app: ${this.opts.appUrl}`;

    const msg = await this.db.asService((tx) =>
      one<{ id: string }>(
        tx,
        `insert into whatsapp_messages (company_id, group_id, direction, kind, body, status, provider)
         values ($1, $2, 'saida', 'resposta', $3, 'pendente', $4) returning id`,
        [group.companyId, group.id, reply, this.provider.name],
      ),
    );
    const outcome = await this.deliver(msg!.id, group.externalId, reply);
    return { intent, reply, outcome };
  }

  /**
   * Verificação periódica (worker, a cada minuto): grupos cujo horário de envio
   * já chegou no fuso da empresa e que ainda não receberam o cronograma do dia.
   */
  async dispatchDue(): Promise<{ checked: number; results: (SendOutcome & { groupId: string })[] }> {
    const due = await this.db.asService(async (tx) => {
      if (!(await this.messagingEnabled(tx))) return [];
      return many<{ id: string; localDate: string }>(
        tx,
        `select g.id, (now() at time zone c.timezone)::date::text as local_date
           from whatsapp_groups g join companies c on c.id = g.company_id
          where g.active and not g.paused and c.status = 'ativa'
            and extract(isodow from (now() at time zone c.timezone))::smallint = any(g.send_weekdays)
            and (now() at time zone c.timezone)::time >= g.daily_send_time
            and not exists (
              select 1 from whatsapp_messages m
               where m.dedupe_key = 'daily:' || g.id || ':' || (now() at time zone c.timezone)::date::text
                 and (m.status in ('enviada', 'pendente', 'ignorada') or m.attempts >= $1)
            )`,
        [this.opts.maxAttempts],
      );
    });
    const results: (SendOutcome & { groupId: string })[] = [];
    for (const g of due) {
      results.push({ groupId: g.id, ...(await this.sendDailySchedule(g.id, g.localDate, { trigger: 'automatico' })) });
    }
    return { checked: due.length, results };
  }
}
