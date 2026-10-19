import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { DataPaths } from '../config/paths.js';
import type { Db } from '../db/database.js';
import { countMigrations } from '../db/migrate.js';

/**
 * Backup e restauração do estado (`var/`: SQLite + anexos).
 *
 * - Backup: cópia consistente via `db.backup()` (online, inclui WAL) +
 *   `attachments/` + `manifest.json`, tudo em um `.tar.gz` com rotação.
 * - Restore: valida o arquivo (manifesto + `integrity_check` em cópia
 *   temporária) e troca o DATA_DIR, guardando o anterior como fallback.
 * - Nenhuma das funções fala com a rede nem loga segredos; caminhos de
 *   fora do backup nunca são tocados sem confirmação do CLI.
 */

export const BACKUP_KEEP_DEFAULT = 7;

export function defaultBackupDir(): string {
  return path.join(homedir(), '.local', 'share', 'krndocs-backups');
}

export interface BackupManifest {
  tool: 'krndocs-backup';
  version: 1;
  appVersion: string;
  createdAt: string;
  migrations: number;
  databaseFile: 'app.db';
  attachmentsDir: 'attachments' | null;
  avatarsDir: 'avatars' | null;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  // YYYYMMDD-HHMMSS em UTC
}

function listArchives(backupDir: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((file) => file.startsWith('krndocs-') && file.endsWith('.tar.gz'))
    .sort();
}

/** Apaga os mais antigos além de `keep`. Devolve os removidos. */
export function rotateBackups(backupDir: string, keep: number): string[] {
  const archives = listArchives(backupDir);
  const excess = archives.slice(0, Math.max(archives.length - keep, 0));
  for (const file of excess) {
    fs.rmSync(path.join(backupDir, file), { force: true });
  }
  return excess;
}

export interface CreatedBackup {
  file: string;
  migrations: number;
  rotated: string[];
}

