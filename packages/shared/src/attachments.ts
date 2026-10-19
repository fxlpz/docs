import { z } from 'zod';

/**
 * Contratos de anexos (Etapa 3).
 *
 * - Upload é multipart (campo `file`); este contrato cobre as respostas e
 *   listagens. O nome original é só exibição — nunca vira caminho no disco.
 * - Download autorizado: `GET /api/attachments/:id/download` exige sessão e
 *   responde `Content-Disposition: attachment` (nunca inline).
 */

export const attachmentSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  originalName: z.string().min(1).max(255),
  /** MIME final aceito (detectado por magic bytes no servidor). */
  mime: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
  /** SHA-256 hexadecimal do conteúdo. */
  sha256: z.string().length(64),
  uploadedAt: z.string().datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** GET /api/nodes/:id/attachments */
export const attachmentListResponseSchema = z.object({
  attachments: z.array(attachmentSchema),
});
export type AttachmentListResponse = z.infer<typeof attachmentListResponseSchema>;

/** POST /api/nodes/:id/attachments (201) */
export const attachmentUploadResponseSchema = attachmentSchema;
export type AttachmentUploadResponse = z.infer<typeof attachmentUploadResponseSchema>;

/**
 * GET .../download?inline=1 — exibe no navegador em vez de baixar.
 * Só vale para imagem/vídeo/áudio (o servidor ignora para o resto).
 */
export const downloadQuerySchema = z.object({
  inline: z.enum(['1']).optional(),
});
export type DownloadQuery = z.infer<typeof downloadQuerySchema>;
