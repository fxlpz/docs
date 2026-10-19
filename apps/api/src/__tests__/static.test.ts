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

/**
 * Front estático em produção (Etapa 4): com `webDistDir` + estático ativo,
 * a API serve o SPA na mesma origem; rotas de API inexistentes continuam
 * em envelope JSON. Sem dist, comportamento inalterado (404 JSON).
 */

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let distDir: string;

beforeAll(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-static-'));
  dataDir = path.join(base, 'data');
  distDir = path.join(base, 'dist');
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  fs.writeFileSync(path.join(distDir, 'assets', 'app-abc123.js'), 'console.log("spa");');

  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    SERVE_STATIC: 'true',
  } as NodeJS.ProcessEnv);
  const paths = buildDataPaths(env.DATA_DIR);
  db = openDatabase(paths.databaseFile);
  runMigrations(db);

  const ctx: AppContext = { env, paths, db, version: '0.1.0-test', webDistDir: distDir };
  app = await buildApp(ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDatabase(db);
  fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
});

describe('servido estático (SERVE_STATIC=true)', () => {
  it('GET / devolve o index.html sem cache', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="root">');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rotas do SPA caem no index.html (fallback do roteador)', async () => {
    const response = await app.inject({ method: 'GET', url: '/p/qualquer-coisa' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<div id="root">');
  });

  it('assets com hash servem com cache longo', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('API inexistente continua em envelope JSON (não HTML)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect((response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('rotas de API reais continuam funcionando', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
  });
});
