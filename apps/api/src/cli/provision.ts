import { PASSWORD_MIN_LENGTH, type UserRole } from '@krndocs/shared';
import { loadEnv } from '../config/env.js';
import { buildDataPaths, resolveDataDir } from '../config/paths.js';
import { findWorkspaceRoot } from '../config/workspace.js';
import { closeDatabase, openDatabase } from '../db/database.js';
import { ensureUser, resetUserPassword, userExists } from '../services/users.js';

/**
 * CLI de provisionamento: npm run provision [-- --reset]
 *
 * Cria (ou corrige o papel de) os usuários administradores da equipe.
 * A senha é digitada no terminal SEM ser exibida nem passada por argumento
 * (argumentos aparecem em `ps` e em histórico — nunca segredos por lá).
 *
 * - `KD_BOOTSTRAP_PASSWORD`: senha provisória via ambiente (não interativo),
 *   para o primeiro provisionamento. Nunca versionada: só `.env` local.
 * - `--reset`: REDEFINE a senha dos alvos existentes para a senha informada
 *   (env ou prompt) e marca troca obrigatória no próximo login. Sem o flag,
 *   conta existente nunca tem a senha tocada.
 * Toda senha definida aqui nasce provisória: o 1º login exige a troca.
 */

const TARGETS: { username: string; displayName: string; role: UserRole }[] = [
  { username: 'felipe.rosa', displayName: 'Felipe Rosa', role: 'admin' },
  { username: 'wesley.matos', displayName: 'Wesley Matos', role: 'admin' },
];

const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;

/** Lê uma linha do teclado sem ecoar (raw mode), em TTY real. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY) {
      reject(
        new Error(
          'A leitura de senha exige terminal interativo (TTY). ' +
            'Abra um terminal e execute: npm run provision',
        ),
      );
      return;
    }

    stdout.write(question);
    const previousRaw = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.resume();
    let input = '';

    const finish = (value: string | null, error?: Error): void => {
      stdin.off('data', onData);
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value ?? '');
    };

    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString('utf8')) {
        // Enter (LF/CR) ou Ctrl+D envia; Ctrl+C cancela; Backspace apaga.
        if (char === '\n' || char === '\r' || char === '\u0004') {
          finish(input);
          return;
        }
        if (char === '\u0003') {
          finish(null, new Error('Cancelado pelo usuário.'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    };

    stdin.on('data', onData);
  });
}

async function promptNewPassword(username: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const password = await promptHidden(
      `Senha para ${username} (mín. ${MIN_PASSWORD_LENGTH} caracteres): `,
    );
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.log(`Senha muito curta (mínimo ${MIN_PASSWORD_LENGTH}). Tente novamente.`);
      continue;
    }
    const confirm = await promptHidden('Repita a senha: ');
    if (confirm !== password) {
      console.log('As senhas não coincidem. Tente novamente.');
      continue;
    }
    return password;
  }
  throw new Error('Provisionamento cancelado: senhas não validadas.');
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const envPassword = process.env.KD_BOOTSTRAP_PASSWORD;
  if (envPassword && envPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`KD_BOOTSTRAP_PASSWORD abaixo do mínimo (${MIN_PASSWORD_LENGTH} caracteres).`);
  }

  const env = loadEnv();
  const root = findWorkspaceRoot();
  const paths = buildDataPaths(resolveDataDir(env, root));
  const db = openDatabase(paths.databaseFile);

  try {
    for (const target of TARGETS) {
      const exists = userExists(db, target.username);

      if (reset && exists) {
        // Redefinição aprovada: senha nova provisória + sessões revogadas.
        const password = envPassword ?? (await promptNewPassword(target.username));
        await resetUserPassword(db, target.username, password);
        console.log(`senha redefinida: ${target.username} (troca obrigatória no próximo login)`);
        continue;
      }

      // A senha só é pedida quando a conta ainda não existe.
      const password = exists
        ? undefined
        : (envPassword ?? (await promptNewPassword(target.username)));

      const result = await ensureUser(db, target, password);
      switch (result.outcome) {
        case 'created':
          console.log(`criado: ${target.username} (${target.role})`);
          break;
        case 'role_updated':
          console.log(`atualizado: ${target.username} ${result.from} -> ${target.role}`);
          break;
        default:
          console.log(`sem alteracao: ${target.username} ja existe como ${target.role}`);
          break;
      }
    }
    console.log(`Banco: ${paths.databaseFile}`);
    console.log('Provisionamento concluido.');
  } finally {
    closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
