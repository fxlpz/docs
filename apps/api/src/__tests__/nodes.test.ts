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

interface NodeSummaryLike {
  id: string;
  type: string;
  parentId: string | null;
  title: string;
  position: number;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-nodes-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  const paths = buildDataPaths(env.DATA_DIR);
  db = openDatabase(paths.databaseFile);
  runMigrations(db);

  const user = await ensureUser(
    db,
    { username: 'editor.teste', displayName: 'Editor Teste', role: 'admin' },
    'senha-do-editor-123',
  );
  void user;
  // Estes testes cobrem a árvore, não a trava de senha provisória (testada em
  // auth.test.ts): baixa a flag para simular o pós-troca.
  db.prepare(`UPDATE users SET must_change_password = 0 WHERE username = 'editor.teste'`).run();
  const row = db
    .prepare<[], { id: string }>(`SELECT id FROM users WHERE username = 'editor.teste'`)
    .get();
  const session = createSession(db, row?.id ?? '', { ipMasked: null, userAgent: 'vitest' });
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

async function createNode(payload: Record<string, unknown>): Promise<InjectResponse> {
  return app.inject({ method: 'POST', url: '/api/nodes', payload, cookies: authCookies });
}

async function tree(): Promise<NodeSummaryLike[]> {
  const response = await app.inject({ method: 'GET', url: '/api/tree', cookies: authCookies });
  expect(response.statusCode).toBe(200);
  return (response.json() as { nodes: NodeSummaryLike[] }).nodes;
}

describe('autorização (toda rota exige sessão)', () => {
  it('GET /api/tree sem sessão => 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/nodes sem sessão => 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'page' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('DELETE /api/nodes/:id sem sessão => 401', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/nodes/qualquer-id' });
    expect(response.statusCode).toBe(401);
  });
});

describe('CRUD da árvore', () => {
  it('cria pasta e página, listando na árvore', async () => {
    const folder = await createNode({ type: 'folder', title: 'Runbooks' });
    expect(folder.statusCode).toBe(201);
    const folderBody = folder.json() as NodeSummaryLike;
    expect(folderBody.type).toBe('folder');
    expect(folderBody.title).toBe('Runbooks');

    const page = await createNode({
      type: 'page',
      parentId: folderBody.id,
      title: 'Reset de senha',
    });
    expect(page.statusCode).toBe(201);

    const nodes = await tree();
    expect(nodes.some((node) => node.title === 'Runbooks')).toBe(true);
    expect(nodes.some((node) => node.title === 'Reset de senha')).toBe(true);
  });

  it('rejeita página como destino de movimento', async () => {
    const page = await createNode({ type: 'page', title: 'Solta' });
    const pageBody = page.json() as NodeSummaryLike;
    const target = await createNode({ type: 'page', title: 'Destino errado' });
    const targetBody = target.json() as NodeSummaryLike;

    const move = await app.inject({
      method: 'PATCH',
      url: `/api/nodes/${pageBody.id}`,
      payload: { parentId: targetBody.id },
      cookies: authCookies,
    });
    expect(move.statusCode).toBe(400);
  });

  it('renomeia um item', async () => {
    const created = await createNode({ type: 'page', title: 'Antes' });
    const body = created.json() as NodeSummaryLike;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/nodes/${body.id}`,
      payload: { title: 'Depois' },
      cookies: authCookies,
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as NodeSummaryLike).title).toBe('Depois');
  });

  it('impede ciclo: mover pasta para dentro de descendente => 409', async () => {
    const pai = (await createNode({ type: 'folder', title: 'Pai' })).json() as NodeSummaryLike;
    const filho = (
      await createNode({ type: 'folder', parentId: pai.id, title: 'Filho' })
    ).json() as NodeSummaryLike;
    const neto = (
      await createNode({ type: 'folder', parentId: filho.id, title: 'Neto' })
    ).json() as NodeSummaryLike;

    // Pai -> dentro do neto (descendente) = ciclo
    const move = await app.inject({
      method: 'PATCH',
      url: `/api/nodes/${pai.id}`,
      payload: { parentId: neto.id },
      cookies: authCookies,
    });
    expect(move.statusCode).toBe(409);
    expect((move.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
  });

  it('exclusão lógica some com a subárvore inteira da listagem', async () => {
    const pasta = (
      await createNode({ type: 'folder', title: 'Lixeira-teste' })
    ).json() as NodeSummaryLike;
    const filho = (
      await createNode({ type: 'page', parentId: pasta.id, title: 'Filho-oculto' })
    ).json() as NodeSummaryLike;

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/nodes/${pasta.id}`,
      cookies: authCookies,
    });
    expect(remove.statusCode).toBe(204);

    const nodes = await tree();
    expect(nodes.some((node) => node.id === pasta.id)).toBe(false);
    expect(nodes.some((node) => node.id === filho.id)).toBe(false);

    // Dados continuam no banco (exclusão LÓGICA)
    const row = db
      .prepare<[string], { deleted_at: string | null }>(`SELECT deleted_at FROM nodes WHERE id = ?`)
      .get(filho.id);
    expect(row?.deleted_at).not.toBeNull();

    // Item excluído não é acessível depois (404)
    const after = await app.inject({
      method: 'GET',
      url: `/api/nodes/${filho.id}`,
      cookies: authCookies,
    });
    expect(after.statusCode).toBe(404);
  });

  it('404 para id inexistente', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/nodes/nao-existe',
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('conteúdo da página (controle otimista)', () => {
  it('salva v1, relê e atualiza para v2', async () => {
    const page = (
      await createNode({ type: 'page', title: 'Documentada' })
    ).json() as NodeSummaryLike;
    const bloco = [{ type: 'paragraph', content: 'Primeiro paragrafo.' }];

    const first = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${page.id}/content`,
      payload: { content: bloco, baseVersion: 0, source: 'manual' },
      cookies: authCookies,
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { version: number }).version).toBe(1);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}`,
      cookies: authCookies,
    });
    const detailBody = detail.json() as { version: number; content: unknown };
    expect(detailBody.version).toBe(1);
    expect(detailBody.content).toEqual(bloco);

    const second = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${page.id}/content`,
      payload: { content: bloco, baseVersion: 1, source: 'autosave' },
      cookies: authCookies,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { version: number }).version).toBe(2);
  });

  it('baseVersion divergente => 409 VERSION_CONFLICT (não sobrescreve)', async () => {
    const page = (
      await createNode({ type: 'page', title: 'Concorrida' })
    ).json() as NodeSummaryLike;

    await app.inject({
      method: 'PUT',
      url: `/api/nodes/${page.id}/content`,
      payload: { content: [{ type: 'paragraph', content: 'Versao do editor A.' }], baseVersion: 0 },
      cookies: authCookies,
    });

    // Editor B ainda está na v0: deve ser rejeitado
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${page.id}/content`,
      payload: { content: [{ type: 'paragraph', content: 'Versao do editor B.' }], baseVersion: 0 },
      cookies: authCookies,
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT');

    // Conteúdo do B não entrou
    const detail = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}`,
      cookies: authCookies,
    });
    const body = detail.json() as { version: number; content: Array<{ content: string }> };
    expect(body.version).toBe(1);
    expect(body.content[0]?.content).toBe('Versao do editor A.');
  });

  it('pasta não aceita conteúdo', async () => {
    const folder = (
      await createNode({ type: 'folder', title: 'Nao-editavel' })
    ).json() as NodeSummaryLike;
    const response = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${folder.id}/content`,
      payload: { content: [], baseVersion: 0 },
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(400);
  });
});
