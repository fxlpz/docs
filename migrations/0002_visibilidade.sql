-- ============================================================
-- KernelDocs - 0002_visibilidade.sql
-- Visibilidade pública/privada por nó (landing pública).
--
-- - Coluna nova com padrão 'private': nada existente muda de visibilidade.
-- - Leitura pública exige o nó E todos os ancestrais como 'public'
--   (regra aplicada no backend, em services/public.ts).
-- ============================================================

ALTER TABLE nodes
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'public'));

CREATE INDEX nodes_visibility_idx ON nodes (visibility) WHERE visibility = 'public' AND deleted_at IS NULL;
