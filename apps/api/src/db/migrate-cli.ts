import { loadEnv } from '../config/env.js';
import { buildDataPaths, resolveDataDir } from '../config/paths.js';
import { findWorkspaceRoot } from '../config/workspace.js';
import { closeDatabase, openDatabase } from './database.js';
import { runMigrations } from './migrate.js';

/**
 * CLI de migrações: npm run migrate
 *
 * - Em desenvolvimento/teste aplica migrações pendentes automaticamente.
 * - Em produção (NODE_ENV=production) exige o flag explícito --apply,
 *   garantindo que nenhuma migração rode sem aprovação humana.
 */
function main(): void {
  const args = process.argv.slice(2);
  const isProduction = process.env.NODE_ENV === 'production';
  const applyRequested = args.includes('--apply');

  if (isProduction && !applyRequested) {
    console.error(
      'NODE_ENV=production: migração BLOQUEADA sem aprovação.\n' +
        'Revise as migrações pendentes e execute:\n' +
        '  npm run migrate -- --apply',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const root = findWorkspaceRoot();
  const paths = buildDataPaths(resolveDataDir(env, root));
  const db = openDatabase(paths.databaseFile);

  try {
    const result = runMigrations(db);
    if (result.applied.length === 0) {
      console.log(`Banco em dia: ${result.alreadyApplied.length} migração(ões) já aplicadas.`);
    } else {
      console.log('Migrações aplicadas:');
      for (const file of result.applied) console.log(`  + ${file}`);
      console.log(`Total já aplicadas antes: ${result.alreadyApplied.length}`);
    }
    console.log(`Banco: ${paths.databaseFile}`);
  } finally {
    closeDatabase(db);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
