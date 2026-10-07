# Modelo de dados — `migrations/0001_inicial.sql`

Schema completo criado na Etapa 1 (14 tabelas concretas + 1 índice FTS5). As funcionalidades
que consomem cada tabela chegam nas Etapas 2–4; o schema já está pronto para não precisar de
migrações destrutivas depois.

## Convenções

- **IDs**: `TEXT` (ULID/UUID) — ordenáveis, sem sequência compartilhada.
- **Datas**: `TEXT` ISO 8601 UTC (`2026-10-06T18:00:00.000Z`).
- **Booleanos**: `INTEGER` 0/1 com `CHECK`.
- **Exclusão lógica**: colunas `deleted_at`/`deleted_by`; `DELETE` físico só para dados
  descartáveis (sessões expiradas, tentativas antigas).
- **Auditoria**: `created_at/created_by`, `updated_at/updated_by` nas entidades editáveis.
- **Referências**: `ON DELETE SET NULL` para autor, `CASCADE` para dependentes,
  `RESTRICT` para o pai de um nó (mover/excluir é decisão da aplicação).

## Tabelas

### Identidade e autenticação (Etapa 2)
| Tabela | Papel |
| --- | --- |
| `users` | `username` minúsculo único (índice parcial ativo), `role` `admin`\|`member`, hash **Argon2id**, lockout (`failed_attempts`, `locked_until`), `must_change_password`, exclusão lógica. **Sem cadastro público.** |
| `sessions` | Sessão por cookie: guarda apenas **SHA-256 do token** (`token_hash`), expiração, `last_seen_at`, `revoked_at`, IP/user-agent para auditoria. |
| `login_attempts` | Auditoria + rate limit persistente; IP mascarado (menos dado pessoal). |

### Conteúdo (Etapas 2–3)
| Tabela | Papel |
| --- | --- |
| `nodes` | **Árvore unificada** de pastas e páginas (`type`), `parent_id`, ordenação (`position`), `icon`, `is_template`, controle otimista (`current_version`), `search_text` (texto puro p/ busca), exclusão lógica. |
| `page_versions` | Histórico imutável: `version` sequencial por nó, `content_json` (JSON do editor, validado no servidor), `title_snapshot`, `source` (`autosave`\|`manual`\|`restore`\|`conflict_resolution`). Conflito = versão divergente => HTTP 409 na Etapa 2. |
| `tags` / `page_tags` | Tags com nome único case-insensitive (parcial) + N:N. |
| `favorites` | Favoritos por usuário (com posição). |
| `recent_views` | Documentos recentes por usuário (`viewed_at`, `view_count`), limite mantido na aplicação. |
| `attachments` | Metadados de anexos: `storage_key` gerado pelo servidor (nunca o nome original como caminho), MIME declarado **e** detectado por magic bytes, `sha256`, tamanho. Arquivos ficam em `DATA_DIR/attachments`. |
| `templates` | Metadados (nome, categoria, descrição, posição) de páginas-template — conteúdo vive em `page_versions`. |

### Sistema (Etapas 3–4)
| Tabela | Papel |
| --- | --- |
| `activity` | Auditoria de ações (`page.create`, `login.failure`, …) com `summary` curto **sem conteúdo** de documentos; indexada por data/autor/entidade. |
| `comments` | Estrutura pronta (thread com `parent_id`); funcionalidade é etapa futura. |
| `settings` | Configurações do espaço de trabalho (chave/valor versionado por `updated_by`). |

### Busca full-text
| Objeto | Papel |
| --- | --- |
| `pages_fts` (FTS5) | `node_id`, `title`, `body`, `tags`; tokenizer `unicode61 remove_diacritics 2`. Mantido por **triggers** em `nodes` (`nodes_ai`, `nodes_ad`, `nodes_au`): inserir/atualizar/remover nó reindexa sozinho. |

## Migrações

- Arquivos `NNNN_nome.sql`, aplicados em ordem pelo runner (`apps/api/src/db/migrate.ts`).
- Cada migração aplicada é registrada com **checksum SHA-256**; alterar arquivo já
  aplicado faz o runner falhar (drift detectado) — a mudança vira uma **nova** migração.
- `npm run migrate` em desenvolvimento; em produção exige `npm run migrate -- --apply`.
