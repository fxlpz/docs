import { describe, expect, it } from 'vitest';
import { attachmentSchema, downloadQuerySchema } from './attachments.js';
import { authUserResponseSchema, changePasswordRequestSchema, loginRequestSchema } from './auth.js';
import { apiErrorSchema, ERROR_CODES } from './errors.js';
import { addFavoriteRequestSchema } from './favorites.js';
import { healthResponseSchema } from './health.js';
import { restoreVersionRequestSchema } from './history.js';
import {
  createNodeRequestSchema,
  moveNodeRequestSchema,
  saveContentRequestSchema,
  updateNodeRequestSchema,
} from './nodes.js';
import { searchQuerySchema } from './search.js';
import { createFromTemplateRequestSchema, markTemplateRequestSchema } from './templates.js';
import { permanentDeleteQuerySchema } from './trash.js';
import {
  createUserRequestSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
  updateUserRequestSchema,
} from './users.js';

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
  const user = {
    id: 'u1',
    username: 'felipe.rosa',
    displayName: 'Felipe Rosa',
    role: 'admin',
    hasAvatar: false,
  };

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

describe('createUserRequestSchema', () => {
  it('normaliza username e aplica papel padrão', () => {
    const parsed = createUserRequestSchema.safeParse({
      username: '  Maria.Silva ',
      displayName: 'Maria Silva',
      password: 'senha-valida-123',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.username).toBe('maria.silva');
      expect(parsed.data.role).toBe('member');
    }
  });

  it('rejeita username inválido e senha curta', () => {
    expect(
      createUserRequestSchema.safeParse({
        username: 'nome com espaço!',
        displayName: 'X',
        password: 'senha-valida-123',
      }).success,
    ).toBe(false);
    expect(
      createUserRequestSchema.safeParse({ username: 'abc', displayName: 'X', password: 'curta' })
        .success,
    ).toBe(false);
  });
});

describe('updateUserRequestSchema', () => {
  it('exige ao menos um campo', () => {
    expect(updateUserRequestSchema.safeParse({}).success).toBe(false);
    expect(updateUserRequestSchema.safeParse({ role: 'admin' }).success).toBe(true);
  });
});

describe('updateProfileRequestSchema', () => {
  it('exige nome não vazio', () => {
    expect(updateProfileRequestSchema.safeParse({ displayName: 'Novo Nome' }).success).toBe(true);
    expect(updateProfileRequestSchema.safeParse({ displayName: '   ' }).success).toBe(false);
  });
});

describe('resetPasswordRequestSchema', () => {
  it('exige mínimo de 10', () => {
    expect(resetPasswordRequestSchema.safeParse({ password: 'senha-valida-1' }).success).toBe(true);
    expect(resetPasswordRequestSchema.safeParse({ password: 'curta' }).success).toBe(false);
  });
});

describe('downloadQuerySchema', () => {
  it('aceita ausente ou inline=1, rejeita outro valor', () => {
    expect(downloadQuerySchema.safeParse({}).success).toBe(true);
    expect(downloadQuerySchema.safeParse({ inline: '1' }).success).toBe(true);
    expect(downloadQuerySchema.safeParse({ inline: '0' }).success).toBe(false);
  });
});

describe('moveNodeRequestSchema', () => {
  it('aceita mover para raiz, pasta ou antes de irmão', () => {
    expect(moveNodeRequestSchema.safeParse({ parentId: null, beforeId: null }).success).toBe(true);
    expect(moveNodeRequestSchema.safeParse({ parentId: 'abc', beforeId: 'def' }).success).toBe(
      true,
    );
    expect(moveNodeRequestSchema.safeParse({}).success).toBe(true);
    expect(moveNodeRequestSchema.safeParse({ parentId: '' }).success).toBe(false);
  });
});

describe('searchQuerySchema', () => {
  it('aceita termo válido e rejeita vazio/longo', () => {
    expect(searchQuerySchema.safeParse({ q: 'firewall' }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('attachmentSchema', () => {
  const valid = {
    id: 'a1',
    nodeId: 'n1',
    originalName: 'print.png',
    mime: 'image/png',
    sizeBytes: 1234,
    sha256: 'a'.repeat(64),
    uploadedAt: new Date().toISOString(),
  };

  it('aceita metadados válidos', () => {
    expect(attachmentSchema.safeParse(valid).success).toBe(true);
  });

  it('rejeita sha256 fora do formato', () => {
    expect(attachmentSchema.safeParse({ ...valid, sha256: 'curto' }).success).toBe(false);
  });
});

describe('addFavoriteRequestSchema', () => {
  it('exige nodeId', () => {
    expect(addFavoriteRequestSchema.safeParse({ nodeId: 'n1' }).success).toBe(true);
    expect(addFavoriteRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('markTemplateRequestSchema', () => {
  it('aplica categoria padrão e rejeita nome vazio', () => {
    const parsed = markTemplateRequestSchema.safeParse({ name: 'Checklist' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.category).toBe('Geral');
    expect(markTemplateRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
});

describe('createFromTemplateRequestSchema', () => {
  it('aceita corpo vazio (tudo opcional)', () => {
    expect(createFromTemplateRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe('restoreVersionRequestSchema', () => {
  it('exige versão >= 1', () => {
    expect(restoreVersionRequestSchema.safeParse({ version: 2 }).success).toBe(true);
    expect(restoreVersionRequestSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

describe('permanentDeleteQuerySchema', () => {
  it('só aceita confirm=true literal', () => {
    expect(permanentDeleteQuerySchema.safeParse({ confirm: 'true' }).success).toBe(true);
    expect(permanentDeleteQuerySchema.safeParse({}).success).toBe(false);
    expect(permanentDeleteQuerySchema.safeParse({ confirm: 'yes' }).success).toBe(false);
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
