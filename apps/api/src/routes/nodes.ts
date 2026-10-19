import {
  createNodeRequestSchema,
  moveNodeRequestSchema,
  nodeDetailSchema,
  nodeSummarySchema,
  saveContentRequestSchema,
  saveContentResponseSchema,
  treeResponseSchema,
  updateNodeRequestSchema,
} from '@krndocs/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parseOutput } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';
import {
  createNode,
  deleteNode,
  getNodeDetail,
  listNodes,
  moveNode,
  saveContent,
  updateNode,
} from '../services/nodes.js';

/**
 * Rotas da árvore e do conteúdo (Etapa 2) — TODAS exigem sessão.
 * A autorização é sempre verificada no servidor, nunca só na interface.
 */

const idParamSchema = z.object({ id: z.string().min(1) });

/** Usuário autentado do request (requireAuth garante no runtime). */
function actorOf(request: FastifyRequest): { id: string } {
  const user = request.user;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return { id: user.id };
}

export async function registerNodeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/tree', { preHandler: requireAuth }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return parseOutput(treeResponseSchema, { nodes: listNodes(ctx.db) }, request);
  });

  app.post('/api/nodes', { preHandler: requireAuth }, async (request, reply) => {
    const body = createNodeRequestSchema.parse(request.body);
    const node = createNode(ctx.db, actorOf(request).id, body);
    reply.status(201);
    return parseOutput(nodeSummarySchema, node, request);
  });

  app.get('/api/nodes/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const detail = getNodeDetail(ctx.db, id);
    reply.header('cache-control', 'no-store');
    return parseOutput(nodeDetailSchema, detail, request);
  });

  app.patch('/api/nodes/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateNodeRequestSchema.parse(request.body);
    const node = updateNode(ctx.db, actorOf(request).id, id, body);
    return parseOutput(nodeSummarySchema, node, request);
  });

  app.post('/api/nodes/:id/move', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = moveNodeRequestSchema.parse(request.body);
    const node = moveNode(ctx.db, actorOf(request).id, id, {
      parentId: body.parentId ?? null,
      beforeId: body.beforeId ?? null,
    });
    return parseOutput(nodeSummarySchema, node, request);
  });

  app.delete('/api/nodes/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    deleteNode(ctx.db, actorOf(request).id, id);
    return reply.status(204).send();
  });

  app.put('/api/nodes/:id/content', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = saveContentRequestSchema.parse(request.body);
    const result = saveContent(ctx.db, actorOf(request).id, id, body);
    reply.header('cache-control', 'no-store');
    return parseOutput(saveContentResponseSchema, result, request);
  });
}
