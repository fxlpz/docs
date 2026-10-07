import {
  type AuthUserResponse,
  authUserResponseSchema,
  type ChangePasswordResponse,
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  ERROR_CODES,
  loginRequestSchema,
  logoutResponseSchema,
} from '@krndocs/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { maskIp } from '../lib/ip.js';
import { parseOutput } from '../lib/validate.js';
import { requireAuth, sessionTokenFrom } from '../plugins/auth.js';
import { logActivity } from '../services/activity.js';
import {
  authenticate,
  changePassword,
  createSession,
  purgeExpiredSessions,
  revokeSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '../services/auth.js';

/**
 * Rotas de autenticação (Etapa 2).
 *
 * - POST /api/auth/login            - única rota pública de escrita; rate limit + lockout.
 * - POST /api/auth/logout           - idempotente (revoga sessão e limpa cookie).
 * - GET  /api/auth/me               - exige sessão válida (devolve a flag de troca).
 * - POST /api/auth/change-password  - troca obrigatória no 1º acesso (emite sessão nova).
 * Nenhuma resposta loga ou devolve senha, hash ou token cru.
 */
export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post(
    '/api/auth/login',
    {
      config: {
        // Limite por IP em complemento ao lockout por conta (defesa em profundidade).
        rateLimit: { max: 30, timeWindow: '5 minutes' },
      },
    },
    async (request, reply) => {
      const body = loginRequestSchema.parse(request.body);
      const userAgent = request.headers['user-agent'];
      const meta = {
        ipMasked: maskIp(request.ip),
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
      };

      const result = await authenticate(ctx.db, body, meta);

      if (!result.ok) {
        logActivity(ctx.db, {
          actorId: null,
          action: 'login.failure',
          entityType: 'session',
          summary: body.username,
          ipMasked: meta.ipMasked,
        });
        if (result.reason === 'locked') {
          throw new AppError(
            429,
            ERROR_CODES.RATE_LIMITED,
            'Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.',
          );
        }
        if (result.reason === 'inactive') {
          throw new AppError(
            403,
            ERROR_CODES.FORBIDDEN,
            'Conta desativada. Procure um administrador.',
          );
        }
        throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Usuário ou senha incorretos.');
      }

      const session = createSession(ctx.db, result.user.id, meta);
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.env.COOKIE_SECURE,
        path: '/',
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
        signed: Boolean(ctx.env.SESSION_SECRET),
      });

      logActivity(ctx.db, {
        actorId: result.user.id,
        action: 'login.success',
        entityType: 'session',
        summary: result.user.username,
        ipMasked: meta.ipMasked,
      });

      reply.header('cache-control', 'no-store');
      return parseOutput<AuthUserResponse>(
        authUserResponseSchema,
        { user: result.user, mustChangePassword: result.mustChangePassword },
        request,
      );
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = sessionTokenFrom(request, ctx);
    if (token) {
      revokeSession(ctx.db, token);
      purgeExpiredSessions(ctx.db);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.header('cache-control', 'no-store');
    return parseOutput(logoutResponseSchema, { ok: true }, request);
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    // Narrowing defensivo: requireAuth já garante a sessão no runtime.
    const user = request.user;
    if (!user) {
      throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Autenticação necessária.');
    }
    reply.header('cache-control', 'no-store');
    return parseOutput(
      authUserResponseSchema,
      { user, mustChangePassword: request.mustChangePassword },
      request,
    );
  });

  app.post(
    '/api/auth/change-password',
    {
      preHandler: requireAuth,
      config: {
        // Mesma proteção do login: a senha atual não pode ser testada à exaustão.
        rateLimit: { max: 30, timeWindow: '5 minutes' },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Autenticação necessária.');
      }
      const body = changePasswordRequestSchema.parse(request.body);

      const result = await changePassword(ctx.db, user.id, body.currentPassword, body.newPassword);
      if (!result.ok) {
        if (result.reason === 'invalid_current') {
          throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Senha atual incorreta.');
        }
        if (result.reason === 'same_as_current') {
          throw new AppError(
            400,
            ERROR_CODES.VALIDATION_ERROR,
            'A nova senha precisa ser diferente da atual.',
          );
        }
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          'A nova senha não atende à política mínima.',
        );
      }

      // Sessões antigas foram revogadas na troca: emite sessão nova para seguir logado.
      const userAgent = request.headers['user-agent'];
      const meta = {
        ipMasked: maskIp(request.ip),
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
      };
      const session = createSession(ctx.db, user.id, meta);
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.env.COOKIE_SECURE,
        path: '/',
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
        signed: Boolean(ctx.env.SESSION_SECRET),
      });

      logActivity(ctx.db, {
        actorId: user.id,
        action: 'user.password',
        entityType: 'user',
        entityId: user.id,
        summary: user.username,
        ipMasked: meta.ipMasked,
      });

      reply.header('cache-control', 'no-store');
      return parseOutput<ChangePasswordResponse>(
        changePasswordResponseSchema,
        { ok: true },
        request,
      );
    },
  );
}
