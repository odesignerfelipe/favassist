import { CONTENT_FORMAT_LABELS, CONTENT_PILLAR_LABELS, WEEKDAY_LABELS } from '@fav/shared';
import type { CompanyContext } from './types';

/**
 * Instruções fixas (iguais para todas as empresas → aproveitam cache de prompt).
 * Tudo o que é específico da empresa vai na mensagem do usuário.
 */
export const PLANNER_SYSTEM_PROMPT = `Você é o motor de planejamento estratégico do FAV Assist, plataforma da FAVIS Design Studio.
Você cria planejamentos de conteúdo (principalmente Stories) para pequenas e médias empresas, que serão revisados pela equipe da FAVIS e executados pela própria equipe do cliente, normalmente com celular e sem equipe de produção.

Como trabalhar:
- Use o diagnóstico da empresa para que cada conteúdo soe como ela: público, tom de voz, personalidade, diferenciais e objetivos. Um planejamento que serviria para qualquer empresa do segmento está errado.
- Explique como produzir cada conteúdo: roteiro em etapas, falas sugeridas na voz da marca e orientações práticas de gravação (enquadramento, luz, áudio, duração). Escreva para quem não é profissional de vídeo.
- Distribua os conteúdos entre os pilares relacionamento, bastidores, engajamento, autoridade, prova social e conversão. Quando houver campanha ativa, conteúdos ligados a ela devem ficar próximos da participação-alvo informada (referência, não regra rígida); o restante fica nos demais pilares, para o perfil não virar um catálogo de anúncios.
- Para conteúdo de campanha use pillar "campanha" ou outro pilar com campaign_id preenchido; use somente IDs de campanhas fornecidas.
- Sugira horários coerentes com o funcionamento da empresa e com a rotina do público. Considere as datas comerciais informadas.
- Use o histórico para não repetir temas, títulos e abordagens recentes, e para adaptar a estratégia: tarefas impedidas indicam formatos difíceis para a equipe — proponha versões mais simples.
- Respeite rigorosamente as restrições de conteúdo da empresa.

Regras de veracidade (obrigatórias):
- Nunca invente preços, descontos, promoções, brindes, prazos, estoque, resultados, números de clientes ou depoimentos. Use apenas o que estiver nos dados fornecidos.
- Se um conteúdo depender de informação que você não tem (ex.: valor de um produto, nome de cliente para depoimento), escreva um marcador entre colchetes, como [confirmar preço], e liste o que precisa ser confirmado em needs_verification.
- Só mencione tendências que estiverem na lista de tendências com fonte. Se a lista estiver vazia, não cite tendências, desafios virais ou dados de mercado.
- Métricas só podem ser citadas se estiverem na lista de métricas fornecida.

Formato: responda somente com o JSON pedido, em português do Brasil.`;

const section = (title: string, body: string) => `## ${title}\n${body.trim() || '(não informado)'}`;

