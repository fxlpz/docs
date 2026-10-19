# Arquitetura — KernelDocs (Etapa 1)

## Visão geral

Monorepo com **npm workspaces** e três unidades de entrega:

```
                        ┌──────────────────────────────┐
  navegador ──► :5173   │  apps/web  (React + Vite)    │  dev: proxy /api -> :3000
                        └──────────────┬───────────────┘
                                       │ fetch('/api/...') mesma origem (produção)
                        ┌──────────────▼───────────────┐
  API  Fastify :3000 ── │  apps/api                    │
                        │  rotas (HTTP + validação)    │
                        │    └► serviços (regras)      │   Etapa 1: apenas /api/health
                        │         └► persistência      │
                        │             (better-sqlite3) │
                        └──────────────┬───────────────┘
                                       │ contratos Zod
                        ┌──────────────▼───────────────┐
                        │  packages/shared             │  fonte única de verdade
                        │  schemas + tipos z.infer     │
                        └──────────────────────────────┘
```

- **`packages/shared`**: todo payload HTTP tem schema Zod aqui; tipos vêm de `z.infer`.
  API valida **entrada e saída**; Web consome os mesmos tipos — mudanças de contrato
  quebram `npm run typecheck` dos dois lados.
- **`apps/api`**: Fastify 5 + TypeScript ESM. Camadas separadas — rotas (HTTP/validação),
  serviços (regras), persistência (consultas parametrizadas). Erros de domínio viram
  envelope uniforme `{ code, message, requestId }` via `AppError`.
- **`apps/web`**: React 19 + Vite 8 + Tailwind 4. Em dev o Vite faz proxy de `/api` para
  `127.0.0.1:3000`, então API e Web têm **mesma origem** — sem CORS.

## Decisões de stack (aprovadas)

| Decisão | Justificativa |
| --- | --- |
| Node 24 LTS em `~/.local/node-24` | Sem root/apt; não toca em serviços do servidor |
| SQLite (WAL + FTS5) via better-sqlite3 | Zero operação extra, servidor único, busca full-text embutida |
| Migrações SQL versionadas com checksum | Impede drift: arquivo alterado após aplicado => erro, exige nova migração |
| Fastify + Zod | Validação declarativa e contratos compartilhados |
| BlockNote (MPL-2.0) como editor | Próxima etapa; armazenamento em JSON estruturado, não Markdown |
| Biome (lint/formato) | Um só ferramental, rápido, sem ESLint/Prettier paralelos |
| Vitest | Mesmo motor do Vite; roda nos 3 workspaces |

## Banco de dados

- Arquivo em `DATA_DIR` (padrão `var/`), **WAL** habilitado; isolado do código e
  ignorado pelo git.
- Migrações em `migrations/NNNN_nome.sql`, aplicadas pelo runner em
  `apps/api/src/db/migrate.ts`: cada arquivo é registrado com **SHA-256**; mudou depois
  de aplicado => falha explícita (crie nova migração).
- Consultas **sempre parametrizadas** (better-sqlite3 prepared statements).
- Busca full-text com **FTS5** (`pages_fts`), mantida por triggers de `nodes`
  (inserição/atualização/remoção). Tokenizer `unicode61 remove_diacritics 2` para
  português.
- Exclusão **lógica** (`deleted_at` + `deleted_by`) em páginas, pastas, tags, usuários e
  anexos.

## Segurança (fundação já presente na Etapa 1)

- `@fastify/helmet` com **CSP** restritiva; cookies `httpOnly` + `sameSite: lax`
  (`secure` controlado por `COOKIE_SECURE`).
- Logs com `redact` de `cookie`/`authorization` — segredos nunca em log.
- Bind `127.0.0.1` por padrão; `WEB_HOST=0.0.0.0` expõe **só a Web** na LAN (a API
  permanece `127.0.0.1`, acessível apenas pelo proxy do Vite; o `HOST` da API é
  **validado por código** e recusa qualquer valor fora de loopback). Nada de senha/token
  em código (`.env` não versionado).
- O dev server do Vite tem `server.fs.deny` configurado: mesmo com a Web na rede, ele
  **nunca serve** `var/` (banco/anexos), `.env` ou chaves (`/@fs/` → 403).
- Banco e `.env` com permissões de dono apenas (`0600`/`0700`); `GET /api/health`
  responde `503` + `status: "degraded"` (nunca `ok` enganoso) quando o banco não responde.
- Autenticação local (Argon2id, sessões com token hash SHA-256, lockout
  persistente após 5 falhas + rate limit) e **autorização em toda rota**,
  incluindo download de anexos.
- Senha provisória no provisionamento (`must_change_password=1`): o 1º login
  exige a troca em `POST /api/auth/change-password` (com a senha atual); até
  a troca, toda rota fora de `/api/auth/*` responde 403
  `PASSWORD_CHANGE_REQUIRED` — trava aplicada no servidor, nunca só na tela.
  A troca revoga todas as sessões e emite uma nova.
- Sessões com validade fixa de 7 dias (sem renovação por atividade; `last_seen_at`
  é só auditoria). Cookies `httpOnly`, assinados quando há `SESSION_SECRET`.
- Anexos: allowlist de tipos com detecção por magic bytes (imagens, vídeo,
  áudio, PDF, Office via ZIP+extensão, ZIP, texto; executáveis e SVG/HTML
  barrados; declarado ≠ detectado => rejeitado), 25 MiB por arquivo,
  armazenamento como UUID sem extensão em `DATA_DIR/attachments` (0700/0600).
  Download sempre como `attachment`, exceto `?inline=1` para imagem/vídeo/áudio
  (com `nosniff`) — o que permite embutir mídia no editor via upload direto
  (aba Upload do `/`, sem só-link) e soltar arquivos na página.
- Árvore com arrastar-soltar: `POST /api/nodes/:id/move` (pasta de destino +
  posição antes-do-irmão, renumeração densa em transação, anti-ciclo).
- Visualização embutida de anexos: imagem/vídeo/áudio/PDF nativos, texto com
  escape, DOCX/XLSX convertidos localmente em iframe isolado e PPTX com leitura
  simplificada local (texto + imagens por slide, sem layout); ZIP e afins só por
  download (fidelidade total exigiria OnlyOffice/Collabora).
- `login_attempts` e `activity` já existem no schema para auditoria desde o início.

## Fluxo de desenvolvimento

```
npm run dev
  └─ build inicial de packages/shared (tsc)
  └─ scripts/dev.mjs
       ├─ [shared] tsc --watch        -> regenera dist/ a cada mudança de contrato
       ├─ [api]    tsx watch          -> observa src/ e packages/shared/dist/** (reinicia)
       └─ [web]    vite               -> HMR
```

A cadeia já foi validada ponta a ponta: alteração em `packages/shared/src` => `dist`
regenerado => API reinicia com shutdown gracioso => `/api/health` segue respondendo 200.

`scripts/dev.mjs` também **garante o Node 24**: se o shell estiver com Node antigo, ele
coloca `~/.local/node-24/bin` na frente do `PATH` dos processos filhos (ou falha com
mensagem clara se o Node 24 não existir).

## Testes

- `packages/shared`: contratos Zod (formatos, limites, códigos de erro).
- `apps/api`: app Fastify com `inject` (health + envelope de erros), config e migrações —
  usando `DATA_DIR` temporário por teste (banco real nunca é tocado).
- `apps/web`: componentes com Testing Library em jsdom; `fetch` controlado por teste
  (sem depender de servidor rodando).
- Sem dados fictícios apresentados como reais; nenhum conteúdo confidencial de clientes
  é usado em testes.
