/**
 * Regras de gamificação. Os pontos são lançados por triggers no banco
 * (supabase/migrations/20261104000300_platform.sql); aqui ficam os valores
 * de referência e os cálculos derivados (nível, sequência).
 */
export const POINT_RULES = {
  conclusaoNoPrazo: 10,
  conclusaoAtrasada: 4,
  evidencia: 3,
} as const;

/** Pontos necessários para alcançar o nível n (n >= 1): 50 · (n-1)². Crescimento suave. */
export function pointsForLevel(level: number): number {
  return 50 * (level - 1) ** 2;
}

export function levelFromPoints(points: number): { level: number; current: number; next: number; progress: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, points) / 50)) + 1;
  const current = pointsForLevel(level);
  const next = pointsForLevel(level + 1);
  return { level, current, next, progress: (points - current) / (next - current) };
}

/**
 * Sequência de dias ativos terminando em `today` (ou ontem, para não zerar antes do fim do dia).
 * `activeDays` = datas ISO (YYYY-MM-DD) em que houve conclusão.
 */
export function currentStreak(activeDays: Iterable<string>, today: string): number {
  const days = new Set(activeDays);
  const cursor = new Date(`${today}T12:00:00Z`);
  if (!days.has(toIso(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(toIso(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/**
 * Pontuação de ranking que privilegia consistência e qualidade, não volume:
 * taxa de execução no prazo (peso maior), sequência e evidências.
 */
export function consistencyScore(input: {
  due: number;
  completedOnTime: number;
  completedWithEvidence: number;
  streak: number;
}): number {
  if (input.due === 0) return 0;
  const onTimeRate = input.completedOnTime / input.due;
  const evidenceRate = input.completedWithEvidence / input.due;
  const streakFactor = Math.min(input.streak, 14) / 14;
  return Math.round((onTimeRate * 0.6 + evidenceRate * 0.25 + streakFactor * 0.15) * 1000) / 10;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
