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

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let adminId: string;
let memberId: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-users-'));
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
    { username: 'adm.teste', displayName: 'Adm Teste', role: 'admin' },
    'senha-adm-123456',
  );
  await ensureUser(
    db,
    { username: 'mem.teste', displayName: 'Mem Teste', role: 'member' },
    'senha-mem-123456',
  );
  db.prepare(`UPDATE users SET must_change_password = 0`).run();
  for (const [username, store] of [
    [
      'adm.teste',
      (id: string, c: Record<string, string>) => {
        adminId = id;
        adminCookies = c;
      },
    ],
    [
      'mem.teste',
      (id: string, c: Record<string, string>) => {
        memberId = id;
        memberCookies = c;
      },
    ],
  ] as const) {
    const row = db
      .prepare<[string], { id: string }>(`SELECT id FROM users WHERE username = ?`)
      .get(username);
    const session = createSession(db, row?.id ?? '', { ipMasked: null, userAgent: 'vitest' });
    store(row?.id ?? '', { kd_session: session.token });
  }

  const ctx: AppContext = { env, paths, db, version: '0.1.0-test' };
  app = await buildApp(ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDatabase(db);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/users (só admin)', () => {
  it('401 sem sessão, 403 para membro', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(401);
    const member = await app.inject({ method: 'GET', url: '/api/users', cookies: memberCookies });
    expect(member.statusCode).toBe(403);
    expect((member.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('admin lista sem hash nem segredo', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/users', cookies: adminCookies });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { users: Array<Record<string, unknown>> };
    expect(body.users.length).toBeGreaterThanOrEqual(2);
    for (const user of body.users) {
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('password');
    }
    expect(body.users.some((u) => u.username === 'adm.teste' && u.role === 'admin')).toBe(true);
  });
});

describe('POST /api/users (só admin)', () => {
  it('401 sem sessão, 403 para membro', async () => {
    const payload = { username: 'novo.user', displayName: 'Novo', password: 'senha-nova-123' };
    expect((await app.inject({ method: 'POST', url: '/api/users', payload })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/users', payload, cookies: memberCookies }))
        .statusCode,
    ).toBe(403);
  });

  it('cria com senha provisória e papel padrão membro', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'Novo.User', displayName: 'Novo User', password: 'senha-nova-123' },
      cookies: adminCookies,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { username: string; role: string; mustChangePassword: boolean };
    expect(body.username).toBe('novo.user');
    expect(body.role).toBe('member');
    expect(body.mustChangePassword).toBe(true);
  });

  it('409 para duplicado e 400 para corpo inválido', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'novo.user', displayName: 'Outro', password: 'senha-nova-123' },
      cookies: adminCookies,
    });
    expect(dup.statusCode).toBe(409);

    const short = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'curto.user', displayName: 'Curto', password: 'curta' },
      cookies: adminCookies,
    });
    expect(short.statusCode).toBe(400);

    const badName = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'AB', displayName: 'X', password: 'senha-valida-123' },
      cookies: adminCookies,
    });
    expect(badName.statusCode).toBe(400);
  });
});

