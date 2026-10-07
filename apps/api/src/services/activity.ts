import type { Db } from '../db/database.js';
import { newId } from '../lib/ids.js';

/**
 * Registro de auditoria (tabela `activity`).
 *
 * Regras: sem conteúdo de documento, sem segredos e sem dado pessoal além do
 * resumo curto já exibível na interface. Falha de gravação nunca derruba a
 * requisição principal — é melhor perder um evento do que uma ação legítima.
 */
export interface ActivityEntry {
  actorId: string | null;
  /** ex.: 'login.success', 'page.create', 'folder.move' */
  action: string;
  entityType: 'node' | 'user' | 'session' | 'attachment' | 'tag';
  entityId?: string | null;
  /** Título/resumo curto exibível (nunca o corpo do documento). */
  summary?: string | null;
  metadata?: string | null;
  ipMasked?: string | null;
}

const INSERT = `
  INSERT INTO activity (id, actor_id, action, entity_type, entity_id, summary, metadata, ip_masked, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function logActivity(db: Db, entry: ActivityEntry): void {
  try {
    db.prepare(INSERT).run(
      newId(),
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.summary ?? null,
      entry.metadata ?? null,
      entry.ipMasked ?? null,
      new Date().toISOString(),
    );
  } catch {
    // Auditoria é best-effort aqui: o erro real aparece no log do Fastify se
    // a requisição falhar por outro motivo.
  }
}
