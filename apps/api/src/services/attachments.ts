import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type Attachment, ERROR_CODES } from '@krndocs/shared';
import { fileTypeFromBuffer } from 'file-type';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { logActivity } from './activity.js';

/**
 * Anexos (Etapa 3).
 *
 * - Tipos permitidos por allowlist; detecção por magic bytes (`file-type`).
 *   Declarado ≠ detectado => rejeitado (anti-spoof de extensão/MIME).
 * - Arquivo em disco = `storage_key` (UUID, sem extensão executável), dentro de
 *   `DATA_DIR/attachments` (0700). O nome original é só exibição.
 * - Download sempre como `attachment` (nunca inline) com MIME detectado.
 */

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB por arquivo

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'application/ogg',
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

/**
 * OOXML (docx/xlsx/pptx) é ZIP por dentro: o `file-type` detecta
 * `application/zip`. Aceita quando o declarado é um tipo ZIP conhecido E a
 * extensão do nome confere (anti-spoof de executável renomeado).
 */
const ZIP_BY_EXTENSION: Record<string, string> = {
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** MIMEs servidos inline (`?inline=1`): só mídia sem risco de script. */
export function isInlineableMime(mime: string): boolean {
  return (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/ogg'
  );
}

function tooLarge(): AppError {
  return new AppError(
    413,
    ERROR_CODES.PAYLOAD_TOO_LARGE,
    `Arquivo acima do limite de ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MiB.`,
  );
}

function unsupported(message: string): AppError {
  return new AppError(400, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, message);
}

function notFound(): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, 'Anexo não encontrado.');
}

