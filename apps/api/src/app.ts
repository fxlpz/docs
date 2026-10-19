import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ERROR_CODES, type HealthResponse, healthResponseSchema } from '@krndocs/shared';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { Env } from './config/env.js';
import { serveStaticEnabled } from './config/env.js';
import type { DataPaths } from './config/paths.js';
import type { Db } from './db/database.js';
import { countMigrations } from './db/migrate.js';
import { AppError, fromZodError, safeEnvelope } from './lib/errors.js';
import { parseOutput } from './lib/validate.js';
import { attachSession, enforcePasswordFreshness } from './plugins/auth.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHistoryRoutes, registerTrashRoutes } from './routes/history.js';
import { registerNodeRoutes } from './routes/nodes.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerUserRoutes } from './routes/users.js';
import { registerVisibilityRoutes } from './routes/visibility.js';

export interface AppContext {
  env: Env;
  paths: DataPaths;
  db: Db;
  version: string;
  /**
   * Diretório do front pronto (`apps/web/dist`). Quando definido + estático
   * ativo, a API serve o SPA na mesma origem (produção em loopback).
   */
  webDistDir?: string;
}

interface BuildOptions {
  logger?: boolean;
}

/**
 * Constrói a instância Fastify.
 *
 * Camadas separadas:
 *   rotas (HTTP + validação) -> serviços (regras) -> db (persistência)
 * A autorização será aplicada em TODA rota (exceto /api/health e /api/auth/login).
 */
