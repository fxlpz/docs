import { describe, expect, it } from 'vitest';
import { loadEnv, serveStaticEnabled } from '../config/env.js';
import { buildDataPaths, resolveDataDir } from '../config/paths.js';

describe('loadEnv', () => {
  it('aplica valores padrão seguros', () => {
    const env = loadEnv({} as NodeJS.ProcessEnv);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.SERVE_STATIC).toBe(false);
  });

  it('rejeita porta fora do intervalo', () => {
    expect(() => loadEnv({ PORT: '99999' } as NodeJS.ProcessEnv)).toThrow(
      /Configuração de ambiente inválida/,
    );
  });

  it('exige SESSION_SECRET em produção', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', DATA_DIR: '/data' } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/);
  });

  it('aceita produção com SESSION_SECRET válido', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      DATA_DIR: '/data',
      SESSION_SECRET: 'x'.repeat(48),
      COOKIE_SECURE: 'true',
    } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('production');
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('rejeita LOG_LEVEL inválido', () => {
    expect(() => loadEnv({ LOG_LEVEL: 'verbose' } as NodeJS.ProcessEnv)).toThrow(/LOG_LEVEL/);
  });

  it('rejeita HOST fora de loopback (API nunca sai da máquina)', () => {
    expect(() => loadEnv({ HOST: '0.0.0.0' } as NodeJS.ProcessEnv)).toThrow(/loopback/);
    expect(() => loadEnv({ HOST: '172.16.16.36' } as NodeJS.ProcessEnv)).toThrow(/loopback/);
  });

  it('aceita HOST de loopback', () => {
    expect(loadEnv({ HOST: '127.0.0.1' } as NodeJS.ProcessEnv).HOST).toBe('127.0.0.1');
    expect(loadEnv({ HOST: 'localhost' } as NodeJS.ProcessEnv).HOST).toBe('localhost');
    expect(loadEnv({ HOST: '::1' } as NodeJS.ProcessEnv).HOST).toBe('::1');
  });

  it('estático: explícito ou implícito em produção', () => {
    expect(serveStaticEnabled(loadEnv({} as NodeJS.ProcessEnv))).toBe(false);
    expect(serveStaticEnabled(loadEnv({ SERVE_STATIC: 'true' } as NodeJS.ProcessEnv))).toBe(true);
    expect(
      serveStaticEnabled(
        loadEnv({
          NODE_ENV: 'production',
          DATA_DIR: '/data',
          SESSION_SECRET: 'x'.repeat(48),
        } as NodeJS.ProcessEnv),
      ),
    ).toBe(true);
  });
});

describe('paths', () => {
  it('resolve caminho relativo contra a raiz do workspace', () => {
    const env = loadEnv({ DATA_DIR: 'var' } as NodeJS.ProcessEnv);
    expect(resolveDataDir(env, '/opt/krndocs')).toBe('/opt/krndocs/var');
  });

  it('mantém caminho absoluto intacto', () => {
    const env = loadEnv({ DATA_DIR: '/home/kernel-adm/krndocs-data' } as NodeJS.ProcessEnv);
    expect(resolveDataDir(env, '/qualquer/lugar')).toBe('/home/kernel-adm/krndocs-data');
  });

  it('monta os caminhos de banco e anexos', () => {
    const paths = buildDataPaths('/data/kdocs');
    expect(paths.databaseFile).toBe('/data/kdocs/app.db');
    expect(paths.attachmentsDir).toBe('/data/kdocs/attachments');
  });
});
