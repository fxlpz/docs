import { describe, expect, it } from 'vitest';
import { AppError, assertEnvelope, errors, safeEnvelope } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { maskIp } from '../lib/ip.js';
import { parseOutput } from '../lib/validate.js';
import { requireAdmin } from '../plugins/auth.js';
import { blocksToPlainText } from '../services/nodes.js';

describe('maskIp', () => {
  it('zera o último octeto do IPv4', () => {
    expect(maskIp('192.168.1.25')).toBe('192.168.1.0');
    expect(maskIp('127.0.0.1')).toBe('127.0.0.0');
  });

  it('expande :: e mantém os 3 primeiros hextetos', () => {
    expect(maskIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:0:0:0:0:0');
    expect(maskIp('2001:db8::1')).toBe('2001:db8:0:0:0:0:0:0');
    expect(maskIp('fe80::a:b:c:d')).toBe('fe80:0:0:0:0:0:0:0');
  });

  it('trata IPv4-mapeado como IPv4', () => {
    expect(maskIp('::ffff:192.168.0.10')).toBe('192.168.0.0');
  });

  it('remove zona de escopo e rejeita lixo', () => {
    expect(maskIp('fe80::1%eth0')).toBe('fe80:0:0:0:0:0:0:0');
    expect(maskIp(undefined)).toBeNull();
    expect(maskIp(null)).toBeNull();
    expect(maskIp('')).toBeNull();
    expect(maskIp('nao-um-ip')).toBeNull();
    expect(maskIp('1.2.3')).toBeNull();
    expect(maskIp('gggg::1')).toBeNull();
  });

  it('rejeita octetos e grupos malformados', () => {
    expect(maskIp('%')).toBeNull();
    expect(maskIp('1::2::3')).toBeNull();
    expect(maskIp('1:2:3')).toBeNull();
    expect(maskIp('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(maskIp('1.2.3.x')).toBeNull();
    expect(maskIp('1.2.3.4.5')).toBeNull();
  });
});

describe('newId', () => {
  it('gera UUIDs únicos não vazios', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });
});

describe('errors (helpers e envelope de saída)', () => {
  it('helpers devolvem status e código coerentes', () => {
    expect(errors.unauthorized().statusCode).toBe(401);
    expect(errors.forbidden().statusCode).toBe(403);
    expect(errors.notFound().statusCode).toBe(404);
    expect(errors.conflict('x').statusCode).toBe(409);
    expect(errors.versionConflict('x').code).toBe('VERSION_CONFLICT');
    expect(errors.validation('x').statusCode).toBe(400);
    expect(errors.internal().statusCode).toBe(500);
  });

  it('safeEnvelope trunca mensagem longa mantendo o contrato', () => {
    const envelope = safeEnvelope(new AppError(400, 'VALIDATION_ERROR', 'x'.repeat(600)), 'r1');
    expect(envelope.error.message).toHaveLength(500);
    expect(assertEnvelope(envelope)).toBeTruthy();
  });

  it('safeEnvelope cai no genérico quando até o código viola o contrato', () => {
    const envelope = safeEnvelope(new AppError(400, 'X'.repeat(100), 'msg'), 'r1');
    expect(envelope.error.code).toBe('INTERNAL_ERROR');
    expect(envelope.error.message).toBe('Erro interno. Tente novamente.');
  });
});

describe('parseOutput (validação de saída)', () => {
  it('devolve o dado quando o contrato é respeitado', () => {
    const parsed = parseOutput(
      { safeParse: (v: unknown) => ({ success: true as const, data: v }) },
      { a: 1 },
      { log: { error: () => {} } } as never,
    );
    expect(parsed).toEqual({ a: 1 });
  });

  it('vira 500 genérico (nunca 400 de cliente) quando o contrato é violado', () => {
    let logged = false;
    try {
      parseOutput({ safeParse: () => ({ success: false as const, error: 'bug' }) }, { a: 1 }, {
        log: {
          error: () => {
            logged = true;
          },
        },
      } as never);
      expect.unreachable('deveria lançar');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(500);
      expect(logged).toBe(true);
    }
  });
});

describe('requireAdmin', () => {
  it('401 sem sessão, 403 para membro, passa para admin', async () => {
    await expect(requireAdmin({ user: null } as never, {} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      requireAdmin(
        { user: { id: 'u', username: 'm', displayName: 'M', role: 'member' } } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      requireAdmin(
        { user: { id: 'u', username: 'a', displayName: 'A', role: 'admin' } } as never,
        {} as never,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('blocksToPlainText', () => {
  it('extrai texto de blocos aninhados', () => {
    const blocks = [
      { type: 'heading', content: [{ type: 'text', text: 'Título' }] },
      { type: 'paragraph', content: 'Corpo simples.' },
    ];
    expect(blocksToPlainText(blocks)).toBe('Título Corpo simples.');
  });

  it('ignora chaves não textuais e normaliza espaços', () => {
    const blocks = [{ type: 'paragraph', id: 'abc-123', content: '  a   b\nc ' }];
    expect(blocksToPlainText(blocks)).toBe('a b c');
  });

  it('conteúdo malicioso vira texto (sem execução)', () => {
    const blocks = [{ type: 'paragraph', content: '<script>alert(1)</script>' }];
    const text = blocksToPlainText(blocks);
    expect(text).toBe('<script>alert(1)</script>');
    expect(typeof text).toBe('string');
  });

  it('entrada vazia ou estranha não quebra', () => {
    expect(blocksToPlainText([])).toBe('');
    expect(blocksToPlainText([null, 42, { type: 'x' }] as unknown as [])).toBe('');
  });
});
