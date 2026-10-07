#!/usr/bin/env node
/**
 * Sobe API (3000) e Web (5173) em paralelo, com prefixos de log.
 * Encerra os dois processos com Ctrl+C.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Node mínimo exigido (Vitest 5 / Vite 8). */
const NODE_MAJOR_MIN = 24;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Carrega as variáveis do `.env` da raiz para os processos filhos.
 * Variáveis já presentes no ambiente do shell têm prioridade.
 */
function loadRootEnv(env) {
  const envFile = path.join(repoRoot, '.env');
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

/**
 * Garante Node 24 mesmo em shell com PATH desatualizado: se o node atual for
 * antigo, procura ~/.local/node-24 e coloca o diretório na frente do PATH dos
 * processos filhos (vite/tsx chamam `node` via PATH).
 */
function resolveChildEnv() {
  const env = { ...process.env };
  const currentMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (currentMajor >= NODE_MAJOR_MIN) return env;

  const localNodeBin = path.join(homedir(), '.local', 'node-24', 'bin');
  if (!existsSync(path.join(localNodeBin, 'node'))) {
    console.error(
      `✖ Node ${NODE_MAJOR_MIN}+ é necessário (atual: ${process.versions.node}).\n` +
        `  Instalado em ${localNodeBin} não encontrado. Abra um novo terminal e verifique o PATH.`,
    );
    process.exit(1);
  }
  console.warn(
    `⚠ Node ${process.versions.node} no shell; usando ${localNodeBin}/node para os processos do dev.`,
  );
  env.PATH = `${localNodeBin}${path.delimiter}${env.PATH ?? ''}`;
  return env;
}

const childEnv = resolveChildEnv();
loadRootEnv(childEnv);

// Avisa onde a Web vai escutar (WEB_HOST=0.0.0.0 => acessível pela LAN).
const webPort = Number(childEnv.WEB_PORT) || 5173;
{
  const webHost = childEnv.WEB_HOST || '127.0.0.1';
  if (webHost === '0.0.0.0' || webHost === '::') {
    const lanIp = Object.values(networkInterfaces())
      .flat()
      .find((iface) => iface && !iface.internal && iface.family === 'IPv4')?.address;
    console.log(
      `🌐 Web (dev) escutando na rede: http://${lanIp ?? webHost}:${webPort}` +
        (lanIp ? `  (e http://127.0.0.1:${webPort})` : ''),
    );
  } else {
    console.log(`🌐 Web (dev) apenas nesta máquina: http://${webHost}:${webPort}`);
  }
}

/** Verifica se algo já está escutando em 127.0.0.1:porta. */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(700, () => finish(false));
  });
}

// Evita o erro confuso "Port ... already in use" do Vite: se já existe um
// dev rodando, explica e sai. (PORT vem do .env, mesmo valor usado pela API.)
const apiPort = Number(childEnv.PORT) || 3000;
const busy = [];
if (await portInUse(apiPort)) busy.push(`${apiPort} (API)`);
if (await portInUse(webPort)) busy.push(`${webPort} (Web)`);
if (busy.length > 0) {
  console.error(
    `✖ Porta(s) em uso: ${busy.join(', ')} — provavelmente outro "npm run dev" está ativo.\n` +
      '  Encerre o outro terminal (Ctrl+C) ou rode:\n' +
      "    pkill -f 'scripts/dev.mjs'",
  );
  process.exit(1);
}

const procs = [
  {
    name: 'shared',
    color: '\x1b[32m',
    args: ['run', 'build', '-w', '@krndocs/shared', '--', '--watch', '--preserveWatchOutput'],
  },
  { name: 'api', color: '\x1b[36m', args: ['run', 'dev', '-w', '@krndocs/api'] },
  { name: 'web', color: '\x1b[35m', args: ['run', 'dev', '-w', '@krndocs/web'] },
].map(({ name, color, args }) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}encerrado (código ${code ?? '?'})\n`);
    shutdown();
  });
  return { name, child };
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of procs) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
