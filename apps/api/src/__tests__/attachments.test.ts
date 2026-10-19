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
let pageId: string;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const EXE_MZ = Buffer.concat([Buffer.from('TVqQAAMAAAAEAAAA', 'ascii'), Buffer.alloc(64, 0)]);

/** Monta corpo multipart (campo `file`) para o inject. */
function multipart(
  filename: string,
  mimetype: string,
  buffer: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----krndocs-test-boundary';
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-anexos-'));
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
    { username: 'anexo.teste', displayName: 'Anexo Teste', role: 'admin' },
    'senha-anexo-123456',
  );
  db.prepare(`UPDATE users SET must_change_password = 0 WHERE username = 'anexo.teste'`).run();
  const row = db
    .prepare<[], { id: string }>(`SELECT id FROM users WHERE username = 'anexo.teste'`)
    .get();
  const session = createSession(db, row?.id ?? '', { ipMasked: null, userAgent: 'vitest' });
  authCookies = { kd_session: session.token };

  const ctx: AppContext = { env, paths, db, version: '0.1.0-test' };
  app = await buildApp(ctx, { logger: false });
  await app.ready();

  const created = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    payload: { type: 'page', title: 'Página com anexos' },
    cookies: authCookies,
  });
  pageId = (created.json() as { id: string }).id;
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
  nodeId: string = pageId,
): Promise<InjectResponse> {
  const { payload, headers } = multipart(filename, mimetype, buffer);
  return app.inject({
    method: 'POST',
    url: `/api/nodes/${nodeId}/attachments`,
    payload,
    headers,
    cookies,
  });
}

