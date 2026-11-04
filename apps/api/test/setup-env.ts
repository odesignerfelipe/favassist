import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carrega o .env da raiz (se existir) para os testes
const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Defina TEST_DATABASE_URL (banco exclusivo de testes — será apagado).');
}
