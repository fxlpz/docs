import type { ApiError as ApiErrorBody } from '@krndocs/shared';
import type { ZodType } from 'zod';

/**
 * Cliente HTTP da aplicação (mesma origem via proxy do Vite).
 *
 * - Erros da API vêm sempre no envelope padrão { error: {...} } e são
 *   reexibidos como `ApiError` com código estável + mensagem pt-BR.
 * - Toda resposta de SUCESSO é validada pelo schema compartilhado no ponto de
 *   uso (`parseWith`): contrato divergente não vira estado corrompido na tela.
 * - O cookie de sessão acompanha as requisições (same-origin, credentials).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    // Falha de rede: mensagem de conexão, nunca stack trace.
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao servidor.');
  }

  if (response.status === 204) return undefined as T;

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = (json as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? 'UNKNOWN',
      envelope?.message ?? `O servidor respondeu ${response.status}.`,
      envelope?.fields,
    );
  }

  return json as T;
}

/** Valida a resposta de sucesso contra o contrato compartilhado. */
export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(0, 'OUT_OF_CONTRACT', 'Resposta da API fora do contrato esperado.');
  }
  return parsed.data;
}