/** Nome só para exibição: sem caminho, sem controle, até 255 chars. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  const clean = base.replace(/[^\x20-\x7e\u00a0-\u024f\u1e00-\u1eff ]/g, '').trim();
  return clean.slice(0, 255) || 'arquivo';
}

function isTextual(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  // NUL ou controles fora de \t\n\r => binário.
  for (const byte of sample) {
    if (byte === 0x00) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false;
  }
  return true;
}

export interface UploadInput {
  nodeId: string;
  actorId: string;
  originalName: string;
  mimeDeclared: string;
  buffer: Buffer;
}

function toAttachment(row: {
  id: string;
  node_id: string;
  original_name: string;
  mime_detected: string;
  size_bytes: number;
  sha256: string;
  uploaded_at: string;
}): Attachment {
  return {
    id: row.id,
    nodeId: row.node_id,
    originalName: row.original_name,
    mime: row.mime_detected,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    uploadedAt: row.uploaded_at,
  };
}

export function listAttachments(db: Db, nodeId: string): Attachment[] {
  const node = db
    .prepare<[string], { id: string }>(`SELECT id FROM nodes WHERE id = ? AND deleted_at IS NULL`)
    .get(nodeId);
  if (!node) throw notFound();
  const rows = db
    .prepare<
      [string],
      {
        id: string;
        node_id: string;
        original_name: string;
        mime_detected: string;
        size_bytes: number;
        sha256: string;
        uploaded_at: string;
      }
    >(
      `SELECT id, node_id, original_name, mime_detected, size_bytes, sha256, uploaded_at
         FROM attachments
        WHERE node_id = ? AND deleted_at IS NULL
        ORDER BY uploaded_at`,
    )
    .all(nodeId);
  return rows.map(toAttachment);
}

export async function saveAttachment(
  db: Db,
  attachmentsDir: string,
  input: UploadInput,
): Promise<Attachment> {
  const node = db
    .prepare<[string], { id: string; title: string }>(
      `SELECT id, title FROM nodes WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(input.nodeId);
  if (!node) throw notFound();

  if (input.buffer.length === 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Arquivo vazio.');
  }
  if (input.buffer.length > ATTACHMENT_MAX_BYTES) throw tooLarge();

  const detected = await fileTypeFromBuffer(input.buffer);
  const declaredBase = input.mimeDeclared.split(';')[0]?.trim().toLowerCase() ?? '';
  const lowerName = input.originalName.toLowerCase();
  let mime: string;
  if (detected) {
    if (detected.mime === 'application/zip') {
      // OOXML (docx/xlsx/pptx) e zip: confirma pela extensão do nome.
      const expected = Object.entries(ZIP_BY_EXTENSION).find(([ext]) => lowerName.endsWith(ext));
      if (!expected || expected[1] !== declaredBase) {
        throw unsupported('O tipo declarado não confere com o conteúdo do arquivo.');
      }
      mime = declaredBase;
    } else {
      if (!ALLOWED_MIME.has(detected.mime)) {
        throw unsupported(`Tipo de arquivo não permitido (${detected.mime}).`);
      }
      // Declarado precisa ser compatível com o detectado (anti-spoof).
      if (declaredBase !== detected.mime) {
        throw unsupported('O tipo declarado não confere com o conteúdo do arquivo.');
      }
      mime = detected.mime;
    }
  } else {
    // Sem assinatura reconhecível: só passa como texto puro declarado.
    const declaredBase = input.mimeDeclared.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ALLOWED_MIME.has(declaredBase) || !declaredBase.startsWith('text/')) {
      throw unsupported('Tipo de arquivo não permitido ou não reconhecido.');
    }
    if (!isTextual(input.buffer)) {
      throw unsupported('O conteúdo não confere com o tipo de texto declarado.');
    }
    mime = declaredBase;
  }

  const id = newId();
  const storageKey = newId().replace(/-/g, '');
  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  const now = new Date().toISOString();
  const originalName = sanitizeFileName(input.originalName);

  fs.mkdirSync(attachmentsDir, { recursive: true, mode: 0o700 });
  const filePath = path.join(attachmentsDir, storageKey);
  try {
    fs.writeFileSync(filePath, input.buffer, { flag: 'wx', mode: 0o600 });
  } catch {
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Falha ao armazenar o arquivo.');
  }

  try {
    const apply = db.transaction(() => {
      db.prepare(
        `INSERT INTO attachments (id, node_id, original_name, storage_key, mime_declared, mime_detected, size_bytes, sha256, uploaded_at, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.nodeId,
        originalName,
        storageKey,
        input.mimeDeclared,
        mime,
        input.buffer.length,
        sha256,
        now,
        input.actorId,
      );
    });
    apply();
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Melhor esforço: o registro não entrou, o arquivo órfão é inofensivo.
    }
    throw error;
  }

  logActivity(db, {
    actorId: input.actorId,
    action: 'attachment.upload',
    entityType: 'attachment',
    entityId: id,
    summary: `${node.title} — ${originalName}`,
  });

  return {
    id,
    nodeId: input.nodeId,
    originalName,
    mime,
    sizeBytes: input.buffer.length,
    sha256,
    uploadedAt: now,
  };
}

export interface DownloadTarget {
  attachment: Attachment;
  filePath: string;
}

/** Registro ativo + caminho do arquivo (para a rota de download). */
export function getDownloadTarget(db: Db, attachmentsDir: string, id: string): DownloadTarget {
  const row = db
    .prepare<
      [string],
      {
        id: string;
        node_id: string;
        original_name: string;
        mime_detected: string;
        size_bytes: number;
        sha256: string;
        uploaded_at: string;
        storage_key: string;
      }
    >(
      `SELECT id, node_id, original_name, mime_detected, size_bytes, sha256, uploaded_at, storage_key
         FROM attachments WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id);
  if (!row) throw notFound();

  const filePath = path.join(attachmentsDir, row.storage_key);
  if (!fs.existsSync(filePath)) {
    // Inconsistência servidor (registro sem arquivo): erro nosso, genérico.
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Erro interno. Tente novamente.');
  }
  const attachment = toAttachment(row);
  return { attachment, filePath };
}

/** Exclusão lógica do anexo (o arquivo sai do disco na purga definitiva do nó). */
export function deleteAttachment(db: Db, actorId: string, id: string): void {
  const row = db
    .prepare<[string], { id: string; original_name: string }>(
      `SELECT id, original_name FROM attachments WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id);
  if (!row) throw notFound();
  db.prepare(`UPDATE attachments SET deleted_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id,
  );
  logActivity(db, {
    actorId,
    action: 'attachment.delete',
    entityType: 'attachment',
    entityId: id,
    summary: row.original_name,
  });
}
