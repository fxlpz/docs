import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDataPaths } from '../config/paths.js';
import { closeDatabase, type Db, openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  DEFAULT_TEMPLATES,
  DEFAULT_TEMPLATES_SEEDED_KEY,
  DEFAULT_TEMPLATES_VERSION,
  seedDefaultTemplates,
} from '../services/defaultTemplates.js';

let dataDir: string;
let db: Db;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krndocs-std-'));
  const paths = buildDataPaths(dataDir);
  db = openDatabase(paths.databaseFile);
  runMigrations(db);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function count(sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as { total: number } | undefined;
  return row?.total ?? 0;
}

describe('seedDefaultTemplates (modelos padrão)', () => {
  it('cria todos os modelos UMA única vez e marca como concluído', () => {
    expect(seedDefaultTemplates(db)).toBe(DEFAULT_TEMPLATES.length);
    expect(seedDefaultTemplates(db)).toBe(0);

    expect(count(`SELECT COUNT(*) AS total FROM templates`)).toBe(DEFAULT_TEMPLATES.length);
    expect(count(`SELECT COUNT(*) AS total FROM nodes WHERE is_template = 1`)).toBe(
      DEFAULT_TEMPLATES.length,
    );
    // Padrão Notion: cada modelo tem um ícone (emoji) na página.
    expect(DEFAULT_TEMPLATES.every((template) => template.icon.length > 0)).toBe(true);
    expect(
      count(`SELECT COUNT(*) AS total FROM nodes WHERE icon IS NULL AND is_template = 1`),
    ).toBe(0);
    const marker = db
      .prepare<[string], { value: string }>(`SELECT value FROM settings WHERE key = ?`)
      .get(DEFAULT_TEMPLATES_SEEDED_KEY);
    const state = JSON.parse(marker?.value ?? '{}') as { version: number; seen: string[] };
    expect(state.version).toBe(DEFAULT_TEMPLATES_VERSION);
    expect(state.seen).toHaveLength(DEFAULT_TEMPLATES.length);
  });

  it('apagar os modelos não faz eles voltarem sozinhos', () => {
    seedDefaultTemplates(db);
    // Simula o usuário removendo TODOS os modelos.
    db.prepare(`DELETE FROM templates`).run();
    expect(seedDefaultTemplates(db)).toBe(0);
    expect(count(`SELECT COUNT(*) AS total FROM templates`)).toBe(0);
  });

  it('force recria só o que falta e não duplica o que existe', () => {
    seedDefaultTemplates(db);
    const first = db
      .prepare<[], { node_id: string }>(`SELECT node_id FROM templates WHERE name LIKE 'Ata%'`)
      .get();
    expect(first).toBeTruthy();
    db.prepare(`DELETE FROM templates WHERE node_id = ?`).run(first?.node_id ?? '');

    // Restauração: recria apenas o que foi apagado.
    expect(seedDefaultTemplates(db, { force: true })).toBe(1);
    // E é idempotente mesmo com force quando nada falta.
    expect(seedDefaultTemplates(db, { force: true })).toBe(0);
    expect(count(`SELECT COUNT(*) AS total FROM templates`)).toBe(DEFAULT_TEMPLATES.length);
  });

  it('páginas padrão têm conteúdo v1 e entram no índice de busca', () => {
    seedDefaultTemplates(db);
    const node = db
      .prepare<[string], { id: string; current_version: number; search_text: string }>(
        `SELECT id, current_version, search_text FROM nodes WHERE title = ?`,
      )
      .get('Runbook de incidente de segurança');
    expect(node?.current_version).toBe(1);
    expect(node?.search_text.length ?? 0).toBeGreaterThan(0);

    const versions = count(`SELECT COUNT(*) AS total FROM page_versions WHERE node_id = ?`, [
      node?.id ?? '',
    ]);
    expect(versions).toBe(1);

    // FTS5: o modelo é encontrado por conteúdo/título.
    const hits = db
      .prepare<[], { node_id: string }>(
        `SELECT node_id FROM pages_fts WHERE pages_fts MATCH 'erradicacao'`,
      )
      .all();
    expect(hits.some((hit) => hit.node_id === node?.id)).toBe(true);
  });

  it('fica tudo dentro de uma pasta única na raiz', () => {
    seedDefaultTemplates(db);
    const folder = db
      .prepare<[], { id: string }>(
        `SELECT id FROM nodes WHERE type = 'folder' AND title = 'Modelos padrão'`,
      )
      .get();
    expect(folder).toBeTruthy();
    expect(
      count(`SELECT COUNT(*) AS total FROM nodes WHERE parent_id = ?`, [folder?.id ?? '']),
    ).toBe(DEFAULT_TEMPLATES.length);
    // Uma segunda pasta não é criada na restauração.
    seedDefaultTemplates(db, { force: true });
    expect(
      count(
        `SELECT COUNT(*) AS total FROM nodes WHERE title = 'Modelos padrão' AND type = 'folder'`,
      ),
    ).toBe(1);
  });

  function nodeIdByTitle(title: string): string {
    const row = db
      .prepare<[string], { id: string }>(`SELECT id FROM nodes WHERE title = ?`)
      .get(title);
    return row?.id ?? '';
  }

  it('marcador legado (v1) com conteúdo antigo é atualizado para a versão nova', () => {
    seedDefaultTemplates(db);
    const id = nodeIdByTitle('Ata de reunião');
    db.prepare(`UPDATE page_versions SET content_json = ? WHERE node_id = ? AND version = 1`).run(
      '[{"type":"paragraph","content":"conteúdo antigo"}]',
      id,
    );
    // Estado antigo do marcador (texto simples '1').
    db.prepare(`UPDATE settings SET value = '1' WHERE key = ?`).run(DEFAULT_TEMPLATES_SEEDED_KEY);

    expect(seedDefaultTemplates(db)).toBe(1);

    const node = db
      .prepare<[string], { current_version: number; search_text: string }>(
        `SELECT current_version, search_text FROM nodes WHERE id = ?`,
      )
      .get(id);
    expect(node?.current_version).toBe(2);
    expect(node?.search_text ?? '').toContain('Decisões');
    const current = db
      .prepare<[string], { content_json: string }>(
        `SELECT content_json FROM page_versions WHERE node_id = ? AND version = 2`,
      )
      .get(id);
    expect(current?.content_json ?? '').toContain('Como usar');
    // Versão antiga continua no histórico.
    expect(count(`SELECT COUNT(*) AS total FROM page_versions WHERE node_id = ?`, [id])).toBe(2);
  });

  it('conteúdo editado pela equipe não é sobrescrito na atualização', () => {
    seedDefaultTemplates(db);
    const id = nodeIdByTitle('Relatório de vulnerabilidade');
    const edited = JSON.stringify([{ type: 'paragraph', content: 'texto escrito pela equipe' }]);
    db.prepare(
      `INSERT INTO page_versions (id, node_id, version, content_json, title_snapshot, source, byte_size, created_at)
       VALUES (?, ?, 2, ?, 'Relatório de vulnerabilidade', 'manual', ?, ?)`,
    ).run('v2-editada', id, edited, edited.length, '2026-10-13T12:00:00.000Z');
    db.prepare(`UPDATE nodes SET current_version = 2, search_text = ? WHERE id = ?`).run(
      'texto escrito pela equipe',
      id,
    );
    db.prepare(`UPDATE settings SET value = '1' WHERE key = ?`).run(DEFAULT_TEMPLATES_SEEDED_KEY);

    // Nada a regravar: os demais já estão com o conteúdo novo e o editado é preservado.
    expect(seedDefaultTemplates(db)).toBe(0);
    const current = db
      .prepare<[string], { content_json: string }>(
        `SELECT content_json FROM page_versions WHERE node_id = ? AND version = 2`,
      )
      .get(id);
    expect(current?.content_json).toBe(edited);
    const node = db
      .prepare<[string], { current_version: number }>(
        `SELECT current_version FROM nodes WHERE id = ?`,
      )
      .get(id);
    expect(node?.current_version).toBe(2);
  });

  it('modelo novo entra na subida de versão; o apagado (conhecido) não volta', () => {
    seedDefaultTemplates(db);
    // Usuário apagou um modelo antigo e um novo.
    db.prepare(`DELETE FROM templates WHERE name IN (?, ?)`).run(
      'Ata de reunião',
      'Matriz de risco',
    );
    // Estado simulado de uma versão anterior: só "Ata de reunião" era conhecido.
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(
      JSON.stringify({ version: 1, hashes: {}, seen: ['Ata de reunião'] }),
      DEFAULT_TEMPLATES_SEEDED_KEY,
    );

    // Só o modelo desconhecido é criado; o apagado continua fora.
    expect(seedDefaultTemplates(db)).toBe(1);
    const names = db.prepare<[], { name: string }>(`SELECT name FROM templates`).all();
    expect(names.some((row) => row.name === 'Matriz de risco')).toBe(true);
    expect(names.some((row) => row.name === 'Ata de reunião')).toBe(false);
  });
});
