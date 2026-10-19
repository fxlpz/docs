import { z } from 'zod';
import { nodeIconSchema } from './nodes.js';

/**
 * Contratos de templates (Etapa 3).
 *
 * Template = página marcada (`templates` + `nodes.is_template`); o conteúdo
 * mora em `page_versions` como qualquer página. Criar a partir de um template
 * copia o conteúdo da versão corrente para uma página nova (v1).
 */

export const templateItemSchema = z.object({
  nodeId: z.string().min(1),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60),
  description: z.string().max(500).nullable(),
  position: z.number().int().nonnegative(),
  /** Título atual da página-template (para exibição). */
  pageTitle: z.string(),
  /** Ícone (emoji) da página-template, como no Notion. */
  icon: nodeIconSchema.nullable(),
});
export type TemplateItem = z.infer<typeof templateItemSchema>;

/** GET /api/templates */
export const templateListResponseSchema = z.object({
  templates: z.array(templateItemSchema),
});
export type TemplateListResponse = z.infer<typeof templateListResponseSchema>;

/** POST /api/nodes/:id/make-template — marca página como template. */
export const markTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60).default('Geral'),
  description: z.string().trim().max(500).nullish(),
});
export type MarkTemplateRequest = z.infer<typeof markTemplateRequestSchema>;

/** POST /api/templates/:id/pages — cria página a partir do template. */
export const createFromTemplateRequestSchema = z.object({
  parentId: z.string().min(1).nullish(),
  /** Título da nova página (padrão: título do template). */
  title: z.string().max(200).nullish(),
});
export type CreateFromTemplateRequest = z.infer<typeof createFromTemplateRequestSchema>;
