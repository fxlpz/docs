import { searchQuerySchema, searchResponseSchema } from '@krndocs/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { parseOutput } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';
import { searchNodes } from '../services/search.js';

/** GET /api/search?q= — busca full-text (exige sessão; gate da senha é global). */
export async function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/search', { preHandler: requireAuth }, async (request, reply) => {
    const { q } = searchQuerySchema.parse(request.query);
    const results = searchNodes(ctx.db, q);
    reply.header('cache-control', 'no-store');
    return parseOutput(searchResponseSchema, { query: q, results }, request);
  });
}
