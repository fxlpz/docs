/**
 * URL que o editor usa para embutir um anexo recém-enviado.
 *
 * - Imagem/vídeo/áudio: `?inline=1` (o servidor só honra para esses MIMEs,
 *   com `nosniff` — ver `isInlineableMime` na API).
 * - Todo o resto (PDF, DOCX, ZIP...): download direto.
 */
export function embedUrlForAttachment(id: string, mime: string): string {
  const inlineable =
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/ogg';
  return inlineable
    ? `/api/attachments/${id}/download?inline=1`
    : `/api/attachments/${id}/download`;
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Como o visualizador abre cada tipo (o resto cai em download). */
export type ViewerKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'download';
export function viewerKindFor(mime: string): ViewerKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || mime === 'application/ogg') return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/')) return 'text';
  if (mime === DOCX_MIME) return 'docx';
  if (mime === XLSX_MIME) return 'xlsx';
  if (mime === PPTX_MIME) return 'pptx';
  return 'download';
}
