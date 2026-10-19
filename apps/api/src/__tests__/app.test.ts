import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiErrorSchema, healthResponseSchema } from '@krndocs/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppContext, buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { buildDataPaths } from '../config/paths.js';
import { closeDatabase, type Db, openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import { AppError, safeEnvelope } from '../lib/errors.js';

let app: FastifyInstance;
let db: Db;
let dataDir: string;

beforeAll(async () => {
  // Banco de teste separado dos dados reais: diretório temporório por execução.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-test-'));
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

describe('GET /api/health', () => {
  it('responde 200 com o contrato HealthResponse', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);

    const parsed = healthResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('ok');
      expect(parsed.data.version).toBe('0.1.0-test');
      expect(parsed.data.migrations).toBeGreaterThanOrEqual(1);
    }
  });

  it('não vaza cabeçalhos de segurança (Helmet ativo)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('não permite cache do diagnóstico (no-store)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('responde 503 degraded quando o banco não responde', async () => {
    // Instância própria com o banco já fechado: nenhuma consulta responde.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-degraded-'));
    const env = loadEnv({
      NODE_ENV: 'test',
      DATA_DIR: tmp,
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    const paths = buildDataPaths(env.DATA_DIR);
    const brokenDb = openDatabase(paths.databaseFile);
    brokenDb.close();

    const brokenApp = await buildApp(
      { env, paths, db: brokenDb, version: '0.1.0-test' },
      { logger: false },
    );
    await brokenApp.ready();

    const response = await brokenApp.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    const parsed = healthResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('degraded');
      expect(parsed.data.migrations).toBe(0);
    }

    await brokenApp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('tratamento de erros', () => {
  it('retorna envelope padrão em rota inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/rota-que-nao-existe' });
    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('usa requestId rastreável no envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    const body = response.json() as { error: { requestId?: string } };
    expect(body.error.requestId).toBeDefined();
  });

  it('mantém o envelope dentro do contrato mesmo com mensagem longa (validação de saída)', () => {
    const envelope = safeEnvelope(
      new AppError(400, 'VALIDATION_ERROR', 'x'.repeat(600), { campo: 'y'.repeat(400) }),
      'req-teste',
    );
    const parsed = apiErrorSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    expect(envelope.error.message.length).toBeLessThanOrEqual(500);
    expect(envelope.error.fields?.campo.length).toBeLessThanOrEqual(300);
  });

  it('corpo JSON malformado vira 400 com envelope (não vaza detalhe)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"username": "quebrado", ',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Requisição inválida.');
  });

  it('corpo acima de 2 MiB vira 413 com envelope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: `{"username": "alguem.valido", "password": "${'x'.repeat(2 * 1024 * 1024 + 100)}"}`,
    });
    expect(response.statusCode).toBe(413);
    expect((response.json() as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  }, 30000);
});

describe('migrações', () => {
  it('é idempotente: segunda execução não reaplica', async () => {
    const result = runMigrations(db);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied.length).toBeGreaterThanOrEqual(1);
  });

  it('cria as tabelas essenciais com integridade referencial', async () => {
    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);

    for (const expected of [
      'users',
      'sessions',
      'nodes',
      'page_versions',
      'tags',
      'favorites',
      'attachments',
      'activity',
      'schema_migrations',
    ]) {
      expect(tables).toContain(expected);
    }

    const fk = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(fk[0]?.foreign_keys).toBe(1);
  });

  it('falha ao alterar migração já aplicada (drift de checksum)', async () => {
    // Simula drift: altera o checksum registrado da primeira migração.
    const row = db
      .prepare<[], { version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations LIMIT 1',
      )
      .get();
    expect(row).toBeDefined();

    db.prepare("UPDATE schema_migrations SET checksum = 'drift' WHERE version = ?").run(
      row?.version,
    );
    expect(() => runMigrations(db)).toThrow(/checksum/i);

    // Restaura para não poluir os demais testes.
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?').run(
      row?.checksum,
      row?.version,
    );
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('falha quando uma migração aplicada some do diretório (drift por remoção)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-mig-'));
    try {
      fs.writeFileSync(path.join(dir, '0001_x.sql'), 'CREATE TABLE t_drift (a TEXT);');
      const d2 = openDatabase(path.join(dir, 'db.sqlite'));
      runMigrations(d2, dir);

      fs.rmSync(path.join(dir, '0001_x.sql'));
      expect(() => runMigrations(d2, dir)).toThrow(/ausente/i);
      d2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falha com mensagem clara quando duas migrações têm a mesma versão', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-mig-'));
    try {
      fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE t_a (x TEXT);');
      fs.writeFileSync(path.join(dir, '0001_b.sql'), 'CREATE TABLE t_b (x TEXT);');
      const d2 = openDatabase(path.join(dir, 'db.sqlite'));
      expect(() => runMigrations(d2, dir)).toThrow(/duplicada/i);
      d2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aplicação por fora não quebra a reexecução (base do recheck de corrida)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-mig-'));
    try {
      fs.writeFileSync(path.join(dir, '0001_x.sql'), 'CREATE TABLE t_race (a TEXT);');
      const d2 = openDatabase(path.join(dir, 'db.sqlite'));
      runMigrations(d2, dir);

      // Simula outro processo que já registrou a mesma migração: apagar e
      // reinserir o registro não pode gerar "table already exists".
      const row = d2
        .prepare<[], { version: string; name: string; checksum: string; applied_at: string }>(
          'SELECT * FROM schema_migrations LIMIT 1',
        )
        .get();
      expect(row).toBeDefined();
      d2.prepare('DELETE FROM schema_migrations WHERE version = ?').run(row?.version);
      d2.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(row?.version, row?.name, row?.checksum, row?.applied_at);

      expect(() => runMigrations(d2, dir)).not.toThrow();
      d2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
