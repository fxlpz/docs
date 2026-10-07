import { type ApiError, apiErrorSchema, ERROR_CODES } from '@krndocs/shared';
import type { ZodError } from 'zod';

/**
 * Erro de aplicação com código HTTP e código estável.
 * Nunca transporta segredos, stack traces ou dados de outros usuários.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(statusCode: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (fields) this.fields = fields;
  }

  toEnvelope(requestId?: string): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }
}

export const errors = {
  unauthorized: (message = 'Autenticação necessária.') =>
    new AppError(401, ERROR_CODES.UNAUTHORIZED, message),
  forbidden: (message = 'Você não tem permissão para esta operação.') =>
    new AppError(403, ERROR_CODES.FORBIDDEN, message),
  notFound: (message = 'Recurso não encontrado.') =>
    new AppError(404, ERROR_CODES.NOT_FOUND, message),
  conflict: (message: string) => new AppError(409, ERROR_CODES.CONFLICT, message),
  versionConflict: (message: string) => new AppError(409, ERROR_CODES.VERSION_CONFLICT, message),
  validation: (message: string, fields?: Record<string, string>) =>
    new AppError(400, ERROR_CODES.VALIDATION_ERROR, message, fields),
  internal: (message = 'Erro interno. Tente novamente.') =>
    new AppError(500, ERROR_CODES.INTERNAL_ERROR, message),
};

/** Converte ZodError em AppError 400 com campos individuais. */
export function fromZodError(error: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '(raiz)';
    if (!fields[key]) fields[key] = issue.message;
  }
  return errors.validation('Dados inválidos. Verifique os campos destacados.', fields);
}

/** Garante que o valor de envelope passe pelo schema (defesa em profundidade). */
export function assertEnvelope(value: ApiError): ApiError {
  return apiErrorSchema.parse(value);
}

/**
 * Monta o envelope validando-o contra o contrato — validação de SAÍDA, exigida
 * pelo AGENTS.md (valide entrada E saída no servidor).
 *
 * Se a violação for por tamanho (mensagem/campo acima do limite do schema),
 * trunca e revalida; como último recurso, devolve o envelope genérico — nunca
 * um payload fora do contrato.
 */
export function safeEnvelope(error: AppError, requestId?: string): ApiError {
  const envelope = error.toEnvelope(requestId);
  try {
    return assertEnvelope(envelope);
  } catch {
    const truncated: ApiError = {
      error: {
        code: envelope.error.code,
        message: envelope.error.message.slice(0, 500) || 'Erro.',
        ...(envelope.error.fields
          ? {
              fields: Object.fromEntries(
                Object.entries(envelope.error.fields).map(([key, value]) => [
                  key,
                  value.slice(0, 300),
                ]),
              ),
            }
          : {}),
        ...(envelope.error.requestId ? { requestId: envelope.error.requestId } : {}),
      },
    };
    try {
      return assertEnvelope(truncated);
    } catch {
      return apiErrorSchema.parse({
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Erro interno. Tente novamente.',
          ...(requestId ? { requestId } : {}),
        },
      });
    }
  }
}
