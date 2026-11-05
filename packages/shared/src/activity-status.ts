import { ACTIVITY_STATUSES, type ActivityStatus } from './enums';

/**
 * Máquina de estados das atividades.
 * ESPELHO de app.activity_transition_allowed() em
 * supabase/migrations/20261104000200_strategy.sql — altere os dois juntos
 * (há teste automatizado comparando ambos).
 */
export const ACTIVITY_TRANSITIONS: Record<ActivityStatus, readonly ActivityStatus[]> = {
  planejada: ['pendente_aprovacao', 'aprovada', 'em_andamento', 'concluida', 'impedida', 'cancelada'],
  pendente_aprovacao: ['aprovada', 'planejada', 'cancelada'],
  aprovada: ['em_andamento', 'concluida', 'impedida', 'cancelada', 'planejada'],
  em_andamento: ['concluida', 'impedida', 'cancelada', 'aprovada'],
  impedida: ['em_andamento', 'planejada', 'concluida', 'cancelada'],
  concluida: ['em_andamento'],
  cancelada: ['planejada'],
};

/** Estados de origem/destino permitidos a colaboradores (nas próprias tarefas). */
export const COLLABORATOR_FROM: readonly ActivityStatus[] = ['planejada', 'aprovada', 'em_andamento', 'impedida'];
export const COLLABORATOR_TO: readonly ActivityStatus[] = ['em_andamento', 'concluida', 'impedida'];

/** Transições que exigem a permissão `activities.approve`. */
export const APPROVAL_TARGETS: readonly ActivityStatus[] = ['aprovada'];

export function canTransition(from: ActivityStatus, to: ActivityStatus): boolean {
  return from === to || ACTIVITY_TRANSITIONS[from].includes(to);
}

export function collaboratorCanTransition(from: ActivityStatus, to: ActivityStatus): boolean {
  return from === to || (COLLABORATOR_FROM.includes(from) && COLLABORATOR_TO.includes(to));
}

/** Próximos estados disponíveis para o ator. */
export function availableTransitions(
  from: ActivityStatus,
  opts: { isCollaboratorOnly: boolean; canApprove: boolean },
): ActivityStatus[] {
  return ACTIVITY_STATUSES.filter((to) => {
    if (to === from || !canTransition(from, to)) return false;
    if (opts.isCollaboratorOnly) return collaboratorCanTransition(from, to);
    if (APPROVAL_TARGETS.includes(to) && from === 'pendente_aprovacao' && !opts.canApprove) return false;
    return true;
  });
}

/** Estados considerados "abertos" (contam como pendência). */
export const OPEN_STATUSES: readonly ActivityStatus[] = [
  'planejada',
  'pendente_aprovacao',
  'aprovada',
  'em_andamento',
  'impedida',
];
