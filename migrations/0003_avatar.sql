-- ============================================================
-- KernelDocs - 0003_avatar.sql
-- Foto de perfil do usuário (armazenada em DATA_DIR/avatars).
--
-- - Coluna nova, anulável: ninguém existente muda de comportamento.
-- - O arquivo em disco usa chave gerada pelo servidor (UUID, sem extensão),
--   como os anexos; o nome original nunca vira caminho.
-- ============================================================

ALTER TABLE users ADD COLUMN avatar_storage_key TEXT;
