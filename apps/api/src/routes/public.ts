import fs from 'node:fs';
import {
  downloadQuerySchema,
  publicAttachmentListResponseSchema,
  publicPageSchema,
  publicTreeResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
} from '@krndocs/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { parseOutput } from '../lib/validate.js';
import { isInlineableMime } from '../services/attachments.js';
import {
  getPublicDownloadTarget,
  getPublicPage,
  listPublicAttachments,
  listPublicTree,
  searchPublic,
} from '../services/public.js';

/**
 * Leitura pública anônima (landing). SEM `requireAuth` por desenho:
 * - Só expõe nós com cadeia ancestral integralmente pública (backend).
 * - Contratos mínimos de leitura (sem autor, histórico ou IDs de usuário).
 * - Exceções explícitas na matriz de autorização (`authz.test.ts`).
 */

const idParamSchema = z.object({ id: z.string().min(1) });

/** Nome de download seguro (mesma regra da rota autenticada). */
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

export async function registerPublicRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/public/tree', async (request, reply) => {
    const nodes = listPublicTree(ctx.db);
    reply.header('cache-control', 'no-store');
    return parseOutput(publicTreeResponseSchema, { nodes }, request);
  });

  app.get('/api/public/pages/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const page = getPublicPage(ctx.db, id);
    reply.header('cache-control', 'no-store');
    return parseOutput(publicPageSchema, page, request);
  });

  app.get('/api/public/search', async (request, reply) => {
    const { q } = searchQuerySchema.parse(request.query);
    const results = searchPublic(ctx.db, q);
    reply.header('cache-control', 'no-store');
    return parseOutput(searchResponseSchema, { query: q, results }, request);
  });

  app.get('/api/public/pages/:id/attachments', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const attachments = listPublicAttachments(ctx.db, id);
    reply.header('cache-control', 'no-store');
    return parseOutput(publicAttachmentListResponseSchema, { attachments }, request);
  });

  app.get('/api/public/attachments/:id/download', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { inline } = downloadQuerySchema.parse(request.query);
    const target = getPublicDownloadTarget(ctx.db, ctx.paths.attachmentsDir, id);
    const stat = fs.statSync(target.filePath);
    const showInline = inline === '1' && isInlineableMime(target.mime);
    reply.header('content-type', target.mime);
    reply.header('content-length', stat.size);
    if (showInline) {
      reply.header('content-disposition', 'inline');
      reply.header('x-content-type-options', 'nosniff');
    } else {
      reply.header(
        'content-disposition',
        `attachment; filename="${downloadFileName(target.originalName, target.mime)}"`,
      );
    }
    reply.header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(target.filePath));
  });
}
