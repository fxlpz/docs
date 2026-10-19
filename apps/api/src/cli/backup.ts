import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { buildDataPaths, resolveDataDir } from '../config/paths.js';
import { findWorkspaceRoot } from '../config/workspace.js';
import { closeDatabase, openDatabase } from '../db/database.js';
import { BACKUP_KEEP_DEFAULT, createBackup, defaultBackupDir } from '../services/backup.js';

/**
 * CLI de backup: npm run backup
 *
 * Gera `.tar.gz` com banco (cópia online consistente) + anexos + manifesto,
 * em BACKUP_DIR (padrão: ~/.local/share/krndocs-backups), mantendo os
 * BACKUP_KEEP mais recentes (padrão 7). Pode rodar com o servidor no ar.
 */
function readAppVersion(root: string): string {
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
  const backupDir = process.env.BACKUP_DIR?.trim() || defaultBackupDir();
  const keep = Number(process.env.BACKUP_KEEP) || BACKUP_KEEP_DEFAULT;

  const env = loadEnv();
  const root = findWorkspaceRoot();
  const paths = buildDataPaths(resolveDataDir(env, root));
  const db = openDatabase(paths.databaseFile);

  try {
    const result = await createBackup(db, paths, {
      backupDir,
      keep,
      appVersion: readAppVersion(root),
    });
    console.log(`Backup criado: ${result.file}`);
    console.log(`Migrações no banco: ${result.migrations}`);
    for (const removed of result.rotated) console.log(`Rotação: removido ${removed}`);
  } finally {
    closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
