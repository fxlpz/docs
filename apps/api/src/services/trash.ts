import fs from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, type NodeSummary, type TrashItem } from '@krndocs/shared';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { logActivity } from './activity.js';

/**
 * Lixeira (Etapa 3).
 *
 * - Lista tudo com `deleted_at` (plano; a UI agrupa por subárvore).
 * - Restaurar um item restaura também os ANCESTRAIS (sem isso o item
 *   continuaria invisível sob um pai excluído).
 * - Exclusão definitiva é FÍSICA (`DELETE`, com cascata do schema para
 *   versões/anexos/favoritos) + remoção dos arquivos de anexo do disco.
 *   Só executa com confirmação explícita (a rota exige `?confirm=true`).
 */

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Item não encontrado.');
}

export function listTrash(db: Db): TrashItem[] {
  const rows = db
    .prepare<
      [],
      {
        id: string;
        type: 'folder' | 'page';
        parent_id: string | null;
        title: string;
        icon: string | null;
        position: number;
        visibility: 'private' | 'public';
        updated_at: string;
        deleted_at: string;
      }
    >(
      `SELECT id, type, parent_id, title, icon, position, visibility, updated_at, deleted_at
         FROM nodes
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC`,
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
    visibility: row.visibility,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }));
}

/** Restaura o item + subárvore + ancestrais (para voltar a ser visível). */
export function restoreNode(db: Db, actorId: string, id: string): NodeSummary {
  const row = db
    .prepare<
      [string],
      {
        id: string;
        type: 'folder' | 'page';
        parent_id: string | null;
        title: string;
        icon: string | null;
        position: number;
        visibility: 'private' | 'public';
        updated_at: string;
        deleted_at: string | null;
      }
    >(
      `SELECT id, type, parent_id, title, icon, position, visibility, updated_at, deleted_at
         FROM nodes WHERE id = ?`,
    )
    .get(id);
  if (!row) throw notFound();
  if (!row.deleted_at) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Este item não está na lixeira.');
  }

  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    // Ancestrais primeiro (cadeia até a raiz), depois a subárvore inteira.
    let cursor: string | null = row.parent_id;
    for (let depth = 0; cursor && depth < 1000; depth += 1) {
      db.prepare(
        `UPDATE nodes SET deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?`,
      ).run(now, actorId, cursor);
      const parent = db
        .prepare<[string], { parent_id: string | null }>(`SELECT parent_id FROM nodes WHERE id = ?`)
        .get(cursor);
      cursor = parent?.parent_id ?? null;
    }
    db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
       )
       UPDATE nodes
          SET deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ?
        WHERE id IN (SELECT id FROM subtree)`,
    ).run(id, now, actorId);
  });
  apply();

  logActivity(db, {
    actorId,
    action: row.type === 'folder' ? 'folder.restore' : 'page.restore',
    entityType: 'node',
    entityId: id,
    summary: row.title,
  });

  return {
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
    visibility: row.visibility,
    updatedAt: now,
  };
}

/**
 * Exclusão definitiva da subárvore: apaga metadados (cascata) e os arquivos
 * de anexo do disco. Irreversível — a confirmação é validada na rota.
 */
export function permanentlyDeleteNode(
  db: Db,
  actorId: string,
  attachmentsDir: string,
  id: string,
): void {
  const row = db
    .prepare<[string], { id: string; type: string; title: string; deleted_at: string | null }>(
      `SELECT id, type, title, deleted_at FROM nodes WHERE id = ?`,
    )
    .get(id);
  if (!row) throw notFound();
  if (!row.deleted_at) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      'Só é possível excluir definitivamente itens da lixeira.',
    );
  }

  // Chaves de anexo da subárvore ANTES do DELETE físico (cascata apagaria o rastro).
  const keys = db
    .prepare<[string], { storage_key: string }>(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
       )
       SELECT a.storage_key FROM attachments a WHERE a.node_id IN (SELECT id FROM subtree)`,
    )
    .all(id);

  const apply = db.transaction(() => {
    db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
       )
       DELETE FROM nodes WHERE id IN (SELECT id FROM subtree)`,
    ).run(id);
  });
  apply();

  for (const { storage_key } of keys) {
    try {
      fs.rmSync(path.join(attachmentsDir, storage_key), { force: true });
    } catch {
      // Arquivo já ausente: metadados foram apagados, nada a fazer.
    }
  }

  logActivity(db, {
    actorId,
    action: row.type === 'folder' ? 'folder.purge' : 'page.purge',
    entityType: 'node',
    entityId: id,
    summary: row.title,
  });
}
