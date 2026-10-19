import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppContext, buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { buildDataPaths } from '../config/paths.js';
import { closeDatabase, type Db, openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';

let app: FastifyInstance;
let db: Db;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-authz-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  const paths = buildDataPaths(env.DATA_DIR);
  db = openDatabase(paths.databaseFile);
  runMigrations(db);

  const ctx: AppContext = { env, paths, db, version: '0.1.0-test' };
  app = await buildApp(ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDatabase(db);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/**
 * Matriz de autorização (Etapa 4): TODA rota de API exige sessão, exceto a
 * allowlist explícita. Os casos derivam da árvore real de rotas (radix do
 * Fastify): rota nova sem `requireAuth` quebra este teste — autorização
 * verificada no servidor, por construção.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/** Reconstrói (método, caminho) a partir de `printRoutes()` (radix aninhada). */
function discoverRoutes(tree: string): Array<{ method: Method; url: string }> {
  const found: Array<{ method: Method; url: string }> = [];
  const stack: string[] = [];
  for (const line of tree.split('\n')) {
    const leading = (/^[│\s├└─]*/.exec(line)?.[0] ?? '').length;
    const depth = Math.floor(leading / 4);
    const rest = line.slice(leading).trim();
    if (!rest) continue;
    const methodsMatch = /\(([A-Z, ]+)\)$/.exec(rest);
    const fragment = methodsMatch ? rest.slice(0, methodsMatch.index).trim() : rest;
    while (stack.length >= depth) stack.pop();
    stack.push(fragment);
    if (!methodsMatch) continue;
    const full = `/${stack
      .join('')
      .replace(/^\/+/, '')
      .replace(/\/{2,}/g, '/')}`;
    if (!full.startsWith('/api/')) continue;
    for (const method of methodsMatch[1]?.split(',').map((m) => m.trim()) ?? []) {
      if ((METHODS as readonly string[]).includes(method)) {
        found.push({ method: method as Method, url: full });
      }
    }
  }
  const seen = new Set<string>();
  return found.filter((route) => {
    const key = `${route.method} ${route.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PUBLIC = new Set([
  'GET /api/health',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  // Leitura pública anônima (landing): só o que é public-chain, por desenho.
  'GET /api/public/tree',
  'GET /api/public/search',
  'GET /api/public/pages/:id',
  'GET /api/public/pages/:id/attachments',
  'GET /api/public/attachments/:id/download',
]);

function concreteUrl(url: string): string {
  return url.replace(/:id/g, 'nao-existe').replace(/:v/g, '1');
}

describe('toda rota /api exige sessão (exceto allowlist)', () => {
  let routes: Array<{ method: Method; url: string }> = [];

  beforeAll(() => {
    routes = discoverRoutes(app.printRoutes());
  });

  it('descobre as rotas reais (sentinela contra parser quebrado)', () => {
    // Sem esta sentinela, um parser vazio deixaria o teste seguinte
    // vacuamente verde. O número acompanha o crescimento da API.
    expect(routes.length).toBeGreaterThanOrEqual(20);
    expect(routes.some((r) => r.url === '/api/search')).toBe(true);
    expect(routes.some((r) => r.url === '/api/trash')).toBe(true);
  });

  it('cada rota privada responde 401 sem sessão', async () => {
    const privates = routes.filter((r) => !PUBLIC.has(`${r.method} ${r.url}`));
    expect(privates.length).toBeGreaterThan(0);
    for (const { method, url } of privates) {
      const response = await app.inject({
        method,
        url: concreteUrl(url),
        payload: method === 'GET' ? undefined : {},
      });
      expect(`${method} ${url} → ${response.statusCode}`).toBe(`${method} ${url} → 401`);
      expect((response.json() as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    }
  });

  it('allowlist pública responde sem sessão (não-401)', async () => {
    for (const key of [...PUBLIC]) {
      const [method, url] = key.split(' ') as [Method, string];
      const response = await app.inject({
        method,
        url,
        payload: method === 'GET' ? undefined : {},
      });
      expect(response.statusCode).not.toBe(401);
    }
  });
});
