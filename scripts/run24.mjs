#!/usr/bin/env node
/**
 * Executa um comando shell garantindo Node 24+ no PATH.
 *
 * Uso (em scripts npm):
 *   node scripts/run24.mjs 'npm run build:shared && npm run build -w @krndocs/api'
 *
 * Se o node atual for antigo (ex.: Node 18 do sistema no PATH de um shell aberto
 * antes da instalação), o comando é relançado com ~/.local/node-24/bin na frente
 * do PATH, de modo que npm, tsc, vite e tsx usem o Node 24.
 *
 * IMPORTANTE: este arquivo precisa continuar compatível com Node 18 — é ele que
 * roda justamente quando o shell está desatualizado.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const NODE_MAJOR_MIN = 24;

const command = process.argv[2];
if (!command) {
  console.error('uso: node scripts/run24.mjs "<comando shell>"');
  process.exit(2);
}
// Repassa argumentos extras (ex.: `npm run provision -- --reset`): o npm os
// anexa após o script, e sem isso flags como --reset seriam silenciosamente
// engolidas.
const extraArgs = process.argv.slice(3);
const fullCommand = extraArgs.length > 0 ? `${command} ${extraArgs.join(' ')}` : command;

const currentMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
let env = process.env;

if (currentMajor < NODE_MAJOR_MIN) {
  const localNodeBin = path.join(homedir(), '.local', 'node-24', 'bin');
  if (!existsSync(path.join(localNodeBin, 'node'))) {
    console.error(
      `✖ Este projeto exige Node ${NODE_MAJOR_MIN}+ (você está com ${process.versions.node})\n` +
        `  e ${localNodeBin}/node não foi encontrado. Instale o Node 24 ou corrija o PATH.`,
    );
    process.exit(1);
  }
  console.warn(
    `⚠ Shell com Node ${process.versions.node}; executando com ${path.join(localNodeBin, 'node')}.`,
  );
  env = { ...env, PATH: `${localNodeBin}${path.delimiter}${env.PATH ?? ''}` };
}

const result = spawnSync(fullCommand, { shell: true, stdio: 'inherit', env, cwd: process.cwd() });
if (result.error) {
  console.error(`✖ Falha ao executar: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
