import path from 'node:path';
import type { Env } from './env.js';

/**
 * Resolve os caminhos de dados a partir de DATA_DIR.
 *
 * - Caminho absoluto: usado como está (recomendado em produção, fora do código).
 * - Caminho relativo: resolvido contra a raiz do workspace (não contra cwd),
 *   para que o comportamento não mude conforme o diretório de execução.
 */
export function resolveDataDir(env: Env, workspaceRoot: string): string {
  return path.isAbsolute(env.DATA_DIR)
    ? path.normalize(env.DATA_DIR)
    : path.resolve(workspaceRoot, env.DATA_DIR);
}

export interface DataPaths {
  /** Raiz dos dados (DATA_DIR) */
  root: string;
  /** Arquivo do banco SQLite */
  databaseFile: string;
  /** Raiz de armazenamento de anexos */
  attachmentsDir: string;
}

export function buildDataPaths(dataDir: string): DataPaths {
  const root = path.normalize(dataDir);
  return {
    root,
    databaseFile: path.join(root, 'app.db'),
    attachmentsDir: path.join(root, 'attachments'),
  };
}
