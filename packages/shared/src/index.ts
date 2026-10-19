/**
 * Contratos compartilhados entre API e Web (fonte única de verdade).
 *
 * Regras:
 * - Todo contrato de entrada/saída exposto por HTTP deve ter um schema Zod aqui.
 * - Os tipos são derivados dos schemas (`z.infer`), nunca escritos à mão.
 * - Mudanças neste pacote alteram API e Web juntas: execute `npm run typecheck`.
 */

export {
  type Attachment,
  type AttachmentListResponse,
  type AttachmentUploadResponse,
  attachmentListResponseSchema,
  attachmentSchema,
  attachmentUploadResponseSchema,
  type DownloadQuery,
  downloadQuerySchema,
} from './attachments.js';
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
export {
  type AddFavoriteRequest,
  addFavoriteRequestSchema,
  type FavoriteItem,
  type FavoriteListResponse,
  favoriteItemSchema,
  favoriteListResponseSchema,
} from './favorites.js';
export { type HealthResponse, healthResponseSchema } from './health.js';
export {
  type RestoreVersionRequest,
  restoreVersionRequestSchema,
  type VersionDetail,
  type VersionItem,
  type VersionListResponse,
  type VersionSource,
  versionDetailSchema,
  versionItemSchema,
  versionListResponseSchema,
  versionSourceSchema,
} from './history.js';
export {
  type CreateNodeRequest,
  createNodeRequestSchema,
  type MoveNodeRequest,
  moveNodeRequestSchema,
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
export {
  type SearchQuery,
  type SearchResponse,
  type SearchResultItem,
  searchQuerySchema,
  searchResponseSchema,
  searchResultItemSchema,
} from './search.js';
export {
  type CreateFromTemplateRequest,
  createFromTemplateRequestSchema,
  type MarkTemplateRequest,
  markTemplateRequestSchema,
  type TemplateItem,
  type TemplateListResponse,
  templateItemSchema,
  templateListResponseSchema,
} from './templates.js';
export {
  type PermanentDeleteQuery,
  permanentDeleteQuerySchema,
  type TrashItem,
  type TrashResponse,
  trashItemSchema,
  trashResponseSchema,
} from './trash.js';
export {
  type CreateUserRequest,
  createUserRequestSchema,
  type ManagedUser,
  managedUserSchema,
  type ResetPasswordRequest,
  resetPasswordRequestSchema,
  type UpdateProfileRequest,
  type UpdateUserRequest,
  type UserListResponse,
  updateProfileRequestSchema,
  updateUserRequestSchema,
  userListResponseSchema,
} from './users.js';
export {
  type PublicAttachment,
  type PublicAttachmentListResponse,
  type PublicNode,
  type PublicPage,
  type PublicTreeResponse,
  publicAttachmentListResponseSchema,
  publicAttachmentSchema,
  publicNodeSchema,
  publicPageSchema,
  publicTreeResponseSchema,
  type SetVisibilityRequest,
  setVisibilityRequestSchema,
  type Visibility,
  visibilitySchema,
} from './visibility.js';