export function buildPlanUserPrompt(ctx: CompanyContext): string {
  const p = ctx.profile;
  const hours = p.businessHours.length
    ? p.businessHours
        .map((h) => `${WEEKDAY_LABELS[h.weekday]}: ${h.closed ? 'fechado' : `${h.opens ?? '?'}–${h.closes ?? '?'}`}`)
        .join('; ')
    : '';
  const dates = p.commercialDates
    .filter((d) => d.date >= shiftDays(ctx.period.start, -7) && d.date <= shiftDays(ctx.period.end, 30))
    .map((d) => `- ${d.date}: ${d.name}${d.notes ? ` (${d.notes})` : ''}`)
    .join('\n');
  const campaigns = ctx.campaigns
    .map(
      (c) =>
        `- id: ${c.id}\n  nome: ${c.name}\n  período: ${c.startsOn} a ${c.endsOn}\n  objetivos: ${c.objectives || '-'}\n` +
        `  produtos: ${c.products || '-'}\n  ofertas confirmadas: ${c.offers || '(nenhuma oferta informada — não invente)'}\n` +
        `  observações: ${c.notes || '-'}\n  participação-alvo no planejamento: ${Math.round(c.contentShare * 100)}%`,
    )
    .join('\n');
  const history = ctx.history
    .slice(-60)
    .map(
      (h) =>
        `- ${h.date} | ${CONTENT_PILLAR_LABELS[h.pillar]} | ${CONTENT_FORMAT_LABELS[h.format]} | ${h.status} | ${h.title}` +
        (h.blockerNote ? ` | dificuldade: ${h.blockerNote}` : ''),
    )
    .join('\n');
  const metrics = ctx.metrics.map((m) => `- ${m.metric}: ${m.value} (${m.periodStart} a ${m.periodEnd}, ${m.source})`).join('\n');
  const trends = ctx.trends.map((t) => `- ${t.title} — fonte: ${t.source} (${t.url})`).join('\n');

  const task = ctx.alternativeFor
    ? `Crie de 1 a 3 alternativas viáveis para a tarefa abaixo, que a equipe não conseguiu executar. ` +
      `Mantenha o objetivo estratégico, mas simplifique a execução considerando a dificuldade relatada. ` +
      `Use a data ${ctx.alternativeFor.date}.\n` +
      `Tarefa original: ${ctx.alternativeFor.title} (${CONTENT_PILLAR_LABELS[ctx.alternativeFor.pillar]}, ${CONTENT_FORMAT_LABELS[ctx.alternativeFor.format]})\n` +
      `Roteiro original: ${ctx.alternativeFor.script || '-'}\nDificuldade relatada: ${ctx.alternativeFor.blocker || '-'}`
    : `Crie o planejamento de conteúdo de ${ctx.period.start} a ${ctx.period.end} (inclusive). ` +
      `Planeje em média um conteúdo por dia útil de funcionamento, salvo instrução diferente abaixo.`;

  return [
    `# Tarefa\n${task}`,
    section('Instruções de quem pediu', ctx.instructions),
    section('Diretrizes da FAVIS', ctx.guidelines),
    `# Empresa: ${ctx.company.name}\nSegmento: ${ctx.company.segment || '(não informado)'}\nFuso horário: ${ctx.company.timezone}`,
    section('Descrição do negócio', p.businessDescription),
    section('Público-alvo', p.targetAudience),
    section('Produtos', p.products),
    section('Serviços', p.services),
    section('Diferenciais', p.differentiators),
    section('Posicionamento', p.positioning),
    section('Personalidade da marca', p.brandPersonality),
    section('Tom de comunicação', p.toneOfVoice),
    section('Objetivos comerciais', p.businessGoals),
    section('Metas de marketing', p.marketingGoals),
    section('Principais dificuldades', p.mainChallenges),
    section('Horários de funcionamento', hours),
    section('Datas comerciais próximas', dates),
    section('Restrições de conteúdo (obrigatório respeitar)', p.contentRestrictions),
    section('Informações adicionais', p.additionalInfo),
    section(
      'Campanhas ativas no período',
      campaigns
        ? `${campaigns}\nReferência geral de participação de campanha: ${Math.round(p.campaignMixTarget * 100)}%.`
        : 'Nenhuma campanha ativa — não crie conteúdo de campanha nem promoções.',
    ),
    section('Histórico recente (mais antigo → mais recente)', history || 'Sem histórico: primeiro planejamento.'),
    section('Métricas disponíveis', metrics || 'Nenhuma integração de métricas conectada. Não cite números de desempenho.'),
    section('Tendências com fonte verificável', trends || 'Nenhuma. Não cite tendências.'),
  ].join('\n\n');
}

export const ASSISTANT_SYSTEM_PROMPT = `Você é o assistente virtual de marketing da FAVIS Design Studio, um assistente automatizado (não uma pessoa).
Responde mensagens de equipes de clientes em grupos de WhatsApp sobre o planejamento de conteúdo.
Seja humano, próximo, profissional e breve (no máximo 5 linhas). Use o tom de voz da empresa quando informado.
Nunca invente preços, promoções, prazos ou resultados. Se não souber, diga que vai encaminhar à equipe da FAVIS.
Não finja ser uma pessoa. Não use markdown de títulos; emojis com moderação.`;

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
