import {
  type CreateNodeRequest,
  ERROR_CODES,
  type NodeDetail,
  type NodeSummary,
  type PageContent,
  type SaveContentRequest,
  type SaveContentResponse,
  type UpdateNodeRequest,
} from '@krndocs/shared';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { logActivity } from './activity.js';

/**
 * Serviço da árvore unificada (pastas e páginas) e do conteúdo de página.
 *
 * Regras centrais:
 * - Exclusão é SEMPRE lógica (deleted_at), inclusive na subárvore inteira.
 * - Movimento nunca cria ciclo (pai não pode ser descendente do próprio nó).
 * - Escrita de conteúdo usa controle otimista: baseVersion divergente => 409.
 * - Toda mutação registra auditoria (`activity`) com resumo curto, sem corpo.
 */

interface NodeRow {
  id: string;
  type: 'folder' | 'page';
  parent_id: string | null;
  title: string;
  icon: string | null;
  position: number;
  current_version: number;
  visibility: 'private' | 'public';
  updated_at: string;
}

const NODE_COLUMNS = `id, type, parent_id, title, icon, position, current_version, visibility, updated_at`;

/** Teto de uma versão de conteúdo (abaixo do bodyLimit de 2 MiB). */
export const PAGE_CONTENT_MAX_BYTES = 1500 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Item não encontrado.');
}

function invalid(message: string): AppError {
  return new AppError(400, ERROR_CODES.VALIDATION_ERROR, message);
}

function toSummary(row: NodeRow): NodeSummary {
  return {
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
    updatedAt: row.updated_at,
    visibility: row.visibility,
  };
}

function getActiveNode(db: Db, id: string): NodeRow {
  const row = db
    .prepare<[string], NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM nodes WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id);
  if (!row) throw notFound();
  return row;
}

/** Lista plana (agrupada por pai) para o cliente montar a árvore. */
export function listNodes(db: Db): NodeSummary[] {
  const rows = db
    .prepare<[], NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM nodes
        WHERE deleted_at IS NULL
        ORDER BY COALESCE(parent_id, ''), position, title`,
    )
    .all();
  return rows.map(toSummary);
}

function nextPosition(db: Db, parentId: string | null): number {
  const row = db
    .prepare<(string | null)[], { next: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next
         FROM nodes
        WHERE parent_id IS ? AND deleted_at IS NULL`,
    )
    .get(parentId);
  return row?.next ?? 0;
}

function assertValidParent(db: Db, parentId: string): NodeRow {
  const parent = db
    .prepare<[string], NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM nodes WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(parentId);
  if (!parent) throw invalid('A pasta de destino não existe.');
  if (parent.type !== 'folder') throw invalid('O destino precisa ser uma pasta.');
  return parent;
}

