import { describe, expect, it } from 'vitest';
import {
  availableTransitions,
  can,
  canTransition,
  collaboratorCanTransition,
  consistencyScore,
  currentStreak,
  levelFromPoints,
  manageableRoles,
  activityCreateSchema,
  campaignCreateSchema,
  slugify,
  type Actor,
} from '../src';

const company = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const actor = (role: 'owner' | 'manager' | 'collaborator', permissions = {}): Actor => ({
  userId: 'u',
  isFavisAdmin: false,
  memberships: [{ companyId: company, role, permissions, active: true }],
});

describe('máquina de estados', () => {
  it('permite fluxos válidos e bloqueia inválidos', () => {
    expect(canTransition('planejada', 'pendente_aprovacao')).toBe(true);
    expect(canTransition('pendente_aprovacao', 'concluida')).toBe(false);
    expect(canTransition('cancelada', 'concluida')).toBe(false);
  });
  it('restringe colaboradores', () => {
    expect(collaboratorCanTransition('aprovada', 'concluida')).toBe(true);
    expect(collaboratorCanTransition('pendente_aprovacao', 'aprovada')).toBe(false);
    expect(collaboratorCanTransition('concluida', 'em_andamento')).toBe(false);
    expect(availableTransitions('em_andamento', { isCollaboratorOnly: true, canApprove: false })).toEqual([
      'concluida',
      'impedida',
    ]);
  });
  it('exige permissão para aprovar', () => {
    expect(availableTransitions('pendente_aprovacao', { isCollaboratorOnly: false, canApprove: false })).not.toContain(
      'aprovada',
    );
  });
});

describe('permissões', () => {
  it('proprietário tem acesso amplo apenas à própria empresa', () => {
    expect(can(actor('owner'), company, 'members.manage')).toBe(true);
    expect(can(actor('owner'), other, 'company.view')).toBe(false);
    expect(can(actor('owner'), company, 'messaging.manage')).toBe(false);
  });
  it('gerente usa padrões configuráveis', () => {
    expect(can(actor('manager'), company, 'activities.manage')).toBe(true);
    expect(can(actor('manager'), company, 'activities.approve')).toBe(false);
    expect(can(actor('manager', { 'activities.approve': true }), company, 'activities.approve')).toBe(true);
    expect(can(actor('manager', { 'activities.manage': false }), company, 'activities.manage')).toBe(false);
  });
  it('colaborador só executa', () => {
    expect(can(actor('collaborator'), company, 'activities.execute')).toBe(true);
    expect(can(actor('collaborator'), company, 'activities.view_all')).toBe(false);
  });
  it('papéis gerenciáveis', () => {
    expect(manageableRoles(actor('owner'), company)).toEqual(['manager', 'collaborator']);
    expect(manageableRoles(actor('manager', { 'members.manage': true }), company)).toEqual(['collaborator']);
    expect(manageableRoles(actor('manager'), company)).toEqual([]);
    expect(manageableRoles({ userId: 'a', isFavisAdmin: true, memberships: [] }, other)).toHaveLength(3);
  });
});

describe('gamificação', () => {
  it('calcula nível', () => {
    expect(levelFromPoints(0).level).toBe(1);
    expect(levelFromPoints(50).level).toBe(2);
    expect(levelFromPoints(199).level).toBe(2);
    expect(levelFromPoints(200).level).toBe(3);
  });
  it('calcula sequência', () => {
    expect(currentStreak(['2026-11-02', '2026-11-03', '2026-11-04'], '2026-11-04')).toBe(3);
    expect(currentStreak(['2026-11-02', '2026-11-03'], '2026-11-04')).toBe(2);
    expect(currentStreak(['2026-11-01'], '2026-11-04')).toBe(0);
  });
  it('favorece consistência, não volume', () => {
    const muitasAtrasadas = consistencyScore({ due: 20, completedOnTime: 5, completedWithEvidence: 0, streak: 1 });
    const poucasNoPrazo = consistencyScore({ due: 5, completedOnTime: 5, completedWithEvidence: 4, streak: 5 });
    expect(poucasNoPrazo).toBeGreaterThan(muitasAtrasadas);
  });
});

describe('schemas', () => {
  it('valida campanha com período coerente', () => {
    expect(campaignCreateSchema.safeParse({ name: 'Natal', startsOn: '2026-12-10', endsOn: '2026-12-01' }).success).toBe(
      false,
    );
  });
  it('aplica padrões em atividades', () => {
    const r = activityCreateSchema.parse({ title: 'Bastidores', scheduledDate: '2026-11-05', pillar: 'bastidores' });
    expect(r).toMatchObject({ format: 'stories', status: 'planejada', storiesCount: 1, assigneeId: null });
  });
  it('gera slug', () => {
    expect(slugify('Café & Cia. São João')).toBe('cafe-cia-sao-joao');
  });
});
