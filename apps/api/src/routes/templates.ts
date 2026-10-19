import {
  createFromTemplateRequestSchema,
  markTemplateRequestSchema,
  nodeSummarySchema,
  templateListResponseSchema,
} from '@krndocs/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parseOutput } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';
import { seedDefaultTemplates } from '../services/defaultTemplates.js';
import {
  createFromTemplate,
  listTemplates,
  markAsTemplate,
  unmarkTemplate,
} from '../services/templates.js';

/** Templates (Etapa 3) — TODAS exigem sessão. */

const idParamSchema = z.object({ id: z.string().min(1) });

function actorOf(request: FastifyRequest): { id: string } {
  const user = request.user;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return { id: user.id };
}

export async function registerTemplateRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/templates', { preHandler: requireAuth }, async (request, reply) => {
    const templates = listTemplates(ctx.db);
    reply.header('cache-control', 'no-store');
    return parseOutput(templateListResponseSchema, { templates }, request);
  });

  app.post('/api/nodes/:id/make-template', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = markTemplateRequestSchema.parse(request.body);
    const template = markAsTemplate(ctx.db, actorOf(request).id, id, body);
    return parseOutput(templateListResponseSchema, { templates: [template] }, request);
  });

  app.post('/api/templates/:id/pages', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = createFromTemplateRequestSchema.parse(request.body);
    const node = createFromTemplate(ctx.db, actorOf(request).id, id, body);
    reply.status(201);
    return parseOutput(nodeSummarySchema, node, request);
  });

  // Tira o modelo da lista (a página continua existindo na árvore).
  app.delete('/api/templates/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    unmarkTemplate(ctx.db, actorOf(request).id, id);
    return reply.status(204).send();
  });

  // Recria os modelos padrão (idempotente: não duplica títulos existentes).
  app.post('/api/templates/defaults', { preHandler: requireAuth }, async (request, reply) => {
    seedDefaultTemplates(ctx.db, { force: true });
    reply.status(201);
    return parseOutput(templateListResponseSchema, { templates: listTemplates(ctx.db) }, request);
  });
}
