import { z } from 'zod';
import { nodeIconSchema, nodeTitleSchema, nodeTypeSchema, pageContentSchema } from './nodes.js';

/**
 * Contratos de visibilidade pública/privada (landing pública).
 *
 * - `private` (padrão): exige sessão, como sempre.
 * - `public`: leitura anônima na landing. A regra de ancestralidade
 *   (nó + todos os pais públicos) é aplicada no backend, nunca no cliente.
 * - Contratos públicos carregam o MÍNIMO para leitura: sem autor, sem
 *   histórico, sem IDs de usuário.
 */

export const visibilitySchema = z.enum(['private', 'public']);
export type Visibility = z.infer<typeof visibilitySchema>;

/** POST /api/nodes/:id/visibility (admin) — troca com cascata opcional. */
export const setVisibilityRequestSchema = z.object({
  visibility: visibilitySchema,
  /**
   * Cascata: aplica a toda a subárvore de uma vez. Padrão false (o operador
   * confirma explicitamente na UI antes de publicar em massa).
   */
  cascade: z.boolean().default(false),
});
export type SetVisibilityRequest = z.infer<typeof setVisibilityRequestSchema>;

/** Nó na árvore pública (sem metadados internos). */
export const publicNodeSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  parentId: z.string().min(1).nullable(),
  title: nodeTitleSchema,
  icon: nodeIconSchema.nullable(),
  position: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type PublicNode = z.infer<typeof publicNodeSchema>;

/** GET /api/public/tree */
export const publicTreeResponseSchema = z.object({
  nodes: z.array(publicNodeSchema),
});
export type PublicTreeResponse = z.infer<typeof publicTreeResponseSchema>;

/** GET /api/public/pages/:id — leitura pública (somente título + conteúdo). */
export const publicPageSchema = publicNodeSchema.extend({
  content: pageContentSchema.nullable(),
});
export type PublicPage = z.infer<typeof publicPageSchema>;

/** Anexo visível na página pública (metadados para download). */
export const publicAttachmentSchema = z.object({
  id: z.string().min(1),
  originalName: z.string().min(1).max(255),
  mime: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
});
export type PublicAttachment = z.infer<typeof publicAttachmentSchema>;

/** GET /api/public/pages/:id/attachments */
export const publicAttachmentListResponseSchema = z.object({
  attachments: z.array(publicAttachmentSchema),
});
export type PublicAttachmentListResponse = z.infer<typeof publicAttachmentListResponseSchema>;
