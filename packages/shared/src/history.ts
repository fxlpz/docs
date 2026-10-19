import { z } from 'zod';
import { pageContentSchema } from './nodes.js';

/**
 * Contratos de histórico de versões (Etapa 3).
 *
 * - `page_versions` é imutável: restaurar cria uma NOVA versão
 *   (`source='restore'`), nunca reescreve o passado.
 * - Detalhe de versão inclui o conteúdo para visualização/comparação.
 */

export const versionSourceSchema = z.enum(['autosave', 'manual', 'restore', 'conflict_resolution']);
export type VersionSource = z.infer<typeof versionSourceSchema>;

export const versionItemSchema = z.object({
  version: z.number().int().min(1),
  titleSnapshot: z.string(),
  source: versionSourceSchema,
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  /** Nome de exibição do autor (null se conta removida). */
  createdByName: z.string().nullable(),
});
export type VersionItem = z.infer<typeof versionItemSchema>;

/** GET /api/nodes/:id/versions */
export const versionListResponseSchema = z.object({
  versions: z.array(versionItemSchema),
});
export type VersionListResponse = z.infer<typeof versionListResponseSchema>;

/** GET /api/nodes/:id/versions/:v */
export const versionDetailSchema = versionItemSchema.extend({
  content: pageContentSchema,
});
export type VersionDetail = z.infer<typeof versionDetailSchema>;

/** POST /api/nodes/:id/versions/restore — cria nova versão a partir de uma antiga. */
export const restoreVersionRequestSchema = z.object({
  version: z.number().int().min(1),
});
export type RestoreVersionRequest = z.infer<typeof restoreVersionRequestSchema>;