export function createNode(db: Db, actorId: string, input: CreateNodeRequest): NodeSummary {
  const parentId = input.parentId ?? null;
  if (parentId) assertValidParent(db, parentId);

  const id = newId();
  const now = nowIso();
  const position = nextPosition(db, parentId);

  db.prepare(
    `INSERT INTO nodes (id, type, parent_id, title, icon, position, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    parentId,
    input.title,
    input.icon ?? null,
    position,
    now,
    actorId,
    now,
    actorId,
  );

  logActivity(db, {
    actorId,
    action: input.type === 'folder' ? 'folder.create' : 'page.create',
    entityType: 'node',
    entityId: id,
    summary: input.title || '(sem título)',
  });

  return toSummary(getActiveNode(db, id));
}

/** true se `ancestorId` está na cadeia de ascendentes de `nodeId` (ou é o próprio). */
function isSelfOrAncestor(db: Db, nodeId: string, ancestorId: string): boolean {
  let cursor: string | null = nodeId;
  for (let depth = 0; cursor && depth < 1000; depth += 1) {
    if (cursor === ancestorId) return true;
    const row = db
      .prepare<[string], { parent_id: string | null }>(`SELECT parent_id FROM nodes WHERE id = ?`)
      .get(cursor);
    cursor = row?.parent_id ?? null;
  }
  return false;
}

export function updateNode(
  db: Db,
  actorId: string,
  id: string,
  input: UpdateNodeRequest,
): NodeSummary {
  const node = getActiveNode(db, id);

  // Validações de movimento ANTES de qualquer escrita (leituras puras).
  if (input.parentId !== undefined && input.parentId) {
    const parentId = input.parentId;
    if (parentId === id) throw invalid('Um item não pode ser pai de si mesmo.');
    assertValidParent(db, parentId);
    // Ciclo: o novo pai não pode ser o próprio nó nem um descendente dele.
    if (isSelfOrAncestor(db, parentId, id)) {
      throw new AppError(
        409,
        ERROR_CODES.CONFLICT,
        'Movimento inválido: não é possível mover uma pasta para dentro de si mesma ou de um descendente.',
      );
    }
  }

  // Todas as escritas em UMA transação: falha no meio não deixa o nó com
  // pai novo e posição antiga (ou vice-versa).
  const apply = db.transaction(() => {
    if (input.parentId !== undefined) {
      const parentId = input.parentId;
      db.prepare(`UPDATE nodes SET parent_id = ? WHERE id = ?`).run(parentId, id);
      // Posição explícita vence; sem ela, entra no fim do destino.
      const position = input.position ?? nextPosition(db, parentId);
      db.prepare(`UPDATE nodes SET position = ? WHERE id = ?`).run(position, id);
    } else if (input.position !== undefined) {
      db.prepare(`UPDATE nodes SET position = ? WHERE id = ?`).run(input.position, id);
    }

    if (input.title !== undefined) {
      db.prepare(`UPDATE nodes SET title = ? WHERE id = ?`).run(input.title, id);
    }
    if (input.icon !== undefined) {
      db.prepare(`UPDATE nodes SET icon = ? WHERE id = ?`).run(input.icon, id);
    }

    db.prepare(`UPDATE nodes SET updated_at = ?, updated_by = ? WHERE id = ?`).run(
      nowIso(),
      actorId,
      id,
    );
  });
  apply();

  const moved = input.parentId !== undefined;
  const action = moved
    ? node.type === 'folder'
      ? 'folder.move'
      : 'page.move'
    : node.type === 'folder'
      ? 'folder.rename'
      : 'page.rename';
  logActivity(db, {
    actorId,
    action,
    entityType: 'node',
    entityId: id,
    summary: input.title ?? node.title,
  });

  return toSummary(getActiveNode(db, id));
}

export interface MoveNodeInput {
  parentId: string | null;
  /** Inserir imediatamente antes deste irmão (null = no fim). */
  beforeId: string | null;
}

/**
 * Move com renumeração densa dos irmãos (origem e destino), em transação.
 * Base do arrastar-soltar na árvore: sem furos nem duplicatas de posição.
 */
export function moveNode(db: Db, actorId: string, id: string, input: MoveNodeInput): NodeSummary {
  const node = getActiveNode(db, id);
  const parentId = input.parentId;

  if (parentId === id) throw invalid('Um item não pode ser pai de si mesmo.');
  if (parentId) {
    assertValidParent(db, parentId);
    if (isSelfOrAncestor(db, parentId, id)) {
      throw new AppError(
        409,
        ERROR_CODES.CONFLICT,
        'Movimento inválido: não é possível mover uma pasta para dentro de si mesma ou de um descendente.',
      );
    }
  }

  let beforeId: string | null = null;
  if (input.beforeId) {
    const before = db
      .prepare<[string], { id: string; parent_id: string | null }>(
        `SELECT id, parent_id FROM nodes WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(input.beforeId);
    if (!before) throw invalid('O item de referência não existe.');
    if ((before.parent_id ?? null) !== parentId || before.id === id) {
      throw invalid('O item de referência precisa ser irmão do destino.');
    }
    beforeId = before.id;
  }

  const now = nowIso();
  const apply = db.transaction(() => {
    db.prepare(`UPDATE nodes SET parent_id = ? WHERE id = ?`).run(parentId, id);

    // Renumera os irmãos do destino de forma densa, com o movido na posição
    // do `beforeId` (ou no fim).
    const siblings = db
      .prepare<(string | null)[], { id: string }>(
        `SELECT id FROM nodes
          WHERE parent_id IS ? AND id <> ? AND deleted_at IS NULL
          ORDER BY position, title`,
      )
      .all(parentId, id);
    const ordered = siblings.map((sibling) => sibling.id);
    const at = beforeId ? ordered.indexOf(beforeId) : -1;
    if (at >= 0) ordered.splice(at, 0, id);
    else ordered.push(id);
    ordered.forEach((siblingId, position) => {
      db.prepare(`UPDATE nodes SET position = ? WHERE id = ?`).run(position, siblingId);
    });

    // Renumera os irmãos antigos (de onde o nó saiu), se mudou de pai.
    if ((node.parent_id ?? null) !== parentId) {
      const oldSiblings = db
        .prepare<(string | null)[], { id: string }>(
          `SELECT id FROM nodes
            WHERE parent_id IS ? AND id <> ? AND deleted_at IS NULL
            ORDER BY position, title`,
        )
        .all(node.parent_id, id);
      oldSiblings.forEach((sibling, position) => {
        db.prepare(`UPDATE nodes SET position = ? WHERE id = ?`).run(position, sibling.id);
      });
    }

    db.prepare(`UPDATE nodes SET updated_at = ?, updated_by = ? WHERE id = ?`).run(
      now,
      actorId,
      id,
    );
  });
  apply();

  logActivity(db, {
    actorId,
    action: node.type === 'folder' ? 'folder.move' : 'page.move',
    entityType: 'node',
    entityId: id,
    summary: node.title,
  });

  return toSummary(getActiveNode(db, id));
}

