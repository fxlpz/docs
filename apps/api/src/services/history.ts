import {
  ERROR_CODES,
  type PageContent,
  type SaveContentResponse,
  type VersionDetail,
  type VersionItem,
} from '@krndocs/shared';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { logActivity } from './activity.js';
import { blocksToPlainText } from './nodes.js';

/**
 * Histórico imutável de versões (`page_versions`).
 *
 * - Leitura: lista + detalhe (para visualizar/comparar na UI).
 * - Restaurar NUNCA reescreve o passado: insere uma NOVA versão
 *   (`source='restore'`) com o conteúdo/título da versão alvo.
 */

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Item não encontrado.');
}

function assertActivePage(db: Db, nodeId: string): void {
  const row = db
    .prepare<[string], { id: string }>(
      `SELECT id FROM nodes WHERE id = ? AND type = 'page' AND deleted_at IS NULL`,
    )
    .get(nodeId);
  if (!row) throw notFound();
}

interface VersionRow {
  version: number;
  title_snapshot: string;
  source: 'autosave' | 'manual' | 'restore' | 'conflict_resolution';
  byte_size: number;
  created_at: string;
  created_by_name: string | null;
  content_json?: string;
}

const VERSION_COLUMNS = `v.version, v.title_snapshot, v.source, v.byte_size, v.created_at, u.display_name AS created_by_name`;

export function listVersions(db: Db, nodeId: string): VersionItem[] {
  assertActivePage(db, nodeId);
  const rows = db
    .prepare<[string], VersionRow>(
      `SELECT ${VERSION_COLUMNS}
         FROM page_versions v
         LEFT JOIN users u ON u.id = v.created_by
        WHERE v.node_id = ?
        ORDER BY v.version DESC`,
    )
    .all(nodeId);
  return rows.map((row) => ({
    version: row.version,
    titleSnapshot: row.title_snapshot,
    source: row.source,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
  }));
}

export function getVersion(db: Db, nodeId: string, version: number): VersionDetail {
  assertActivePage(db, nodeId);
  const row = db
    .prepare<[string, number], VersionRow>(
      `SELECT ${VERSION_COLUMNS}, v.content_json
         FROM page_versions v
         LEFT JOIN users u ON u.id = v.created_by
        WHERE v.node_id = ? AND v.version = ?`,
    )
    .get(nodeId, version);
  if (!row?.content_json) throw notFound();

  let content: PageContent;
  try {
    content = JSON.parse(row.content_json) as PageContent;
  } catch {
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Versão com conteúdo ilegível.');
  }

  return {
    version: row.version,
    titleSnapshot: row.title_snapshot,
    source: row.source,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    content,
  };
}

export function restoreVersion(
  db: Db,
  actorId: string,
  nodeId: string,
  version: number,
): SaveContentResponse {
  assertActivePage(db, nodeId);
  const target = db
    .prepare<[string, number], { content_json: string; title_snapshot: string }>(
      `SELECT content_json, title_snapshot FROM page_versions WHERE node_id = ? AND version = ?`,
    )
    .get(nodeId, version);
  if (!target) throw notFound();

  const current = db
    .prepare<[string], { current_version: number }>(
      `SELECT current_version FROM nodes WHERE id = ?`,
    )
    .get(nodeId);
  const nextVersion = (current?.current_version ?? 0) + 1;
  const now = new Date().toISOString();
  const byteSize = Buffer.byteLength(target.content_json, 'utf8');

  let searchText = '';
  try {
    searchText = blocksToPlainText(JSON.parse(target.content_json) as PageContent);
  } catch {
    searchText = '';
  }

  const apply = db.transaction(() => {
    db.prepare(
      `INSERT INTO page_versions (id, node_id, version, content_json, title_snapshot, source, byte_size, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'restore', ?, ?, ?)`,
    ).run(
      newId(),
      nodeId,
      nextVersion,
      target.content_json,
      target.title_snapshot,
      byteSize,
      now,
      actorId,
    );
    db.prepare(
      `UPDATE nodes
          SET title = ?, current_version = ?, search_text = ?, updated_at = ?, updated_by = ?
        WHERE id = ?`,
    ).run(target.title_snapshot, nextVersion, searchText, now, actorId, nodeId);
  });
  apply();

  logActivity(db, {
    actorId,
    action: 'page.restore',
    entityType: 'node',
    entityId: nodeId,
    summary: target.title_snapshot,
    metadata: `v${version} -> v${nextVersion}`,
  });

  return { version: nextVersion, updatedAt: now };
}
