---
description: Revisa alterações sem modificar arquivos
agent: plan
---

Revise as alterações atuais (arquivos modificados e não rastreados) **sem modificar nenhum arquivo**.

Foque em:

1. **Segurança**: validação de entrada no servidor, autorização em toda rota (inclusive downloads), XSS, injeção/SQL, upload inseguro, path traversal, segredos ou conteúdo sensível em logs.
2. **Correção**: erros de lógica, condições de corrida no salvamento/conflito de versões, tratamento de falhas de rede e estados de erro ausentes na UI.
3. **Contratos**: divergência entre `packages/shared` e o uso real na API/Web.
4. **Testes**: casos faltando de login/logout/autorização, criação/edição, pastas, salvamento e recuperação, conflitos, histórico, lixeira/restauração, busca, anexos e conteúdo malicioso.
5. **Convenções**: separação de camadas, convenções do AGENTS.md, escopo (nada implementado fora do pedido).

Entregue os achados em ordem de severidade, cada um com arquivo e linha. Não edite nada.
