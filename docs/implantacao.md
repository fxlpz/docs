# Implantação — KernelDocs (Etapa 4)

Modelo aprovado: **produção em loopback + acesso via túnel SSH**. Nada é
exposto à rede ou à internet sem aprovação explícita + HTTPS (ver checklist
de TLS no final).

```
PC da equipe ── túnel SSH ──► 127.0.0.1:3000 (krn-sec001, usuário kernel-adm)
                                ├─ SPA pronta (apps/web/dist, mesma origem)
                                └─ /api/* (Fastify, SQLite em DATA_DIR)
```

## 1. Pré-requisitos

- Node 24 LTS em `~/.local/node-24` (binários em `~/.local/bin`).
- `.env` real (nunca versionado) com, no mínimo:
  - `NODE_ENV=production`
  - `DATA_DIR=/home/kernel-adm/krndocs-data` (absoluto, fora do código)
  - `SESSION_SECRET` (≥ 32 caracteres; gerar com o comando do `.env.example`)
  - `BACKUP_DIR` (opcional; padrão `~/.local/share/krndocs-backups`)
- Servidor parado antes de qualquer troca de banco (o restore recusa com a API no ar).

## 2. Subida limpa (primeira vez ou após `git pull`)

```bash
cd /home/kernel-adm/Porject
npm ci --ignore-scripts   # trava scripts nativos; confere prebuilds depois
npm run build             # shared → api → web (gera apps/web/dist)
npm run migrate -- --apply   # produção exige --apply (sem ele, bloqueia)
npm run provision         # cria/confere felipe.rosa e wesley.matos (admin)
npm run backup            # backup do estado anterior, por segurança
NODE_ENV=production npm run start   # API + SPA em 127.0.0.1:3000
```

Cheque: `curl http://127.0.0.1:3000/api/health` → 200, e `/` devolve o HTML.

## 3. Rotina de atualização (deploy)

1. `npm run backup` (sempre antes).
2. `git pull` (ou checkout do commit alvo).
3. `npm ci --ignore-scripts && npm run build`.
4. `npm run migrate -- --apply` (revisar o que será aplicado).
5. Reiniciar o serviço (se systemd) ou o processo.
6. Validar: `/api/health` 200 + login de teste.

## 4. Rollback

- **Código**: `git checkout <commit-anterior> && npm run build` (+ restart).
- **Dados**: `npm run restore -- <arquivo.tar.gz>` (servidor parado; em
  produção exige `--apply`). O estado anterior fica guardado em
  `<DATA_DIR>.pre-restore-<ts>` — apague manualmente após validar.
- Ordem segura: volta o código primeiro, depois os dados se preciso.

## 5. Backup e restore (resumo operacional)

- `npm run backup` — pode rodar com o servidor no ar (cópia online via
  `db.backup()` + anexos + manifesto). Mantém os `BACKUP_KEEP` mais recentes
  (padrão 7, em `BACKUP_DIR`).
- `npm run restore -- <arquivo>` — valida manifesto + `integrity_check` em
  cópia temporária; **recusa com a API no ar**; guarda fallback automático.
- Agende `npm run backup` no cron do `kernel-adm` (ex.: diário). Exemplo:
  `0 3 * * * cd /home/kernel-adm/Porject && PATH=/home/kernel-adm/.local/bin:/usr/bin:/bin npm run backup`

## 6. Serviço systemd (opcional, usuário `kernel-adm`)

O arquivo `docs/systemd/krndocs.service` é um **exemplo** (user unit: roda
sem root). Instalar/ativar altera o servidor — faça com aprovação:

```bash
mkdir -p ~/.config/systemd/user
cp docs/systemd/krndocs.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now krndocs.service
loginctl enable-linger kernel-adm   # mantém o serviço sem sessão aberta
```

## 7. Acesso da equipe (túneis, sem expor porta)

No PC: `ssh -N -L 3000:127.0.0.1:3000 kernel-adm@172.16.16.36` e abrir
`http://localhost:3000`. A Web em dev (`:5173`) continua disponível para
desenvolvimento; em produção usa-se apenas a `:3000` (SPA embutida).

## 8. Checklist TLS/HTTPS (quando aprovado)

- [ ] Decidir terminação: reverso na LAN ou direto no Fastify (`https.listen`).
- [ ] Certificado (CA interna ou pública) + renovação documentada.
- [ ] `COOKIE_SECURE=true` no `.env` de produção.
- [ ] Revisar CSP para o esquema `https:` (sem `'unsafe-inline'` novo).
- [ ] Re-rodar `/validar` + esta revisão contra o endpoint TLS.
- [ ] Atualizar este doc com o desenho final aprovado.
