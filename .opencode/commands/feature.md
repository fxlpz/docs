---
description: Implementa uma funcionalidade completa com testes
agent: build
---

Implemente a funcionalidade descrita em: $ARGUMENTS

Regras obrigatórias:

1. Leia os arquivos relacionados antes de alterar qualquer coisa.
2. Implemente seguindo a arquitetura existente: rotas (HTTP/validação) -> serviços (regras) -> persistência.
3. Valide entradas no servidor com os schemas de `packages/shared` e mantenha API e Web consistentes.
4. Escreva/atualize testes cobrindo o comportamento novo. Quando houver rota nova, inclua caso de acesso não autorizado.
5. Execute as verificações: `npm run lint`, `npm run typecheck`, `npm run test`.
6. Só declare sucesso se todas as verificações passarem.
7. Ao final, informe: alterações feitas, testes executados, falhas e pendências.

Não implemente nada fora do escopo pedido sem justificar e pedir aprovação.
Não execute commit, push, deploy ou migração em produção sem aprovação.
