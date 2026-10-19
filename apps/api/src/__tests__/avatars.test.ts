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
import { createSession } from '../services/auth.js';
import { ensureUser } from '../services/users.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let authCookies: Record<string, string>;
let userId: string;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(
  filename: string,
  mimetype: string,
  buffer: Buffer,
): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = '----krndocs-avatar-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-avatar-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  const paths = buildDataPaths(env.DATA_DIR);
  db = openDatabase(paths.databaseFile);
  runMigrations(db);

  await ensureUser(
    db,
    { username: 'foto.teste', displayName: 'Foto Teste', role: 'member' },
    'senha-foto-123456',
  );
  db.prepare(`UPDATE users SET must_change_password = 0 WHERE username = 'foto.teste'`).run();
  const row = db
    .prepare<[], { id: string }>(`SELECT id FROM users WHERE username = 'foto.teste'`)
    .get();
  userId = row?.id ?? '';
  const session = createSession(db, userId, { ipMasked: null, userAgent: 'vitest' });
  authCookies = { kd_session: session.token };

  const ctx: AppContext = { env, paths, db, version: '0.1.0-test' };
  app = await buildApp(ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDatabase(db);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function upload(
  filename: string,
  mimetype: string,
  buffer: Buffer,
  cookies: Record<string, string> = authCookies,
): Promise<InjectResponse> {
  const { payload, headers } = multipart(filename, mimetype, buffer);
  return app.inject({ method: 'POST', url: '/api/users/me/avatar', payload, headers, cookies });
}

describe('avatar (foto de perfil)', () => {
  it('401 sem sessão', async () => {
    const { payload, headers } = multipart('a.png', 'image/png', PNG_1X1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/users/me/avatar',
      payload,
      headers,
    });
    expect(response.statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: `/api/users/${userId}/avatar` })).statusCode,
    ).toBe(401);
  });

  it('envia PNG, marca hasAvatar e serve os bytes', async () => {
    const response = await upload('foto.png', 'image/png', PNG_1X1);
    expect(response.statusCode).toBe(200);
    expect((response.json() as { hasAvatar: boolean }).hasAvatar).toBe(true);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: authCookies });
    expect((me.json() as { user: { hasAvatar: boolean } }).user.hasAvatar).toBe(true);

    const download = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/avatar`,
      cookies: authCookies,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');

    const files = fs.readdirSync(path.join(dataDir, 'avatars'));
    expect(files).toHaveLength(1);
  });

  it('substitui apagando o arquivo anterior', async () => {
    await upload('foto.png', 'image/png', PNG_1X1);
    const before = fs.readdirSync(path.join(dataDir, 'avatars'));
    const second = await upload('foto2.png', 'image/png', PNG_1X1);
    expect(second.statusCode).toBe(200);
    const after = fs.readdirSync(path.join(dataDir, 'avatars'));
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
  });

  it('rejeita não-imagem, spoof e gigante', async () => {
    const exe = await upload(
      'x.txt',
      'text/plain',
      Buffer.concat([Buffer.from('TVqQAAMAAAAEAAAA', 'ascii'), Buffer.alloc(64, 0)]),
    );
    expect(exe.statusCode).toBe(400);

    const spoof = await upload('x.jpg', 'application/x-msdownload', PNG_1X1);
    expect(spoof.statusCode).toBe(400);

    const big = await upload('g.png', 'image/png', Buffer.alloc(2 * 1024 * 1024 + 1, 7));
    expect([400, 413]).toContain(big.statusCode);
  });

  it('remove e volta a 404', async () => {
    await upload('foto.png', 'image/png', PNG_1X1);
    const remove = await app.inject({
      method: 'DELETE',
      url: '/api/users/me/avatar',
      cookies: authCookies,
    });
    expect(remove.statusCode).toBe(204);

    const download = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/avatar`,
      cookies: authCookies,
    });
    expect(download.statusCode).toBe(404);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: authCookies });
    expect((me.json() as { user: { hasAvatar: boolean } }).user.hasAvatar).toBe(false);
  });
});
