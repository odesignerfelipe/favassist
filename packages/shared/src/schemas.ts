import { z } from 'zod';
import {
  ACTIVITY_STATUSES,
  ACTIVITY_UPDATE_KINDS,
  AI_GENERATION_KINDS,
  CAMPAIGN_STATUSES,
  COMPANY_STATUSES,
  CONTENT_FORMATS,
  CONTENT_PILLARS,
  MEMBER_ROLES,
} from './enums';
import { MANAGER_CONFIGURABLE_PERMISSIONS } from './permissions';

// Schemas de entrada compartilhados por API (validação) e web (formulários).

const text = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`);
const requiredText = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label}: mínimo de ${min} caracteres`)
    .max(max, `${label}: máximo de ${max} caracteres`);

export const isoDate = z.iso.date({ message: 'Data inválida (AAAA-MM-DD)' });
export const timeHHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Horário inválido (HH:MM)')
  .transform((v) => v.slice(0, 5));
export const uuid = z.uuid({ message: 'Identificador inválido' });
export const email = z.email({ message: 'E-mail inválido' }).trim().toLowerCase();
export const password = z
  .string()
  .min(10, 'A senha deve ter pelo menos 10 caracteres')
  .max(128, 'Senha muito longa');

// ---------- Autenticação ----------
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Informe a senha').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export const updateMeSchema = z.object({
  fullName: requiredText(2, 120, 'Nome'),
});

// ---------- Empresas ----------
export const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export const companyCreateSchema = z.object({
  name: requiredText(2, 120, 'Nome'),
  segment: text(120).default(''),
  timezone: z.string().trim().min(3).max(64).default('America/Sao_Paulo'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens')
    .max(60)
    .optional(),
});
export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

export const companyUpdateSchema = z.object({
  name: requiredText(2, 120, 'Nome').optional(),
  segment: text(120).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  status: z.enum(COMPANY_STATUSES).optional(),
});

// ---------- Diagnóstico estratégico ----------
export const businessHourSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  closed: z.boolean().default(false),
  opens: timeHHMM.nullable().default(null),
  closes: timeHHMM.nullable().default(null),
});

export const commercialDateSchema = z.object({
  date: isoDate,
  name: requiredText(2, 120, 'Nome da data'),
  notes: text(500).default(''),
});

export const companyProfileSchema = z.object({
  businessDescription: text(4000).default(''),
  targetAudience: text(4000).default(''),
  products: text(4000).default(''),
  services: text(4000).default(''),
  differentiators: text(4000).default(''),
  positioning: text(2000).default(''),
  brandPersonality: text(2000).default(''),
  toneOfVoice: text(2000).default(''),
  businessGoals: text(4000).default(''),
  marketingGoals: text(4000).default(''),
  mainChallenges: text(4000).default(''),
  businessHours: z.array(businessHourSchema).max(7).default([]),
  commercialDates: z.array(commercialDateSchema).max(100).default([]),
  contentRestrictions: text(4000).default(''),
  additionalInfo: text(8000).default(''),
  campaignMixTarget: z.number().min(0).max(1).default(0.3),
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;

// ---------- Membros / usuários ----------
const managerPermissionsSchema = z
  .object(
    Object.fromEntries(MANAGER_CONFIGURABLE_PERMISSIONS.map((p) => [p, z.boolean().optional()])) as Record<
      (typeof MANAGER_CONFIGURABLE_PERMISSIONS)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

export const memberCreateSchema = z.object({
  email,
  fullName: requiredText(2, 120, 'Nome'),
  role: z.enum(MEMBER_ROLES),
  jobTitle: text(80).default(''),
  permissions: managerPermissionsSchema.default({}),
  /** Senha inicial (obrigatória quando o usuário ainda não existe). */
  password: password.optional(),
});
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

export const memberUpdateSchema = z.object({
  role: z.enum(MEMBER_ROLES).optional(),
  jobTitle: text(80).optional(),
  permissions: managerPermissionsSchema.optional(),
  active: z.boolean().optional(),
});

export const adminUserCreateSchema = z.object({
  email,
  fullName: requiredText(2, 120, 'Nome'),
  password,
  favisAdmin: z.boolean().default(false),
});

export const adminUserUpdateSchema = z.object({
  fullName: requiredText(2, 120, 'Nome').optional(),
  favisAdmin: z.boolean().optional(),
  active: z.boolean().optional(),
  password: password.optional(),
});

// ---------- Campanhas ----------
const campaignBase = z.object({
  name: requiredText(2, 120, 'Nome'),
  objectives: text(4000).default(''),
  startsOn: isoDate,
  endsOn: isoDate,
  products: text(4000).default(''),
  offers: text(4000).default(''),
  notes: text(4000).default(''),
  status: z.enum(CAMPAIGN_STATUSES).default('ativa'),
  contentShare: z.number().min(0).max(1).default(0.3),
});

export const campaignCreateSchema = campaignBase.refine((v) => v.endsOn >= v.startsOn, {
  message: 'A data final deve ser igual ou posterior à inicial',
  path: ['endsOn'],
});
export type CampaignInput = z.infer<typeof campaignCreateSchema>;

export const campaignUpdateSchema = campaignBase.partial().refine(
  (v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn,
  { message: 'A data final deve ser igual ou posterior à inicial', path: ['endsOn'] },
);

// ---------- Atividades ----------
const activityFields = {
  title: requiredText(2, 160, 'Título'),
  scheduledDate: isoDate,
  scheduledTime: timeHHMM.nullable().default(null),
  pillar: z.enum(CONTENT_PILLARS),
  format: z.enum(CONTENT_FORMATS).default('stories'),
  storiesCount: z.number().int().min(0).max(30).default(1),
  objective: text(2000).default(''),
  script: text(8000).default(''),
  talkingPoints: text(4000).default(''),
  recordingGuidelines: text(4000).default(''),
  captionSuggestion: text(2200).default(''),
  callToAction: text(500).default(''),
  assigneeId: uuid.nullable().default(null),
  campaignId: uuid.nullable().default(null),
  notes: text(4000).default(''),
};

export const activityCreateSchema = z.object({
  ...activityFields,
  status: z.enum(['planejada', 'pendente_aprovacao', 'aprovada']).default('planejada'),
});
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

export const activityUpdateSchema = z
  .object({
    title: activityFields.title,
    scheduledDate: activityFields.scheduledDate,
    scheduledTime: timeHHMM.nullable(),
    pillar: activityFields.pillar,
    format: z.enum(CONTENT_FORMATS),
    storiesCount: z.number().int().min(0).max(30),
    objective: text(2000),
    script: text(8000),
    talkingPoints: text(4000),
    recordingGuidelines: text(4000),
    captionSuggestion: text(2200),
    callToAction: text(500),
    assigneeId: uuid.nullable(),
    campaignId: uuid.nullable(),
    notes: text(4000),
  })
  .partial();
export type ActivityUpdateInput = z.infer<typeof activityUpdateSchema>;

export const activityStatusChangeSchema = z.object({
  status: z.enum(ACTIVITY_STATUSES),
  message: text(2000).default(''),
});

export const activityUpdateCreateSchema = z.object({
  kind: z.enum(ACTIVITY_UPDATE_KINDS).exclude(['status']),
  message: requiredText(2, 2000, 'Mensagem'),
});

export const evidenceCreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('link'),
    url: z.url({ protocol: /^https?$/, message: 'Informe um link http(s) válido' }),
    description: text(2000).default(''),
  }),
  z.object({ kind: z.literal('texto'), description: requiredText(2, 2000, 'Descrição') }),
]);

