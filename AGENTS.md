# KernelDocs — instruções do projeto

Plataforma privada de documentação da equipe de Cybersegurança da Kernel Solutions.
Responda sempre em **português do Brasil**.

## Regras fundamentais

- **Estas instruções não substituem permissões nem isolamento.** Se uma ação precisa de
  aprovação, peça aprovação; não contorne nem assuma autorização.
- **Examine antes de alterar.** Leia os arquivos envolvidos e mantenha as convenções
  existentes. Mudanças pequenas e verificáveis.
- **Não declare sucesso sem executar as verificações** (`npm run lint`, `npm run typecheck`,
  `npm run test`, `npm run build`). Se algo falhar, informe a falha.
- **Nada fora do escopo** sem justificar explicitamente a mudança e pedir aprovação.
- **Sem operações destrutivas sem aprovação**: commit, push, deploy, migração em produção,
  exclusão de arquivos/diretórios, alteração de serviços do servidor.
- Finalize cada etapa informando: alterações feitas, testes executados, falhas e pendências.

## Limites do ambiente (servidor krn-sec001)

- O servidor roda outros serviços (Wazuh, Samba, Elasticsearch, Zabbix, Defender).
  **Não altere** serviços, portas, pacotes, firewall ou compartilhamentos existentes.
- **Não tocar** no vault Obsidian existente nem em `/home/kernel-adm/Obisidian*`.
  O projeto é independente: não usar Obsidian como base nem depender de arquivos Markdown
  para armazenar documentos.
- A aplicação **não roda como root** e não é exposta à internet sem aprovação.
- Node.js 24 LTS fica em `~/.local/node-24` (binários em `~/.local/bin`). Não instalar Node
  globalmente nem via apt.
- Portas aprovadas: API `3000` — **sempre** `127.0.0.1` (sai à rede apenas via proxy do
  Vite); Vite `5173` — padrão `127.0.0.1`, podendo escutar na LAN com `WEB_HOST=0.0.0.0`
  para a equipe abrir no PC (aprovado pelo usuário em 06/10/2026). Internet exige
  aprovação + HTTPS (Etapa 4).

## Arquitetura em uma frase

Monorepo npm workspaces: API Fastify (TypeScript, ESM) + SPA React/Vite/Tailwind, contrato
compartilhado em `@krndocs/shared` (schemas Zod), banco SQLite (WAL + FTS5) e anexos em
`DATA_DIR`, tudo isolado do código.

```
apps/api     rotas (HTTP/validação) -> serviços (regras) -> persistência (better-sqlite3)
apps/web     React + Vite; consome a API via proxy /api (mesma origem, sem CORS)
packages/shared  schemas Zod + tipos derivados: fonte única de verdade dos contratos
migrations   SQL versionado, aplicado pelo runner (nunca editado após aplicado)
var/         dados locais (banco + anexos) — ignorado pelo git, nunca versionar
```

## Convenções

- **TypeScript estrito**, ESM (`"type": "module"`), importações relativas com extensão `.js`.
- **Formatador/lint**: Biome (`npm run lint`, `npm run format`). Não introduzir ESLint/Prettier.
- **Contratos**: todo payload HTTP tem schema Zod em `packages/shared`; tipos vêm de
  `z.infer`. Valide entrada **e** saída no servidor.
- **Banco**: consultas parametrizadas (nunca concatenação de SQL). Migrações são arquivos
  `NNNN_nome.sql`, imutáveis após aplicadas — crie nova migração para mudar o schema.
- **Autorização** é verificada no backend em toda rota (inclusive download de anexos),
  nunca só no frontend.
- **Exclusão lógica** (`deleted_at`) para páginas/pastas; exclusão definitiva exige
  confirmação explícita.
- **Sem dados fictícios** apresentados como reais; seeds demonstrativos só com
  `SEED_DEMO=true` e claramente rotulados, restritos a desenvolvimento.
- **Segurança**: nada de senhas/token em logs ou código; segredos só em `.env`
  (não versionado). Não usar conteúdo confidencial de clientes em testes ou envios a
  provedores de IA.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API (3000) + Web (5173) em paralelo |
| `npm run lint` / `lint:fix` | Biome: checagem / correção automática |
| `npm run typecheck` | `tsc --noEmit` em todos os workspaces |
| `npm run test` | Vitest (banco e arquivos de teste separados dos reais) |
| `npm run build` | Build de shared, api e web |
| `npm run migrate` | Aplica migrações pendentes (em produção exige `-- --apply`) |

Fluxo: **/plan** (ou agente Plan) para planejar → **/feature** (agente Build) para
implementar → **/validar** para verificar → **/revisar** para revisão sem edição.

## Estado do projeto

- **Etapa 1 (atual)**: inspeção, arquitetura, modelo de dados, MVP e estrutura inicial.
- Etapas seguintes: autenticação, layout/árvore/editor (Etapa 2); busca, anexos,
  favoritos, templates, histórico/lixeira/conflitos (Etapa 3); testes completos,
  segurança, backup e implantação (Etapa 4).
- Ver `docs/` para arquitetura, modelo de dados e definição de MVP.
