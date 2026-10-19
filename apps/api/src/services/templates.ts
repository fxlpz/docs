import {
  type CreateFromTemplateRequest,
  ERROR_CODES,
  type MarkTemplateRequest,
  type NodeSummary,
  type TemplateItem,
} from '@krndocs/shared';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { logActivity } from './activity.js';

/**
 * Templates de páginas recorrentes (runbooks, checklists, relatórios).
 *
 * - Só PÁGINAS viram template; o conteúdo mora em `page_versions`.
 * - Criar a partir do template copia o JSON da versão corrente para uma
 *   página nova (v1, `source='manual'` — o CHECK de `source` não tem valor
 *   'template', e a origem real é uma criação manual a partir de modelo).
 */

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Item não encontrado.');
}

function invalid(message: string): AppError {
  return new AppError(400, ERROR_CODES.VALIDATION_ERROR, message);
}

export function listTemplates(db: Db): TemplateItem[] {
  const rows = db
    .prepare<
      [],
      {
        node_id: string;
        name: string;
        category: string;
        description: string | null;
        position: number;
        page_title: string;
        icon: string | null;
      }
    >(
      `SELECT t.node_id, t.name, t.category, t.description, t.position, n.title AS page_title, n.icon
         FROM templates t
         JOIN nodes n ON n.id = t.node_id
        WHERE n.deleted_at IS NULL
        ORDER BY t.category, t.position, t.name`,
    )
    .all();
  return rows.map((row) => ({
    nodeId: row.node_id,
    name: row.name,
    category: row.category,
    description: row.description,
    position: row.position,
    pageTitle: row.page_title,
    icon: row.icon,
  }));
}

/** Marca uma página ativa como template (idempotente nos metadados). */
export function markAsTemplate(
  db: Db,
  actorId: string,
  nodeId: string,
  input: MarkTemplateRequest,
): TemplateItem {
  const page = db
    .prepare<[string], { id: string; title: string; icon: string | null }>(
      `SELECT id, title, icon FROM nodes WHERE id = ? AND type = 'page' AND deleted_at IS NULL`,
    )
    .get(nodeId);
  if (!page) throw invalid('Apenas páginas ativas podem virar template.');

  const now = new Date().toISOString();
  const existing = db
    .prepare<[string], { node_id: string }>(`SELECT node_id FROM templates WHERE node_id = ?`)
    .get(nodeId);

  const apply = db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE templates SET name = ?, category = ?, description = ?, updated_at = ? WHERE node_id = ?`,
      ).run(input.name, input.category, input.description ?? null, now, nodeId);
    } else {
      const positionRow = db
        .prepare<[string], { next: number }>(
          `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM templates WHERE category = ?`,
        )
        .get(input.category);
      db.prepare(
        `INSERT INTO templates (node_id, name, category, description, position, created_at, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        nodeId,
        input.name,
        input.category,
        input.description ?? null,
        positionRow?.next ?? 0,
        now,
        actorId,
        now,
      );
    }
    db.prepare(`UPDATE nodes SET is_template = 1, updated_at = ?, updated_by = ? WHERE id = ?`).run(
      now,
      actorId,
      nodeId,
    );
  });
  apply();

  logActivity(db, {
    actorId,
    action: 'template.mark',
    entityType: 'node',
    entityId: nodeId,
    summary: input.name,
  });

  const row = db
    .prepare<
      [string],
      { name: string; category: string; description: string | null; position: number }
    >(`SELECT name, category, description, position FROM templates WHERE node_id = ?`)
    .get(nodeId);
  if (!row) throw notFound();
  return {
    nodeId,
    name: row.name,
    category: row.category,
    description: row.description,
    position: row.position,
    pageTitle: page.title,
    icon: page.icon,
  };
}

/**
 * Tira a página da lista de modelos. A PÁGINA NÃO É APAGADA — ela continua
 * na árvore; para removê-la do workspace, exclua-a pelo painel da página ou
 * pela árvore (vai para a lixeira).
 */
export function unmarkTemplate(db: Db, actorId: string, nodeId: string): void {
  const existing = db
    .prepare<[string], { node_id: string }>(`SELECT node_id FROM templates WHERE node_id = ?`)
    .get(nodeId);
  if (!existing) throw notFound();

  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    db.prepare(`DELETE FROM templates WHERE node_id = ?`).run(nodeId);
    db.prepare(`UPDATE nodes SET is_template = 0, updated_at = ?, updated_by = ? WHERE id = ?`).run(
      now,
      actorId,
      nodeId,
    );
  });
  apply();

  logActivity(db, {
    actorId,
    action: 'template.unmark',
    entityType: 'node',
    entityId: nodeId,
  });
}

/** Cria uma página nova a partir do conteúdo corrente do template. */
export function createFromTemplate(
  db: Db,
  actorId: string,
  templateNodeId: string,
  input: CreateFromTemplateRequest,
): NodeSummary {
  const template = db
    .prepare<[string], { id: string; title: string; current_version: number }>(
      `SELECT n.id, n.title, n.current_version
         FROM templates t
         JOIN nodes n ON n.id = t.node_id
        WHERE t.node_id = ? AND n.deleted_at IS NULL`,
    )
    .get(templateNodeId);
  if (!template) throw notFound();

  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = db
      .prepare<[string], { id: string }>(
        `SELECT id FROM nodes WHERE id = ? AND type = 'folder' AND deleted_at IS NULL`,
      )
      .get(parentId);
    if (!parent) throw invalid('A pasta de destino não existe.');
  }

  let contentJson: string | null = null;
  if (template.current_version > 0) {
    const row = db
      .prepare<[string, number], { content_json: string }>(
        `SELECT content_json FROM page_versions WHERE node_id = ? AND version = ?`,
      )
      .get(templateNodeId, template.current_version);
    contentJson = row?.content_json ?? null;
  }

  const id = newId();
  const now = new Date().toISOString();
  const title = input.title ?? template.title;
  const positionRow = db
    .prepare<(string | null)[], { next: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM nodes WHERE parent_id IS ? AND deleted_at IS NULL`,
    )
    .get(parentId);

  const apply = db.transaction(() => {
    db.prepare(
      `INSERT INTO nodes (id, type, parent_id, title, position, created_at, created_by, updated_at, updated_by)
       VALUES (?, 'page', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, parentId, title, positionRow?.next ?? 0, now, actorId, now, actorId);
    if (contentJson) {
      db.prepare(
        `INSERT INTO page_versions (id, node_id, version, content_json, title_snapshot, source, byte_size, created_at, created_by)
         VALUES (?, ?, 1, ?, ?, 'manual', ?, ?, ?)`,
      ).run(newId(), id, contentJson, title, Buffer.byteLength(contentJson, 'utf8'), now, actorId);
      db.prepare(`UPDATE nodes SET current_version = 1 WHERE id = ?`).run(id);
    }
  });
  apply();

  logActivity(db, {
    actorId,
    action: 'page.create',
    entityType: 'node',
    entityId: id,
    summary: title,
    metadata: `de-template:${templateNodeId}`,
  });

  const created = db
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
      }
    >(
      `SELECT id, type, parent_id, title, icon, position, visibility, updated_at FROM nodes WHERE id = ?`,
    )
    .get(id);
  if (!created) throw notFound();
  return {
    id: created.id,
    type: created.type,
    parentId: created.parent_id,
    title: created.title,
    icon: created.icon,
    position: created.position,
    visibility: created.visibility,
    updatedAt: created.updated_at,
  };
}