/**
 * Exclusão lógica do item e de toda a subárvore, em transação.
 * Nada é removido fisicamente aqui (a lixeira é Etapa 3).
 */
export function deleteNode(db: Db, actorId: string, id: string): void {
  const node = getActiveNode(db, id);
  const now = nowIso();

  const apply = db.transaction(() => {
    db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
       )
       UPDATE nodes
          SET deleted_at = ?, deleted_by = ?
        WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL`,
    ).run(id, now, actorId);
  });
  apply();

  logActivity(db, {
    actorId,
    action: node.type === 'folder' ? 'folder.delete' : 'page.delete',
    entityType: 'node',
    entityId: id,
    summary: node.title,
  });
}

/** Detalhe da página com conteúdo da versão corrente (null se nunca salvou). */
export function getNodeDetail(db: Db, id: string): NodeDetail {
  const node = getActiveNode(db, id);

  let content: PageContent | null = null;
  if (node.type === 'page' && node.current_version > 0) {
    const row = db
      .prepare<[string, number], { content_json: string }>(
        `SELECT content_json FROM page_versions WHERE node_id = ? AND version = ?`,
      )
      .get(id, node.current_version);
    if (row) {
      try {
        content = JSON.parse(row.content_json) as PageContent;
      } catch {
        // Conteúdo corrompido não pode derrubar a página: reporta vazio.
        content = null;
      }
    }
  }

  return {
    ...toSummary(node),
    version: node.current_version,
    content,
  };
}

/** Deriva texto puro dos blocos do editor para o índice de busca (FTS5). */
export function blocksToPlainText(blocks: PageContent): string {
  const out: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        // Só campos textuais do BlockNote; ignora type, props, ids etc.
        // `children` (toggles/listas aninhadas) e `rows` (tabelas) também
        // carregam conteúdo que precisa ser encontrável na busca.
        if (key === 'text' || key === 'content' || key === 'children' || key === 'rows') {
          collect(item);
        }
      }
    }
  };
  collect(blocks);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Salva o conteúdo com controle otimista de versão.
 * `baseVersion` divergente da corrente => 409 VERSION_CONFLICT (não sobrescreve).
 */
export function saveContent(
  db: Db,
  actorId: string,
  id: string,
  input: SaveContentRequest,
): SaveContentResponse {
  const node = getActiveNode(db, id);
  if (node.type !== 'page') throw invalid('Apenas páginas têm conteúdo.');
  if (input.baseVersion !== node.current_version) {
    throw new AppError(
      409,
      ERROR_CODES.VERSION_CONFLICT,
      'A página foi alterada em outra sessão. Recarregue antes de salvar para não sobrescrever o trabalho alheio.',
    );
  }

  const nextVersion = node.current_version + 1;
  const json = JSON.stringify(input.content);
  const byteSize = Buffer.byteLength(json, 'utf8');
  // Teto por versão: abaixo do bodyLimit (2 MiB) com folga para o envelope.
  // Páginas maiores que isso indicam anexo disfarçado de conteúdo.
  if (byteSize > PAGE_CONTENT_MAX_BYTES) {
    throw new AppError(
      413,
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      'Conteúdo acima do tamanho permitido para uma versão. Use anexos para arquivos grandes.',
    );
  }
  const now = nowIso();
  const searchText = blocksToPlainText(input.content);

  const apply = db.transaction(() => {
    db.prepare(
      `INSERT INTO page_versions (id, node_id, version, content_json, title_snapshot, source, byte_size, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), id, nextVersion, json, node.title, input.source, byteSize, now, actorId);

    db.prepare(
      `UPDATE nodes
          SET current_version = ?, search_text = ?, updated_at = ?, updated_by = ?
        WHERE id = ?`,
    ).run(nextVersion, searchText, now, actorId, id);
  });
  apply();

  logActivity(db, {
    actorId,
    action: 'page.update',
    entityType: 'node',
    entityId: id,
    summary: node.title,
    metadata: `v${nextVersion}`,
  });

  return { version: nextVersion, updatedAt: now };
}
