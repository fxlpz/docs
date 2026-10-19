import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDataPaths } from '../config/paths.js';
import { closeDatabase, openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import { applyRestore, createBackup, planRestore, rotateBackups } from '../services/backup.js';

let dataDir: string;
let backupDir: string;
let workDir: string;

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-bkp-'));
  dataDir = path.join(base, 'data');
  backupDir = path.join(base, 'backups');
  workDir = path.join(base, 'work');
  fs.mkdirSync(workDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
});

function seedDb(): void {
  const paths = buildDataPaths(dataDir);
  const db = openDatabase(paths.databaseFile);
  try {
    runMigrations(db);
    db.prepare(
      `INSERT INTO nodes (id, type, title, position, created_at, updated_at) VALUES ('n1', 'page', 'Doc', 0, ?, ?)`,
    ).run('2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
    fs.mkdirSync(paths.attachmentsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.attachmentsDir, 'abc123'), 'conteúdo do anexo');
    fs.mkdirSync(paths.avatarsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.avatarsDir, 'rosto1'), 'bytes-da-foto');
  } finally {
    closeDatabase(db);
  }
}

describe('createBackup', () => {
  it('gera tar.gz com banco + anexos + manifesto, e roda com o banco aberto', async () => {
    seedDb();
    const paths = buildDataPaths(dataDir);
    const db = openDatabase(paths.databaseFile);
    try {
      const result = await createBackup(db, paths, {
        backupDir,
        keep: 7,
        appVersion: '9.9.9-test',
      });
      expect(fs.existsSync(result.file)).toBe(true);
      expect(result.migrations).toBeGreaterThanOrEqual(1);

      const stat = fs.statSync(result.file);
      expect((stat.mode & 0o777).toString(8)).toBe('600');

      const check = JSON.parse(
        execSyncCapture(`tar -xzOf ${quote(result.file)} manifest.json`),
      ) as { tool: string; appVersion: string };
      expect(check.tool).toBe('krndocs-backup');
      expect(check.appVersion).toBe('9.9.9-test');
    } finally {
      closeDatabase(db);
    }
  });

  it('rotação mantém só os N mais recentes', async () => {
    seedDb();
    const paths = buildDataPaths(dataDir);
    const db = openDatabase(paths.databaseFile);
    try {
      for (let i = 0; i < 3; i += 1) {
        await createBackup(db, paths, { backupDir, keep: 2, appVersion: 't' });
        await sleep(1100);
      }
      const remaining = fs.readdirSync(backupDir).filter((f) => f.endsWith('.tar.gz'));
      expect(remaining).toHaveLength(2);
    } finally {
      closeDatabase(db);
    }
  });
});

describe('rotateBackups', () => {
  it('remove os mais antigos além do limite', () => {
    fs.mkdirSync(backupDir, { recursive: true });
    for (const name of [
      'krndocs-20240101-000000.tar.gz',
      'krndocs-20240102-000000.tar.gz',
      'nota.txt',
    ]) {
      fs.writeFileSync(path.join(backupDir, name), 'x');
    }
    const removed = rotateBackups(backupDir, 1);
    expect(removed).toEqual(['krndocs-20240101-000000.tar.gz']);
    expect(fs.existsSync(path.join(backupDir, 'nota.txt'))).toBe(true);
  });
});

describe('restore (round-trip)', () => {
  it('valida, troca o DATA_DIR e preserva fallback', async () => {
    seedDb();
    const paths = buildDataPaths(dataDir);
    const db = openDatabase(paths.databaseFile);
    const archive = (await createBackup(db, paths, { backupDir, keep: 7 })).file;
    closeDatabase(db);

    // Destrói o estado atual para provar que o restore o reconstrói
    fs.rmSync(dataDir, { recursive: true, force: true });

    const plan = planRestore(archive, workDir);
    expect(plan.manifest.tool).toBe('krndocs-backup');
    const { fallbackDir } = applyRestore(dataDir, plan);
    expect(fallbackDir).toBeNull();

    // Estado reconstruído: banco íntegro + anexo de volta
    const restored = new Database(path.join(dataDir, 'app.db'), { readonly: true });
    try {
      const row = restored.prepare(`SELECT title FROM nodes WHERE id = 'n1'`).get() as {
        title: string;
      };
      expect(row.title).toBe('Doc');
    } finally {
      restored.close();
    }
    expect(fs.readFileSync(path.join(dataDir, 'attachments', 'abc123'), 'utf8')).toBe(
      'conteúdo do anexo',
    );
    expect(fs.readFileSync(path.join(dataDir, 'avatars', 'rosto1'), 'utf8')).toBe('bytes-da-foto');
  });

  it('guarda fallback quando já existe estado', async () => {
    seedDb();
    const paths = buildDataPaths(dataDir);
    const db = openDatabase(paths.databaseFile);
    const archive = (await createBackup(db, paths, { backupDir, keep: 7 })).file;
    closeDatabase(db);

    const plan = planRestore(archive, workDir);
    const { fallbackDir } = applyRestore(dataDir, plan);
    expect(fallbackDir).not.toBeNull();
    expect(fs.existsSync(path.join(fallbackDir as string, 'app.db'))).toBe(true);
  });

  it('falha no meio da troca restaura o fallback e relança o erro', () => {
    seedDb();
    const before = fs.readFileSync(path.join(dataDir, 'app.db'));
    const stagedDb = path.join(workDir, 'staged.db');
    fs.copyFileSync(path.join(dataDir, 'app.db'), stagedDb);
    const plan = {
      stagedDb,
      stagedAttachments: path.join(workDir, 'anexos-que-nao-existem'),
      manifest: {
        tool: 'krndocs-backup',
        version: 1,
        appVersion: 't',
        createdAt: new Date().toISOString(),
        migrations: 1,
        databaseFile: 'app.db',
        attachmentsDir: null,
      },
      cleanup: () => {},
    } as never;
    // A cópia dos anexos falha (origem inexistente) após o banco já trocado
    expect(() => applyRestore(dataDir, plan)).toThrow();
    // Estado original intacto após o rollback
    expect(Buffer.compare(fs.readFileSync(path.join(dataDir, 'app.db')), before)).toBe(0);
  });

  it('rejeita arquivo inválido, incompleto e corrompido', async () => {
    expect(() => planRestore(path.join(workDir, 'nao-existe.tar.gz'), workDir)).toThrow();
    const notTar = path.join(workDir, 'nada.tar.gz');
    fs.writeFileSync(notTar, 'isso não é um tar');
    expect(() => planRestore(notTar, workDir)).toThrow();

    seedDb();
    const paths = buildDataPaths(dataDir);
    const db = openDatabase(paths.databaseFile);
    const archive = (await createBackup(db, paths, { backupDir, keep: 7 })).file;
    closeDatabase(db);
    // Corrompe o banco dentro de uma cópia do tar
    const corrupt = path.join(workDir, 'corrupt.tar.gz');
    fs.copyFileSync(archive, corrupt);
    execSyncCapture(`tar -xzf ${quote(corrupt)} -C ${quote(workDir)}`);
    fs.writeFileSync(path.join(workDir, 'app.db'), 'lixo não é sqlite');
    execSyncCapture(`tar -czf ${quote(corrupt)} -C ${quote(workDir)} app.db manifest.json`);
    expect(() => planRestore(corrupt, workDir)).toThrow(/corrompido/i);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function execSyncCapture(command: string): string {
  return execSync(command, { encoding: 'utf8' });
}
