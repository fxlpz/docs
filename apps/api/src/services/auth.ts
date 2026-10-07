import { createHash, randomBytes } from 'node:crypto';
import { PASSWORD_MIN_LENGTH, type SessionUser } from '@krndocs/shared';
import argon2 from 'argon2';
import type { Db } from '../db/database.js';
import { newId } from '../lib/ids.js';

/**
 * Serviço de autenticação local.
 *
 * - Senhas com Argon2id (nunca texto puro; o hash nunca sai daqui).
 * - Sessão por token aleatório de 256 bits: só o SHA-256 vai ao banco.
 * - Lockout progressivo persistente (users.failed_attempts/locked_until),
 *   que sobrevive a reinícios — diferente de rate limit em memória.
 * - Timing igualado quando o usuário não existe (anti-enumeration).
 */

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000; // 15 minutos

/** Cookie de sessão (httpOnly; mesmo nome em dev e produção). */
export const SESSION_COOKIE = 'kd_session';

/**
 * Hash Argon2id inerte para equalizar o tempo de resposta quando o usuário
 * não existe (evita descobrir contas por medição de latência).
 * Gerado de forma lazy e assíncrona (o argon2 não expõe versão síncrona).
 */
let dummyHashPromise: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash('timing-equalizer-not-a-real-password', {
    type: argon2.argon2id,
  });
  return dummyHashPromise;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginMeta {
  ipMasked: string | null;
  userAgent: string | null;
}

export type AuthenticateResult =
  | { ok: true; user: SessionUser; mustChangePassword: boolean }
  | { ok: false; reason: 'invalid_credentials' | 'inactive' | 'locked' };

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  password_hash: string | null;
  must_change_password: number;
  is_active: number;
  failed_attempts: number;
  locked_until: string | null;
}

function recordAttempt(db: Db, username: string, meta: LoginMeta, success: boolean): void {
  db.prepare(
    `INSERT INTO login_attempts (id, username, ip_masked, success, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(newId(), username, meta.ipMasked, success ? 1 : 0, new Date().toISOString());
}

/**
 * Verifica credenciais e atualiza contadores de lockout.
 * Não cria sessão — quem chama decide após um resultado `ok`.
 */
export async function authenticate(
  db: Db,
  credentials: LoginCredentials,
  meta: LoginMeta,
): Promise<AuthenticateResult> {
  const { username, password } = credentials;
  const now = new Date().toISOString();

  const row = db
    .prepare<[string], UserRow>(
      `SELECT id, username, display_name, role, password_hash, must_change_password, is_active, failed_attempts, locked_until
         FROM users
        WHERE username = ? AND deleted_at IS NULL`,
    )
    .get(username);

  if (!row) {
    // Mesmo custo de um verify real para não revelar que a conta não existe.
    await argon2.verify(await dummyHash(), password).catch(() => false);
    recordAttempt(db, username, meta, false);
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (row.locked_until && row.locked_until > now) {
    recordAttempt(db, username, meta, false);
    return { ok: false, reason: 'locked' };
  }

  let valid = false;
  if (row.password_hash) {
    try {
      valid = await argon2.verify(row.password_hash, password);
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    const failed = row.failed_attempts + 1;
    const lockedUntil =
      failed >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    db.prepare(
      `UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`,
    ).run(failed, lockedUntil, now, row.id);
    recordAttempt(db, username, meta, false);
    return { ok: false, reason: lockedUntil ? 'locked' : 'invalid_credentials' };
  }

  // Só após a senha correta a conta inativa é revelada — sem ela, a mensagem
  // é a genérica de credenciais (não se confirma a existência da conta).
  if (row.is_active !== 1) {
    recordAttempt(db, username, meta, false);
    return { ok: false, reason: 'inactive' };
  }

  db.prepare(
    `UPDATE users
        SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(now, now, row.id);
  recordAttempt(db, username, meta, true);

  return {
    ok: true,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    },
    mustChangePassword: row.must_change_password === 1,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface IssuedSession {
  /** Token CRU — devolvido apenas no cookie; nunca é persistido ou logado. */
  token: string;
  expiresAt: string;
}

export function createSession(db: Db, userId: string, meta: LoginMeta): IssuedSession {
  const token = randomBytes(32).toString('base64url');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, issued_at, expires_at, last_seen_at, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    userId,
    sha256(token),
    issuedAt.toISOString(),
    expiresAt,
    issuedAt.toISOString(),
    meta.ipMasked,
    meta.userAgent,
    issuedAt.toISOString(),
  );

  return { token, expiresAt };
}

/** Sessão resolvida: usuário + flag de senha provisória. */
export interface ResolvedSession {
  user: SessionUser;
  /** true quando a senha é provisória (troca obrigatória antes de usar a API). */
  mustChangePassword: boolean;
}

/** Resolve o token cru do cookie em sessão ativa, ou null. */
export function resolveSession(db: Db, token: string): ResolvedSession | null {
  const row = db
    .prepare<
      [string],
      {
        id: string;
        username: string;
        display_name: string;
        role: 'admin' | 'member';
        must_change_password: number;
        is_active: number;
        session_id: string;
        expires_at: string;
        revoked_at: string | null;
      }
    >(
      `SELECT u.id, u.username, u.display_name, u.role, u.must_change_password, u.is_active,
              s.id AS session_id, s.expires_at, s.revoked_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token));

  const now = new Date().toISOString();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at <= now) return null;
  if (row.is_active !== 1) return null;

  // last_seen deslizante permite estender a sessão por atividade no futuro.
  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(now, row.session_id);

  return {
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    },
    mustChangePassword: row.must_change_password === 1,
  };
}

/** Revoga a sessão do token (logout). Retorna true se alguma linha mudou. */
export function revokeSession(db: Db, token: string): boolean {
  const result = db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), sha256(token));
  return result.changes > 0;
}

/** Limpeza de sessões expiradas (chamada no logout; barato e localizado). */
export function purgeExpiredSessions(db: Db): void {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(new Date().toISOString());
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_current' | 'same_as_current' | 'too_short' };

/**
 * Troca a senha do usuário autenticado.
 *
 * - Exige a senha atual correta (anti-sequestro de sessão aberta).
 * - A nova senha precisa diferir da atual e respeitar o mínimo do contrato.
 * - Em sucesso: zera lockout, baixa a flag `must_change_password` e REVOGA
 *   TODAS as sessões do usuário (a rota emite uma sessão nova em seguida).
 * Tudo em transação: ou a troca é completa, ou nada muda.
 */
export async function changePassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (newPassword.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' };

  const row = db
    .prepare<[string], { password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(userId);
  if (!row?.password_hash) return { ok: false, reason: 'invalid_current' };

  let currentValid = false;
  try {
    currentValid = await argon2.verify(row.password_hash, currentPassword);
  } catch {
    currentValid = false;
  }
  if (!currentValid) return { ok: false, reason: 'invalid_current' };

  let same = false;
  try {
    same = await argon2.verify(row.password_hash, newPassword);
  } catch {
    same = false;
  }
  if (same) return { ok: false, reason: 'same_as_current' };

  const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  const now = new Date().toISOString();

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE users
          SET password_hash = ?, must_change_password = 0,
              failed_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(newHash, now, userId);
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(
      now,
      userId,
    );
  });
  apply();

  return { ok: true };
}
