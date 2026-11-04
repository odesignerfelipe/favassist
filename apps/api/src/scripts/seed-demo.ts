import { loadConfig } from '../config';
import { Database } from '../db/database';
import { createAuthProvider } from '../auth/provider';

/**
 * Dados de DEMONSTRAÇÃO para desenvolvimento local (nunca em produção).
 * Cria a "Empresa Demonstração" com proprietário e colaborador fictícios, claramente identificados.
 * Não cria métricas: dashboards de métricas permanecem vazios até haver integração real.
 */
const cfg = loadConfig();
if (cfg.NODE_ENV === 'production') {
  console.error('seed:demo é bloqueado em produção.');
  process.exit(1);
}
const db = new Database(cfg.DATABASE_URL);
const auth = createAuthProvider(cfg, db);
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-fav-assist-2026';

async function user(email: string, fullName: string) {
  const r = await db.asService((tx) => tx.query('select id from profiles where email = $1', [email]));
  return (r.rows[0]?.id as string) ?? auth.createUser({ email, password: PASSWORD, fullName });
}

try {
  const owner = await user('proprietario@demo.favassist.dev', 'Paula Proprietária (demo)');
  const collab = await user('colaborador@demo.favassist.dev', 'Caio Colaborador (demo)');
  await db.asService(async (tx) => {
    const c = await tx.query(
      `insert into companies (name, slug, segment) values ('Empresa Demonstração', 'empresa-demonstracao', 'Padaria artesanal (demo)')
       on conflict (slug) do update set name = excluded.name returning id`,
    );
    const companyId = c.rows[0].id;
    await tx.query(
      `insert into company_members (company_id, user_id, role, job_title) values ($1, $2, 'owner', 'Sócia'), ($1, $3, 'collaborator', 'Atendimento')
       on conflict (company_id, user_id) do nothing`,
      [companyId, owner, collab],
    );
    await tx.query(
      `update company_profiles set business_description = 'Empresa fictícia para demonstração do FAV Assist.',
              target_audience = 'Moradores do bairro (dado fictício)', tone_of_voice = 'Próximo e acolhedor',
              business_hours = '[{"weekday":1,"closed":false,"opens":"07:00","closes":"19:00"},{"weekday":7,"closed":true,"opens":null,"closes":null}]'
        where company_id = $1`,
      [companyId],
    );
  });
  console.log(`Dados de demonstração prontos. Senha dos usuários demo: ${PASSWORD}`);
} finally {
  await db.close();
}
