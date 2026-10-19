import {
  nodeSummarySchema,
  permanentDeleteQuerySchema,
  restoreVersionRequestSchema,
  saveContentResponseSchema,
  trashResponseSchema,
  versionDetailSchema,
  versionListResponseSchema,
} from '@krndocs/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parseOutput } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';
import { getVersion, listVersions, restoreVersion } from '../services/history.js';
import { listTrash, permanentlyDeleteNode, restoreNode } from '../services/trash.js';

/**
 * Histórico + lixeira (Etapa 3) — TODAS exigem sessão.
 *
 * - Histórico é imutável: restaurar cria nova versão (`restore`).
 * - Lixeira: restaurar reativa subárvore + ancestrais; excluir de verdade é
 *   físico e exige `?confirm=true` explícito.
 */

const idParamSchema = z.object({ id: z.string().min(1) });
const versionParamSchema = z.object({ id: z.string().min(1), v: z.coerce.number().int().min(1) });

function actorOf(request: FastifyRequest): { id: string } {
  const user = request.user;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return { id: user.id };
}

export async function registerHistoryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/nodes/:id/versions', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const versions = listVersions(ctx.db, id);
    reply.header('cache-control', 'no-store');
    return parseOutput(versionListResponseSchema, { versions }, request);
  });

  app.get('/api/nodes/:id/versions/:v', { preHandler: requireAuth }, async (request, reply) => {
    const { id, v } = versionParamSchema.parse(request.params);
    const detail = getVersion(ctx.db, id, v);
    reply.header('cache-control', 'no-store');
    return parseOutput(versionDetailSchema, detail, request);
  });

  app.post(
    '/api/nodes/:id/versions/restore',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const body = restoreVersionRequestSchema.parse(request.body);
      const result = restoreVersion(ctx.db, actorOf(request).id, id, body.version);
      reply.header('cache-control', 'no-store');
      return parseOutput(saveContentResponseSchema, result, request);
    },
  );
}

export async function registerTrashRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/trash', { preHandler: requireAuth }, async (request, reply) => {
    const nodes = listTrash(ctx.db);
    reply.header('cache-control', 'no-store');
    return parseOutput(trashResponseSchema, { nodes }, request);
  });

  app.post('/api/nodes/:id/restore', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const node = restoreNode(ctx.db, actorOf(request).id, id);
    return parseOutput(nodeSummarySchema, node, request);
  });

  app.delete('/api/nodes/:id/permanent', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    // Confirmação explícita: sem ?confirm=true, nada é apagado.
    permanentDeleteQuerySchema.parse(request.query);
    permanentlyDeleteNode(ctx.db, actorOf(request).id, ctx.paths.attachmentsDir, id);
    return reply.status(204).send();
  });
}
