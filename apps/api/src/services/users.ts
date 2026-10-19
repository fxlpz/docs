import { ERROR_CODES, PASSWORD_MIN_LENGTH, type UserRole } from '@krndocs/shared';
import argon2 from 'argon2';
import type { Db } from '../db/database.js';
import { AppError } from '../lib/errors.js';
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

interface ManagedUserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: number;
  must_change_password: number;
  avatar_storage_key: string | null;
  last_login_at: string | null;
  created_at: string;
}

function toManagedUser(row: ManagedUserRow): {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  hasAvatar: boolean;
  lastLoginAt: string | null;
  createdAt: string;
} {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    hasAvatar: row.avatar_storage_key !== null,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

const MANAGED_COLUMNS = `id, username, display_name, role, is_active, must_change_password, avatar_storage_key, last_login_at, created_at`;

function getManagedUser(db: Db, id: string): ManagedUserRow {
  const row = db
    .prepare<[string], ManagedUserRow>(
      `SELECT ${MANAGED_COLUMNS} FROM users WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id);
  if (!row) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Usuário não encontrado.');
  }
  return row;
}

/** Um usuário ativo por id (uso interno das rotas). */
export function getUser(db: Db, id: string): ReturnType<typeof toManagedUser> {
  return toManagedUser(getManagedUser(db, id));
}

/** Lista todos os usuários ativos (admin). */
export function listUsers(db: Db): ReturnType<typeof toManagedUser>[] {
  const rows = db
    .prepare<[], ManagedUserRow>(
      `SELECT ${MANAGED_COLUMNS} FROM users WHERE deleted_at IS NULL ORDER BY username`,
    )
    .all();
  return rows.map(toManagedUser);
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  role: UserRole;
  password: string;
}

/**
 * Cria usuário via administração (sem cadastro público).
 * A senha nasce PROVISÓRIA (`must_change_password=1`).
 */
export async function createUser(
  db: Db,
  actorId: string,
  input: CreateUserInput,
): Promise<ReturnType<typeof toManagedUser>> {
  const username = input.username.toLowerCase();
  if (findUser(db, username)) {
    throw new AppError(409, ERROR_CODES.CONFLICT, 'Este usuário já existe.');
  }
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Senha abaixo do mínimo (${PASSWORD_MIN_LENGTH} caracteres).`,
    );
  }

  const now = new Date().toISOString();
  const id = newId();
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, must_change_password, is_active, failed_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`,
    ).run(id, username, input.displayName, input.role, passwordHash, now, now);
  } catch {
    // Corrida entre checagem e INSERT (índice único).
    if (findUser(db, username)) {
      throw new AppError(409, ERROR_CODES.CONFLICT, 'Este usuário já existe.');
    }
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Erro interno. Tente novamente.');
  }

  logActivity(db, {
    actorId,
    action: 'user.create',
    entityType: 'user',
    entityId: id,
    summary: `${username} (${input.role})`,
  });
  return toManagedUser(getManagedUser(db, id));
}

export interface UpdateUserInput {
  displayName?: string;
  role?: UserRole;
  isActive?: boolean;
}

/**
 * Atualiza usuário (admin). Trava de segurança: ninguém altera o próprio
 * papel nem desativa a própria conta (evita lockout administrativo).
 */
export function updateUser(
  db: Db,
  actorId: string,
  targetId: string,
  input: UpdateUserInput,
): ReturnType<typeof toManagedUser> {
  const target = getManagedUser(db, targetId);
  const self = targetId === actorId;

  if (self && input.role !== undefined && input.role !== target.role) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Você não pode alterar seu próprio papel.');
  }
  if (self && input.isActive === false) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Você não pode desativar sua própria conta.');
  }

  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    if (input.displayName !== undefined) {
      db.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`).run(
        input.displayName,
        now,
        targetId,
      );
    }
    if (input.role !== undefined && input.role !== target.role) {
      db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).run(
        input.role,
        now,
        targetId,
      );
      logActivity(db, {
        actorId,
        action: 'user.role',
        entityType: 'user',
        entityId: targetId,
        summary: `${target.username}: ${target.role} -> ${input.role}`,
      });
    }
    if (input.isActive !== undefined && (input.isActive ? 1 : 0) !== target.is_active) {
      db.prepare(
        `UPDATE users SET is_active = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      ).run(input.isActive ? 1 : 0, now, targetId);
      if (!input.isActive) {
        db.prepare(
          `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
        ).run(now, targetId);
      }
      logActivity(db, {
        actorId,
        action: input.isActive ? 'user.activate' : 'user.deactivate',
        entityType: 'user',
        entityId: targetId,
        summary: target.username,
      });
    }
  });
  apply();

  if (input.displayName !== undefined && input.role === undefined && input.isActive === undefined) {
    logActivity(db, {
      actorId,
      action: 'user.update',
      entityType: 'user',
      entityId: targetId,
      summary: target.username,
    });
  }
  return toManagedUser(getManagedUser(db, targetId));
}

/** O próprio usuário atualiza o nome de exibição. */
export function updateProfile(
  db: Db,
  userId: string,
  displayName: string,
): ReturnType<typeof toManagedUser> {
  const user = getManagedUser(db, userId);
  const now = new Date().toISOString();
  db.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`).run(
    displayName,
    now,
    userId,
  );
  logActivity(db, {
    actorId: userId,
    action: 'user.update',
    entityType: 'user',
    entityId: userId,
    summary: user.username,
  });
  return toManagedUser(getManagedUser(db, userId));
}

/**
 * Exclusão LÓGICA de usuário (admin). Nunca a si mesmo; sessões revogadas.
 * Referências (created_by etc.) usam ON DELETE SET NULL / ficam órfãs por
 * desenho — o histórico de auditoria preserva o `summary` com o username.
 */
export function deleteUser(db: Db, actorId: string, targetId: string): void {
  const target = getManagedUser(db, targetId);
  if (targetId === actorId) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Você não pode excluir sua própria conta.');
  }

  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    db.prepare(`UPDATE users SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?`).run(
      now,
      actorId,
      now,
      targetId,
    );
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(
      now,
      targetId,
    );
  });
  apply();

  logActivity(db, {
    actorId,
    action: 'user.delete',
    entityType: 'user',
    entityId: targetId,
    summary: target.username,
  });
}

/**
 * Redefinição de senha pelo admin (ex.: usuário esqueceu a provisória).
 * Nunca a si mesmo (para isso existe a troca com senha atual).
 * A nova senha nasce PROVISÓRIA e revoga todas as sessões do alvo.
 */
export async function adminResetPassword(
  db: Db,
  actorId: string,
  targetId: string,
  password: string,
): Promise<ReturnType<typeof toManagedUser>> {
  const target = getManagedUser(db, targetId);
  if (targetId === actorId) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      'Para trocar sua própria senha, use o perfil com a senha atual.',
    );
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Senha abaixo do mínimo (${PASSWORD_MIN_LENGTH} caracteres).`,
    );
  }

  const now = new Date().toISOString();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE users
          SET password_hash = ?, must_change_password = 1,
              failed_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(passwordHash, now, targetId);
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(
      now,
      targetId,
    );
  });
  apply();

  logActivity(db, {
    actorId,
    action: 'user.password',
    entityType: 'user',
    entityId: targetId,
    summary: `${target.username} (redefinida por ${actorId === targetId ? 'si mesmo' : 'admin'})`,
  });
  return toManagedUser(getManagedUser(db, targetId));
}
