import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, userRoleSchema } from './auth.js';

/**
 * Contratos de perfil e administração de usuários.
 *
 * - Sem cadastro público: criar usuário é ação de admin (`POST /api/users`).
 * - Senha de conta nova nasce PROVISÓRIA (troca obrigatória no 1º login).
 * - O próprio usuário edita só o nome de exibição (`PATCH /api/users/me`);
 *   papel/ativo só via admin, que nunca pode rebaixar ou desativar a si mesmo.
 */

/** Usuário gerenciado (visão admin ou do próprio dono — sem hash). */
export const managedUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(3).max(64),
  displayName: z.string().min(1).max(120),
  role: userRoleSchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  hasAvatar: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;

/** GET /api/users (admin) */
export const userListResponseSchema = z.object({
  users: z.array(managedUserSchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

/** POST /api/users (admin) */
export const createUserRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .transform((value) => value.toLowerCase())
    .refine((value) => /^[a-z0-9._-]+$/.test(value), {
      message: 'Usuário aceita letras minúsculas, números, ponto, hífen e sublinhado.',
    }),
  displayName: z.string().trim().min(1).max(120),
  role: userRoleSchema.default('member'),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(1024),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** PATCH /api/users/:id (admin) */
export const updateUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined || value.role !== undefined || value.isActive !== undefined,
    { message: 'Informe ao menos um campo para atualizar.' },
  );
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

/** POST /api/users/:id/reset-password (admin) — redefine com provisória. */
export const resetPasswordRequestSchema = z.object({
  password: z.string().min(PASSWORD_MIN_LENGTH).max(1024),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** PATCH /api/users/me (o próprio usuário: só o nome de exibição). */
export const updateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