export const activityListQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  status: z.enum(ACTIVITY_STATUSES).optional(),
  assigneeId: uuid.optional(),
  campaignId: uuid.optional(),
});

export const dateRangeQuerySchema = z.object({ from: isoDate, to: isoDate });

// ---------- IA ----------
export const aiPlanRequestSchema = z
  .object({
    kind: z.enum(AI_GENERATION_KINDS).exclude(['alternativa']),
    periodStart: isoDate,
    periodEnd: isoDate,
    instructions: text(2000).default(''),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: 'Período inválido',
    path: ['periodEnd'],
  });

export const aiAlternativeRequestSchema = z.object({
  activityId: uuid,
  instructions: text(2000).default(''),
});

export const aiApplySchema = z.object({
  itemIndexes: z.array(z.number().int().min(0)).min(1, 'Selecione ao menos um item').max(200),
  assigneeId: uuid.nullable().default(null),
});

export const platformSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  aiDefaultCampaignMix: z.number().min(0).max(1),
  aiHistoryDays: z.number().int().min(7).max(365),
  aiGuidelines: text(4000),
  messagingEnabled: z.boolean(),
  messagingDefaultSendTime: timeHHMM,
  /** Teto mensal de referência de IA por empresa (US$); opcional para manter clientes antigos. */
  aiDefaultMonthlyBudgetUsd: z.number().min(0).max(10_000).optional(),
  aiBudgetAlertPct: z.number().int().min(10).max(99).optional(),
});

/** Teto mensal de IA de uma empresa. null = usar o padrão da plataforma. */
export const aiBudgetUpdateSchema = z.object({
  monthlyBudgetUsd: z.number().min(0, 'Use 0 ou mais').max(10_000, 'Máximo de US$ 10.000').nullable(),
});

// ---------- WhatsApp ----------
export const whatsappGroupCreateSchema = z.object({
  name: requiredText(2, 120, 'Nome do grupo'),
  externalId: z
    .string()
    .trim()
    .min(3, 'Identificador muito curto')
    .max(120)
    .regex(/^[\w.@-]+$/, 'Use apenas letras, números, ponto, @, _ ou -'),
  dailySendTime: timeHHMM.default('08:00'),
  sendWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5, 6]),
});

export const whatsappGroupUpdateSchema = z.object({
  name: requiredText(2, 120, 'Nome do grupo').optional(),
  dailySendTime: timeHHMM.optional(),
  sendWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  active: z.boolean().optional(),
  paused: z.boolean().optional(),
});

export const sendDailySchema = z.object({ date: isoDate.optional() });

export const simulatorInboundSchema = z.object({
  senderName: requiredText(1, 80, 'Remetente'),
  text: requiredText(1, 2000, 'Mensagem'),
});
