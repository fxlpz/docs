-- ============================================================
-- KernelDocs - 0001_inicial.sql
-- Modelo de dados completo (Etapa 1).
-- Convenções:
--   * IDs estáveis: ULID/UUID em TEXT (ordenáveis, sem sequência compartilhada).
--   * Datas: TEXT em ISO 8601 UTC (ex.: 2026-10-06T18:00:00.000Z).
--   * Exclusão lógica: colunas *_at + *_by, nunca DELETE em dados de negócio.
--   * Booleanos: INTEGER 0/1 com CHECK.
--   * Toda entidade editável registra created_by / updated_by.
-- ============================================================

-- ------------------------------------------------------------
-- Usuários e autenticação
-- ------------------------------------------------------------
CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL,
  display_name         TEXT NOT NULL,
  email                TEXT,
  -- 'admin' gerencia usuários; 'member' edita documentação. Sem cadastro público.
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  -- Hash Argon2id. NULL apenas para usuários provisionados com convite pendente.
  password_hash        TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  -- Controle de lockout de login (rate limit persistente)
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  created_by           TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at           TEXT NOT NULL,
  updated_by           TEXT REFERENCES users (id) ON DELETE SET NULL,
  deleted_at           TEXT,
  deleted_by           TEXT REFERENCES users (id) ON DELETE SET NULL,
  CHECK (username = lower(username)),
  CHECK (length(username) BETWEEN 3 AND 64)
);

CREATE UNIQUE INDEX users_username_uq ON users (username) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- Sessões (autenticação local por cookie de sessão)
-- ------------------------------------------------------------
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 do token: o valor cru nunca é persistido.
  token_hash   TEXT NOT NULL,
  -- Para revogação ativa / detecção de fixação
  issued_at    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX sessions_token_hash_uq ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ------------------------------------------------------------
-- Tentativas de login (auditoria + limitação de tentativas)
-- ------------------------------------------------------------
CREATE TABLE login_attempts (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  -- Máscara de IP (octeto final zerado em octetos altos) para reduzir dado pessoal
  ip_masked  TEXT,
  success    INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX login_attempts_username_created_idx ON login_attempts (username, created_at);

-- ------------------------------------------------------------
-- Árvore unificada: pastas e páginas (nodes)
-- type = 'folder' | 'page'
-- ------------------------------------------------------------
CREATE TABLE nodes (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('folder', 'page')),
  -- NULL = nó raiz (categoria inicial / nível superior)
  parent_id        TEXT REFERENCES nodes (id) ON DELETE RESTRICT,
  title            TEXT NOT NULL DEFAULT '',
  -- Emoji ou identificador curto de ícone (validado na aplicação)
  icon             TEXT,
  -- Ordenação dentro do pai (índice inteiro denso reorganizado na aplicação)
  position         INTEGER NOT NULL DEFAULT 0,
  -- Páginas usadas como template
  is_template      INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0, 1)),
  -- Versão corrente do conteúdo (controle otimista); 0 = sem conteúdo
  current_version  INTEGER NOT NULL DEFAULT 0,
  -- Snapshot do texto puro para busca (mantido na gravação da versão)
  search_text      TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  created_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  deleted_at       TEXT,
  deleted_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX nodes_parent_position_idx ON nodes (parent_id, position);
CREATE INDEX nodes_deleted_at_idx ON nodes (deleted_at);
CREATE INDEX nodes_updated_at_idx ON nodes (updated_at);
CREATE INDEX nodes_is_template_idx ON nodes (is_template) WHERE is_template = 1;

-- ------------------------------------------------------------
-- Versões de conteúdo (histórico imutável)
-- content_json: JSON estruturado do editor (BlockNote), validado no servidor.
-- ------------------------------------------------------------
CREATE TABLE page_versions (
  id            TEXT PRIMARY KEY,
  node_id       TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  version       INTEGER NOT NULL CHECK (version >= 1),
  content_json  TEXT NOT NULL,
  -- Título vigente na época da versão (para exibir histórico coerente)
  title_snapshot TEXT NOT NULL DEFAULT '',
  -- 'autosave' | 'manual' | 'restore' | 'conflict_resolution'
  source        TEXT NOT NULL CHECK (
    source IN ('autosave', 'manual', 'restore', 'conflict_resolution')
  ),
  byte_size     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  CHECK (version >= 1 AND length(content_json) > 0)
);