export async function createBackup(
  db: Db,
  paths: DataPaths,
  options: { backupDir: string; keep?: number; appVersion?: string },
): Promise<CreatedBackup> {
  const keep = options.keep ?? BACKUP_KEEP_DEFAULT;
  fs.mkdirSync(options.backupDir, { recursive: true, mode: 0o700 });

  const stage = fs.mkdtempSync(path.join(options.backupDir, '.stage-'));
  try {
    // Cópia online consistente (WAL incluído pelo próprio SQLite).
    await db.backup(path.join(stage, 'app.db'));

    let attachmentsDir: BackupManifest['attachmentsDir'] = null;
    if (fs.existsSync(paths.attachmentsDir)) {
      fs.cpSync(paths.attachmentsDir, path.join(stage, 'attachments'), { recursive: true });
      attachmentsDir = 'attachments';
    }

    let avatarsDir: BackupManifest['avatarsDir'] = null;
    if (fs.existsSync(paths.avatarsDir)) {
      fs.cpSync(paths.avatarsDir, path.join(stage, 'avatars'), { recursive: true });
      avatarsDir = 'avatars';
    }

    const manifest: BackupManifest = {
      tool: 'krndocs-backup',
      version: 1,
      appVersion: options.appVersion ?? '0.0.0',
      createdAt: new Date().toISOString(),
      migrations: countMigrations(db),
      databaseFile: 'app.db',
      attachmentsDir,
      avatarsDir,
    };
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const file = path.join(options.backupDir, `krndocs-${timestamp()}.tar.gz`);
    execFileSync('tar', [
      '-czf',
      file,
      '-C',
      stage,
      'app.db',
      'manifest.json',
      ...(attachmentsDir ? [attachmentsDir] : []),
      ...(avatarsDir ? [avatarsDir] : []),
    ]);
    fs.chmodSync(file, 0o600);

    const rotated = rotateBackups(options.backupDir, keep);
    return { file, migrations: manifest.migrations, rotated };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export interface RestorePlan {
  /** Arquivo validado pronto para entrar no lugar do DATA_DIR. */
  stagedDb: string;
  stagedAttachments: string | null;
  stagedAvatars: string | null;
  manifest: BackupManifest;
  cleanup: () => void;
}

/**
 * Extrai e valida um backup SEM tocar no DATA_DIR atual.
 * O chamador decide a troca (e guarda fallback) após `plan` válido.
 */
export function planRestore(archiveFile: string, workDir: string): RestorePlan {
  const resolved = path.resolve(archiveFile);
  if (!fs.existsSync(resolved) || !resolved.endsWith('.tar.gz')) {
    throw new Error(`Arquivo de backup inválido: ${archiveFile}`);
  }
  const stage = fs.mkdtempSync(path.join(workDir, '.restore-'));
  const cleanup = (): void => {
    fs.rmSync(stage, { recursive: true, force: true });
  };
  try {
    execFileSync('tar', ['-xzf', resolved, '-C', stage]);

    const manifestPath = path.join(stage, 'manifest.json');
    const dbPath = path.join(stage, 'app.db');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(dbPath)) {
      throw new Error('Backup incompleto: faltam manifest.json ou app.db.');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
    if (manifest.tool !== 'krndocs-backup' || manifest.version !== 1) {
      throw new Error('Manifesto desconhecido: não é um backup do KernelDocs.');
    }
    // Integridade do banco em cópia temporária (nunca no DATA_DIR real).
    // O better-sqlite3 abre preguiçoso: qualquer falha (abertura ou leitura)
    // vira rejeição com mensagem normalizada.
    let check: Database.Database | null = null;
    try {
      check = new Database(dbPath, { readonly: true });
      const integrity = check.prepare(`PRAGMA integrity_check`).get() as {
        integrity_check: string;
      };
      if (integrity.integrity_check !== 'ok') {
        throw new Error(`Banco do backup corrompido: ${integrity.integrity_check}`);
      }
      const tables = check
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'schema_migrations'`)
        .get() as { n: number };
      if (tables.n !== 1) {
        throw new Error('Banco do backup sem controle de migrações.');
      }
    } catch (error) {
      if (error instanceof Error && /corrompido|migrações/.test(error.message)) throw error;
      throw new Error('Banco do backup ilegível ou corrompido.');
    } finally {
      check?.close();
    }
    const attachments = path.join(stage, 'attachments');
    const avatars = path.join(stage, 'avatars');
    return {
      stagedDb: dbPath,
      stagedAttachments: fs.existsSync(attachments) ? attachments : null,
      stagedAvatars: fs.existsSync(avatars) ? avatars : null,
      manifest,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Troca o DATA_DIR pelo plano validado. Se já existir conteúdo, ele é
 * guardado como fallback (`<root>.pre-restore-<ts>`) antes da troca.
 * Chamador garante: servidor parado + plano válido.
 */
export function applyRestore(dataDir: string, plan: RestorePlan): { fallbackDir: string | null } {
  const root = path.normalize(dataDir);
  let fallbackDir: string | null = null;
  if (fs.existsSync(root)) {
    fallbackDir = `${root}.pre-restore-${timestamp()}`;
    fs.renameSync(root, fallbackDir);
  }
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.copyFileSync(plan.stagedDb, path.join(root, 'app.db'));
    fs.chmodSync(path.join(root, 'app.db'), 0o600);
    if (plan.stagedAttachments) {
      fs.cpSync(plan.stagedAttachments, path.join(root, 'attachments'), { recursive: true });
    }
    if (plan.stagedAvatars) {
      fs.cpSync(plan.stagedAvatars, path.join(root, 'avatars'), { recursive: true });
    }
  } catch (error) {
    // Troca parcial: tenta voltar o fallback para não perder o estado.
    try {
      fs.rmSync(root, { recursive: true, force: true });
      if (fallbackDir) fs.renameSync(fallbackDir, root);
    } catch {
      // Pior caso: fallback preservado em fallbackDir; erro original prevalece.
    }
    throw error;
  } finally {
    plan.cleanup();
  }
  return { fallbackDir };
}
