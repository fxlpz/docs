import { ERROR_CODES } from '@krndocs/shared';
import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { AppError } from './errors.js';

/**
 * Validação de SAÍDA (exigida pelo AGENTS.md: valide entrada E saída).
 *
 * Se um payload nosso violar o contrato, o bug é do servidor: loga o detalhe
 * e responde 500 genérico — nunca um 400 "de cliente" nem um corpo fora do
 * schema chegando ao front.
 */
export function parseOutput<T>(schema: ZodType<T>, value: unknown, request: FastifyRequest): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    request.log.error({ err: parsed.error }, 'resposta fora do contrato (bug interno)');
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Erro interno. Tente novamente.');
  }
  return parsed.data;
}
