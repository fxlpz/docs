import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Raiz do workspace do projeto (onde ficam package.json raiz, migrations/, apps/).
 *
 * Subindo a partir deste arquivo: src/config -> src -> api -> apps -> raiz.
 * Funciona igual em src/ (dev via tsx) e dist/ (build), pois ambos têm
 * a mesma profundidade dentro de apps/api.
 */
export function findWorkspaceRoot(startDir?: string): string {
  const from = startDir ?? path.dirname(fileURLToPath(import.meta.url));
  let dir = from;
  for (let depth = 0; depth < 12; depth += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
          name?: string;
          workspaces?: unknown;
        };
        // package.json raiz do monorepo (tem "workspaces")
        if (pkg.workspaces) return dir;
      } catch {
        // package.json ilegível: continua subindo
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Não foi possível localizar a raiz do workspace a partir de: ${from}`);
}
