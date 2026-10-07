import { describe, expect, it } from 'vitest';
import { authUserResponseSchema, changePasswordRequestSchema, loginRequestSchema } from './auth.js';
import { apiErrorSchema, ERROR_CODES } from './errors.js';
import { healthResponseSchema } from './health.js';
import {
  createNodeRequestSchema,
  saveContentRequestSchema,
  updateNodeRequestSchema,
} from './nodes.js';

describe('apiErrorSchema', () => {
  it('aceita um envelope de erro válido', () => {
    const parsed = apiErrorSchema.safeParse({
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Sessão expirada. Entre novamente.',
        requestId: 'abc123',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejeita mensagem vazia', () => {
    const parsed = apiErrorSchema.safeParse({
      error: { code: 'NOT_FOUND', message: '' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejeita campos com tipos inválidos', () => {
    const parsed = apiErrorSchema.safeParse({ error: { code: 123, message: 'x' } });
    expect(parsed.success).toBe(false);
  });
});

describe('healthResponseSchema', () => {
  it('aceita uma resposta de saúde válida', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      time: new Date().toISOString(),
      migrations: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it('aceita status degraded (banco indisponível)', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'degraded',
      version: '0.1.0',
      time: new Date().toISOString(),
      migrations: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejeita status fora do contrato', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'erro',
      version: '0.1.0',
      time: new Date().toISOString(),
      migrations: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejeita migrations negativas', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      time: new Date().toISOString(),
      migrations: -1,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('normaliza username para minúsculo e sem espaços', () => {
    const parsed = loginRequestSchema.safeParse({
      username: '  Felipe.Rosa ',
      password: 'qualquer-senha',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.username).toBe('felipe.rosa');
  });

  it('rejeita senha vazia e username curto', () => {
    expect(loginRequestSchema.safeParse({ username: 'felipe.rosa', password: '' }).success).toBe(
      false,
    );
    expect(loginRequestSchema.safeParse({ username: 'ab', password: 'x' }).success).toBe(false);
  });
});

describe('authUserResponseSchema', () => {
  const user = { id: 'u1', username: 'felipe.rosa', displayName: 'Felipe Rosa', role: 'admin' };

  it('exige a flag mustChangePassword (contrato da Etapa 2)', () => {
    expect(authUserResponseSchema.safeParse({ user }).success).toBe(false);
    const parsed = authUserResponseSchema.safeParse({ user, mustChangePassword: true });
    expect(parsed.success).toBe(true);
  });
});

describe('changePasswordRequestSchema', () => {
  it('aceita troca válida', () => {
    const parsed = changePasswordRequestSchema.safeParse({
      currentPassword: 'provisoria-atual',
      newPassword: 'senha-definitiva-1',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejeita nova senha abaixo do mínimo', () => {
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'atual', newPassword: 'curta' })
        .success,
    ).toBe(false);
  });
});

describe('createNodeRequestSchema', () => {
  it('aceita criação mínima com título padrão vazio', () => {
    const parsed = createNodeRequestSchema.safeParse({ type: 'page' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.title).toBe('');
  });

  it('rejeita tipo desconhecido', () => {
    expect(createNodeRequestSchema.safeParse({ type: 'arquivo' }).success).toBe(false);
  });
});

describe('updateNodeRequestSchema', () => {
  it('exige ao menos um campo', () => {
    expect(updateNodeRequestSchema.safeParse({}).success).toBe(false);
  });

  it('aceita renomear apenas', () => {
    expect(updateNodeRequestSchema.safeParse({ title: 'Novo titulo' }).success).toBe(true);
  });
});

describe('saveContentRequestSchema', () => {
  it('aceita salvamento com versão base válida e source padrão', () => {
    const parsed = saveContentRequestSchema.safeParse({
      content: [{ type: 'paragraph', content: 'texto' }],
      baseVersion: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.source).toBe('manual');
  });

  it('rejeita versão base negativa e conteúdo que não é lista', () => {
    expect(saveContentRequestSchema.safeParse({ content: [], baseVersion: -1 }).success).toBe(
      false,
    );
    expect(
      saveContentRequestSchema.safeParse({ content: { blocks: [] }, baseVersion: 0 }).success,
    ).toBe(false);
  });
});
