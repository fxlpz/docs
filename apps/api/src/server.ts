import fs from 'node:fs';
import path from 'node:path';
import { type AppContext, buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { buildDataPaths, resolveDataDir } from './config/paths.js';
import { findWorkspaceRoot } from './config/workspace.js';
import { closeDatabase, openDatabase } from './db/database.js';
import { runMigrations } from './db/migrate.js';
import { seedDefaultTemplates } from './services/defaultTemplates.js';

function readVersion(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const root = findWorkspaceRoot();
  const paths = buildDataPaths(resolveDataDir(env, root));
  const db = openDatabase(paths.databaseFile);

  // Migrações pendentes aplicadas apenas fora de produção (produção usa CLI com --apply).
  if (env.NODE_ENV !== 'production') {
    const result = runMigrations(db);
    if (result.applied.length > 0) {
      console.log(`[migrations] aplicadas: ${result.applied.join(', ')}`);
    }
  }

  // Modelos padrão: criados UMA única vez (marcado em `settings`); apagá-los
  // depois não faz eles voltarem. Falha aqui nunca derruba a inicialização.
  try {
    const seeded = seedDefaultTemplates(db);
    if (seeded > 0) console.log(`[templates] ${seeded} modelos padrão criados/atualizados`);
  } catch (error) {
    console.error('[templates] falha ao criar modelos padrão:', error);
  }

  const ctx: AppContext = {
    env,
    paths,
    db,
    version: readVersion(root),
    // Front pronto para produção (SERVE_STATIC/produção); inexistente em dev puro.
    webDistDir: path.join(root, 'apps', 'web', 'dist'),
  };

  const app = await buildApp(ctx);

  // Guard de reentrada: dois sinais seguidos não fecham duas vezes (SAIGB/código 1).
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'encerrando');
    try {
      await app.close();
      closeDatabase(db);
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
  console.log(`API em http://${env.HOST}:${env.PORT} (env=${env.NODE_ENV})`);
  console.log(`Dados em ${paths.root}`);
}

// Rejeições não tratadas são sempre logadas e encerram com falha (nunca em silêncio).
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  process.exit(1);
});

// Exceções não tratadas: mesmo comportamento (log + falha explícita).
process.on('uncaughtException', (error) => {
  console.error('uncaughtException:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
