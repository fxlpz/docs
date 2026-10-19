import { z } from 'zod';
import { nodeTypeSchema } from './nodes.js';

/**
 * Contratos de favoritos (Etapa 3).
 *
 * Favoritos são individuais por usuário (`favorites`), ordenados por posição.
 * A resposta já traz título/tipo para exibição sem nova requisição.
 */

export const favoriteItemSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string(),
  type: nodeTypeSchema,
  position: z.number().int().nonnegative(),
});
export type FavoriteItem = z.infer<typeof favoriteItemSchema>;

/** GET /api/favorites */
export const favoriteListResponseSchema = z.object({
  favorites: z.array(favoriteItemSchema),
});
export type FavoriteListResponse = z.infer<typeof favoriteListResponseSchema>;

/** POST /api/favorites — adiciona (idempotente). */
export const addFavoriteRequestSchema = z.object({
  nodeId: z.string().min(1),
});
export type AddFavoriteRequest = z.infer<typeof addFavoriteRequestSchema>;
