import { z } from 'zod';

/**
 * Contratos da árvore de páginas e do conteúdo de página (Etapa 2).
 *
 * - `nodes` é a árvore unificada: pasta e página no mesmo modelo.
 * - Exclusão é SEMPRE lógica (deleted_at) — nenhum contrato expõe remoção física.
 * - O conteúdo do editor é JSON estruturado (BlockNote); o servidor valida a
 *   estrutura mínima e o controle otimista por versão (baseVersion).
 */

export const nodeTypeSchema = z.enum(['folder', 'page']);
export type NodeType = z.infer<typeof nodeTypeSchema>;

/** Título: 0 a 200 caracteres (páginas podem nascer sem título). */
export const nodeTitleSchema = z.string().max(200);
/** Ícone: emoji ou identificador curto (16 chars). */
export const nodeIconSchema = z.string().max(16);

/** Resumo de nó usado na árvore lateral. */
export const nodeSummarySchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  parentId: z.string().min(1).nullable(),
  title: nodeTitleSchema,
  icon: nodeIconSchema.nullable(),
  position: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  /**
   * Visibilidade (landing pública). Default para compatibilidade com
   * respostas antigas em cache: ausente = privado.
   */
  visibility: z.enum(['private', 'public']).default('private'),
});
export type NodeSummary = z.infer<typeof nodeSummarySchema>;

/** GET /api/tree - lista plana; a árvore é montada no cliente pelo parentId. */
export const treeResponseSchema = z.object({
  nodes: z.array(nodeSummarySchema),
});
export type TreeResponse = z.infer<typeof treeResponseSchema>;

/** POST /api/nodes - criação de pasta ou página. */
export const createNodeRequestSchema = z.object({
  type: nodeTypeSchema,
  parentId: z.string().min(1).nullish(),
  title: nodeTitleSchema.default(''),
  icon: nodeIconSchema.nullish(),
});
export type CreateNodeRequest = z.infer<typeof createNodeRequestSchema>;

/** PATCH /api/nodes/:id - renomear, trocar ícone e/ou mover. */
export const updateNodeRequestSchema = z
  .object({
    title: nodeTitleSchema.optional(),
    icon: nodeIconSchema.nullish(),
    /** Novo pai (mover); null = raiz. */
    parentId: z.string().min(1).nullish(),
    position: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.icon !== undefined ||
      value.parentId !== undefined ||
      value.position !== undefined,
    { message: 'Informe ao menos um campo para atualizar.' },
  );
export type UpdateNodeRequest = z.infer<typeof updateNodeRequestSchema>;

/**
 * Documento do editor: lista de blocos (formato serializado do BlockNote).
 * O servidor valida a forma; o conteúdo textual é derivado para busca.
 */
export const pageContentSchema = z.array(z.unknown()).max(100_000);
export type PageContent = z.infer<typeof pageContentSchema>;

/** Detalhe de página (GET /api/nodes/:id). */
export const nodeDetailSchema = nodeSummarySchema.extend({
  /** Versão corrente do conteúdo; 0 = página ainda sem conteúdo salvo. */
  version: z.number().int().nonnegative(),
  /** Conteúdo salvo (null se nunca salvo). */
  content: pageContentSchema.nullable(),
});
export type NodeDetail = z.infer<typeof nodeDetailSchema>;

/** PUT /api/nodes/:id/content - salvamento com controle otimista. */
export const saveContentRequestSchema = z.object({
  content: pageContentSchema,
  /** Versão que o cliente tem; divergente da atual => 409 VERSION_CONFLICT. */
  baseVersion: z.number().int().nonnegative(),
  source: z.enum(['autosave', 'manual']).default('manual'),
});
export type SaveContentRequest = z.infer<typeof saveContentRequestSchema>;

/**
 * POST /api/nodes/:id/move - mover para outra pasta e/ou posição.
 * `beforeId` = inserir antes deste irmão (null = no fim). Posições dos
 * irmãos são renumeradas de forma densa no servidor (sem furos/duplicatas).
 */
export const moveNodeRequestSchema = z.object({
  parentId: z.string().min(1).nullish(),
  beforeId: z.string().min(1).nullish(),
});
export type MoveNodeRequest = z.infer<typeof moveNodeRequestSchema>;

/** Resposta do salvamento. */
export const saveContentResponseSchema = z.object({
  version: z.number().int().min(1),
  updatedAt: z.string().datetime(),
});
export type SaveContentResponse = z.infer<typeof saveContentResponseSchema>;