describe('PATCH /api/users/:id (só admin, sem auto-rebaixar)', () => {
  it('401 sem sessão, 403 para membro', async () => {
    const payload = { displayName: 'X' };
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/users/${memberId}`, payload })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/users/${memberId}`,
          payload,
          cookies: memberCookies,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('promove membro a admin e renomeia', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${memberId}`,
      payload: { role: 'admin', displayName: 'Membro Promovido' },
      cookies: adminCookies,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { role: string; displayName: string };
    expect(body.role).toBe('admin');
    expect(body.displayName).toBe('Membro Promovido');
    // Volta a membro para os demais testes
    const back = await app.inject({
      method: 'PATCH',
      url: `/api/users/${memberId}`,
      payload: { role: 'member' },
      cookies: adminCookies,
    });
    expect(back.statusCode).toBe(200);
  });

  it('desativa e reativa (desativado não loga)', async () => {
    const off = await app.inject({
      method: 'PATCH',
      url: `/api/users/${memberId}`,
      payload: { isActive: false },
      cookies: adminCookies,
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { isActive: boolean }).isActive).toBe(false);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'mem.teste', password: 'senha-mem-123456' },
    });
    expect(login.statusCode).toBe(403);

    const on = await app.inject({
      method: 'PATCH',
      url: `/api/users/${memberId}`,
      payload: { isActive: true },
      cookies: adminCookies,
    });
    expect((on.json() as { isActive: boolean }).isActive).toBe(true);
    const relogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'mem.teste', password: 'senha-mem-123456' },
    });
    expect(relogin.statusCode).toBe(200);
    // A desativação revogou as sessões (proposital): renova o cookie dos testes seguintes
    const raw = relogin.headers['set-cookie'];
    const header = (Array.isArray(raw) ? raw[0] : raw) as string;
    const [cookieName, cookieValue] = (header.split(';')[0] as string).split('=');
    memberCookies = { [cookieName as string]: cookieValue as string };
  });

  it('admin não rebaixa nem desativa a si mesmo', async () => {
    const role = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      payload: { role: 'member' },
      cookies: adminCookies,
    });
    expect(role.statusCode).toBe(403);

    const off = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      payload: { isActive: false },
      cookies: adminCookies,
    });
    expect(off.statusCode).toBe(403);

    // Mas pode trocar o próprio nome
    const name = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      payload: { displayName: 'Adm Renomeado' },
      cookies: adminCookies,
    });
    expect(name.statusCode).toBe(200);
  });

  it('404 para id inexistente e 400 para corpo vazio', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/users/nao-existe',
          payload: { role: 'admin' },
          cookies: adminCookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/users/${memberId}`,
          payload: {},
          cookies: adminCookies,
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('PATCH /api/users/me (perfil próprio)', () => {
  it('401 sem sessão e 200 atualizando o nome', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/users/me',
          payload: { displayName: 'X' },
        })
      ).statusCode,
    ).toBe(401);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { displayName: 'Mem Novo Nome' },
      cookies: memberCookies,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { displayName: string }).displayName).toBe('Mem Novo Nome');
  });

  it('400 para nome vazio', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { displayName: '   ' },
      cookies: memberCookies,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /api/users/:id (só admin, sem auto-exclusão)', () => {
  it('401 sem sessão, 403 para membro', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${memberId}` })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/users/${memberId}`,
          cookies: memberCookies,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('admin não exclui a si mesmo', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/users/${adminId}`,
      cookies: adminCookies,
    });
    expect(response.statusCode).toBe(403);
  });

  it('exclui membro: some da lista, sessão morre, login falha', async () => {
    await ensureUser(
      db,
      { username: 'sair.teste', displayName: 'Sair Teste', role: 'member' },
      'senha-sair-123456',
    );
    db.prepare(`UPDATE users SET must_change_password = 0 WHERE username = 'sair.teste'`).run();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'sair.teste', password: 'senha-sair-123456' },
    });
    expect(login.statusCode).toBe(200);
    const raw = login.headers['set-cookie'];
    const header = (Array.isArray(raw) ? raw[0] : raw) as string;
    const [cookieName, cookieValue] = (header.split(';')[0] as string).split('=');
    const victimCookies = { [cookieName as string]: cookieValue as string };
    const victimId = db
      .prepare<[string], { id: string }>(`SELECT id FROM users WHERE username = ?`)
      .get('sair.teste')?.id as string;

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/users/${victimId}`,
      cookies: adminCookies,
    });
    expect(remove.statusCode).toBe(204);

    // Sessão do excluído morre (inclui o filtro deleted_at do resolveSession)
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: victimCookies });
    expect(me.statusCode).toBe(401);

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'sair.teste', password: 'senha-sair-123456' },
    });
    expect(relogin.statusCode).toBe(401);

    const list = await app.inject({ method: 'GET', url: '/api/users', cookies: adminCookies });
    expect(
      (list.json() as { users: Array<{ username: string }> }).users.some(
        (user) => user.username === 'sair.teste',
      ),
    ).toBe(false);
  });

  it('404 para id inexistente', async () => {
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/users/nao-existe',
          cookies: adminCookies,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('POST /api/users/:id/reset-password (só admin)', () => {
  it('401 sem sessão, 403 para membro e para si mesmo', async () => {
    const payload = { password: 'senha-reset-123' };
    expect(
      (await app.inject({ method: 'POST', url: `/api/users/${memberId}/reset-password`, payload }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/users/${memberId}/reset-password`,
          payload,
          cookies: memberCookies,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/users/${adminId}/reset-password`,
          payload,
          cookies: adminCookies,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('redefine com provisória e revoga sessões do alvo', async () => {
    await ensureUser(
      db,
      { username: 'reset2.teste', displayName: 'Reset2', role: 'member' },
      'senha-antiga-abcdef',
    );
    db.prepare(`UPDATE users SET must_change_password = 0 WHERE username = 'reset2.teste'`).run();
    const targetId = db
      .prepare<[string], { id: string }>(`SELECT id FROM users WHERE username = ?`)
      .get('reset2.teste')?.id as string;

    const response = await app.inject({
      method: 'POST',
      url: `/api/users/${targetId}/reset-password`,
      payload: { password: 'senha-nova-abcdef' },
      cookies: adminCookies,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { mustChangePassword: boolean };
    expect(body.mustChangePassword).toBe(true);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'reset2.teste', password: 'senha-antiga-abcdef' },
        })
      ).statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'reset2.teste', password: 'senha-nova-abcdef' },
    });
    expect(login.statusCode).toBe(200);
    expect((login.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });

  it('400 para senha curta', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/users/${memberId}/reset-password`,
      payload: { password: 'curta' },
      cookies: adminCookies,
    });
    expect(response.statusCode).toBe(400);
  });
});