CREATE UNIQUE INDEX page_versions_node_version_uq ON page_versions (node_id, version);
CREATE INDEX page_versions_node_created_idx ON page_versions (node_id, created_at DESC);

-- ------------------------------------------------------------
-- Tags
-- ------------------------------------------------------------
CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX tags_name_uq ON tags (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE page_tags (
  node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, tag_id)
);

CREATE INDEX page_tags_tag_id_idx ON page_tags (tag_id);

-- ------------------------------------------------------------
-- Favoritos (individuais por usuário)
-- ------------------------------------------------------------
CREATE TABLE favorites (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, node_id)
);

-- ------------------------------------------------------------
-- Documentos recentes (por usuário, com limite mantido na aplicação)
-- ------------------------------------------------------------
CREATE TABLE recent_views (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  viewed_at  TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, node_id)
);

CREATE INDEX recent_views_user_viewed_idx ON recent_views (user_id, viewed_at DESC);

-- ------------------------------------------------------------
-- Anexos (metadados; arquivos em DATA_DIR/attachments)
-- ------------------------------------------------------------
CREATE TABLE attachments (
  id               TEXT PRIMARY KEY,
  node_id          TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  -- Nome original do arquivo (apenas exibição; nunca usado como caminho)
  original_name    TEXT NOT NULL,
  -- Chave de armazenamento gerada pelo servidor (UUID), sem extensão de execução
  storage_key      TEXT NOT NULL,
  mime_declared    TEXT NOT NULL,
  -- MIME detectado por magic bytes no servidor
  mime_detected    TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256           TEXT NOT NULL,
  -- Tamanho máximo permitido (BYTES_MAX) para validação no upload
  uploaded_at      TEXT NOT NULL,
  uploaded_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  deleted_at       TEXT
);

CREATE UNIQUE INDEX attachments_storage_key_uq ON attachments (storage_key);
CREATE INDEX attachments_node_id_idx ON attachments (node_id);

-- ------------------------------------------------------------
-- Templates (metadados de páginas-template; conteúdo fica em page_versions)
-- ------------------------------------------------------------
CREATE TABLE templates (
  node_id      TEXT PRIMARY KEY REFERENCES nodes (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'Geral',
  description  TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX templates_category_idx ON templates (category, position);

-- ------------------------------------------------------------
-- Auditoria / atividade recente
-- Ações registradas sem conteúdo confidencial nem segredos.
-- ------------------------------------------------------------
CREATE TABLE activity (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT REFERENCES users (id) ON DELETE SET NULL,
  -- ex.: 'page.create', 'page.update', 'page.delete', 'page.restore',
  --       'folder.move', 'login.success', 'login.failure', 'user.create'
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('node', 'user', 'session', 'attachment', 'tag')),
  entity_id    TEXT,
  -- Resumo curto exibível (título do nó), sem conteúdo do documento
  summary      TEXT,
  metadata     TEXT,
  ip_masked    TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX activity_created_at_idx ON activity (created_at DESC);
CREATE INDEX activity_actor_created_idx ON activity (actor_id, created_at DESC);
CREATE INDEX activity_entity_idx ON activity (entity_type, entity_id);

-- ------------------------------------------------------------
-- Comentários (estrutura pronta; funcionalidade é Etapa futura)
-- ------------------------------------------------------------
CREATE TABLE comments (
  id           TEXT PRIMARY KEY,
  node_id      TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES comments (id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE INDEX comments_node_created_idx ON comments (node_id, created_at);

-- ------------------------------------------------------------
-- Configurações do espaço de trabalho (chave/valor editáveis)
-- ------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- Busca full-text (FTS5) - índice de páginas
-- Mantido por triggers: conteúdo novo/alterado reindexa automaticamente.
-- text é preenchido a partir de title + search_text + tags.
-- ------------------------------------------------------------
CREATE VIRTUAL TABLE pages_fts USING fts5 (
  node_id UNINDEXED,
  title,
  body,
  tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Popula/atualiza o índice a partir de nodes.search_text
CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO pages_fts (node_id, title, body, tags)
  VALUES (new.id, new.title, new.search_text, '');
END;

CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
  DELETE FROM pages_fts WHERE node_id = old.id;
END;

CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
  DELETE FROM pages_fts WHERE node_id = old.id;
  INSERT INTO pages_fts (node_id, title, body, tags)
  VALUES (new.id, new.title, new.search_text, '');
END;
