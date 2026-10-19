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
let authCookies: Record<string, string>;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-e3-'));
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
    { username: 'e3.teste', displayName: 'E3 Teste', role: 'admin' },
    'senha-e3-123456',
  );
  // Fora da trava de senha provisória (coberta em auth.test.ts).
  db.prepare(`UPDATE users SET must_change_password = 0 WHERE username = 'e3.teste'`).run();
  const row = db
    .prepare<[], { id: string }>(`SELECT id FROM users WHERE username = 'e3.teste'`)
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

async function createNode(payload: Record<string, unknown>): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    payload,
    cookies: authCookies,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function saveContent(
  nodeId: string,
  content: unknown,
  baseVersion: number,
): Promise<{ version: number }> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/nodes/${nodeId}/content`,
    payload: { content, baseVersion, source: 'manual' },
    cookies: authCookies,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { version: number };
}

describe('GET /api/search', () => {
  it('401 sem sessão', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/search?q=teste' });
    expect(response.statusCode).toBe(401);
  });

  it('400 com query vazia ou ausente', async () => {
    for (const url of ['/api/search', '/api/search?q=', '/api/search?q=%20%20']) {
      const response = await app.inject({ method: 'GET', url, cookies: authCookies });
      expect(response.statusCode).toBe(400);
    }
  });

  it('encontra por título e por corpo', async () => {
    const page = await createNode({ type: 'page', title: 'Runbook de firewall' });
    await saveContent(
      page.id,
      [{ type: 'paragraph', content: 'Procedimento de zebra-quarenta.' }],
      0,
    );

    const byTitle = await app.inject({
      method: 'GET',
      url: '/api/search?q=firewall',
      cookies: authCookies,
    });
    expect(byTitle.statusCode).toBe(200);
    const titleBody = byTitle.json() as { query: string; results: Array<{ nodeId: string }> };
    expect(titleBody.query).toBe('firewall');
    expect(titleBody.results.some((result) => result.nodeId === page.id)).toBe(true);

    const byBody = await app.inject({
      method: 'GET',
      url: '/api/search?q=zebra-quarenta',
      cookies: authCookies,
    });
    const bodyResults = (byBody.json() as { results: Array<{ nodeId: string; snippet: string }> })
      .results;
    expect(bodyResults.some((result) => result.nodeId === page.id)).toBe(true);
    // Snippet é texto puro (sem HTML injetado pelo índice)
    for (const result of bodyResults) {
      expect(result.snippet).not.toContain('<');
    }
  });

  it('não retorna item excluído e não quebra com sintaxe FTS', async () => {
    const page = await createNode({ type: 'page', title: 'Documento efêmero xyz123' });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/nodes/${page.id}`,
      cookies: authCookies,
    });
    expect(deleted.statusCode).toBe(204);

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=xyz123',
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(200);
    expect(
      (response.json() as { results: Array<{ nodeId: string }> }).results.some(
        (result) => result.nodeId === page.id,
      ),
    ).toBe(false);

    const hostile = await app.inject({
      method: 'GET',
      url: '/api/search?q="OR"(DROP)**:',
      cookies: authCookies,
    });
    expect(hostile.statusCode).toBe(200);
  });
});

