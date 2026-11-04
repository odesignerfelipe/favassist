// Valores de domínio. Mantenha sincronizado com os CHECKs das migrações SQL.

export const MEMBER_ROLES = ['owner', 'manager', 'collaborator'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  collaborator: 'Colaborador',
};

export const ACTIVITY_STATUSES = [
  'planejada',
  'pendente_aprovacao',
  'aprovada',
  'em_andamento',
  'concluida',
  'impedida',
  'cancelada',
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  planejada: 'Planejada',
  pendente_aprovacao: 'Pendente de aprovação',
  aprovada: 'Aprovada',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  impedida: 'Impedida',
  cancelada: 'Cancelada',
};

export const CONTENT_PILLARS = [
  'relacionamento',
  'bastidores',
  'engajamento',
  'autoridade',
  'prova_social',
  'conversao',
  'campanha',
] as const;
export type ContentPillar = (typeof CONTENT_PILLARS)[number];

export const CONTENT_PILLAR_LABELS: Record<ContentPillar, string> = {
  relacionamento: 'Relacionamento',
  bastidores: 'Bastidores',
  engajamento: 'Engajamento',
  autoridade: 'Autoridade',
  prova_social: 'Prova social',
  conversao: 'Conversão',
  campanha: 'Campanha',
};

export const CONTENT_FORMATS = ['stories', 'reels', 'feed', 'carrossel', 'live', 'outro'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  stories: 'Stories',
  reels: 'Reels',
  feed: 'Post no feed',
  carrossel: 'Carrossel',
  live: 'Live',
  outro: 'Outro',
};

export const CAMPAIGN_STATUSES = ['rascunho', 'ativa', 'pausada', 'encerrada'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  rascunho: 'Rascunho',
  ativa: 'Ativa',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
};

export const COMPANY_STATUSES = ['ativa', 'inativa'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const ACTIVITY_UPDATE_KINDS = ['status', 'comentario', 'dificuldade'] as const;
export type ActivityUpdateKind = (typeof ACTIVITY_UPDATE_KINDS)[number];

export const EVIDENCE_KINDS = ['link', 'texto', 'arquivo'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const AI_GENERATION_KINDS = ['plano_semanal', 'plano_mensal', 'alternativa'] as const;
export type AiGenerationKind = (typeof AI_GENERATION_KINDS)[number];

export const AI_GENERATION_STATUSES = ['pendente', 'processando', 'concluida', 'falhou', 'aplicada'] as const;
export type AiGenerationStatus = (typeof AI_GENERATION_STATUSES)[number];

export const MESSAGE_STATUSES = ['pendente', 'enviada', 'falhou', 'ignorada', 'recebida'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_KINDS = ['cronograma_diario', 'manual', 'resposta', 'recebida'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'google_business'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  google_business: 'Perfil da Empresa no Google',
};

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
  7: 'Dom',
};
