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
  const boundary = '----krndocs-pub-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-pub-'));
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
    { username: 'pub.admin', displayName: 'Pub Admin', role: 'admin' },
    'senha-pub-admin-123',
  );
  await ensureUser(
    db,
    { username: 'pub.membro', displayName: 'Pub Membro', role: 'member' },
    'senha-pub-membro-123',
  );
  db.prepare(`UPDATE users SET must_change_password = 0`).run();
  for (const [username, store] of [
    ['pub.admin', (c: Record<string, string>) => (adminCookies = c)],
    ['pub.membro', (c: Record<string, string>) => (memberCookies = c)],
  ] as const) {
    const row = db
      .prepare<[string], { id: string }>(`SELECT id FROM users WHERE username = ?`)
      .get(username);
    const session = createSession(db, row?.id ?? '', { ipMasked: null, userAgent: 'vitest' });
    store({ kd_session: session.token });
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

async function createNode(
  payload: Record<string, unknown>,
  cookies: Record<string, string> = adminCookies,
): Promise<{ id: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/nodes', payload, cookies });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function setVisibility(
  nodeId: string,
  visibility: 'public' | 'private',
  cascade = false,
  cookies: Record<string, string> = adminCookies,
) {
  return app.inject({
    method: 'POST',
    url: `/api/nodes/${nodeId}/visibility`,
    payload: { visibility, cascade },
    cookies,
  });
}

async function saveContent(nodeId: string, text: string, baseVersion: number): Promise<void> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/nodes/${nodeId}/content`,
    payload: { content: [{ type: 'paragraph', content: text }], baseVersion, source: 'manual' },
    cookies: adminCookies,
  });
  expect(response.statusCode).toBe(200);
}

describe('POST /api/nodes/:id/visibility (só admin)', () => {
  it('401 sem sessão, 403 para membro, 200 para admin', async () => {
    const page = await createNode({ type: 'page', title: 'Alvo' });

    const anon = await app.inject({
      method: 'POST',
      url: `/api/nodes/${page.id}/visibility`,
      payload: { visibility: 'public' },
    });
    expect(anon.statusCode).toBe(401);

    const member = await setVisibility(page.id, 'public', false, memberCookies);
    expect(member.statusCode).toBe(403);
    expect((member.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    const admin = await setVisibility(page.id, 'public');
    expect(admin.statusCode).toBe(200);
    // Volta ao privado para não vazar nos demais testes deste arquivo
    const back = await setVisibility(page.id, 'private');
    expect(back.statusCode).toBe(200);
  });

  it('404 para item inexistente', async () => {
    const response = await setVisibility('nao-existe', 'public');
    expect(response.statusCode).toBe(404);
  });

  it('cascata publica a subárvore inteira de uma vez', async () => {
    const folder = await createNode({ type: 'folder', title: 'Pai cascata' });
    const childResponse = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'page', parentId: folder.id, title: 'Filho cascata' },
      cookies: adminCookies,
    });
    const child = childResponse.json() as { id: string };

    const response = await setVisibility(folder.id, 'public', true);
    expect(response.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/public/tree' });
    const ids = (tree.json() as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(ids).toContain(folder.id);
    expect(ids).toContain(child.id);
  });
});

describe('leitura pública não vaza (regra de ancestralidade)', () => {
  it('filho público sob pai privado some da árvore e dá 404 no direto', async () => {
    const folder = await createNode({ type: 'folder', title: 'Pai privado' });
    const childResponse = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'page', parentId: folder.id, title: 'Filho marcado' },
      cookies: adminCookies,
    });
    const child = childResponse.json() as { id: string };
    await saveContent(child.id, 'Conteúdo que não pode vazar.', 0);

    // Marca SÓ o filho como público (pai continua privado)
    expect((await setVisibility(child.id, 'public')).statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/public/tree' });
    expect(tree.statusCode).toBe(200);
    const ids = (tree.json() as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(ids).not.toContain(child.id);
    expect(ids).not.toContain(folder.id);

    const direct = await app.inject({ method: 'GET', url: `/api/public/pages/${child.id}` });
    expect(direct.statusCode).toBe(404);

    const search = await app.inject({ method: 'GET', url: '/api/public/search?q=vazar' });
    expect(search.statusCode).toBe(200);
    expect(
      (search.json() as { results: Array<{ nodeId: string }> }).results.some(
        (r) => r.nodeId === child.id,
      ),
    ).toBe(false);
  });

  it('página pública com cadeia pública é legível sem sessão (e sem metadados internos)', async () => {
    const folder = await createNode({ type: 'folder', title: 'Manual público' });
    const childResponse = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'page', parentId: folder.id, title: 'Guia aberto' },
      cookies: adminCookies,
    });
    const child = childResponse.json() as { id: string };
    await saveContent(child.id, 'Leia à vontade.', 0);
    expect((await setVisibility(folder.id, 'public', true)).statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/public/tree' });
    expect((tree.json() as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toContain(
      child.id,
    );

    const page = await app.inject({ method: 'GET', url: `/api/public/pages/${child.id}` });
    expect(page.statusCode).toBe(200);
    const body = page.json() as Record<string, unknown>;
    expect(body.title).toBe('Guia aberto');
    expect(body.content).toEqual([{ type: 'paragraph', content: 'Leia à vontade.' }]);
    // Nada de metadados internos
    expect(body).not.toHaveProperty('created_by');
    expect(body).not.toHaveProperty('createdBy');
    expect(body).not.toHaveProperty('updated_by');
    expect(JSON.stringify(body)).not.toContain('pub.admin');

    const search = await app.inject({ method: 'GET', url: '/api/public/search?q=vontade' });
    expect(
      (search.json() as { results: Array<{ nodeId: string }> }).results.some(
        (r) => r.nodeId === child.id,
      ),
    ).toBe(true);
  });

  it('página excluída some da leitura pública', async () => {
    const page = await createNode({ type: 'page', title: 'Efêmera pública' });
    await saveContent(page.id, 'Texto.', 0);
    expect((await setVisibility(page.id, 'public')).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/api/public/pages/${page.id}` })).statusCode,
    ).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/nodes/${page.id}`, cookies: adminCookies });
    expect(
      (await app.inject({ method: 'GET', url: `/api/public/pages/${page.id}` })).statusCode,
    ).toBe(404);
  });
});

describe('anexos públicos', () => {
  it('lista e baixa sem sessão quando a página é public-chain', async () => {
    const page = await createNode({ type: 'page', title: 'Com anexo aberto' });
    const { payload, headers } = multipart('aberto.png', 'image/png', PNG_1X1);
    const upload = await app.inject({
      method: 'POST',
      url: `/api/nodes/${page.id}/attachments`,
      payload,
      headers,
      cookies: adminCookies,
    });
    expect(upload.statusCode).toBe(201);
    const meta = upload.json() as { id: string };
    expect((await setVisibility(page.id, 'public')).statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/api/public/pages/${page.id}/attachments`,
    });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { attachments: Array<{ id: string; originalName: string }> })
      .attachments;
    expect(items.some((a) => a.id === meta.id)).toBe(true);
    // Sem sha256 nem dono na resposta pública
    expect(JSON.stringify(items)).not.toContain('sha256');

    const download = await app.inject({
      method: 'GET',
      url: `/api/public/attachments/${meta.id}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment;');
  });

  it('404 anônimo para anexo de página privada', async () => {
    const page = await createNode({ type: 'page', title: 'Com anexo fechado' });
    const { payload, headers } = multipart('fechado.png', 'image/png', PNG_1X1);
    const upload = await app.inject({
      method: 'POST',
      url: `/api/nodes/${page.id}/attachments`,
      payload,
      headers,
      cookies: adminCookies,
    });
    const meta = upload.json() as { id: string };

    expect(
      (await app.inject({ method: 'GET', url: `/api/public/pages/${page.id}/attachments` }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/api/public/attachments/${meta.id}/download` }))
        .statusCode,
    ).toBe(404);
  });
});