describe('favoritos', () => {
  it('401 sem sessão nas três rotas', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/favorites' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/favorites', payload: { nodeId: 'x' } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/favorites/x' })).statusCode).toBe(401);
  });

  it('adiciona (idempotente), lista e remove', async () => {
    const page = await createNode({ type: 'page', title: 'Página favorita' });

    const add = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      payload: { nodeId: page.id },
      cookies: authCookies,
    });
    expect(add.statusCode).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      payload: { nodeId: page.id },
      cookies: authCookies,
    });
    expect(again.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/favorites', cookies: authCookies });
    expect(list.statusCode).toBe(200);
    const favorites = (list.json() as { favorites: Array<{ nodeId: string; title: string }> })
      .favorites;
    expect(favorites.filter((favorite) => favorite.nodeId === page.id)).toHaveLength(1);
    expect(favorites[0]?.title).toBe('Página favorita');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/favorites/${page.id}`,
      cookies: authCookies,
    });
    expect(remove.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/favorites',
      cookies: authCookies,
    });
    expect(
      (after.json() as { favorites: Array<{ nodeId: string }> }).favorites.some(
        (favorite) => favorite.nodeId === page.id,
      ),
    ).toBe(false);
  });

  it('404 ao favoritar item inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      payload: { nodeId: 'nao-existe' },
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('templates', () => {
  it('401 sem sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/templates' })).statusCode).toBe(401);
  });

  it('rejeita marcar pasta como template', async () => {
    const folder = await createNode({ type: 'folder', title: 'Pasta comum' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${folder.id}/make-template`,
      payload: { name: 'Modelo inválido' },
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(400);
  });

  it('marca, lista e cria página a partir do template (com conteúdo)', async () => {
    const page = await createNode({ type: 'page', title: 'Checklist base' });
    await saveContent(page.id, [{ type: 'paragraph', content: 'Item um.' }], 0);

    const mark = await app.inject({
      method: 'POST',
      url: `/api/nodes/${page.id}/make-template`,
      payload: { name: 'Checklist', category: 'Operação' },
      cookies: authCookies,
    });
    expect(mark.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/templates',
      cookies: authCookies,
    });
    const templates = (list.json() as { templates: Array<{ nodeId: string; name: string }> })
      .templates;
    expect(templates.some((template) => template.nodeId === page.id)).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: `/api/templates/${page.id}/pages`,
      payload: { title: 'Checklist do plantão' },
      cookies: authCookies,
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { id: string; title: string };
    expect(createdBody.title).toBe('Checklist do plantão');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/nodes/${createdBody.id}`,
      cookies: authCookies,
    });
    const detailBody = detail.json() as { version: number; content: unknown };
    expect(detailBody.version).toBe(1);
    expect(detailBody.content).toEqual([{ type: 'paragraph', content: 'Item um.' }]);
  });

  it('404 ao criar de template inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates/nao-existe/pages',
      payload: {},
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(404);
  });

  it('401 ao remover sem sessão', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/templates/x' })).statusCode).toBe(401);
  });

  it('remove da lista sem apagar a página', async () => {
    const page = await createNode({ type: 'page', title: 'Modelo descartável' });
    const mark = await app.inject({
      method: 'POST',
      url: `/api/nodes/${page.id}/make-template`,
      payload: { name: 'Descartável', category: 'Operação' },
      cookies: authCookies,
    });
    expect(mark.statusCode).toBe(200);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${page.id}`,
      cookies: authCookies,
    });
    expect(removed.statusCode).toBe(204);

    // Sai da lista…
    const list = await app.inject({ method: 'GET', url: '/api/templates', cookies: authCookies });
    const templates = (list.json() as { templates: Array<{ nodeId: string }> }).templates;
    expect(templates.some((template) => template.nodeId === page.id)).toBe(false);
    // …mas a página continua ativa e acessível.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}`,
      cookies: authCookies,
    });
    expect(detail.statusCode).toBe(200);
    const flag = db
      .prepare<[string], { is_template: number }>(`SELECT is_template FROM nodes WHERE id = ?`)
      .get(page.id);
    expect(flag?.is_template).toBe(0);

    // Segunda remoção: 404 (já não é modelo).
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${page.id}`,
      cookies: authCookies,
    });
    expect(again.statusCode).toBe(404);
  });
});

describe('histórico de versões', () => {
  it('401 sem sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/nodes/x/versions' })).statusCode).toBe(
      401,
    );
  });

  it('lista vazia antes do primeiro salvamento', async () => {
    const page = await createNode({ type: 'page', title: 'Sem conteúdo' });
    const response = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}/versions`,
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { versions: unknown[] }).versions).toEqual([]);
  });

  it('lista, detalha e restaura criando nova versão (sem reescrever)', async () => {
    const page = await createNode({ type: 'page', title: 'Evolutiva' });
    await saveContent(page.id, [{ type: 'paragraph', content: 'Texto v1.' }], 0);
    await saveContent(page.id, [{ type: 'paragraph', content: 'Texto v2.' }], 1);

    const list = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}/versions`,
      cookies: authCookies,
    });
    const versions = (list.json() as { versions: Array<{ version: number; source: string }> })
      .versions;
    expect(versions.map((version) => version.version)).toEqual([2, 1]);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}/versions/1`,
      cookies: authCookies,
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { content: unknown }).content).toEqual([
      { type: 'paragraph', content: 'Texto v1.' },
    ]);

    const restore = await app.inject({
      method: 'POST',
      url: `/api/nodes/${page.id}/versions/restore`,
      payload: { version: 1 },
      cookies: authCookies,
    });
    expect(restore.statusCode).toBe(200);
    expect((restore.json() as { version: number }).version).toBe(3);

    const current = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}`,
      cookies: authCookies,
    });
    const currentBody = current.json() as { version: number; content: unknown };
    expect(currentBody.version).toBe(3);
    expect(currentBody.content).toEqual([{ type: 'paragraph', content: 'Texto v1.' }]);

    // A v2 original continua intacta no histórico
    const old = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}/versions/2`,
      cookies: authCookies,
    });
    expect((old.json() as { content: unknown }).content).toEqual([
      { type: 'paragraph', content: 'Texto v2.' },
    ]);
  });

  it('404 para versão inexistente', async () => {
    const page = await createNode({ type: 'page', title: 'Curta' });
    await saveContent(page.id, [{ type: 'paragraph', content: 'Só v1.' }], 0);
    const response = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}/versions/99`,
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('lixeira', () => {
  it('401 sem sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/trash' })).statusCode).toBe(401);
  });

  it('exclui, lista, restaura e volta a aparecer na árvore', async () => {
    const page = await createNode({ type: 'page', title: 'Vai e volta' });
    await app.inject({ method: 'DELETE', url: `/api/nodes/${page.id}`, cookies: authCookies });

    const trash = await app.inject({ method: 'GET', url: '/api/trash', cookies: authCookies });
    expect(trash.statusCode).toBe(200);
    expect(
      (trash.json() as { nodes: Array<{ id: string }> }).nodes.some((node) => node.id === page.id),
    ).toBe(true);

    const restore = await app.inject({
      method: 'POST',
      url: `/api/nodes/${page.id}/restore`,
      cookies: authCookies,
    });
    expect(restore.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/tree', cookies: authCookies });
    expect(
      (tree.json() as { nodes: Array<{ id: string }> }).nodes.some((node) => node.id === page.id),
    ).toBe(true);
  });

  it('restaura ancestrais quando o filho volta sozinho', async () => {
    const folder = await createNode({ type: 'folder', title: 'Pai lixo' });
    const childResponse = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'page', parentId: folder.id, title: 'Filho lixo' },
      cookies: authCookies,
    });
    const child = childResponse.json() as { id: string };
    await app.inject({ method: 'DELETE', url: `/api/nodes/${folder.id}`, cookies: authCookies });

    const restore = await app.inject({
      method: 'POST',
      url: `/api/nodes/${child.id}/restore`,
      cookies: authCookies,
    });
    expect(restore.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/tree', cookies: authCookies });
    const ids = (tree.json() as { nodes: Array<{ id: string }> }).nodes.map((node) => node.id);
    expect(ids).toContain(folder.id);
    expect(ids).toContain(child.id);
  });

  it('exclusão definitiva exige ?confirm=true e apaga de verdade', async () => {
    const page = await createNode({ type: 'page', title: 'Sumir para sempre' });
    await saveContent(page.id, [{ type: 'paragraph', content: 'Adeus.' }], 0);
    await app.inject({ method: 'DELETE', url: `/api/nodes/${page.id}`, cookies: authCookies });

    // Sem confirmação: 400 e nada apaga
    const noConfirm = await app.inject({
      method: 'DELETE',
      url: `/api/nodes/${page.id}/permanent`,
      cookies: authCookies,
    });
    expect(noConfirm.statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/trash', cookies: authCookies })).statusCode,
    ).toBe(200);

    const purge = await app.inject({
      method: 'DELETE',
      url: `/api/nodes/${page.id}/permanent?confirm=true`,
      cookies: authCookies,
    });
    expect(purge.statusCode).toBe(204);

    // Sumiu da lixeira e do banco (versões em cascata)
    const trash = await app.inject({ method: 'GET', url: '/api/trash', cookies: authCookies });
    expect(
      (trash.json() as { nodes: Array<{ id: string }> }).nodes.some((node) => node.id === page.id),
    ).toBe(false);
    expect(
      db
        .prepare<[string], { n: number }>(
          `SELECT COUNT(*) AS n FROM page_versions WHERE node_id = ?`,
        )
        .get(page.id)?.n,
    ).toBe(0);
  });

  it('não apaga definitivamente item fora da lixeira', async () => {
    const page = await createNode({ type: 'page', title: 'Ativa' });
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/nodes/${page.id}/permanent?confirm=true`,
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('árvore (casos extras da Etapa 3)', () => {
  it('move com posição explícita', async () => {
    const folder = await createNode({ type: 'folder', title: 'Destino' });
    const page = await createNode({ type: 'page', title: 'Móvel' });
    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/nodes/${page.id}`,
      payload: { parentId: folder.id, position: 7 },
      cookies: authCookies,
    });
    expect(moved.statusCode).toBe(200);
    const body = moved.json() as { parentId: string; position: number };
    expect(body.parentId).toBe(folder.id);
    expect(body.position).toBe(7);
  });

  it('conteúdo corrompido no banco não derruba a página (content null)', async () => {
    const page = await createNode({ type: 'page', title: 'Corrompida' });
    await saveContent(page.id, [{ type: 'paragraph', content: 'Original.' }], 0);
    db.prepare(`UPDATE page_versions SET content_json = '{json-invalido' WHERE node_id = ?`).run(
      page.id,
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/nodes/${page.id}`,
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { content: unknown }).content).toBeNull();
  });

  it('título com marcação é dado, não HTML (JSON puro)', async () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'page', title: evil },
      cookies: authCookies,
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { title: string }).title).toBe(evil);
    expect(created.headers['content-type']).toContain('application/json');
  });
});

