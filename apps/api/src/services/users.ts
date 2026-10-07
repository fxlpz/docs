import { PASSWORD_MIN_LENGTH, type UserRole } from '@krndocs/shared';
import argon2 from 'argon2';
import type { Db } from '../db/database.js';
import { newId } from '../lib/ids.js';
import { logActivity } from './activity.js';

/**
 * Provisionamento de usuários (sem cadastro público).
 *
 * - Usuários são criados apenas por este serviço (CLI `npm run provision`).
 * - Hash Argon2id; a senha em texto puro nunca é persistida nem logada.
 * - `ensureUser` nunca recria nem regrava senha de conta existente.
 * - Toda senha definida aqui nasce como PROVISÓRIA (`must_change_password=1`):
 *   o primeiro login exige a troca antes de qualquer outra operação.
 */

export interface UserTarget {
  username: string;
  displayName: string;
  role: UserRole;
}

export type EnsureUserResult =
  | { outcome: 'created' }
  | { outcome: 'role_updated'; from: UserRole }
  | { outcome: 'unchanged' };

interface ExistingUserRow {
  id: string;
  role: UserRole;
}

function findUser(db: Db, username: string): ExistingUserRow | undefined {
  return db
    .prepare<[string], { id: string; role: UserRole }>(
      `SELECT id, role FROM users WHERE username = ? AND deleted_at IS NULL`,
    )
    .get(username.toLowerCase());
}

/** Checa existência sem efeitos (o CLI usa para saber se deve pedir senha). */
export function userExists(db: Db, username: string): boolean {
  return findUser(db, username) !== undefined;
}

/**
 * Garante que o usuário exista com o papel esperado.
 * Se não existir, `password` é OBRIGATÓRIO; se existir, a senha nunca muda aqui.
 */
export async function ensureUser(
  db: Db,
  target: UserTarget,
  password?: string,
): Promise<EnsureUserResult> {
  const username = target.username.toLowerCase();
  const existing = findUser(db, username);

  if (existing) {
    if (existing.role === target.role) return { outcome: 'unchanged' };
    db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).run(
      target.role,
      new Date().toISOString(),
      existing.id,
    );
    logActivity(db, {
      actorId: null,
      action: 'user.role',
      entityType: 'user',
      entityId: existing.id,
      summary: `${username}: ${existing.role} -> ${target.role}`,
    });
    return { outcome: 'role_updated', from: existing.role };
  }

  if (!password) {
    throw new Error(`Senha obrigatória para criar o usuário ${username}.`);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Senha de ${username} abaixo do mínimo (${PASSWORD_MIN_LENGTH} caracteres).`);
  }

  const now = new Date().toISOString();
  const id = newId();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, must_change_password, is_active, failed_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`,
    ).run(id, username, target.displayName, target.role, passwordHash, now, now);
  } catch (error) {
    // Índice único: outra instância criou o mesmo usuário entre SELECT e INSERT.
    if (findUser(db, username)) return { outcome: 'unchanged' };
    throw error;
  }

  logActivity(db, {
    actorId: null,
    action: 'user.create',
    entityType: 'user',
    entityId: id,
    summary: `${username} (${target.role})`,
  });
  return { outcome: 'created' };
}

/**
 * Redefine a senha de um usuário EXISTENTE (uso: CLI `npm run provision -- --reset`).
 *
 * - Exclusivo para provisionamento aprovado pelo administrador: não há fluxo
 *   de "recuperar senha" na aplicação.
 * - A nova senha nasce PROVISÓRIA (`must_change_password=1`), zera lockout e
 *   revoga todas as sessões — tudo em transação.
 */
export async function resetUserPassword(
  db: Db,
  username: string,
  password: string,
): Promise<{ reset: boolean }> {
  const existing = findUser(db, username);
  if (!existing) return { reset: false };
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Senha de ${username} abaixo do mínimo (${PASSWORD_MIN_LENGTH} caracteres).`);
  }

  const now = new Date().toISOString();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE users
          SET password_hash = ?, must_change_password = 1,
              failed_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(passwordHash, now, existing.id);
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(
      now,
      existing.id,
    );
  });
  apply();

  logActivity(db, {
    actorId: null,
    action: 'user.password',
    entityType: 'user',
    entityId: existing.id,
    summary: `${username.toLowerCase()} (redefinida pelo provisionamento)`,
  });
  return { reset: true };
}
