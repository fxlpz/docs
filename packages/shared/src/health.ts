import { z } from 'zod';

/** Resposta de GET /api/health - usada pelo front para diagnóstico de conectividade. */
export const healthResponseSchema = z.object({
  /**
   * `ok` (200): API e banco respondendo.
   * `degraded` (503): API viva, mas o banco não respondeu (migrations=0).
   */
  status: z.enum(['ok', 'degraded']),
  /** Versão da aplicação (package.json) */
  version: z.string().min(1),
  /** Timestamp do servidor em ISO 8601 UTC */
  time: z.string().datetime(),
  /** Número de migrações aplicadas no banco */
  migrations: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
