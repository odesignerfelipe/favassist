import { CONTENT_FORMATS, CONTENT_PILLARS } from '@fav/shared';
import { z } from 'zod';

/**
 * Formato de saída pedido ao modelo (saída estruturada).
 * Mantido simples (tipos, enums, nulos) para ser compatível com a geração restrita por schema;
 * os limites de negócio são verificados depois, em `guardrails.ts`.
 */
export const planItemSchema = z.object({
  date: z.string().describe('Data no formato AAAA-MM-DD, dentro do período pedido'),
  time: z.string().nullable().describe('Horário sugerido HH:MM, respeitando o funcionamento, ou null'),
  title: z.string().describe('Título curto e específico do conteúdo'),
  pillar: z.enum(CONTENT_PILLARS),
  format: z.enum(CONTENT_FORMATS),
  stories_count: z.number().int().describe('Quantidade de Stories (0 se não for Stories)'),
  objective: z.string().describe('Objetivo estratégico do conteúdo'),
  script: z.string().describe('Roteiro passo a passo, humanizado, explicando como produzir'),
  talking_points: z.array(z.string()).describe('Sugestões de falas, na voz da marca'),
  recording_guidelines: z.string().describe('Orientações práticas de gravação'),
  caption_suggestion: z.string(),
  call_to_action: z.string(),
  campaign_id: z.string().nullable().describe('ID de uma campanha ativa fornecida, ou null'),
  rationale: z.string().describe('Por que este conteúdo neste dia'),
  needs_verification: z
    .array(z.string())
    .describe('Informações que a empresa precisa confirmar antes de publicar (vazio se nenhuma)'),
});

export const planOutputSchema = z.object({
  summary: z.string().describe('Resumo da estratégia do período'),
  strategy_rationale: z.string().describe('Como os pilares e a campanha foram distribuídos e por quê'),
  items: z.array(planItemSchema),
  warnings: z.array(z.string()).describe('Limitações ou pontos de atenção do planejamento'),
});

export type PlanItem = z.infer<typeof planItemSchema>;
export type PlanOutput = z.infer<typeof planOutputSchema>;