export async function buildApp(
  ctx: AppContext,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: ctx.env.LOG_LEVEL,
            // Nunca logar segredos/cookies de sessão
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                "res.headers['set-cookie']",
              ],
              censor: '[REDACTED]',
            },
            serializers: {
              req(request) {
                return {
                  method: request.method,
                  url: request.url,
                  remoteAddress: request.ip,
                };
              },
            },
          },
    genReqId: () => randomUUID(),
    trustProxy: false,
    bodyLimit: 2 * 1024 * 1024, // 2 MiB para JSON (anexos usam multipart com próprio limite)
  });

  await app.register(fastifyHelmet, {
    // Conteúdo servido pela mesma origem; sem CDN externa.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind/estilos inline do editor
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  });

  await app.register(fastifyCookie, {
    // Cookies assinados com SESSION_SECRET (Etapa 2, autenticação)
    ...(ctx.env.SESSION_SECRET ? { secret: ctx.env.SESSION_SECRET } : {}),
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.env.COOKIE_SECURE,
      path: '/',
    },
  });

  // Rate limit só onde declarado (global: false): reforço ao lockout persistente
  // do login, com o MESMO envelope de erro de toda a aplicação.
  // ATENÇÃO: o plugin faz `throw` do retorno do builder — por isso devolvemos
  // um AppError (com statusCode), e o setErrorHandler formata o envelope.
  await app.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new AppError(
        429,
        ERROR_CODES.RATE_LIMITED,
        `Muitas requisições. Aguarde um momento e tente novamente. (${context.after})`,
      ),
  });

  // Multipart só onde declarado (upload de anexos): 1 arquivo, 25 MiB.
  // Acima do limite, o plugin responde 413 — mesmo envelope do resto.
  await app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: 25 * 1024 * 1024 },
  });

  // Sessão por cookie em todo request (popula request.user).
  attachSession(app, ctx);
  // Senha provisória trava tudo fora de /api/auth/* (403 até a troca).
  enforcePasswordFreshness(app);

  // Front pronto na mesma origem (produção em loopback): exige dist existente.
  // Sem dist (dev/teste), o Vite atende o front e este bloco é inerte.
  const staticRoot =
    serveStaticEnabled(ctx.env) && ctx.webDistDir && fs.existsSync(ctx.webDistDir)
      ? path.normalize(ctx.webDistDir)
      : null;
  if (staticRoot) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
      index: 'index.html',
      // Assets com hash podem cachear 1 ano; o index.html nunca cacheia
      // (é ele que aponta para os assets novos a cada deploy).
      maxAge: '1y',
      immutable: true,
      setHeaders: (reply, filePath) => {
        if (filePath.endsWith('index.html')) reply.header('cache-control', 'no-store');
      },
    });
  } else if (serveStaticEnabled(ctx.env)) {
    app.log.warn(
      { webDistDir: ctx.webDistDir ?? null },
      'estático ativo mas dist ausente: rode npm run build',
    );
  }

  // ---- tratamento uniforme de erros ----
  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);

    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, 'erro da aplicação');
      else request.log.info({ code: error.code }, 'erro tratado');
      return reply.status(error.statusCode).send(safeEnvelope(error, requestId));
    }

    if (error instanceof ZodError) {
      const appError = fromZodError(error);
      return reply.status(400).send(safeEnvelope(appError, requestId));
    }

    // Fastify: corpo inválido / multipart malformado
    const statusCode = extractStatusCode(error);
    if (statusCode === 413) {
      return reply
        .status(413)
        .send(
          safeEnvelope(
            new AppError(413, 'PAYLOAD_TOO_LARGE', 'Conteúdo acima do tamanho permitido.'),
            requestId,
          ),
        );
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply
        .status(statusCode)
        .send(
          safeEnvelope(
            new AppError(statusCode, 'VALIDATION_ERROR', 'Requisição inválida.'),
            requestId,
          ),
        );
    }

    // Erro inesperado: loga tudo no servidor, devolve mensagem genérica.
    request.log.error({ err: error }, 'erro não tratado');
    return reply
      .status(500)
      .send(
        safeEnvelope(
          new AppError(500, 'INTERNAL_ERROR', 'Erro interno. Tente novamente.'),
          requestId,
        ),
      );
  });

  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    // SPA fallback: rotas do front voltam ao index.html (o roteador decide).
    // Rotas de API inexistentes continuam em envelope JSON.
    if (request.method === 'GET' && !url.startsWith('/api/') && staticRoot) {
      reply.header('cache-control', 'no-store');
      return reply.sendFile('index.html');
    }
    return reply
      .status(404)
      .send(
        safeEnvelope(new AppError(404, 'NOT_FOUND', 'Rota não encontrada.'), String(request.id)),
      );
  });

  // ---- rotas ----
  await registerHealthRoutes(app, ctx);
  await registerAuthRoutes(app, ctx);
  // Rotas públicas ANTES das autenticadas: sem requireAuth por desenho
  // (só leitura do que é public-chain; ver services/public.ts).
  await registerPublicRoutes(app, ctx);
  await registerNodeRoutes(app, ctx);
  await registerSearchRoutes(app, ctx);
  await registerAttachmentRoutes(app, ctx);
  await registerTemplateRoutes(app, ctx);
  await registerHistoryRoutes(app, ctx);
  await registerTrashRoutes(app, ctx);
  await registerVisibilityRoutes(app, ctx);
  await registerUserRoutes(app, ctx);

  return app;
}

/**
 * Extrai o status HTTP de um erro `unknown` (Fastify anexa `statusCode` a erros
 * de validação/multipart). Qualquer valor fora de 4xx–5xx vira 500.
 */
function extractStatusCode(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return 500;
  const { statusCode } = error as { statusCode?: unknown };
  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode >= 600) return 500;
  return statusCode;
}

async function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/health', async (request, reply: FastifyReply) => {
    let migrations: number;
    let degraded = false;
    try {
      migrations = countMigrations(ctx.db);
    } catch {
      // Banco indisponível: reporta degradado (503) em vez de "ok" enganoso.
      migrations = 0;
      degraded = true;
    }
    const payload: HealthResponse = {
      status: degraded ? 'degraded' : 'ok',
      version: ctx.version,
      time: new Date().toISOString(),
      migrations,
    };
    // Validação de saída: se o payload violar o contrato, o erro é NOSSO (500),
    // nunca um 400 "de cliente".
    const health = parseOutput(healthResponseSchema, payload, request);
    reply.header('cache-control', 'no-store');
    return reply.status(degraded ? 503 : 200).send(health);
  });
}
