import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/db/migrate.ts', 'src/scripts/seed-admin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Pacotes do monorepo são TypeScript puro: entram no bundle
  noExternal: [/^@fav\//],
});
