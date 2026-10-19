import fs from 'node:fs';
import path from 'node:path';
import { ERROR_CODES } from '@krndocs/shared';
import { fileTypeFromBuffer } from 'file-type';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { logActivity } from './activity.js';

/**
 * Foto de perfil (Etapa extra).
 *
 * - Só imagens (PNG/JPEG/GIF/WebP), até 2 MiB, verificadas por magic bytes.
 * - Arquivo em `DATA_DIR/avatars/<uuid>` (sem extensão, 0600); o anterior é
 *   apagado na troca. Sem vínculo com anexos de páginas.
 * - Leitura autenticada (`GET /api/users/:id/avatar`); nada público.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB

const AVATAR_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function notFound(message = 'Usuário não encontrado.'): AppError {
  return new AppError(404, ERROR_CODES.NOT_FOUND, message);
}

function assertActiveUser(db: Db, userId: string): { id: string; username: string } {
  const row = db
    .prepare<[string], { id: string; username: string }>(
      `SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(userId);
  if (!row) throw notFound();
  return row;
}

export interface AvatarTarget {
  filePath: string;
  mime: string;
  sizeBytes: number;
}

/** Grava a foto (remove a anterior). Devolve true se havia anterior. */
export async function saveAvatar(
  db: Db,
  avatarsDir: string,
  userId: string,
  mimeDeclared: string,
  buffer: Buffer,
): Promise<{ replaced: boolean }> {
  const user = assertActiveUser(db, userId);

  if (buffer.length === 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Arquivo vazio.');
  }
  if (buffer.length > AVATAR_MAX_BYTES) {
    throw new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Foto acima de 2 MiB.');
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !AVATAR_MIME.has(detected.mime)) {
    throw new AppError(
      400,
      ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      'Envie uma imagem PNG, JPEG, GIF ou WebP.',
    );
  }
  const declaredBase = mimeDeclared.split(';')[0]?.trim().toLowerCase() ?? '';
  if (declaredBase !== detected.mime) {
    throw new AppError(
      400,
      ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      'O tipo declarado não confere com o conteúdo do arquivo.',
    );
  }

  const storageKey = newId().replace(/-/g, '');
  fs.mkdirSync(avatarsDir, { recursive: true, mode: 0o700 });
  const filePath = path.join(avatarsDir, storageKey);
  try {
    fs.writeFileSync(filePath, buffer, { flag: 'wx', mode: 0o600 });
  } catch {
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Falha ao armazenar a foto.');
  }

  const previous = db
    .prepare<[string], { avatar_storage_key: string | null }>(
      `SELECT avatar_storage_key FROM users WHERE id = ?`,
    )
    .get(userId)?.avatar_storage_key;

  try {
    db.prepare(`UPDATE users SET avatar_storage_key = ?, updated_at = ? WHERE id = ?`).run(
      storageKey,
      new Date().toISOString(),
      userId,
    );
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Melhor esforço: registro não entrou, arquivo órfão é inofensivo.
    }
    throw error;
  }

  if (previous) {
    try {
      fs.rmSync(path.join(avatarsDir, previous), { force: true });
    } catch {
      // Arquivo anterior já ausente: nada a fazer.
    }
  }

  logActivity(db, {
    actorId: userId,
    action: 'user.avatar',
    entityType: 'user',
    entityId: userId,
    summary: user.username,
  });
  return { replaced: previous !== null };
}

/** Remove a foto (idempotente). */
export function deleteAvatar(db: Db, avatarsDir: string, userId: string): void {
  const user = assertActiveUser(db, userId);
  const previous = db
    .prepare<[string], { avatar_storage_key: string | null }>(
      `SELECT avatar_storage_key FROM users WHERE id = ?`,
    )
    .get(userId)?.avatar_storage_key;
  if (!previous) return;

  db.prepare(`UPDATE users SET avatar_storage_key = NULL, updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    userId,
  );
  try {
    fs.rmSync(path.join(avatarsDir, previous), { force: true });
  } catch {
    // Registro limpo; arquivo já ausente.
  }
  logActivity(db, {
    actorId: userId,
    action: 'user.avatar',
    entityType: 'user',
    entityId: userId,
    summary: `${user.username} (removida)`,
  });
}

/** Alvo de download (qualquer sessão válida pode ver foto de colega). */
export async function getAvatarTarget(
  db: Db,
  avatarsDir: string,
  userId: string,
): Promise<AvatarTarget> {
  assertActiveUser(db, userId);
  const row = db
    .prepare<[string], { avatar_storage_key: string | null }>(
      `SELECT avatar_storage_key FROM users WHERE id = ?`,
    )
    .get(userId);
  if (!row?.avatar_storage_key) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Usuário sem foto de perfil.');
  }
  const filePath = path.join(avatarsDir, row.avatar_storage_key);
  if (!fs.existsSync(filePath)) {
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Erro interno. Tente novamente.');
  }
  // MIME redetectado do arquivo (allowlist garantida na gravação).
  const detected = await fileTypeFromBuffer(await fs.promises.readFile(filePath));
  const stat = fs.statSync(filePath);
  return { filePath, mime: detected?.mime ?? 'application/octet-stream', sizeBytes: stat.size };
}
