import { z } from 'zod';

/**
 * Envelope padrão de erro da API.
 *
 * Toda resposta de erro HTTP da aplicação tem este formato, permitindo que o
 * front trate falhas de forma uniforme (rede, validação, autorização, conflito).
 *
 * `code` é estável e pode ser usado para condicionar comportamentos no cliente.
 * Mensagens são exibíveis ao usuário (pt-BR) e nunca contêm segredos,
 * stack traces ou dados de outros usuários.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    /** Código estável, em MAIÚSCULAS, ex.: VALIDATION_ERROR, UNAUTHORIZED, CONFLICT */
    code: z.string().min(1).max(64),
    /** Mensagem segura para exibição, em português do Brasil */
    message: z.string().min(1).max(500),
    /** Detalhes de campos inválidos (apenas validação), opcional */
    fields: z.record(z.string(), z.string().max(300)).optional(),
    /** Identificador do erro nos logs do servidor (para suporte), opcional */
    requestId: z.string().max(64).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** Códigos de erro conhecidos pela aplicação. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  /** Sessão válida mas senha provisória: exige POST /api/auth/change-password. */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
