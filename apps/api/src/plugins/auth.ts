import { ERROR_CODES, type SessionUser } from '@krndocs/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { resolveSession, SESSION_COOKIE } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuário da sessão corrente; null quando não autenticado. */
    user: SessionUser | null;
    /** true quando a senha é provisória (troca obrigatória pendente). */
    mustChangePassword: boolean;
  }
}

/**
 * Sessão em todo request: lê o cookie, resolve no banco e popula
 * `request.user` + `request.mustChangePassword`. Rotas públicas
 * (health, login) simplesmente ignoram.
 *
 * O cookie é assinado quando existe SESSION_SECRET; sem secret (dev), o valor
 * cru é aceito — o token aleatório de 256 bits já é inviável de adivinhar e o
 * hash no banco valida a sessão.
 */
export function attachSession(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('user', null);
  app.decorateRequest('mustChangePassword', false);

  app.addHook('onRequest', async (request) => {
    request.user = null;
    request.mustChangePassword = false;
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    let token: string | null = raw;
    if (ctx.env.SESSION_SECRET) {
      const unsigned = request.unsignCookie(raw);
      token = unsigned.valid && unsigned.value ? unsigned.value : null;
    }
    if (!token) return;

    const resolved = resolveSession(ctx.db, token);
    if (!resolved) return;
    request.user = resolved.user;
    request.mustChangePassword = resolved.mustChangePassword;
  });
}

/**
 * Trava global de senha provisória: com a flag levantada, toda rota de API
 * fora de `/api/auth/*` responde 403 PASSWORD_CHANGE_REQUIRED.
 *
 * Registrar DEPOIS de `attachSession` (o hook precisa da sessão resolvida).
 * Cobertura automática para rotas futuras — a autorização continua verificada
 * no servidor, nunca só na interface.
 */
export function enforcePasswordFreshness(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (!request.user || !request.mustChangePassword) return;
    const path = request.url.split('?')[0] ?? '';
    if (path.startsWith('/api/auth/')) return;
    throw new AppError(
      403,
      ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
      'Troca de senha obrigatória antes de continuar. Defina uma nova senha.',
    );
  });
}

/** preHandler: exige sessão válida (401 caso contrário). */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Autenticação necessária.');
  }
}

/** preHandler: exige sessão válida de administrador (403 caso contrário). */
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Autenticação necessária.');
  }
  if (request.user.role !== 'admin') {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      'Apenas administradores podem executar esta ação.',
    );
  }
}

/** Extrai o token cru (já não-assinado) do cookie de sessão, ou null. */
export function sessionTokenFrom(request: FastifyRequest, ctx: AppContext): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  if (!ctx.env.SESSION_SECRET) return raw;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}
