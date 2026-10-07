# MVP, plano por etapas e limitações conhecidas — KernelDocs

## O que é o MVP

Uso **interno exclusivo** da equipe de Cybersegurança: editar e organizar documentação em
árvore (pastas/páginas), com busca, anexos e histórico — tudo autenticado, sem cadastro
público e sem depender de Markdown ou do vault Obsidian.

### Funcionalidades do MVP

1. **Autenticação local**: login dos usuários provisionados (`felipe.rosa` = admin,
   `wesley.matos` = membro), sessão por cookie, sem cadastro público.
2. **Árvore de páginas**: pastas e páginas, arrastar/soltar, renomear, favoritos.
3. **Editor rico** (BlockNote) com salvamento automático e histórico de versões
   (visualizar/restaurar).
4. **Busca full-text** (FTS5) por título, conteúdo e tags.
5. **Anexos** com validação de tipo/tamanho no servidor e download autorizado.
6. **Templates** para páginas recorrentes (runbooks, checklists, relatórios).
7. **Lixeira** (exclusão lógica) com restauração e exclusão definitiva confirmada.
8. **Controle de conflito**: edição concorrente detectada => 409 com opção de
   visualizar/resolver.
9. **Auditoria básica** (atividade recente) e administração de usuários.

### Fora do MVP (não prometido nesta versão)

Colaboração em tempo real (CRDT/Yjs), comentários (tabela já criada), permissões finos
por pasta, SSO/LDAP, integrações externas (Samba/SharePoint/rclone), publicação web,
app mobile, edição offline, notificações por e-mail.

## Plano por etapas

| Etapa | Escopo | Situação |
| --- | --- | --- |
| **1** | Inspeção do ambiente, arquitetura, modelo de dados, estrutura inicial, `/api/health` + tela de diagnóstico, migração do schema completo, docs e verificações | **Concluída (após `/revisar`)** |
| **2** | Autenticação e sessões, layout base, árvore de páginas, editor BlockNote | Pendente |
| **3** | Busca, anexos, favoritos, templates, histórico, lixeira, conflitos | Pendente |
| **4** | Testes completos, revisão de segurança, backup/restauração, implantação (HTTPS) e rollback | Pendente |

## O que já funciona (Etapa 1)

- `npm run dev` sobe API (`127.0.0.1:3000`) + Web (`127.0.0.1:5173`, ou na LAN com
  `WEB_HOST=0.0.0.0`) com hot-reload,
  incluindo regeneração automática do contrato compartilhado.
- `GET /api/health` — resposta validada pelo schema compartilhado (`status`, `version`,
  `time`, `migrations`).
- Tela de diagnóstico com os três estados obrigatórios: **carregando**, **erro**
  (API fora do ar ou fora do contrato) e **sucesso** (dados reais da API) + alternância
  de tema claro/escuro.
- Schema completo aplicado e versionado (ver `docs/modelo-de-dados.md`).
- `npm run lint` / `typecheck` / `test` / `build` passando.

## Limitações conhecidas (Etapa 1)

1. **Sem autenticação**: qualquer processo local pode ler `/api/health`. Rotas de dados
   só existirão a partir da Etapa 2, quando a autorização passa a ser verificada no
   backend em toda rota (inclusive downloads).
2. **Sem HTTPS e sem exposição à internet**: em desenvolvimento a Web pode escutar na LAN
   (`WEB_HOST=0.0.0.0`), mas publicar fora da rede interna exige aprovação e TLS
   (Etapa 4).
3. **Sem backup/restauração automatizados**: `var/` (SQLite WAL + anexos) é o único
   estado; procedimento de backup chega na Etapa 4.
4. **Scripts nativos de instalação (`argon2`, `better-sqlite3`)**: o campo
   `allowScripts` do `package.json` registra a preferência, mas no npm 11 os scripts
   continuam habilitados por padrão — ou seja, **não é um bloqueio efetivo**. O que
   foi feito de fato: verificação manual dos binários oficiais (prebuilds
   `linux-x64` presentes e testados: FTS5 e Argon2 funcionando) e `npm audit` limpo.
   Para travar de verdade em implantação: `npm ci --ignore-scripts` + conferência
   dos prebuilds. O servidor não tem `gcc` para compilar fallback.
5. **`tsx watch` acompanha o dist do `shared`**, não o fonte: ao editar
   `packages/shared`, o `tsc --watch` regenera e a API reinicia (comportamento validado).
6. **Tabela `comments` existe mas está ociosa** — funcionalidade é etapa futura.
7. **Sem testes E2E/browser**: testes unitários/de integração via Vitest + jsdom;
   validação visual depende do `npm run dev`.
8. **Janela de dados do health**: `migrations` conta migrações aplicadas; não há
   endpoint de métricas/monitoramento (fora do escopo do MVP).
9. **Semente de demonstração**: se houver seed, será apenas com `SEED_DEMO=true`,
   rotulada e restrita a desenvolvimento — nunca apresentada como dados reais.
