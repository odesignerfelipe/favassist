import type {
  ActivityStatus,
  CampaignStatus,
  ContentFormat,
  ContentPillar,
  MemberRole,
  Permission,
} from '@fav/shared';

export interface Company {
  id: string;
  name: string;
  slug: string;
  segment: string;
  status: 'ativa' | 'inativa';
  timezone: string;
  createdAt: string;
  membersCount?: number;
  activeCampaigns?: number;
  upcomingActivities?: number;
  permissions?: Permission[];
}

export interface Member {
  id: string;
  userId: string;
  role: MemberRole;
  permissions: Record<string, boolean>;
  jobTitle: string;
  active: boolean;
  fullName: string;
  email: string;
}

export interface CompanyProfile {
  companyId: string;
  businessDescription: string;
  targetAudience: string;
  products: string;
  services: string;
  differentiators: string;
  positioning: string;
  brandPersonality: string;
  toneOfVoice: string;
  businessGoals: string;
  marketingGoals: string;
  mainChallenges: string;
  businessHours: { weekday: number; closed: boolean; opens: string | null; closes: string | null }[];
  commercialDates: { date: string; name: string; notes: string }[];
  contentRestrictions: string;
  additionalInfo: string;
  campaignMixTarget: number;
  updatedAt: string;
  updatedByName: string | null;
  completeness: number;
}

export interface Campaign {
  id: string;
  companyId: string;
  name: string;
  objectives: string;
  startsOn: string;
  endsOn: string;
  products: string;
  offers: string;
  notes: string;
  status: CampaignStatus;
  contentShare: number;
  activitiesCount: number;
  completedCount: number;
}

export interface ActivityUpdate {
  id: string;
  kind: 'status' | 'comentario' | 'dificuldade';
  fromStatus: ActivityStatus | null;
  toStatus: ActivityStatus | null;
  message: string;
  createdAt: string;
  userName: string | null;
}

export interface Evidence {
  id: string;
  kind: 'link' | 'texto' | 'arquivo';
  url: string | null;
  description: string;
  createdAt: string;
  createdByName: string | null;
}

export interface Activity {
  id: string;
  companyId: string;
  companyName?: string;
  campaignId: string | null;
  campaignName: string | null;
  title: string;
  scheduledDate: string;
  scheduledTime: string | null;
  pillar: ContentPillar;
  format: ContentFormat;
  storiesCount: number;
  objective: string;
  script: string;
  talkingPoints: string;
  recordingGuidelines: string;
  captionSuggestion: string;
  callToAction: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: ActivityStatus;
  notes: string;
  aiGenerated: boolean;
  completedAt: string | null;
  evidencesCount: number;
  availableTransitions?: ActivityStatus[];
  updates?: ActivityUpdate[];
  evidences?: Evidence[];
}

export interface Checklist {
  date: string;
  today: Activity[];
  overdue: Activity[];
  upcoming: Activity[];
}

export interface CompanyDashboard {
  today: string;
  period: { from: string; to: string };
  byStatus: Partial<Record<ActivityStatus, number>>;
  planned: number;
  due: number;
  done: number;
  doneOnTime: number;
  overdue: number;
  storiesPlanned: number;
  storiesDone: number;
  completionRate: number | null;
  pillars: { pillar: ContentPillar; total: number }[];
  campaignShare: number | null;
  campaignMixTarget: number;
  profileCompleteness: number;
  byAssignee: { assigneeId: string | null; name: string; total: number; done: number; overdue: number; blocked: number }[];
  blockers: { id: string; title: string; scheduledDate: string; assigneeName: string | null; lastMessage: string | null }[];
  upcoming: Pick<Activity, 'id' | 'title' | 'scheduledDate' | 'scheduledTime' | 'pillar' | 'format' | 'status' | 'assigneeName'>[];
  activeCampaigns: { id: string; name: string; startsOn: string; endsOn: string; contentShare: number }[];
  recentActivity: { id: string; kind: string; toStatus: ActivityStatus | null; message: string; createdAt: string; title: string; userName: string | null }[];
}

