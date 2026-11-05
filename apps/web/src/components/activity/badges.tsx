import {
  ACTIVITY_STATUS_LABELS,
  CONTENT_FORMAT_LABELS,
  CONTENT_PILLAR_LABELS,
  type ActivityStatus,
  type ContentFormat,
  type ContentPillar,
} from '@fav/shared';
import { Badge, type BadgeTone } from '@/components/ui/display';

export const STATUS_TONE: Record<ActivityStatus, BadgeTone> = {
  planejada: 'neutral',
  pendente_aprovacao: 'warning',
  aprovada: 'info',
  em_andamento: 'accent',
  concluida: 'success',
  impedida: 'danger',
  cancelada: 'neutral',
};

export function StatusBadge({ status }: { status: ActivityStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={status === 'cancelada' ? 'line-through opacity-70' : undefined}>
      {ACTIVITY_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Cores discretas por pilar (usadas no calendário). */
export const PILLAR_DOT: Record<ContentPillar, string> = {
  relacionamento: 'bg-rose-400',
  bastidores: 'bg-amber-400',
  engajamento: 'bg-sky-400',
  autoridade: 'bg-indigo-400',
  prova_social: 'bg-emerald-400',
  conversao: 'bg-orange-500',
  campanha: 'bg-fuchsia-500',
};

export function PillarTag({ pillar }: { pillar: ContentPillar }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-2 rounded-full ${PILLAR_DOT[pillar]}`} aria-hidden />
      {CONTENT_PILLAR_LABELS[pillar]}
    </span>
  );
}

export function formatLabel(format: ContentFormat, storiesCount: number) {
  return format === 'stories' ? `${storiesCount} ${storiesCount === 1 ? 'Story' : 'Stories'}` : CONTENT_FORMAT_LABELS[format];
}