describe('upload de anexos', () => {
  it('401 sem sessão', async () => {
    const { payload, headers } = multipart('a.png', 'image/png', PNG_1X1);
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${pageId}/attachments`,
      payload,
      headers,
    });
    expect(response.statusCode).toBe(401);
  });

  it('aceita PNG válido e devolve metadados com sha256', async () => {
    const response = await upload('print.png', 'image/png', PNG_1X1);
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      id: string;
      originalName: string;
      mime: string;
      sizeBytes: number;
      sha256: string;
    };
    expect(body.originalName).toBe('print.png');
    expect(body.mime).toBe('image/png');
    expect(body.sizeBytes).toBe(PNG_1X1.length);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('aceita texto puro declarado corretamente', async () => {
    const buffer = Buffer.from('Relatório de teste com acentuação: çãõ.', 'utf8');
    const response = await upload('notas.txt', 'text/plain', buffer);
    expect(response.statusCode).toBe(201);
    expect((response.json() as { mime: string }).mime).toBe('text/plain');
  });

  it('rejeita executável (MZ) mesmo com extensão inofensiva', async () => {
    const response = await upload('documento.txt', 'text/plain', EXE_MZ);
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('rejeita spoof: PNG declarado como outro tipo', async () => {
    const response = await upload('imagem.png', 'application/x-msdownload', PNG_1X1);
    expect(response.statusCode).toBe(400);
  });

  it('400 com multipart sem arquivo no campo `file`', async () => {
    const boundary = '----krndocs-empty';
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${pageId}/attachments`,
      payload: Buffer.from(`--${boundary}--\r\n`, 'utf8'),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      cookies: authCookies,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('lista, download e exclusão', () => {
  it('401 sem sessão nas três rotas', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/nodes/${pageId}/attachments` })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/attachments/x/download' })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/attachments/x' })).statusCode).toBe(
      401,
    );
  });

  it('lista, baixa bytes idênticos como attachment e exclui', async () => {
    const uploaded = await upload('evidencia.png', 'image/png', PNG_1X1);
    const meta = uploaded.json() as { id: string };

    const list = await app.inject({
      method: 'GET',
      url: `/api/nodes/${pageId}/attachments`,
      cookies: authCookies,
    });
    expect(list.statusCode).toBe(200);
    expect(
      (list.json() as { attachments: Array<{ id: string }> }).attachments.some(
        (attachment) => attachment.id === meta.id,
      ),
    ).toBe(true);

    const download = await app.inject({
      method: 'GET',
      url: `/api/attachments/${meta.id}/download`,
      cookies: authCookies,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(download.headers['content-disposition']).not.toContain('\n');
    expect(Number(download.headers['content-length'])).toBe(PNG_1X1.length);
    // Integridade dos bytes: o inject converte o corpo para string (utf8),
    // então a igualdade binária é verificada no arquivo armazenado.
    const stored = db
      .prepare<[string], { storage_key: string }>(
        `SELECT storage_key FROM attachments WHERE id = ?`,
      )
      .get(meta.id);
    const storedBytes = fs.readFileSync(
      `${buildDataPaths(dataDir).attachmentsDir}/${stored?.storage_key}`,
    );
    expect(Buffer.compare(storedBytes, PNG_1X1)).toBe(0);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/attachments/${meta.id}`,
      cookies: authCookies,
    });
    expect(remove.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/attachments/${meta.id}/download`,
      cookies: authCookies,
    });
    expect(after.statusCode).toBe(404);
  });

  it('purga definitiva do nó remove os arquivos do disco', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { type: 'page', title: 'Com anexo purgado' },
      cookies: authCookies,
    });
    const nodeId = (created.json() as { id: string }).id;
    const uploaded = await upload('temporario.png', 'image/png', PNG_1X1, authCookies, nodeId);
    expect(uploaded.statusCode).toBe(201);
    const meta = uploaded.json() as { id: string };
    const row = db
      .prepare<[string], { storage_key: string }>(
        `SELECT storage_key FROM attachments WHERE id = ?`,
      )
      .get(meta.id);
    const paths = buildDataPaths(dataDir);
    const filePath = row ? `${paths.attachmentsDir}/${row.storage_key}` : '';
    expect(filePath !== '' && fs.existsSync(filePath)).toBe(true);

    await app.inject({ method: 'DELETE', url: `/api/nodes/${nodeId}`, cookies: authCookies });
    const purge = await app.inject({
      method: 'DELETE',
      url: `/api/nodes/${nodeId}/permanent?confirm=true`,
      cookies: authCookies,
    });
    expect(purge.statusCode).toBe(204);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('arquivo sumido do disco vira 500 genérico (sem vazar caminho)', async () => {
    const uploaded = await upload('fantasma.png', 'image/png', PNG_1X1);
    const meta = uploaded.json() as { id: string };
    const row = db
      .prepare<[string], { storage_key: string }>(
        `SELECT storage_key FROM attachments WHERE id = ?`,
      )
      .get(meta.id);
    fs.rmSync(`${buildDataPaths(dataDir).attachmentsDir}/${row?.storage_key}`, { force: true });

    const download = await app.inject({
      method: 'GET',
      url: `/api/attachments/${meta.id}/download`,
      cookies: authCookies,
    });
    expect(download.statusCode).toBe(500);
    const body = download.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('attachments');
  });

  it('falha de escrita no disco vira 500 sem registro órfão', async () => {
    const { saveAttachment } = await import('../services/attachments.js');
    const userRow = db
      .prepare<[], { id: string }>(`SELECT id FROM users WHERE username = 'anexo.teste'`)
      .get();
    const roDir = path.join(dataDir, 'somente-leitura');
    fs.mkdirSync(roDir, { recursive: true });
    fs.chmodSync(roDir, 0o555);
    const before = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM attachments`).get()?.n;
    try {
      await expect(
        saveAttachment(db, roDir, {
          nodeId: pageId,
          actorId: userRow?.id ?? '',
          originalName: 'falha.png',
          mimeDeclared: 'image/png',
          buffer: PNG_1X1,
        }),
      ).rejects.toMatchObject({ statusCode: 500 });
      expect(db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM attachments`).get()?.n).toBe(
        before,
      );
    } finally {
      fs.chmodSync(roDir, 0o755);
    }
  });
});

describe('novos formatos e ?inline=1', () => {
  const MP4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
    Buffer.alloc(64, 0),
  ]);
  const ZIP_DOCX = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(128, 0)]);

  async function uploadAs(
    filename: string,
    mimetype: string,
    buffer: Buffer,
  ): Promise<{
    status: number;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
  }> {
    const boundary = '----krndocs-fmt';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
      'utf8',
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${pageId}/attachments`,
      payload: Buffer.concat([head, buffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      cookies: authCookies,
    });
    return { status: response.statusCode, body: response.json(), headers: response.headers };
  }

  it('aceita mp4 e serve inline com nosniff', async () => {
    const { status, body } = await uploadAs('video.mp4', 'video/mp4', MP4);
    expect(status).toBe(201);
    const meta = body as { id: string; mime: string };
    expect(meta.mime).toBe('video/mp4');

    const inline = await app.inject({
      method: 'GET',
      url: `/api/attachments/${meta.id}/download?inline=1`,
      cookies: authCookies,
    });
    expect(inline.statusCode).toBe(200);
    expect(inline.headers['content-disposition']).toBe('inline');
    expect(inline.headers['x-content-type-options']).toBe('nosniff');
  });

  it('aceita docx via zip+extensão e ignora inline (sempre attachment)', async () => {
    const { status, body } = await uploadAs(
      'relatorio.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ZIP_DOCX,
    );
    expect(status).toBe(201);
    const meta = body as { id: string; mime: string };
    expect(meta.mime).toContain('wordprocessingml');

    const inline = await app.inject({
      method: 'GET',
      url: `/api/attachments/${meta.id}/download?inline=1`,
      cookies: authCookies,
    });
    expect(inline.statusCode).toBe(200);
    expect(String(inline.headers['content-disposition'])).toContain('attachment;');
  });

  it('rejeita executável disfarçado de docx', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(128, 0)]);
    const { status, body } = await uploadAs(
      'malware.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      exe,
    );
    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejeita zip com extensão incompatível', async () => {
    const { status } = await uploadAs('arquivo.png', 'image/png', ZIP_DOCX);
    expect(status).toBe(400);
  });
});
