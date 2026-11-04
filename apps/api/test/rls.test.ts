import { ACTIVITY_STATUSES, canTransition, collaboratorCanTransition } from '@fav/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, type Tx } from '../src/db/database';
import { migrate } from '../src/db/migrate';

/**
 * Testes diretos no banco: comprovam o isolamento entre empresas e as regras
 * reforçadas por RLS/triggers, independentemente da API.
 */

const url = process.env.TEST_DATABASE_URL!;
let db: Database;
const ids: Record<string, string> = {};

const claims = (sub: string) => ({ sub, role: 'authenticated' });
const as = <T>(user: string, fn: (tx: Tx) => Promise<T>) => db.asUser(claims(ids[user]!), fn);

async function createUser(key: string, email: string) {
  const r = await db.asService((tx) =>
    tx.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [
      email,
      { full_name: key },
    ]),
  );
  ids[key] = r.rows[0].id;
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  await migrate(url, { localAuth: true, reset: true });
  db = new Database(url, { max: 4 });
  for (const k of ['admin', 'ownerA', 'managerA', 'collabA', 'collabA2', 'ownerB']) {
    await createUser(k, `${k.toLowerCase()}@teste.dev`);
  }
  await db.asService((tx) => tx.query(`update profiles set platform_role = 'favis_admin' where id = $1`, [ids.admin]));

  // Admin cria as empresas (passando pela RLS)
  await as('admin', async (tx) => {
    const a = await tx.query(`insert into companies (name, slug) values ('Empresa A', 'empresa-a') returning id`);
    const b = await tx.query(`insert into companies (name, slug) values ('Empresa B', 'empresa-b') returning id`);
    ids.A = a.rows[0].id;
    ids.B = b.rows[0].id;
    const add = (c: string, u: string, role: string) =>
      tx.query(`insert into company_members (company_id, user_id, role) values ($1, $2, $3)`, [ids[c], ids[u], role]);
    await add('A', 'ownerA', 'owner');
    await add('A', 'managerA', 'manager');
    await add('A', 'collabA', 'collaborator');
    await add('A', 'collabA2', 'collaborator');
    await add('B', 'ownerB', 'owner');
  });
});

afterAll(async () => {
  await db?.close();
});

describe('isolamento entre empresas', () => {
  it('cada proprietário vê apenas a própria empresa', async () => {
    const seenA = await as('ownerA', (tx) => tx.query('select id from companies'));
    expect(seenA.rows.map((r) => r.id)).toEqual([ids.A]);
    const seenB = await as('ownerB', (tx) => tx.query('select id from companies'));
    expect(seenB.rows.map((r) => r.id)).toEqual([ids.B]);
  });

  it('diagnóstico é criado automaticamente e não vaza entre empresas', async () => {
    const rows = await as('ownerB', (tx) => tx.query('select company_id from company_profiles'));
    expect(rows.rows).toEqual([{ company_id: ids.B }]);
  });

  it('não permite gravar dados em outra empresa', async () => {
    await expectPgError(
      as('ownerA', (tx) =>
        tx.query(
          `insert into campaigns (company_id, name, starts_on, ends_on) values ($1, 'Invasão', '2026-11-01', '2026-11-30')`,
          [ids.B],
        ),
      ),
      '42501',
    );
  });

  it('não permite atribuir responsável de outra empresa (FK composta)', async () => {
    await expectPgError(
      as('ownerA', (tx) =>
        tx.query(
          `insert into activities (company_id, title, scheduled_date, pillar, assignee_id)
           values ($1, 'Teste', '2026-11-05', 'bastidores', $2)`,
          [ids.A, ids.ownerB],
        ),
      ),
      '23503',
    );
  });

  it('o papel anon não lê nada', async () => {
    await expectPgError(
      db.asService(async (tx) => {
        await tx.query('set local role anon');
        return tx.query('select * from companies');
      }),
      '42501',
    );
  });

  it('auditoria registra ações com o autor', async () => {
    const r = await db.asService((tx) =>
      tx.query(`select actor_id from audit_logs where entity = 'companies' and action = 'insert' and company_id = $1`, [
        ids.A,
      ]),
    );
    expect(r.rows[0]?.actor_id).toBe(ids.admin);
  });
});

