import { z } from 'zod';

/**
 * Validação única de variáveis de ambiente.
 *
 * O servidor NÃO inicia se a configuração for inválida: falha rápido e explícito
 * é preferível a operar com configuração silenciosamente errada.
 * Nunca coloque segredos neste arquivo - apenas os nomes das variáveis.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Diretório próprio de dados (banco + anexos), separado do código. */
  DATA_DIR: z.string().min(1).default('var'),
  /** Segredo de assinatura de cookies. Obrigatório em produção. */
  SESSION_SECRET: z.string().min(32).optional(),
  /** Cookies Secure: só atrás de HTTPS. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Serve o front pronto (`apps/web/dist`) na mesma origem (produção em
   * loopback). Padrão: ligado em produção, desligado em dev/teste (Vite).
   */
  SERVE_STATIC: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${details}`);
  }

  const env = parsed.data;
  // Política de rede (AGENTS.md): a API escuta SOMENTE em loopback — a exposição
  // à LAN é papel do Vite (WEB_HOST), que chega aqui via proxy same-origin.
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(env.HOST)) {
    throw new Error(
      `HOST="${env.HOST}" não é permitido: a API deve escutar apenas em loopback ` +
        '(127.0.0.1, localhost ou ::1). Expor a Web na LAN use WEB_HOST no .env do projeto.',
    );
  }
  if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET é obrigatório quando NODE_ENV=production (mínimo de 32 caracteres).',
    );
  }
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === false) {
    // Aviso explícito: em produção real deve existir HTTPS.
    console.warn('[aviso] COOKIE_SECURE=false em produção. Use apenas atrás de HTTPS aprovado.');
  }
  return env;
}

/** Front estático ativo: explícito ou implícito em produção. */
export function serveStaticEnabled(env: Env): boolean {
  return env.SERVE_STATIC || env.NODE_ENV === 'production';
}
