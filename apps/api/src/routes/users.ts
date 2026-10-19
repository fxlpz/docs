import fs from 'node:fs';
import {
  createUserRequestSchema,
  managedUserSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
  updateUserRequestSchema,
  userListResponseSchema,
} from '@krndocs/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parseOutput } from '../lib/validate.js';
import { requireAdmin, requireAuth } from '../plugins/auth.js';
import { deleteAvatar, getAvatarTarget, saveAvatar } from '../services/avatars.js';
import {
  adminResetPassword,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateProfile,
  updateUser,
} from '../services/users.js';

/**
 * Perfil e administração de usuários.
 *
 * - `PATCH /api/users/me` (sessão): o próprio usuário troca o nome.
 * - Demais rotas: SÓ admin (`requireAdmin`). Admin nunca rebaixa nem
 *   desativa a si mesmo (trava no serviço).
 */

const idParamSchema = z.object({ id: z.string().min(1) });

function actorOf(request: FastifyRequest): { id: string } {
  const user = request.user;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return { id: user.id };
}

export async function registerUserRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/users', { preHandler: requireAdmin }, async (request, reply) => {
    const users = listUsers(ctx.db);
    reply.header('cache-control', 'no-store');
    return parseOutput(userListResponseSchema, { users }, request);
  });

  app.post('/api/users', { preHandler: requireAdmin }, async (request, reply) => {
    const body = createUserRequestSchema.parse(request.body);
    const user = await createUser(ctx.db, actorOf(request).id, body);
    reply.status(201);
    return parseOutput(managedUserSchema, user, request);
  });

  app.patch('/api/users/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateUserRequestSchema.parse(request.body);
    const user = updateUser(ctx.db, actorOf(request).id, id, body);
    return parseOutput(managedUserSchema, user, request);
  });

  app.patch('/api/users/me', { preHandler: requireAuth }, async (request) => {
    const body = updateProfileRequestSchema.parse(request.body);
    const user = updateProfile(ctx.db, actorOf(request).id, body.displayName);
    return parseOutput(managedUserSchema, user, request);
  });

  app.delete('/api/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    deleteUser(ctx.db, actorOf(request).id, id);
    return reply.status(204).send();
  });

  app.post('/api/users/:id/reset-password', { preHandler: requireAdmin }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = resetPasswordRequestSchema.parse(request.body);
    const user = await adminResetPassword(ctx.db, actorOf(request).id, id, body.password);
    return parseOutput(managedUserSchema, user, request);
  });

  app.post('/api/users/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    const part = await request.file();
    if (!part) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Envie a foto no campo `avatar`.');
    }
    const buffer = await part.toBuffer();
    await saveAvatar(ctx.db, ctx.paths.avatarsDir, actorOf(request).id, part.mimetype, buffer);
    const user = getUser(ctx.db, actorOf(request).id);
    reply.header('cache-control', 'no-store');
    return parseOutput(managedUserSchema, user, request);
  });

  app.get('/api/users/:id/avatar', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const target = await getAvatarTarget(ctx.db, ctx.paths.avatarsDir, id);
    reply.header('content-type', target.mime);
    reply.header('content-length', target.sizeBytes);
    reply.header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(target.filePath));
  });

  app.delete('/api/users/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    deleteAvatar(ctx.db, ctx.paths.avatarsDir, actorOf(request).id);
    return reply.status(204).send();
  });
}
