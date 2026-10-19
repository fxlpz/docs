import {
  ERROR_CODES,
  type PageContent,
  type PublicAttachment,
  type PublicNode,
  type PublicPage,
  type SearchResultItem,
} from '@krndocs/shared';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { getDownloadTarget } from './attachments.js';
import { toFtsQuery } from './search.js';

/**
 * Leitura pública anônima (landing).
 *
 * REGRA CENTRAL: um item só é público se ele E todos os seus ancestrais
 * estiverem com `visibility='public'` (e ninguém excluído). A checagem é
 * feita aqui no backend via CTE recursiva — o frontend nunca decide.
 */

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Página não encontrada.');
}

/**
 * Ancestralidade pública: sobe a cadeia e exige `public` + ativo em todos.
 * Profundidade limitada (1000) contra cadeia corrompida.
 */
function isPublicChain(db: Db, nodeId: string): boolean {
  let cursor: string | null = nodeId;
  for (let depth = 0; cursor && depth < 1000; depth += 1) {
    const row = db
      .prepare<
        [string],
        { parent_id: string | null; visibility: string; deleted_at: string | null }
      >(`SELECT parent_id, visibility, deleted_at FROM nodes WHERE id = ?`)
      .get(cursor);
    if (!row || row.deleted_at || row.visibility !== 'public') return false;
    cursor = row.parent_id;
  }
  return cursor === null;
}

interface PublicRow {
  id: string;
  type: 'folder' | 'page';
  parent_id: string | null;
  title: string;
  icon: string | null;
  position: number;
  updated_at: string;
  visibility: string;
  deleted_at: string | null;
}

/** Árvore pública podada: só ramos integralmente públicos. */
export function listPublicTree(db: Db): PublicNode[] {
  const rows = db
    .prepare<[], PublicRow>(
      `SELECT id, type, parent_id, title, icon, position, updated_at, visibility, deleted_at
         FROM nodes
        WHERE visibility = 'public' AND deleted_at IS NULL
        ORDER BY COALESCE(parent_id, ''), position, title`,
    )
    .all();

  const byId = new Map(rows.map((row) => [row.id, row]));
  const visible = (row: PublicRow): boolean => {
    let cursor: PublicRow | undefined = row;
    for (let depth = 0; cursor && depth < 1000; depth += 1) {
      if (cursor.visibility !== 'public' || cursor.deleted_at) return false;
      if (!cursor.parent_id) return true;
      cursor = byId.get(cursor.parent_id);
      if (!cursor) return false;
    }
    return false;
  };

  return rows.filter(visible).map((row) => ({
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
    updatedAt: row.updated_at,
  }));
}

/** Página pública com conteúdo da versão corrente (null se nunca salvou). */
export function getPublicPage(db: Db, nodeId: string): PublicPage {
  const row = db
    .prepare<[string], PublicRow & { current_version: number }>(
      `SELECT id, type, parent_id, title, icon, position, updated_at, visibility, deleted_at, current_version
         FROM nodes WHERE id = ?`,
    )
    .get(nodeId);
  if (row?.type !== 'page' || !isPublicChain(db, nodeId)) throw notFound();

  let content: PageContent | null = null;
  if (row.current_version > 0) {
    const version = db
      .prepare<[string, number], { content_json: string }>(
        `SELECT content_json FROM page_versions WHERE node_id = ? AND version = ?`,
      )
      .get(nodeId, row.current_version);
    if (version) {
      try {
        content = JSON.parse(version.content_json) as PageContent;
      } catch {
        content = null;
      }
    }
  }

  return {
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
    updatedAt: row.updated_at,
    content,
  };
}

/** Busca pública: FTS restrito à subárvore pública. */
export function searchPublic(db: Db, query: string): SearchResultItem[] {
  const match = toFtsQuery(query);
  if (!match) return [];

  const rows = db
    .prepare<[string], { node_id: string; title: string; snippet: string; rank: number }>(
      `SELECT f.node_id, n.title,
              snippet(pages_fts, 2, '', '', ' … ', 24) AS snippet,
              bm25(pages_fts) AS rank
         FROM pages_fts f
         JOIN nodes n ON n.id = f.node_id
        WHERE pages_fts MATCH ?
          AND n.deleted_at IS NULL
          AND n.visibility = 'public'
        ORDER BY rank
        LIMIT 50`,
    )
    .all(match);

  return rows
    .filter((row) => isPublicChain(db, row.node_id))
    .map((row) => ({
      nodeId: row.node_id,
      title: row.title,
      snippet: row.snippet,
      rank: row.rank,
    }));
}

/** Anexos de página pública (metadados para download anônimo). */
export function listPublicAttachments(db: Db, nodeId: string): PublicAttachment[] {
  const row = db.prepare<[string], { id: string }>(`SELECT id FROM nodes WHERE id = ?`).get(nodeId);
  if (!row || !isPublicChain(db, nodeId)) throw notFound();

  const attachments = db
    .prepare<
      [string],
      { id: string; original_name: string; mime_detected: string; size_bytes: number }
    >(
      `SELECT id, original_name, mime_detected, size_bytes
         FROM attachments WHERE node_id = ? AND deleted_at IS NULL ORDER BY uploaded_at`,
    )
    .all(nodeId);
  return attachments.map((attachment) => ({
    id: attachment.id,
    originalName: attachment.original_name,
    mime: attachment.mime_detected,
    sizeBytes: attachment.size_bytes,
  }));
}

export interface PublicDownloadTarget {
  originalName: string;
  mime: string;
  sizeBytes: number;
  filePath: string;
}

/**
 * Download anônimo: só se o anexo existir, estiver ativo E o nó dono for
 * public-chain. Reaproveita o disco de `DATA_DIR/attachments`.
 */
export function getPublicDownloadTarget(
  db: Db,
  attachmentsDir: string,
  attachmentId: string,
): PublicDownloadTarget {
  const { attachment, filePath } = getDownloadTarget(db, attachmentsDir, attachmentId);
  if (!isPublicChain(db, attachment.nodeId)) throw notFound();
  return {
    originalName: attachment.originalName,
    mime: attachment.mime,
    sizeBytes: attachment.sizeBytes,
    filePath,
  };
}