describe('papéis e permissões no banco', () => {
  it('proprietário não cria outro proprietário; gerente só adiciona colaboradores', async () => {
    await createUser('extra', 'extra@teste.dev');
    await expectPgError(
      as('ownerA', (tx) =>
        tx.query(`insert into company_members (company_id, user_id, role) values ($1, $2, 'owner')`, [ids.A, ids.extra]),
      ),
      '42501',
    );
    await expectPgError(
      as('managerA', (tx) =>
        tx.query(`insert into company_members (company_id, user_id, role) values ($1, $2, 'manager')`, [
          ids.A,
          ids.extra,
        ]),
      ),
      '42501',
    );
    const ok = await as('managerA', (tx) =>
      tx.query(`insert into company_members (company_id, user_id, role) values ($1, $2, 'collaborator') returning id`, [
        ids.A,
        ids.extra,
      ]),
    );
    expect(ok.rowCount).toBe(1);
  });

  it('usuário comum não se promove a administrador', async () => {
    await expectPgError(
      as('ownerA', (tx) => tx.query(`update profiles set platform_role = 'favis_admin' where id = $1`, [ids.ownerA])),
      '42501',
    );
  });

  it('colaborador não acessa auditoria nem configurações de WhatsApp', async () => {
    const audit = await as('collabA', (tx) => tx.query('select count(*)::int as n from audit_logs'));
    expect(audit.rows[0].n).toBe(0);
    const groups = await as('collabA', (tx) => tx.query('select count(*)::int as n from whatsapp_groups'));
    expect(groups.rows[0].n).toBe(0);
  });
});

describe('atividades e colaboradores', () => {
  let mine: string;
  let other: string;

  beforeAll(async () => {
    await as('managerA', async (tx) => {
      const r1 = await tx.query(
        `insert into activities (company_id, title, scheduled_date, pillar, assignee_id, status)
         values ($1, 'Bastidores da produção', current_date + 1, 'bastidores', $2, 'aprovada') returning id`,
        [ids.A, ids.collabA],
      );
      const r2 = await tx.query(
        `insert into activities (company_id, title, scheduled_date, pillar, assignee_id)
         values ($1, 'Depoimento de cliente', current_date + 1, 'prova_social', $2) returning id`,
        [ids.A, ids.collabA2],
      );
      mine = r1.rows[0].id;
      other = r2.rows[0].id;
    });
  });

  it('colaborador vê apenas as tarefas atribuídas a ele', async () => {
    const r = await as('collabA', (tx) => tx.query('select id from activities'));
    expect(r.rows.map((x) => x.id)).toEqual([mine]);
  });

  it('colaborador não altera roteiro/título', async () => {
    await expectPgError(
      as('collabA', (tx) => tx.query(`update activities set title = 'Outro título' where id = $1`, [mine])),
      '42501',
    );
  });

  it('colaborador não aprova tarefas', async () => {
    await as('managerA', (tx) => tx.query(`update activities set status = 'pendente_aprovacao' where id = $1`, [other]));
    await expectPgError(
      as('collabA2', (tx) => tx.query(`update activities set status = 'aprovada' where id = $1`, [other])),
      '42501',
    );
  });

  it('transição inválida é bloqueada pelo banco', async () => {
    await expectPgError(
      as('managerA', (tx) => tx.query(`update activities set status = 'concluida' where id = $1`, [other])),
      '22023',
    );
  });

  it('colaborador conclui a própria tarefa, ganha pontos e conquista', async () => {
    await as('collabA', (tx) =>
      tx.query(
        `insert into activity_evidences (company_id, activity_id, kind, url) values ($1, $2, 'link', 'https://instagram.com/p/x')`,
        [ids.A, mine],
      ),
    );
    await as('collabA', (tx) => tx.query(`update activities set status = 'concluida' where id = $1`, [mine]));
    const act = await db.asService((tx) => tx.query('select completed_at, completed_by from activities where id = $1', [mine]));
    expect(act.rows[0].completed_by).toBe(ids.collabA);
    expect(act.rows[0].completed_at).not.toBeNull();

    const pts = await as('ownerA', (tx) =>
      tx.query(`select reason, points from point_events where user_id = $1 order by id`, [ids.collabA]),
    );
    expect(pts.rows).toEqual([
      { reason: 'conclusao', points: 10 },
      { reason: 'evidencia', points: 3 },
      { reason: 'conquista', points: 5 },
    ]);
  });

  it('colaborador de outra empresa não vê evidências', async () => {
    const r = await as('ownerB', (tx) => tx.query('select count(*)::int as n from activity_evidences'));
    expect(r.rows[0].n).toBe(0);
  });
});

describe('máquina de estados: SQL ≡ TypeScript', () => {
  it('as regras são idênticas para todos os pares de status', async () => {
    const rows = await db.asService((tx) =>
      tx.query(
        `select f, t, app.activity_transition_allowed(f, t) as ok, app.collaborator_transition_allowed(f, t) as collab
         from unnest($1::text[]) f cross join unnest($1::text[]) t`,
        [ACTIVITY_STATUSES],
      ),
    );
    expect(rows.rowCount).toBe(ACTIVITY_STATUSES.length ** 2);
    for (const r of rows.rows) {
      expect([r.f, r.t, r.ok]).toEqual([r.f, r.t, canTransition(r.f, r.t)]);
      expect([r.f, r.t, r.collab]).toEqual([r.f, r.t, collaboratorCanTransition(r.f, r.t)]);
    }
  });
});
