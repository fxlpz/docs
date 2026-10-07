import { randomUUID } from 'node:crypto';

/**
 * Identificador de entidade (UUID v4 em TEXT).
 *
 * O modelo de dados aceita ULID ou UUID: UUID é gerado pela stdlib (sem
 * dependência), é globalmente único e nunca compartilha sequência entre
 * processos — seguro para escrita concorrente.
 */
export function newId(): string {
  return randomUUID();
}
