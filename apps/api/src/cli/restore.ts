import net from 'node:net';
import os from 'node:os';
import { loadEnv } from '../config/env.js';
import { resolveDataDir } from '../config/paths.js';
import { findWorkspaceRoot } from '../config/workspace.js';
import { applyRestore, planRestore } from '../services/backup.js';

/**
 * CLI de restore: npm run restore -- <arquivo.tar.gz>
 *
 * Valida o backup (manifesto + integrity_check em cópia temporária) e troca o
 * DATA_DIR, guardando o anterior como `<root>.pre-restore-<ts>`.
 *
 * Travas de segurança:
 * - Recusa com o servidor no ar (porta da API respondendo): pare o servidor
 *   antes — trocar o banco sob o processo é corrupção na certa.
 * - Em produção (NODE_ENV=production) exige `--apply`, como as migrações.
 */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (value: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(700, () => finish(false));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--apply');
  const rawArgs = process.argv.slice(2);
  const archive = args[0];
  if (!archive) {
    console.error('uso: npm run restore -- <arquivo.tar.gz> [--apply em produção]');
    process.exit(1);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !rawArgs.includes('--apply')) {
    console.error(
      'NODE_ENV=production: restore BLOQUEADO sem aprovação.\n' +
        'Revise o backup e execute:\n' +
        '  npm run restore -- <arquivo.tar.gz> --apply',
    );
    process.exit(1);
  }

  const env = loadEnv();
  if (await portInUse(env.PORT)) {
    console.error(
      `Restore BLOQUEADO: há um servidor respondendo em 127.0.0.1:${env.PORT}.\n` +
        'Pare a API antes de trocar o banco (Ctrl+C no terminal do dev/prod).',
    );
    process.exit(1);
  }

  const root = findWorkspaceRoot();
  const dataDir = resolveDataDir(env, root);

  const plan = planRestore(archive, os.tmpdir());
  console.log(
    `Backup válido: app v${plan.manifest.appVersion}, ` +
      `${plan.manifest.migrations} migração(ões), criado em ${plan.manifest.createdAt}.`,
  );
  const { fallbackDir } = applyRestore(dataDir, plan);
  console.log(`Restore concluído em: ${dataDir}`);
  if (fallbackDir) {
    console.log(`Estado anterior guardado em: ${fallbackDir}`);
    console.log('Se tudo estiver certo, apague o fallback manualmente quando quiser.');
  }
  console.log('Na próxima subida, o servidor aplica migrações pendentes (dev) ou avisa (prod).');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
