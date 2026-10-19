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
import { ensureUser } from '../services/users.js';

/**
 * Cobertura dos caminhos que só existem com SESSION_SECRET (produção):
 * cookie assinado de ponta a ponta + adulteração rejeitada.
 * O restante da suíte roda sem secret (caminho não-assinado de dev).
 */

let app: FastifyInstance;
let db: Db;
let dataDir: string;

const USER = { username: 'assinado.teste', displayName: 'Assinado Teste', role: 'admin' as const };
const PASSWORD = 'senha-assinada-123456';

function cookieOf(response: Awaited<ReturnType<FastifyInstance['inject']>>): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw new Error('resposta sem set-cookie');
  return (header.split(';')[0] as string).trim();
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-signed-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    SESSION_SECRET: 'x'.repeat(48),
  } as NodeJS.ProcessEnv);
  const paths = buildDataPaths(env.DATA_DIR);
  db = openDatabase(paths.databaseFile);
  runMigrations(db);
  await ensureUser(db, USER, PASSWORD);
  db.prepare(`UPDATE users SET must_change_password = 0 WHERE username = ?`).run(USER.username);

  const ctx: AppContext = { env, paths, db, version: '0.1.0-test' };
  app = await buildApp(ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDatabase(db);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('cookies assinados (SESSION_SECRET)', () => {
  it('login emite cookie assinado e a sessão funciona', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: USER.username, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const cookie = cookieOf(login);
    // Assinado: valor com selo (contém separador de assinatura).
    expect(cookie.length).toBeGreaterThan('kd_session='.length + 40);

    const [name, value] = cookie.split('=');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [name as string]: value as string },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { username: string } }).user.username).toBe(USER.username);
  });

  it('cookie adulterado é rejeitado (401)', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: USER.username, password: PASSWORD },
    });
    const cookie = cookieOf(login);
    const [name, value] = cookie.split('=');
    const tampered = `${value as string}X`;

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [name as string]: tampered },
    });
    expect(me.statusCode).toBe(401);
  });

  it('logout com cookie assinado revoga e limpa', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: USER.username, password: PASSWORD },
    });
    const [name, value] = cookieOf(login).split('=');
    const cookies = { [name as string]: value as string };

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(me.statusCode).toBe(401);
  });
});

describe('rate limit do login (plugin, além do lockout)', () => {
  it('31ª tentativa em sequência recebe 429 do limitador', async () => {
    // Senha CORRETA: evita o lockout por conta e isola o limitador por IP.
    // (Lockout persistente é coberto em auth.test.ts.)
    let lastStatus = 0;
    let lastBody: unknown = null;
    for (let i = 0; i < 31; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: USER.username, password: PASSWORD },
      });
      lastStatus = response.statusCode;
      lastBody = response.json();
    }
    expect(lastStatus).toBe(429);
    expect((lastBody as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  }, 60000);
});