export interface AdminDashboard {
  period: { from: string; to: string };
  totals: {
    companies: number;
    users: number;
    activeCampaigns: number;
    messagesSent7d: number;
    messagesFailed7d: number;
    aiGenerations30d: number;
  };
  companies: {
    id: string;
    name: string;
    segment: string;
    planned: number;
    due: number;
    done: number;
    overdue: number;
    blocked: number;
    upcoming7d: number;
    completionRate: number | null;
  }[];
  alerts: { companyId: string; companyName: string; kind: string; message: string }[];
}

export interface RankingEntry {
  userId: string;
  name: string;
  role: MemberRole;
  totalPoints: number;
  periodPoints: number;
  level: { level: number; current: number; next: number; progress: number };
  due: number;
  completedOnTime: number;
  withEvidence: number;
  streak: number;
  achievements: string[];
  score: number;
}

export interface Gamification {
  period: 'week' | 'month' | 'year';
  from: string;
  to: string;
  ranking: RankingEntry[];
  achievements: { code: string; name: string; description: string; points: number }[];
}

export interface WhatsappGroup {
  id: string;
  companyId: string;
  externalId: string;
  name: string;
  active: boolean;
  paused: boolean;
  dailySendTime: string;
  sendWeekdays: number[];
  lastSentAt: string | null;
}

export interface WhatsappMessage {
  id: string;
  companyId: string;
  companyName?: string;
  groupId: string | null;
  groupName: string | null;
  direction: 'saida' | 'entrada';
  kind: 'cronograma_diario' | 'manual' | 'resposta' | 'recebida';
  body: string;
  status: 'pendente' | 'enviada' | 'falhou' | 'ignorada' | 'recebida';
  attempts: number;
  lastError: string | null;
  senderName: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface SendOutcome {
  status: 'enviada' | 'falhou' | 'duplicada' | 'ignorada';
  messageId: string | null;
  reason?: string;
}

export interface AiGenerationSummary {
  id: string;
  kind: 'plano_semanal' | 'plano_mensal' | 'alternativa';
  periodStart: string;
  periodEnd: string;
  status: 'pendente' | 'processando' | 'concluida' | 'falhou' | 'aplicada';
  provider: string | null;
  model: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  requestedByName: string | null;
  itemsCount: number;
  warningsCount: number;
}

export interface AiPlanItem {
  date: string;
  time: string | null;
  title: string;
  pillar: ContentPillar;
  format: ContentFormat;
  stories_count: number;
  objective: string;
  script: string;
  talking_points: string[];
  recording_guidelines: string;
  caption_suggestion: string;
  call_to_action: string;
  campaign_id: string | null;
  rationale: string;
  needs_verification: string[];
  flags: string[];
}

export interface AiGeneration extends AiGenerationSummary {
  output: {
    summary: string;
    strategyRationale: string;
    items: AiPlanItem[];
    warnings: string[];
    appliedIndexes?: number[];
    mix: { campaignShare: number; target: number | null; byPillar: Record<string, number> };
  } | null;
  warnings: string[];
}

export interface AuditLog {
  id: number;
  companyId: string | null;
  companyName: string | null;
  actorName: string | null;
  action: 'insert' | 'update' | 'delete';
  entity: string;
  entityId: string;
  changes: Record<string, unknown>;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  platformRole: 'favis_admin' | null;
  active: boolean;
  createdAt: string;
  memberships: { companyId: string; companyName: string; role: MemberRole }[];
}

export interface PlatformSettings {
  aiEnabled: boolean;
  aiDefaultCampaignMix: number;
  aiHistoryDays: number;
  aiGuidelines: string;
  messagingEnabled: boolean;
  messagingDefaultSendTime: string;
  updatedAt: string;
}
