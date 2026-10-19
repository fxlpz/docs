import { ERROR_CODES, type Visibility } from '@krndocs/shared';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { logActivity } from './activity.js';

/**
 * Visibilidade pública/privada por nó (landing pública).
 *
 * - Só admin altera (a rota usa `requireAdmin`; aqui chega o actorId).
 * - `cascade=true` aplica à subárvore inteira em transação.
 * - Leitura respeita ancestralidade em `services/public.ts` — aqui só grava.
 */

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Item não encontrado.');
}

export function setVisibility(
  db: Db,
  actorId: string,
  nodeId: string,
  visibility: Visibility,
  cascade: boolean,
): { updated: number } {
  const node = db
    .prepare<[string], { id: string; title: string }>(
      `SELECT id, title FROM nodes WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(nodeId);
  if (!node) throw notFound();

  const now = new Date().toISOString();
  let updated = 0;
  const apply = db.transaction(() => {
    if (cascade) {
      // Ordem dos parâmetros segue a ordem textual dos `?`: primeiro o da CTE.
      const result = db
        .prepare(
          `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
         )
         UPDATE nodes SET visibility = ?, updated_at = ?, updated_by = ?
          WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL`,
        )
        .run(nodeId, visibility, now, actorId);
      updated = Number(result.changes);
    } else {
      db.prepare(
        `UPDATE nodes SET visibility = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      ).run(visibility, now, actorId, nodeId);
      updated = 1;
    }
  });
  apply();
  if (updated === 0) {
    // O nó existia na checagem acima: zero linhas tocadas é bug interno, não 200.
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Erro interno. Tente novamente.');
  }

  logActivity(db, {
    actorId,
    action: visibility === 'public' ? 'node.publish' : 'node.unpublish',
    entityType: 'node',
    entityId: nodeId,
    summary: node.title,
    metadata: cascade ? 'cascade' : null,
  });

  return { updated };
}
