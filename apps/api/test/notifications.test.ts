import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, client, createAdmin, createTestApp, login, todayIn, type TestContext } from './helpers';

let ctx: TestContext;
let owner: ReturnType<typeof client>;
let manager: ReturnType<typeof client>;
let collab: ReturnType<typeof client>;
let outsider: ReturnType<typeof client>;
let companyId: string;
let collabId: string;
const day = addDays(todayIn(), 2);

type Notif = { id: string; kind: string; title: string; body: string; activityId: string | null; readAt: string | null };
const inbox = async (c: ReturnType<typeof client>) => (await c.get('/me/notifications')).body as { unread: number; items: Notif[] };

beforeAll(async () => {
  ctx = await createTestApp();
  const a = await createAdmin(ctx);
  const admin = client(ctx, (await login(ctx, a.email, a.password)).token);
  companyId = (await admin.post('/companies', { name: 'Empresa Avisos' })).body.id;
  const add = async (email: string, role: string, name: string) => {
    const r = await admin.post(`/companies/${companyId}/members`, { email, fullName: name, role, password: 'senha-avisos-123' });
    return { id: r.body.userId as string, c: client(ctx, (await login(ctx, email, 'senha-avisos-123')).token) };
  };
  owner = (await add('dono@avisos.dev', 'owner', 'Dona Avisos')).c;
  manager = (await add('gerente@avisos.dev', 'manager', 'Gerente Avisos')).c;
  const col = await add('colab@avisos.dev', 'collaborator', 'Colab Avisos');
  collab = col.c;
  collabId = col.id;

  const other = (await admin.post('/companies', { name: 'Outra Avisos' })).body.id;
  await admin.post(`/companies/${other}/members`, { email: 'fora@avisos.dev', fullName: 'Fora', role: 'owner', password: 'senha-avisos-123' });
  outsider = client(ctx, (await login(ctx, 'fora@avisos.dev', 'senha-avisos-123')).token);
});
afterAll(async () => ctx?.close());

describe('notificações no app', () => {
  let assignedId: string;

  it('colaborador é avisado ao receber uma tarefa; quem atribuiu não é', async () => {
    const r = await owner.post(`/companies/${companyId}/activities`, {
      title: 'Bastidores da cozinha',
      scheduledDate: day,
      scheduledTime: '10:00',
      pillar: 'bastidores',
      assigneeId: collabId,
    });
    assignedId = r.body.id;
    const box = await inbox(collab);
    expect(box.unread).toBe(1);
    expect(box.items[0]).toMatchObject({ kind: 'tarefa_atribuida', title: 'Nova tarefa: Bastidores da cozinha', activityId: assignedId });
    expect(box.items[0]!.body).toContain('às 10:00');
    expect((await inbox(owner)).unread).toBe(0);
  });

  it('várias pendências de aprovação geram UM aviso agrupado e atualizado', async () => {
    for (const t of ['Depoimento 1', 'Depoimento 2', 'Depoimento 3']) {
      await manager.post(`/companies/${companyId}/activities`, {
        title: t,
        scheduledDate: day,
        pillar: 'prova_social',
        status: 'pendente_aprovacao',
        assigneeId: collabId,
      });
    }
    const ownerBox = await inbox(owner);
    const pending = ownerBox.items.filter((n) => n.kind === 'aprovacao_pendente');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.title).toBe('3 atividades aguardando aprovação');
    // Quem criou (gerente) não recebe; o colaborador não é avisado de tarefa ainda não aprovada
    expect((await inbox(manager)).items.some((n) => n.kind === 'aprovacao_pendente')).toBe(false);
    expect((await inbox(collab)).unread).toBe(1);
  });

  it('colaborador é avisado quando a tarefa é aprovada', async () => {
    const list = await owner.get(`/companies/${companyId}/activities?from=${day}&to=${day}&status=pendente_aprovacao`);
    const first = list.body[0];
    await owner.post(`/companies/${companyId}/activities/${first.id}/status`, { status: 'aprovada' });
    const box = await inbox(collab);
    expect(box.items[0]).toMatchObject({ kind: 'tarefa_aprovada', activityId: first.id });
  });

  it('dificuldade avisa proprietário e gerente, com o motivo informado', async () => {
    const r = await collab.post(`/companies/${companyId}/activities/${assignedId}/status`, {
      status: 'impedida',
      message: 'A cozinha estava em reforma',
    });
    expect(r.status).toBe(200);
    for (const c of [owner, manager]) {
      const n = (await inbox(c)).items.find((x) => x.kind === 'tarefa_impedida')!;
      expect(n).toMatchObject({ title: 'Dificuldade em: Bastidores da cozinha', body: 'A cozinha estava em reforma', activityId: assignedId });
    }
    expect((await inbox(collab)).items.some((n) => n.kind === 'tarefa_impedida')).toBe(false);
  });

  it('cada um vê apenas as próprias notificações e só marca as próprias como lidas', async () => {
    expect((await inbox(outsider)).items).toHaveLength(0);
    const ownerItems = (await inbox(owner)).items;
    const stolen = await collab.post('/me/notifications/read', { ids: ownerItems.map((n) => n.id) });
    expect(stolen.body.updated).toBe(0);
    expect((await inbox(owner)).unread).toBe(ownerItems.length);
  });

  it('marca como lidas (algumas ou todas); nova pendência após a leitura gera novo aviso', async () => {
    const box = await inbox(owner);
    const one = await owner.post('/me/notifications/read', { ids: [box.items[0]!.id] });
    expect(one.body.updated).toBe(1);
    expect((await inbox(owner)).unread).toBe(box.unread - 1);
    await owner.post('/me/notifications/read', {});
    expect((await inbox(owner)).unread).toBe(0);

    await manager.post(`/companies/${companyId}/activities`, {
      title: 'Depoimento 4',
      scheduledDate: day,
      pillar: 'prova_social',
      status: 'pendente_aprovacao',
    });
    const after = await inbox(owner);
    expect(after.unread).toBe(1);
    expect(after.items[0]!.title).toBe('3 atividades aguardando aprovação');
  });

  it('o usuário não altera outros campos da notificação', async () => {
    const id = (await inbox(owner)).items[0]!.id;
    await expect(
      ctx.deps.db.asUser({ sub: (await owner.get('/auth/me')).body.id, role: 'authenticated' }, (tx) =>
        tx.query(`update notifications set title = 'hack' where id = $1`, [id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
