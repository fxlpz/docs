import fs from 'node:fs';
import {
  addFavoriteRequestSchema,
  attachmentListResponseSchema,
  attachmentUploadResponseSchema,
  downloadQuerySchema,
  favoriteListResponseSchema,
} from '@krndocs/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parseOutput } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';
import {
  deleteAttachment,
  getDownloadTarget,
  isInlineableMime,
  listAttachments,
  saveAttachment,
} from '../services/attachments.js';
import { addFavorite, listFavorites, removeFavorite } from '../services/favorites.js';

/**
 * Anexos + favoritos (Etapa 3) — TODAS exigem sessão.
 *
 * Anexos: upload multipart (campo `file`), download como `attachment`
 * (nunca inline) com MIME detectado no servidor, exclusão lógica.
 */

const idParamSchema = z.object({ id: z.string().min(1) });

function actorOf(request: FastifyRequest): { id: string } {
  const user = request.user;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return { id: user.id };
}

/** Nome de download seguro: ASCII, sem caminho, com extensão neutra. */
function downloadFileName(originalName: string, mime: string): string {
  const ascii = originalName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/"]/g, '_')
    .trim()
    .slice(0, 100);
  const base = ascii || 'anexo';
  const ext = mime === 'application/pdf' ? '.pdf' : mime.startsWith('image/') ? '.img' : '.txt';
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}

export async function registerAttachmentRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post('/api/nodes/:id/attachments', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const part = await request.file();
    if (!part) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Envie o arquivo no campo `file`.');
    }
    const buffer = await part.toBuffer();
    const attachment = await saveAttachment(ctx.db, ctx.paths.attachmentsDir, {
      nodeId: id,
      actorId: actorOf(request).id,
      originalName: part.filename,
      mimeDeclared: part.mimetype,
      buffer,
    });
    reply.status(201);
    return parseOutput(attachmentUploadResponseSchema, attachment, request);
  });

  app.get('/api/nodes/:id/attachments', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const attachments = listAttachments(ctx.db, id);
    reply.header('cache-control', 'no-store');
    return parseOutput(attachmentListResponseSchema, { attachments }, request);
  });

  app.get('/api/attachments/:id/download', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    // ?inline=1 exibe no navegador (só mídia); o resto sempre baixa.
    const { inline } = downloadQuerySchema.parse(request.query);
    const { attachment, filePath } = getDownloadTarget(ctx.db, ctx.paths.attachmentsDir, id);
    const stat = fs.statSync(filePath);
    const showInline = inline === '1' && isInlineableMime(attachment.mime);
    reply.header('content-type', attachment.mime);
    reply.header('content-length', stat.size);
    if (showInline) {
      // Mídia embutível: sem sniffing, sem execução — só renderização.
      reply.header('content-disposition', 'inline');
      reply.header('x-content-type-options', 'nosniff');
    } else {
      reply.header(
        'content-disposition',
        `attachment; filename="${downloadFileName(attachment.originalName, attachment.mime)}"`,
      );
    }
    reply.header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(filePath));
  });

  app.delete('/api/attachments/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    deleteAttachment(ctx.db, actorOf(request).id, id);
    return reply.status(204).send();
  });

  // ---- Favoritos ----
  app.get('/api/favorites', { preHandler: requireAuth }, async (request, reply) => {
    const favorites = listFavorites(ctx.db, actorOf(request).id);
    reply.header('cache-control', 'no-store');
    return parseOutput(favoriteListResponseSchema, { favorites }, request);
  });

  app.post('/api/favorites', { preHandler: requireAuth }, async (request, reply) => {
    const body = addFavoriteRequestSchema.parse(request.body);
    const favorite = addFavorite(ctx.db, actorOf(request).id, body.nodeId);
    reply.status(200);
    return parseOutput(favoriteListResponseSchema, { favorites: [favorite] }, request);
  });

  app.delete('/api/favorites/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    removeFavorite(ctx.db, actorOf(request).id, id);
    return reply.status(204).send();
  });
}
