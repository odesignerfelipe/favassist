import { loadConfig } from '../config';
import { Database } from '../db/database';
import { createAuthProvider } from '../auth/provider';

/**
 * Cria (ou promove) o primeiro Administrador FAVIS.
 * Uso: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm db:seed:admin
 */
const cfg = loadConfig();
const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? '';
const name = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador FAVIS';
if (!email || password.length < 10) {
  console.error('Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (mínimo 10 caracteres).');
  process.exit(1);
}
const db = new Database(cfg.DATABASE_URL, { ssl: cfg.DATABASE_SSL });
const auth = createAuthProvider(cfg, db);
try {
  const existing = await db.asService((tx) => tx.query('select id from profiles where lower(email) = $1', [email]));
  let id: string = existing.rows[0]?.id;
  if (id) {
    console.log('Usuário já existe; garantindo papel de administrador.');
  } else {
    id = await auth.createUser({ email, password, fullName: name });
    console.log(`Usuário criado: ${email}`);
  }
  await db.asService((tx) =>
    tx.query(`update profiles set platform_role = 'favis_admin', active = true where id = $1`, [id]),
  );
  console.log('Administrador FAVIS pronto.');
} finally {
  await db.close();
}
