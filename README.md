# KernelDocs

Plataforma privada de documentação da equipe de Cybersegurança da **Kernel Solutions** —
interface em pt-BR, uso interno, sem cadastro público.

> **Status: Etapa 1 (inspeção, arquitetura, modelo de dados, MVP e estrutura inicial).**
> Hoje existem: contrato compartilhado, migração do modelo de dados completo, endpoint de
> saúde (`/api/health`) e tela de diagnóstico. Autenticação, editor e árvore de páginas
> chegam nas Etapas 2–4 (ver `docs/mvp-e-limitacoes.md`).

## Requisitos

- **Node.js 24 LTS** — instalado neste servidor em `~/.local/node-24` (binários em
  `~/.local/bin`, já no `PATH` do `kernel-adm`). Não usar o Node 18 do sistema.
- npm incluído no Node 24 (workspaces). Sem Docker, sem serviços extras.
- O projeto **não roda como root** e usa apenas as portas **3000** (API, sempre
  `127.0.0.1`) e **5173** (Vite). Por padrão a Web também fica em `127.0.0.1`; defina
  `WEB_HOST=0.0.0.0` no `.env` para abrir no PC da equipe pela LAN
  (`http://172.16.16.36:5173`) — o navegador fala apenas com o Vite, que faz proxy de
  `/api` para a API. Não exponha à internet sem aprovação.

Se o seu terminal antigo estiver com o PATH antigo (Node 18), abra uma nova sessão ou
rode `source ~/.bashrc`. O `npm run dev` também força o Node 24 automaticamente.

## Instalação

```bash
cd ~/Porject
cp .env.example .env        # ajuste (nunca versione .env); para LAN: WEB_HOST=0.0.0.0
npm install                 # workspaces (uma única vez)
npm run migrate             # aplica migrations/ no SQLite de DATA_DIR (padrão: var/)
npm run dev                 # API 3000 + Web 5173 em paralelo
```

Em produção, migrações exigem confirmação explícita: `npm run migrate -- --apply`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Build inicial do `shared` + API (3000) + Web (5173) com hot-reload |
| `npm run lint` / `lint:fix` | Biome: checagem / correção automática |
| `npm run format` | Formatação (Biome) |
| `npm run typecheck` | `tsc --noEmit` em todos os workspaces |
| `npm run test` | Vitest (shared, api e web; banco e arquivos de teste separados dos reais) |
| `npm run build` | Build de `shared`, `api` e `web` |
| `npm run migrate` | Aplica migrações pendentes (produção: `-- --apply`) |

**Nenhuma etapa é considerada concluída sem `lint`, `typecheck`, `test` e `build` passando.**

## Estrutura

```
apps/api        Fastify (TypeScript, ESM): rotas -> serviços -> persistência (better-sqlite3)
apps/web        React + Vite + Tailwind; consome a API via proxy /api (mesma origem)
packages/shared Contratos Zod compartilhados por API e Web (fonte única de verdade)
migrations      SQL versionado com checksum (nunca editado após aplicado)
scripts/dev.mjs Sobe API + Web + watch do shared com prefixos de log
var/            Dados locais (SQLite + anexos) — ignorado pelo git
docs/           Arquitetura, modelo de dados e limitações
```

## Configuração

Copie `.env.example` para `.env`. Variáveis principais: `HOST`/`PORT` (padrão `127.0.0.1:3000`),
`LOG_LEVEL`, `DATA_DIR` (padrão `var/`), `WEB_HOST` (padrão `127.0.0.1`; `0.0.0.0` expõe
apenas a Web na LAN — a API continua em `127.0.0.1` atrás do proxy), e — a partir da
Etapa 2 — `SESSION_SECRET` (obrigatório em produção, mínimo 32 caracteres) e
`COOKIE_SECURE` (só atrás de HTTPS).

Segredos vivem **apenas** no `.env` (não versionado); nada de senhas ou tokens em código/logs.

## Segurança e limites do servidor

- Sem cadastro público; autorização verificada no backend em **toda** rota (inclusive
  downloads de anexos) a partir da Etapa 2.
- A aplicação não é exposta à internet sem aprovação; implantação com HTTPS (Etapa 4).
- Não altera serviços existentes do servidor (Wazuh, Samba, Elasticsearch, Zabbix,
  Defender) nem o vault Obsidian — o KernelDocs é independente e não usa Markdown como
  armazenamento.
- Exclusões são lógicas (`deleted_at`); exclusão definitiva exige confirmação explícita.

## Documentação

- `docs/arquitetura.md` — camadas, decisões de stack e fluxo de desenvolvimento
- `docs/modelo-de-dados.md` — schema completo (`migrations/0001_inicial.sql`)
- `docs/mvp-e-limitacoes.md` — escopo do MVP, planos por etapa e limitações conhecidas
