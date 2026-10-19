import { nodeSummarySchema, setVisibilityRequestSchema } from '@krndocs/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parseOutput } from '../lib/validate.js';
import { requireAdmin } from '../plugins/auth.js';
import { setVisibility } from '../services/visibility.js';

/**
 * Visibilidade pública/privada — SÓ admin (`requireAdmin`).
 * Membro autenticado recebe 403; sem sessão, 401.
 */

const idParamSchema = z.object({ id: z.string().min(1) });

function actorOf(request: FastifyRequest): { id: string } {
  const user = request.user;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return { id: user.id };
}

export async function registerVisibilityRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post('/api/nodes/:id/visibility', { preHandler: requireAdmin }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = setVisibilityRequestSchema.parse(request.body);
    setVisibility(ctx.db, actorOf(request).id, id, body.visibility, body.cascade);
    const row = ctx.db
      .prepare<
        [string],
        {
          id: string;
          type: 'folder' | 'page';
          parent_id: string | null;
          title: string;
          icon: string | null;
          position: number;
          visibility: 'private' | 'public';
          updated_at: string;
        }
      >(
        `SELECT id, type, parent_id, title, icon, position, visibility, updated_at FROM nodes WHERE id = ?`,
      )
      .get(id);
    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'Item não encontrado.');
    }
    return parseOutput(
      nodeSummarySchema,
      {
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        title: row.title,
        icon: row.icon,
        position: row.position,
        visibility: row.visibility,
        updatedAt: row.updated_at,
      },
      request,
    );
  });
}
