import type { MemberRole } from './enums';

/**
 * Matriz de permissões (fonte única para API e interface).
 * O banco reforça o isolamento por empresa via RLS; a granularidade fica aqui.
 * Documentação: ARQUITETURA.md §3.
 */
export const PERMISSIONS = [
  'company.view',
  'profile.edit',
  'members.manage',
  'campaigns.manage',
  'activities.manage',
  'activities.approve',
  'activities.view_all',
  'activities.execute',
  'ai.use',
  'messaging.view',
  'messaging.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissões que o proprietário/admin pode ligar ou desligar para gerentes. */
export const MANAGER_CONFIGURABLE_PERMISSIONS = [
  'profile.edit',
  'members.manage',
  'campaigns.manage',
  'activities.manage',
  'activities.approve',
  'ai.use',
] as const satisfies readonly Permission[];
export type ManagerConfigurablePermission = (typeof MANAGER_CONFIGURABLE_PERMISSIONS)[number];

export const MANAGER_DEFAULTS: Record<ManagerConfigurablePermission, boolean> = {
  'profile.edit': false,
  'members.manage': false,
  'campaigns.manage': true,
  'activities.manage': true,
  'activities.approve': false,
  'ai.use': true,
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'company.view': 'Ver empresa',
  'profile.edit': 'Editar diagnóstico estratégico',
  'members.manage': 'Gerenciar equipe',
  'campaigns.manage': 'Gerenciar campanhas',
  'activities.manage': 'Criar e editar atividades',
  'activities.approve': 'Aprovar atividades',
  'activities.view_all': 'Ver todas as atividades',
  'activities.execute': 'Executar tarefas atribuídas',
  'ai.use': 'Usar a inteligência artificial',
  'messaging.view': 'Ver mensagens do WhatsApp',
  'messaging.manage': 'Gerenciar automações do WhatsApp',
  'audit.view': 'Ver auditoria',
};

const BASE_BY_ROLE: Record<MemberRole, readonly Permission[]> = {
  owner: [
    'company.view',
    'profile.edit',
    'members.manage',
    'campaigns.manage',
    'activities.manage',
    'activities.approve',
    'activities.view_all',
    'activities.execute',
    'ai.use',
    'messaging.view',
    'audit.view',
  ],
  manager: ['company.view', 'activities.view_all', 'activities.execute', 'messaging.view'],
  collaborator: ['company.view', 'activities.execute'],
};

export interface Membership {
  companyId: string;
  role: MemberRole;
  permissions: Partial<Record<string, boolean>>;
  active: boolean;
}

export interface Actor {
  userId: string;
  isFavisAdmin: boolean;
  memberships: Membership[];
}

export function permissionsForMembership(m: Pick<Membership, 'role' | 'permissions'>): Set<Permission> {
  const set = new Set<Permission>(BASE_BY_ROLE[m.role]);
  if (m.role === 'manager') {
    for (const p of MANAGER_CONFIGURABLE_PERMISSIONS) {
      const value = m.permissions[p];
      if (value ?? MANAGER_DEFAULTS[p]) set.add(p);
    }
  }
  return set;
}

export function companyPermissions(actor: Actor, companyId: string): Set<Permission> {
  if (actor.isFavisAdmin) return new Set(PERMISSIONS);
  const m = actor.memberships.find((x) => x.companyId === companyId && x.active);
  return m ? permissionsForMembership(m) : new Set();
}

export function can(actor: Actor, companyId: string, permission: Permission): boolean {
  return companyPermissions(actor, companyId).has(permission);
}

export function roleOf(actor: Actor, companyId: string): MemberRole | null {
  return actor.memberships.find((x) => x.companyId === companyId && x.active)?.role ?? null;
}

/** Quais papéis o ator pode atribuir/gerenciar numa empresa (espelha app.can_manage_member_role). */
export function manageableRoles(actor: Actor, companyId: string): MemberRole[] {
  if (actor.isFavisAdmin) return ['owner', 'manager', 'collaborator'];
  if (!can(actor, companyId, 'members.manage')) return [];
  const role = roleOf(actor, companyId);
  if (role === 'owner') return ['manager', 'collaborator'];
  if (role === 'manager') return ['collaborator'];
  return [];
}
