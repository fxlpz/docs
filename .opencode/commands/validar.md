---
description: Executa todas as verificações do projeto (lint, tipos, testes, build)
agent: build
---

Execute as verificações completas do projeto e relate o resultado:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`

Para cada verificação, reporte **PASSOU** ou **FALHOU**, com o trecho relevante do erro em caso de falha.

Não corrija arquivos automaticamente: apenas reporte. Correções devem ser feitas depois, via `/feature`.
Se tudo passar, confirme com um resumo final curto.
