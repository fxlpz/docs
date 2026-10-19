import type { SearchResultItem } from '@krndocs/shared';
import type { Db } from '../db/database.js';

/**
 * Busca full-text (FTS5) em título + corpo das páginas.
 *
 * - A exclusão é lógica, mas o índice FTS só sai no DELETE físico: por isso
 *   o JOIN com `nodes` filtra `deleted_at IS NULL` aqui (nunca confie só no índice).
 * - A query do usuário é sanitizada para sintaxe FTS5: cada termo vira frase
 *   entre aspas com prefixo (`"termo"*`), sem caracteres de controle do match.
 * - `tags` do índice não é mantido em mudanças de `page_tags` (limitação
 *   conhecida); a busca cobre título + corpo.
 */

const MAX_RESULTS = 50;

/** Converte texto livre em expressão MATCH segura (frases com prefixo). */
export function toFtsQuery(query: string): string | null {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/["*^:()[\]{}~]/g, '').trim())
    .filter((term) => term.length > 0)
    .slice(0, 10);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(' ');
}

interface FtsRow {
  node_id: string;
  title: string;
  snippet: string;
  rank: number;
}

export function searchNodes(db: Db, query: string): SearchResultItem[] {
  const match = toFtsQuery(query);
  if (!match) return [];

  const rows = db
    .prepare<[string], FtsRow>(
      `SELECT f.node_id, n.title,
              snippet(pages_fts, 2, '', '', ' … ', 24) AS snippet,
              bm25(pages_fts) AS rank
         FROM pages_fts f
         JOIN nodes n ON n.id = f.node_id
        WHERE pages_fts MATCH ?
          AND n.deleted_at IS NULL
        ORDER BY rank
        LIMIT ${MAX_RESULTS}`,
    )
    .all(match);

  return rows.map((row) => ({
    nodeId: row.node_id,
    title: row.title,
    snippet: row.snippet,
    rank: row.rank,
  }));
}
