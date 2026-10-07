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

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

let app: FastifyInstance;
let db: Db;
let dataDir: string;

const ADMIN = { username: 'teste.admin', displayName: 'Teste Admin', role: 'admin' as const };
const ADMIN_PASSWORD = 'senha-de-teste-123456';

function cookieOf(response: InjectResponse): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw new Error('resposta sem set-cookie');
  return header.split(';')[0] as string;
}

async function login(username: string, password: string): Promise<InjectResponse> {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-auth-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  const paths = buildDataPaths(env.DATA_DIR);
  db = openDatabase(paths.databaseFile);
  runMigrations(db);
  await ensureUser(db, ADMIN, ADMIN_PASSWORD);

  const ctx: AppContext = { env, paths, db, version: '0.1.0-test' };
  app = await buildApp(ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDatabase(db);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /api/auth/login', () => {
  it('autentica com credenciais corretas e cria sessão via cookie', async () => {
    const response = await login(ADMIN.username, ADMIN_PASSWORD);
    expect(response.statusCode).toBe(200);

    const body = response.json() as { user: { username: string; role: string } };
    expect(body.user.username).toBe(ADMIN.username);
    expect(body.user.role).toBe('admin');
    // Nunca vaza hash ou senha
    expect(JSON.stringify(body)).not.toContain('password');

    const cookie = cookieOf(response);
    expect(cookie.startsWith('kd_session=')).toBe(true);
    // Token tem entropia (256 bits base64url) — não é curto demais
    const token = cookie.slice('kd_session='.length);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('rejeita senha incorreta com mensagem genérica', async () => {
    const response = await login(ADMIN.username, 'senha-absolutamente-errada');
    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Usuário ou senha incorretos.');
  });

  it('não revela se o usuário existe (mesma resposta para conta inexistente)', async () => {
    const response = await login('nao.existe', 'qualquer-senha-123');
    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Usuário ou senha incorretos.');
  });

  it('valida o corpo da requisição (400 fora do contrato)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ab' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('bloqueia a conta após 5 falhas (lockout persistente)', async () => {
    const username = 'bloqueio.user';
    await ensureUser(
      db,
      { username, displayName: 'Bloqueio', role: 'member' },
      'senha-correta-999',
    );

    // 4 falhas ainda respondem como credencial inválida
    for (let i = 0; i < 4; i += 1) {
      const failed = await login(username, `senha-errada-${i}`);
      expect(failed.statusCode).toBe(401);
    }

    // 5ª falha: conta bloqueada
    const fifth = await login(username, 'senha-errada-ultima');
    expect(fifth.statusCode).toBe(429);
    expect((fifth.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');

    // Com a senha CORRETA ainda bloqueada: continua 429 (não desbloqueia)
    const locked = await login(username, 'senha-correta-999');
    expect(locked.statusCode).toBe(429);
  });

  it('rejeita conta desativada apenas após senha correta', async () => {
    const username = 'inativo.user';
    await ensureUser(db, { username, displayName: 'Inativo', role: 'member' }, 'senha-valida-777');
    db.prepare(`UPDATE users SET is_active = 0 WHERE username = ?`).run(username);

    // Senha errada: mensagem genérica (não confirma existência)
    const wrong = await login(username, 'senha-errada');
    expect(wrong.statusCode).toBe(401);
    expect((wrong.json() as { error: { message: string } }).error.message).toBe(
      'Usuário ou senha incorretos.',
    );

    // Senha correta: aí sim a razão real (conta desativada)
    const correct = await login(username, 'senha-valida-777');
    expect(correct.statusCode).toBe(403);
    expect((correct.json() as { error: { message: string } }).error.message).toContain(
      'desativada',
    );
  });
});

describe('GET /api/auth/me e POST /api/auth/logout', () => {
  it('401 sem sessão', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    expect((response.json() as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('401 com cookie inválido (forjado)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { kd_session: 'token-que-nao-existe-no-banco' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('devolve o usuário da sessão com cookie válido', async () => {
    const loginResponse = await login(ADMIN.username, ADMIN_PASSWORD);
    const cookie = cookieOf(loginResponse);
    const [name, value] = cookie.split('=');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [name as string]: value as string },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { user: { username: string; role: string } };
    expect(body.user.username).toBe(ADMIN.username);
    expect(body.user.role).toBe('admin');
  });

  it('logout revoga a sessão (mesmo cookie deixa de valer)', async () => {
    const loginResponse = await login(ADMIN.username, ADMIN_PASSWORD);
    const cookie = cookieOf(loginResponse);
    const [name, value] = cookie.split('=');
    const cookies = { [name as string]: value as string };

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies });
    expect(logout.statusCode).toBe(200);
    expect((logout.json() as { ok: boolean }).ok).toBe(true);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(me.statusCode).toBe(401);
  });
});

describe('ensureUser (provisionamento)', () => {
  it('cria, não recria e promove papel conforme o alvo', async () => {
    const target = { username: 'provisao.user', displayName: 'Provisao', role: 'member' as const };

    const first = await ensureUser(db, target, 'senha-longa-1234');
    expect(first.outcome).toBe('created');

    // De novo: não altera (senha nunca é regravada por aqui)
    const second = await ensureUser(db, target, 'outra-senha-5678');
    expect(second.outcome).toBe('unchanged');

    // Promover para admin: papel muda, senha permanece a original
    const promoted = await ensureUser(db, { ...target, role: 'admin' });
    expect(promoted.outcome).toBe('role_updated');
    expect(await login(target.username, 'senha-longa-1234')).toHaveProperty('statusCode', 200);
  });

  it('exige senha na criação de conta nova', async () => {
    await expect(
      ensureUser(db, { username: 'sem.senha', displayName: 'Sem Senha', role: 'member' }),
    ).rejects.toThrow(/senha/i);
  });

  it('cria conta já provisória (troca obrigatória no 1º login)', async () => {
    await ensureUser(
      db,
      { username: 'provisoria.user', displayName: 'Provisoria', role: 'member' },
      'senha-provisoria-1',
    );
    const response = await login('provisoria.user', 'senha-provisoria-1');
    expect(response.statusCode).toBe(200);
    const body = response.json() as { mustChangePassword: boolean };
    expect(body.mustChangePassword).toBe(true);
  });

  it('redefine senha via resetUserPassword (revoga sessões e exige troca)', async () => {
    const { resetUserPassword } = await import('../services/users.js');
    await ensureUser(
      db,
      { username: 'reset.user', displayName: 'Reset', role: 'member' },
      'senha-antiga-12345',
    );
    const before = await login('reset.user', 'senha-antiga-12345');
    expect(before.statusCode).toBe(200);

    const { reset } = await resetUserPassword(db, 'reset.user', 'senha-nova-12345');
    expect(reset).toBe(true);

    // Senha antiga não entra mais; a nova entra como provisória
    expect((await login('reset.user', 'senha-antiga-12345')).statusCode).toBe(401);
    const after = await login('reset.user', 'senha-nova-12345');
    expect(after.statusCode).toBe(200);
    expect((after.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });
});

describe('POST /api/auth/change-password', () => {
  const USER = { username: 'troca.user', displayName: 'Troca', role: 'member' as const };
  const CURRENT = 'senha-atual-12345';

  function cookiesOf(response: InjectResponse): Record<string, string> {
    const [name, value] = cookieOf(response).split('=');
    return { [name as string]: value as string };
  }

  it('rejeita senha atual incorreta sem revelar nada além do 401', async () => {
    await ensureUser(db, USER, CURRENT);
    const logged = await login(USER.username, CURRENT);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: 'senha-errada-000', newPassword: 'senha-nova-99999' },
      cookies: cookiesOf(logged),
    });
    expect(response.statusCode).toBe(401);
    expect((response.json() as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('rejeita nova senha igual à atual', async () => {
    await ensureUser(db, { ...USER, username: 'troca2.user' }, CURRENT);
    const logged = await login('troca2.user', CURRENT);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: CURRENT, newPassword: CURRENT },
      cookies: cookiesOf(logged),
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejeita nova senha abaixo do mínimo do contrato', async () => {
    await ensureUser(db, { ...USER, username: 'troca4.user' }, CURRENT);
    const logged = await login('troca4.user', CURRENT);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: CURRENT, newPassword: 'curta' },
      cookies: cookiesOf(logged),
    });
    // Contrato (Zod) barra antes da regra de negócio
    expect(response.statusCode).toBe(400);
  });

  it('troca com sucesso, baixa a flag e rotaciona a sessão', async () => {
    await ensureUser(db, { ...USER, username: 'troca3.user' }, CURRENT);
    const logged = await login('troca3.user', CURRENT);
    expect((logged.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
    const oldCookies = cookiesOf(logged);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: CURRENT, newPassword: 'senha-definitiva-1' },
      cookies: oldCookies,
    });
    expect(changed.statusCode).toBe(200);
    expect((changed.json() as { ok: boolean }).ok).toBe(true);

    // Sessão nova no cookie da resposta; a antiga foi revogada
    const freshCookies = cookiesOf(changed);
    const meOld = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: oldCookies });
    expect(meOld.statusCode).toBe(401);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: freshCookies });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { mustChangePassword: boolean };
    expect(body.mustChangePassword).toBe(false);

    // Login seguinte já entra sem flag
    const relogin = await login('troca3.user', 'senha-definitiva-1');
    expect(relogin.statusCode).toBe(200);
    expect((relogin.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
  });

  it('exige sessão (401 sem cookie)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: 'a', newPassword: 'senha-nova-99999' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('trava de senha provisória (403 fora de /api/auth/*)', () => {
  it('bloqueia /api/tree até a troca e libera depois', async () => {
    await ensureUser(
      db,
      { username: 'travada.user', displayName: 'Travada', role: 'member' },
      'senha-travada-1234',
    );
    const logged = await login('travada.user', 'senha-travada-1234');
    const [name, value] = cookieOf(logged).split('=');
    const cookies = { [name as string]: value as string };

    const blocked = await app.inject({ method: 'GET', url: '/api/tree', cookies });
    expect(blocked.statusCode).toBe(403);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );

    // Rotas de auth continuam acessíveis (é por elas que a troca acontece)
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(me.statusCode).toBe(200);

    // Após a troca, a árvore abre
    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: 'senha-travada-1234', newPassword: 'senha-livre-98765' },
      cookies,
    });
    expect(changed.statusCode).toBe(200);
    const [freshName, freshValue] = cookieOf(changed).split('=');
    const tree = await app.inject({
      method: 'GET',
      url: '/api/tree',
      cookies: { [freshName as string]: freshValue as string },
    });
    expect(tree.statusCode).toBe(200);
  });
});
