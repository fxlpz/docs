import { z } from 'zod';

/**
 * Contratos de busca full-text (Etapa 3).
 *
 * - Fonte: `pages_fts` (FTS5, mantido por triggers de `nodes`).
 * - A API filtra nós com exclusão lógica; o `snippet` usa o título + corpo.
 * - O snippet é texto puro (sem HTML): a UI o renderiza como texto.
 */

/** GET /api/search?q= — query vinda da URL (tudo string). */
export const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, { message: 'Informe o termo da busca.' })
    .max(200, { message: 'Busca limitada a 200 caracteres.' }),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultItemSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string(),
  /** Trecho do corpo com o termo encontrado (texto puro). */
  snippet: z.string(),
  /** Relevância (bm25; menor = mais relevante). */
  rank: z.number(),
});
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultItemSchema).max(50),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
