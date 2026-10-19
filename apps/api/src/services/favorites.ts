import { ERROR_CODES, type FavoriteItem } from '@krndocs/shared';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { logActivity } from './activity.js';

/**
 * Favoritos individuais por usuário.
 *
 * Sem visibilidade restrita por pasta no MVP: qualquer sessão válida pode
 * favoritar qualquer nó ativo (a autorização é "estar autenticado").
 */

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Item não encontrado.');
}

export function listFavorites(db: Db, userId: string): FavoriteItem[] {
  const rows = db
    .prepare<
      [string],
      { node_id: string; title: string; type: 'folder' | 'page'; position: number }
    >(
      `SELECT f.node_id, n.title, n.type, f.position
         FROM favorites f
         JOIN nodes n ON n.id = f.node_id
        WHERE f.user_id = ? AND n.deleted_at IS NULL
        ORDER BY f.position, n.title`,
    )
    .all(userId);
  return rows.map((row) => ({
    nodeId: row.node_id,
    title: row.title,
    type: row.type,
    position: row.position,
  }));
}

/** Adiciona aos favoritos (idempotente: repetir não duplica nem falha). */
export function addFavorite(db: Db, userId: string, nodeId: string): FavoriteItem {
  const node = db
    .prepare<[string], { id: string; title: string; type: 'folder' | 'page' }>(
      `SELECT id, title, type FROM nodes WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(nodeId);
  if (!node) throw notFound();

  const existing = db
    .prepare<[string, string], { position: number }>(
      `SELECT position FROM favorites WHERE user_id = ? AND node_id = ?`,
    )
    .get(userId, nodeId);
  if (existing) {
    return { nodeId, title: node.title, type: node.type, position: existing.position };
  }

  const positionRow = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM favorites WHERE user_id = ?`,
    )
    .get(userId);

  db.prepare(
    `INSERT INTO favorites (user_id, node_id, position, created_at) VALUES (?, ?, ?, ?)`,
  ).run(userId, nodeId, positionRow?.next ?? 0, new Date().toISOString());

  logActivity(db, {
    actorId: userId,
    action: 'favorite.add',
    entityType: 'node',
    entityId: nodeId,
    summary: node.title,
  });

  return { nodeId, title: node.title, type: node.type, position: positionRow?.next ?? 0 };
}

/** Remove dos favoritos (idempotente: ausente não falha). */
export function removeFavorite(db: Db, userId: string, nodeId: string): void {
  db.prepare(`DELETE FROM favorites WHERE user_id = ? AND node_id = ?`).run(userId, nodeId);
}
