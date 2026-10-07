import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './database.js';

/**
 * Runner de migrações SQL versionadas.
 *
 * Regras:
 * - Arquivos: migrations/NNNN_nome.sql (ordem alfabética = ordem de aplicação).
 * - Cada arquivo é aplicado UMA vez, dentro de transação, com checksum SHA-256.
 * - Se um arquivo já aplicado foi alterado, a aplicação FALHA (drift detectado).
 * - Nunca roda silenciosamente em produção: quem executa decide (aprovação).
 */

export interface MigrationRecord {
  version: string;
  name: string;
  checksum: string;
  applied_at: string;
}

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
);`;

export function migrationsDir(): string {
  // src/db (dev) e dist/db (build) têm a mesma profundidade em apps/api:
  //   <raiz>/apps/api/{src,dist}/db  -> sobe 4 níveis até a raiz do workspace.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..', 'migrations');
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export function readMigrationFiles(dir: string = migrationsDir()): MigrationFile[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Diretório de migrações não encontrado: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const migrations = files.map((file) => {
    const match = /^(\d{4})_(.+)\.sql$/.exec(file);
    if (!match) {
      throw new Error(`Nome de migração inválido: ${file} (esperado NNNN_nome.sql)`);
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    return {
      version: match[1] as string,
      name: match[2] as string,
      file,
      sql,
      checksum: sha256(sql),
    };
  });

  // Duas migrações com a mesma versão (ex.: 0001_a.sql + 0001_b.sql) virariam
  // PK duplicada com erro confuso — detectado aqui, com mensagem clara.
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(
        `Versão de migração duplicada: ${migration.version} (${migration.file}). ` +
          'Cada arquivo deve ter um NNNN único.',
      );
    }
    seen.add(migration.version);
  }
  return migrations;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Aplica migrações pendentes. Idempotente: segunda execução não altera nada.
 * Lança erro se uma migração já aplicada foi modificada (checksum divergente).
 */
export function runMigrations(db: Db, dir: string = migrationsDir()): MigrateResult {
  db.exec(MIGRATIONS_TABLE);

  const applied = new Map<string, MigrationRecord>();
  const rows = db
    .prepare<[], MigrationRecord>(
      'SELECT version, name, checksum, applied_at FROM schema_migrations',
    )
    .all();
  for (const row of rows) applied.set(row.version, row);

  const result: MigrateResult = { applied: [], alreadyApplied: [] };
  const files = readMigrationFiles(dir);

  // Drift por REMOÇÃO: migração aplicada que sumiu do diretório nunca pode
  // passar em silêncio (o histórico do banco é imutável).
  const fileVersions = new Set(files.map((file) => file.version));
  const orphaned = [...applied.keys()].filter((version) => !fileVersions.has(version));
  if (orphaned.length > 0) {
    throw new Error(
      `Drift de migração: aplicada(s) no banco mas ausente(s) em ${dir}: ${orphaned.join(', ')}.\n` +
        'Restaure o arquivo original; o histórico aplicado não pode sumir.',
    );
  }

  for (const migration of files) {
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `Migração já aplicada foi alterada: ${migration.file}\n` +
            `  checksum registrado: ${existing.checksum}\n` +
            `  checksum atual:      ${migration.checksum}\n` +
            'Crie uma nova migração em vez de editar o histórico.',
        );
      }
      result.alreadyApplied.push(migration.file);
      continue;
    }

    // Transação IMEDIATA + recheck dentro dela: se o CLI e o servidor rodarem ao
    // mesmo tempo, o segundo processo enxerga a migração já aplicada e pula,
    // em vez de morrer em "table already exists".
    const apply = db.transaction((): 'applied' | 'raced' => {
      const row = db
        .prepare<[string], { checksum: string }>(
          'SELECT checksum FROM schema_migrations WHERE version = ?',
        )
        .get(migration.version);
      if (row) {
        if (row.checksum !== migration.checksum) {
          throw new Error('checksum divergente após corrida entre processos');
        }
        return 'raced';
      }
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO schema_migrations (version, name, checksum, applied_at)
         VALUES (?, ?, ?, ?)`,
      ).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
      return 'applied';
    });

    try {
      if (apply.immediate() === 'raced') {
        result.alreadyApplied.push(migration.file);
        continue;
      }
    } catch (error) {
      throw new Error(
        `Falha ao aplicar migração ${migration.file}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    result.applied.push(migration.file);
  }

  return result;
}

/** Quantidade de migrações já aplicadas (usada no /api/health). */
export function countMigrations(db: Db): number {
  const table = db
    .prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();
  if (!table || table.n === 0) return 0;
  const row = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_migrations').get();
  return row?.n ?? 0;
}
