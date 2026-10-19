import { z } from 'zod';
import { nodeSummarySchema } from './nodes.js';

/**
 * Contratos da lixeira (Etapa 3).
 *
 * - Exclusão continua lógica (`deleted_at`); a lixeira lista os excluídos.
 * - Restaurar um item restaura também os ancestrais (necessário p/ visibilidade).
 * - Exclusão definitiva é física e exige confirmação explícita
 *   (`?confirm=true`); sem ela, a API responde 400 e nada apaga.
 */

export const trashItemSchema = nodeSummarySchema.extend({
  deletedAt: z.string().datetime(),
});
export type TrashItem = z.infer<typeof trashItemSchema>;

/** GET /api/trash */
export const trashResponseSchema = z.object({
  nodes: z.array(trashItemSchema),
});
export type TrashResponse = z.infer<typeof trashResponseSchema>;

/** DELETE /api/nodes/:id/permanent?confirm=true — query da confirmação. */
export const permanentDeleteQuerySchema = z.object({
  confirm: z.literal('true', {
    message: 'Confirme a exclusão definitiva com ?confirm=true.',
  }),
});
export type PermanentDeleteQuery = z.infer<typeof permanentDeleteQuerySchema>;
