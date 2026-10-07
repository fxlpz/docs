/**
 * Contratos compartilhados entre API e Web (fonte única de verdade).
 *
 * Regras:
 * - Todo contrato de entrada/saída exposto por HTTP deve ter um schema Zod aqui.
 * - Os tipos são derivados dos schemas (`z.infer`), nunca escritos à mão.
 * - Mudanças neste pacote alteram API e Web juntas: execute `npm run typecheck`.
 */

export {
  type AuthUserResponse,
  authUserResponseSchema,
  type ChangePasswordRequest,
  type ChangePasswordResponse,
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  type LoginRequest,
  type LogoutResponse,
  loginRequestSchema,
  logoutResponseSchema,
  PASSWORD_MIN_LENGTH,
  type SessionUser,
  sessionUserSchema,
  type UserRole,
  userRoleSchema,
} from './auth.js';
export { type ApiError, apiErrorSchema, ERROR_CODES, type ErrorCode } from './errors.js';
export { type HealthResponse, healthResponseSchema } from './health.js';
export {
  type CreateNodeRequest,
  createNodeRequestSchema,
  type NodeDetail,
  type NodeSummary,
  type NodeType,
  nodeDetailSchema,
  nodeSummarySchema,
  nodeTypeSchema,
  type PageContent,
  pageContentSchema,
  type SaveContentRequest,
  type SaveContentResponse,
  saveContentRequestSchema,
  saveContentResponseSchema,
  type TreeResponse,
  treeResponseSchema,
  type UpdateNodeRequest,
  updateNodeRequestSchema,
} from './nodes.js';
