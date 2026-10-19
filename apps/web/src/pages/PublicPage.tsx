import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { publicAttachmentListResponseSchema, publicPageSchema } from '@krndocs/shared';
import { ArrowLeft, Download, Eye, FileText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AttachmentViewer } from '../components/AttachmentViewer.js';
import { BrandMark } from '../components/Brand.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { ApiError, apiFetch, apiFetchBlob, parseWith } from '../lib/api.js';

interface PublicAttachment {
  id: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
}

/**
 * Leitor público de página (`/pub/:id`) — SOMENTE leitura.
 * Sem editor editável, sem botões de edição/exclusão, sem metadados internos.
 */
export function PublicPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState<string | null>(null);
  const [content, setContent] = useState<unknown[] | null>(null);
  const [attachments, setAttachments] = useState<PublicAttachment[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setTitle(null);
    setContent(null);
    setError(null);
    try {
      const json = await apiFetch(`/api/public/pages/${id}`);
      const page = parseWith(publicPageSchema, json);
      setTitle(page.title);
      setContent(page.content);
      const attachJson = await apiFetch(`/api/public/pages/${id}/attachments`);
      setAttachments(parseWith(publicAttachmentListResponseSchema, attachJson).attachments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar a página.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = (attachment: PublicAttachment): void => {
    void (async () => {
      try {
        const blob = await apiFetchBlob(`/api/public/attachments/${attachment.id}/download`);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = attachment.originalName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha no download.');
      }
    })();
  };

  const viewing = attachments.find((attachment) => attachment.id === viewingId) ?? null;

  return (
    <div className="relative flex min-h-full flex-col">
      <div aria-hidden="true" className="kd-landing-bg" />

      <header
        className="kd-landing-header sticky top-0 z-20 border-b"
        style={{ borderColor: 'var(--kd-border)' }}
      >
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-1 text-sm transition-opacity hover:opacity-80"
              style={{ color: 'var(--kd-muted)' }}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Início
            </Link>
            <BrandMark size={16} />
            <span className="truncate text-sm font-semibold">KernelDocs</span>
            <span className="kd-badge hidden sm:inline-flex">Somente leitura</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link to="/login" className="kd-btn kd-btn-primary">
              Entrar
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        {error && (
          <div className="kd-card p-8 text-center">
            <p role="alert" className="mb-4 text-sm" style={{ color: 'var(--kd-danger)' }}>
              {error}
            </p>
            <Link to="/" className="kd-btn kd-btn-ghost mx-auto">
              <ArrowLeft size={14} aria-hidden="true" />
              Voltar à página inicial
            </Link>
          </div>
        )}

        {!error && title === null && (
          <p role="status" className="text-center text-sm" style={{ color: 'var(--kd-muted)' }}>
            Carregando…
          </p>
        )}

        {!error && title !== null && (
          <article>
            <p
              className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase"
              style={{ color: 'var(--kd-accent)' }}
            >
              <FileText size={13} aria-hidden="true" />
              Documento público
            </p>
            <h1 className="mb-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              {title || 'Sem título'}
            </h1>

            {content && content.length > 0 ? (
              <div className="kd-card p-4 sm:p-6">
                <ReadonlyBlocks content={content} />
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
                Página sem conteúdo.
              </p>
            )}

            {attachments.length > 0 && (
              <section className="kd-card mt-4 p-4">
                <h2 className="kd-section-title mb-2">Anexos</h2>
                <ul className="space-y-1">
                  {attachments.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="flex items-center gap-2 rounded-md p-1.5 text-sm transition-colors hover:bg-[var(--kd-surface-2)]"
                    >
                      <span className="kd-icon-tile !h-8 !w-8">
                        <FileText size={15} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{attachment.originalName}</span>
                      <button
                        type="button"
                        className="kd-btn kd-btn-ghost shrink-0 !px-2 !py-0.5 !text-xs"
                        onClick={() => setViewingId(attachment.id)}
                      >
                        <Eye size={12} aria-hidden="true" />
                        Visualizar
                      </button>
                      <button
                        type="button"
                        className="kd-btn kd-btn-ghost shrink-0 !px-2 !py-0.5 !text-xs"
                        onClick={() => download(attachment)}
                      >
                        <Download size={12} aria-hidden="true" />
                        Baixar
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        )}
      </main>

      {viewing && (
        <AttachmentViewer
          attachment={viewing}
          baseUrl="/api/public/attachments"
          onClose={() => setViewingId(null)}
        />
      )}
    </div>
  );
}

/** Renderiza blocos BlockNote sem edição (leitor público). */
function ReadonlyBlocks({ content }: { content: unknown[] }): React.JSX.Element {
  const editor: BlockNoteEditor = useCreateBlockNote({
    initialContent: content as PartialBlock[],
  });
  const dark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return <BlockNoteView editor={editor} editable={false} theme={dark ? 'dark' : 'light'} />;
}
