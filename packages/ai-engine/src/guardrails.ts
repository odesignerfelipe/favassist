import type { PlanItem, PlanOutput } from './schema';
import type { CompanyContext } from './types';

export interface ValidatedItem extends PlanItem {
  /** Problemas detectados automaticamente neste item. */
  flags: string[];
}

export interface ValidatedPlan {
  summary: string;
  strategyRationale: string;
  items: ValidatedItem[];
  warnings: string[];
  mix: { campaignShare: number; target: number | null; byPillar: Record<string, number> };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONEY = /R\$\s?\d[\d.]*(,\d{1,2})?/gi;
const PERCENT = /\d{1,3}(?:[.,]\d+)?\s?%/g;
const PROMO_WORDS = /\b(promo[çc][ãa]o|desconto|cupom|frete gr[áa]tis|brinde|liquida[çc][ãa]o|black friday|leve \d+ pague \d+|gr[áa]tis)\b/gi;
const RESULT_CLAIM = /\b\d[\d.]*\s?(mil\s)?(clientes|vendas|pedidos|seguidores|avalia[çc][õo]es|alunos|pacientes|unidades vendidas)\b/gi;

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'para', 'com', 'um', 'uma', 'que', 'por', 'seu', 'sua']);

export function normalizeTokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

export function similarity(a: string, b: string): number {
  const ta = normalizeTokens(a);
  const tb = normalizeTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const normalizeForSearch = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** Texto de referência: só o que a empresa informou pode aparecer como fato comercial. */
function sourceText(ctx: CompanyContext): string {
  const p = ctx.profile;
  return normalizeForSearch(
    [
      p.products,
      p.services,
      p.differentiators,
      p.additionalInfo,
      p.businessDescription,
      ctx.instructions,
      ...ctx.campaigns.flatMap((c) => [c.offers, c.products, c.notes, c.objectives, c.name]),
      ...ctx.metrics.map((m) => String(m.value)),
    ].join(' '),
  );
}

function itemText(i: PlanItem): string {
  return [i.title, i.script, i.caption_suggestion, i.call_to_action, ...i.talking_points].join(' ');
}

/**
 * Verifica a saída do modelo contra as regras de negócio.
 * Não descarta conteúdo silenciosamente: corrige o que é seguro (campanha inválida → null)
 * e sinaliza o resto para revisão humana.
 */
export function validatePlan(output: PlanOutput, ctx: CompanyContext): ValidatedPlan {
  const warnings = [...output.warnings];
  const sources = sourceText(ctx);
  const campaignsById = new Map(ctx.campaigns.map((c) => [c.id, c]));
  const hasOffers = ctx.campaigns.some((c) => c.offers.trim().length > 0);
  const recentTitles = ctx.history.map((h) => h.title);

  const items: ValidatedItem[] = output.items.map((raw, index) => {
    const flags: string[] = [];
    const item: ValidatedItem = { ...raw, flags, needs_verification: [...raw.needs_verification] };

    if (!ISO_DATE.test(item.date) || item.date < ctx.period.start || item.date > ctx.period.end) {
      flags.push(`Data ${item.date} fora do período ${ctx.period.start} a ${ctx.period.end}`);
    }
    if (item.time !== null && !HHMM.test(item.time)) {
      flags.push(`Horário inválido (${item.time}) removido`);
      item.time = null;
    }
    item.stories_count = Math.max(0, Math.min(30, Math.round(item.stories_count)));

    if (item.campaign_id) {
      const c = campaignsById.get(item.campaign_id);
      if (!c) {
        flags.push('Campanha inexistente ou inativa removida do item');
        item.campaign_id = null;
      } else if (item.date < c.startsOn || item.date > c.endsOn) {
        flags.push(`Conteúdo da campanha "${c.name}" fora do período da campanha`);
      }
    }
    if (item.pillar === 'campanha' && !item.campaign_id) {
      flags.push('Conteúdo de campanha sem campanha ativa associada');
    }

    // Fatos comerciais não informados pela empresa → revisão obrigatória
    const text = itemText(item);
    const unknownFacts = new Set<string>();
    for (const re of [MONEY, PERCENT, RESULT_CLAIM]) {
      for (const m of text.matchAll(re)) {
        if (!sources.includes(normalizeForSearch(m[0]))) unknownFacts.add(m[0].trim());
      }
    }
    if (!hasOffers) {
      for (const m of text.matchAll(PROMO_WORDS)) unknownFacts.add(m[0].trim());
    }
    if (unknownFacts.size) {
      const list = [...unknownFacts].slice(0, 5).join(', ');
      flags.push(`Possível informação comercial não confirmada: ${list}`);
      item.needs_verification.push(`Confirmar com a empresa: ${list}`);
    }

    // Repetição: histórico recente e itens anteriores do mesmo plano
    const similarPast = recentTitles.find((t) => similarity(t, item.title) >= 0.6);
    if (similarPast) flags.push(`Muito parecido com conteúdo recente: "${similarPast}"`);
    const similarInPlan = output.items.slice(0, index).find((o) => similarity(o.title, item.title) >= 0.6);
    if (similarInPlan) flags.push(`Repete outro item deste planejamento: "${similarInPlan.title}"`);

    return item;
  });

  // Equilíbrio entre pilares e participação de campanha
  const byPillar: Record<string, number> = {};
  for (const i of items) byPillar[i.pillar] = (byPillar[i.pillar] ?? 0) + 1;
  const campaignCount = items.filter((i) => i.campaign_id || i.pillar === 'campanha').length;
  const campaignShare = items.length ? campaignCount / items.length : 0;
  const target = ctx.campaigns.length
    ? ctx.campaigns.reduce((acc, c) => acc + c.contentShare, 0) / ctx.campaigns.length
    : null;

  if (target !== null && items.length >= 4 && Math.abs(campaignShare - target) > 0.15) {
    warnings.push(
      `Participação de campanha em ${Math.round(campaignShare * 100)}% (referência: ${Math.round(target * 100)}%). Avalie o equilíbrio.`,
    );
  }
  if (target === null && campaignCount > 0) {
    warnings.push('Há conteúdos de campanha, mas nenhuma campanha ativa no período.');
  }
  const dominant = Object.entries(byPillar).find(([, n]) => items.length >= 4 && n / items.length > 0.5);
  if (dominant) warnings.push(`O pilar "${dominant[0]}" concentra mais da metade dos conteúdos.`);
  if (items.length === 0) warnings.push('O modelo não retornou conteúdos.');

  const flagged = items.filter((i) => i.flags.length).length;
  if (flagged) warnings.push(`${flagged} item(ns) sinalizado(s) para revisão antes da aprovação.`);

  return {
    summary: output.summary,
    strategyRationale: output.strategy_rationale,
    items,
    warnings,
    mix: { campaignShare, target, byPillar },
  };
}
