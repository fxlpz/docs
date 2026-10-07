import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Abre (ou cria) o banco SQLite com os pragmas exigidos pela aplicação.
 *
 * - WAL: leitores não bloqueiam o escritor (importante para 2 editores).
 * - foreign_keys: integridade referencial REAL (o SQLite desliga por padrão).
 * - busy_timeout: espera em vez de falhar quando houver outra escrita.
 *
 * O banco é sempre aberto em arquivo (nunca ":memory:"), em DATA_DIR,
 * separado do código e dos dados reais de teste.
 */
export function openDatabase(databaseFile: string): Db {
  // Diretório de dados restrito ao dono (0700); só vale na criação (mascarado
  // pelo umask) — o caso pré-existente é ajustado por chmod na implantação.
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true, mode: 0o700 });
  // Pré-cria o banco com 0600 para que nem o SQLite recrie com permissão aberta.
  if (!fs.existsSync(databaseFile)) {
    const fd = fs.openSync(databaseFile, 'wx', 0o600);
    fs.closeSync(fd);
  }
  const db = new Database(databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  hardenPermissions(databaseFile);
  return db;
}

/**
 * Restringe banco e arquivos derivados (WAL/SHM) ao dono (0600).
 * Em plataformas sem chmod equivalente (Windows), ignora silenciosamente.
 */
function hardenPermissions(databaseFile: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${databaseFile}${suffix}`;
    try {
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    } catch {
      // melhor esforço: em FS sem suporte, vale a permissão herdada do diretório
    }
  }
}

/** Fecha a conexão de forma limpa (checkpoint do WAL). */
export function closeDatabase(db: Db): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}