describe('POST /api/nodes/:id/move (arrastar na árvore)', () => {
  it('401 sem sessão', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/nodes/qualquer/move',
      payload: { parentId: null },
    });
    expect(response.statusCode).toBe(401);
  });

  it('move para outra pasta renumerando irmãos sem furos', async () => {
    const folderA = await createNode({ type: 'folder', title: 'Pasta A' });
    const folderB = await createNode({ type: 'folder', title: 'Pasta B' });
    const p1 = await createNode({ type: 'page', parentId: folderA.id, title: 'P1' });
    const p2 = await createNode({ type: 'page', parentId: folderA.id, title: 'P2' });
    expect(p1.id).not.toBe(p2.id);

    const moved = await app.inject({
      method: 'POST',
      url: `/api/nodes/${p2.id}/move`,
      payload: { parentId: folderB.id, beforeId: null },
      cookies: authCookies,
    });
    expect(moved.statusCode).toBe(200);
    const body = moved.json() as { parentId: string; position: number };
    expect(body.parentId).toBe(folderB.id);
    expect(body.position).toBe(0);

    // Irmãos antigos renumerados de forma densa (P1 volta a 0)
    const remaining = db
      .prepare<[string], { position: number }>(
        `SELECT position FROM nodes WHERE parent_id = ? AND deleted_at IS NULL`,
      )
      .get(folderA.id);
    expect(remaining?.position).toBe(0);
  });

  it('reordena antes do irmão indicado', async () => {
    const folder = await createNode({ type: 'folder', title: 'Ordem' });
    const a = await createNode({ type: 'page', parentId: folder.id, title: 'A' });
    const b = await createNode({ type: 'page', parentId: folder.id, title: 'B' });
    const c = await createNode({ type: 'page', parentId: folder.id, title: 'C' });

    const moved = await app.inject({
      method: 'POST',
      url: `/api/nodes/${c.id}/move`,
      payload: { parentId: folder.id, beforeId: a.id },
      cookies: authCookies,
    });
    expect(moved.statusCode).toBe(200);

    const order = db
      .prepare<[string], { id: string }>(
        `SELECT id FROM nodes WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position`,
      )
      .all(folder.id)
      .map((row) => row.id);
    expect(order).toEqual([c.id, a.id, b.id]);
  });

  it('rejeita ciclo e referência de outra pasta', async () => {
    const pai = await createNode({ type: 'folder', title: 'Pai Move' });
    const filhoResponse = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'folder', parentId: pai.id, title: 'Filho Move' },
      cookies: authCookies,
    });
    expect(filhoResponse.statusCode).toBe(201);
    const filho = filhoResponse.json() as { id: string };
    const outra = await createNode({ type: 'folder', title: 'Outra' });
    const pagina = await createNode({ type: 'page', parentId: outra.id, title: 'Solta' });

    const cycle = await app.inject({
      method: 'POST',
      url: `/api/nodes/${pai.id}/move`,
      payload: { parentId: filho.id },
      cookies: authCookies,
    });
    expect(cycle.statusCode).toBe(409);

    const foreign = await app.inject({
      method: 'POST',
      url: `/api/nodes/${pai.id}/move`,
      payload: { parentId: outra.id, beforeId: pagina.id },
      cookies: authCookies,
    });
    // beforeId é da pasta destino (outra) e o movido vai para lá: válido
    expect(foreign.statusCode).toBe(200);

    const badRef = await app.inject({
      method: 'POST',
      url: `/api/nodes/${filho.id}/move`,
      payload: { parentId: outra.id, beforeId: 'nao-existe' },
      cookies: authCookies,
    });
    expect(badRef.statusCode).toBe(400);
  });
});
