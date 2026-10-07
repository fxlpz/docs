import { z } from 'zod';

/**
 * Contratos de autenticação local (Etapa 2).
 *
 * - Sem cadastro público: login restrito aos usuários provisionados.
 * - O cookie de sessão nunca aparece nestes payloads (é infraestrutura HTTP).
 * - `role` distingue admin (gerencia usuários) de member (edita documentação).
 */

/** Papel do usuário no espaço de trabalho. */
export const userRoleSchema = z.enum(['admin', 'member']);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Usuário autenticado, devolvido por /api/auth/login e /api/auth/me. */
export const sessionUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(3).max(64),
  displayName: z.string().min(1).max(120),
  role: userRoleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** POST /api/auth/login - corpo da requisição. */
export const loginRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    // Username é sempre minúsculo (CHECK do banco exige lower(username)).
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Resposta de /api/auth/login e /api/auth/me (200). */
export const authUserResponseSchema = z.object({
  user: sessionUserSchema,
  /**
   * true quando a senha é provisória: o login é aceito, mas toda rota (exceto
   * /api/auth/*) responde 403 até a troca em POST /api/auth/change-password.
   */
  mustChangePassword: z.boolean(),
});
export type AuthUserResponse = z.infer<typeof authUserResponseSchema>;

/** Política única de senha (provisionamento, troca e criação futura). */
export const PASSWORD_MIN_LENGTH = 10;

/** POST /api/auth/change-password - troca obrigatória no primeiro acesso. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(1024),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Resposta da troca de senha. */
export const changePasswordResponseSchema = z.object({
  ok: z.literal(true),
});
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;

/** POST /api/auth/logout - operação idempotente. */
export const logoutResponseSchema = z.object({
  ok: z.literal(true),
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
