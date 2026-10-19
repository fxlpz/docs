import * as mammoth from 'mammoth';
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { ApiError, apiFetchBlob } from '../lib/api.js';
import { viewerKindFor } from '../lib/attachments.js';
import { parsePptx } from '../lib/pptx.js';

export interface ViewerAttachment {
  id: string;
  originalName: string;
  mime: string;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'blob'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string }
  | { kind: 'pptx'; slides: Array<{ texts: string[]; images: string[]; skipped: string[] }> };

/**
 * Visualizador de anexos dentro da plataforma (modal).
 *
 * - Imagem/vídeo/áudio/PDF: render nativo do navegador via Blob.
 * - Texto: <pre> com escape do React (sem HTML).
 * - DOCX/XLSX: conversão local (mammoth/SheetJS) exibida em iframe
 *   TOTALMENTE isolado (`sandbox` vazio + `srcDoc`) — nenhum script do
 *   documento executa.
 * - PPTX: leitura simplificada local (texto + imagens por slide, sem layout).
 * - ZIP/outros: sem renderizador leve em JS — oferece o download
 *   (fidelidade total exigiria OnlyOffice/Collabora, fora do escopo).
 */
export function AttachmentViewer({
  attachment,
  baseUrl,
  onClose,
}: {
  attachment: ViewerAttachment;
  /** Prefixo da rota: '/api/attachments' (área logada) ou '/api/public/attachments' (landing). */
  baseUrl: string;
  onClose: () => void;
}): React.JSX.Element {
  const kind = viewerKindFor(attachment.mime);
  const [state, setState] = useState<ViewState>({ kind: 'loading' });

  useEffect(() => {
    if (kind === 'download') return;
    let cancelled = false;
    const objectUrls: string[] = [];
    void (async () => {
      try {
        const blob = await apiFetchBlob(`${baseUrl}/${attachment.id}/download`);
        if (cancelled) return;
        if (kind === 'text') {
          setState({ kind: 'text', text: await blob.text() });
          return;
        }
        if (kind === 'docx') {
          const { value } = await mammoth.convertToHtml({
            arrayBuffer: await blob.arrayBuffer(),
          });
          if (!cancelled) setState({ kind: 'html', html: value });
          return;
        }
        if (kind === 'xlsx') {
          const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
          const first = workbook.SheetNames[0];
          const html = first
            ? XLSX.utils.sheet_to_html(workbook.Sheets[first] as object, { editable: false })
            : '<p>Planilha vazia.</p>';
          if (!cancelled) setState({ kind: 'html', html });
          return;
        }
        if (kind === 'pptx') {
          const slides = await parsePptx(await blob.arrayBuffer());
          if (cancelled) return;
          const withUrls = slides.map((slide) => ({
            texts: slide.texts,
            images: slide.images.map((image) => {
              const url = URL.createObjectURL(image);
              objectUrls.push(url);
              return url;
            }),
            skipped: slide.skippedImages,
          }));
          if (!cancelled) setState({ kind: 'pptx', slides: withUrls });
          return;
        }
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        if (!cancelled) setState({ kind: 'blob', url });
      } catch (error) {
        if (!cancelled) {
          // ApiError traz a mensagem do servidor; Error local (ex.: parser de
          // PPTX) já é texto seguro para exibição — mostra o motivo real.
          const message =
            error instanceof ApiError || error instanceof Error
              ? error.message
              : 'Falha ao carregar.';
          setState({ kind: 'error', message });
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [attachment.id, baseUrl, kind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = (): void => {
    void (async () => {
      try {
        const blob = await apiFetchBlob(`${baseUrl}/${attachment.id}/download`);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = attachment.originalName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        setState({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Falha no download.',
        });
      }
    })();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop de modal; fechar por clique fora + Escape, diálogo é role="dialog".
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.55)' }}
      onClick={onClose}
      role="presentation"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: só bloqueia propagação do clique; fechar pelo teclado é via Escape global. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Visualizar ${attachment.originalName}`}
        className="kd-card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden !p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--kd-border)' }}
        >
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.originalName}</p>
          <button type="button" className="kd-btn kd-btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {state.kind === 'loading' && kind !== 'download' && (
            <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
              Carregando visualização…
            </p>
          )}
          {state.kind === 'error' && (
            <div role="alert" className="kd-alert-error">
              {state.message}
            </div>
          )}
          {state.kind === 'blob' && kind === 'image' && (
            <img
              src={state.url}
              alt={attachment.originalName}
              className="mx-auto max-h-[70vh] rounded-md object-contain"
            />
          )}
          {state.kind === 'blob' && kind === 'video' && (
            // biome-ignore lint/a11y/useMediaCaption: mídia do usuário sem legendas; controles nativos.
            <video src={state.url} controls className="mx-auto max-h-[70vh] w-full rounded-md">
              Seu navegador não reproduz este vídeo.
            </video>
          )}
          {state.kind === 'blob' && kind === 'audio' && (
            // biome-ignore lint/a11y/useMediaCaption: mídia do usuário sem legendas; controles nativos.
            <audio src={state.url} controls className="w-full">
              Seu navegador não reproduz este áudio.
            </audio>
          )}
          {state.kind === 'blob' && kind === 'pdf' && (
            // Sem `sandbox`: o visualizador nativo (Edge/Chrome) não carrega PDF
            // em iframe isolado. Seguro porque o arquivo é validado por magic
            // bytes no servidor e o viewer do navegador não expõe nosso DOM.
            <iframe
              src={state.url}
              title={attachment.originalName}
              className="h-[70vh] w-full rounded-md border"
              style={{ borderColor: 'var(--kd-border)', background: '#fff' }}
            />
          )}
          {state.kind === 'text' && (
            <pre
              className="max-h-[70vh] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap"
              style={{ background: 'var(--kd-surface-2)', color: 'var(--kd-text)' }}
            >
              {state.text}
            </pre>
          )}
          {state.kind === 'html' && (
            <iframe
              srcDoc={wrapDocument(state.html, attachment.originalName)}
              title={attachment.originalName}
              sandbox=""
              className="h-[70vh] w-full rounded-md border"
              style={{ borderColor: 'var(--kd-border)', background: '#fff' }}
            />
          )}
          {state.kind === 'pptx' && (
            <div className="space-y-4">
              <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
                Visualização simplificada: texto e imagens por slide, sem o layout original. Para
                fidelidade total, baixe o arquivo.
              </p>
              {state.slides.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
                  Nenhum conteúdo legível nos slides.
                </p>
              )}
              {state.slides.map((slide, index) => (
                <section
                  // biome-ignore lint/suspicious/noArrayIndexKey: slides gerados sem id, ordem estável do arquivo.
                  key={`slide-${index}`}
                  aria-label={`Slide ${index + 1}`}
                  className="rounded-md border p-3"
                  style={{ borderColor: 'var(--kd-border)', background: '#fff' }}
                >
                  <p className="mb-2 text-xs font-medium" style={{ color: '#5d6875' }}>
                    Slide {index + 1}
                  </p>
                  {slide.images.map((src, imageIndex) => (
                    <img
                      // biome-ignore lint/suspicious/noArrayIndexKey: blobs sem id, ordem estável.
                      key={`slide-${index}-img-${imageIndex}`}
                      src={src}
                      alt=""
                      className="mb-2 max-h-64 rounded object-contain"
                      onError={(event) => {
                        // Formato que passou no filtro mas não renderizou:
                        // esconde o ícone quebrado em vez de poluir a leitura.
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ))}
                  {slide.skipped.length > 0 && (
                    <p className="mb-1 text-xs" style={{ color: '#5d6875' }}>
                      {slide.skipped.length === 1
                        ? `1 imagem não exibida (formato ${slide.skipped[0]} só abre no PowerPoint).`
                        : `${slide.skipped.length} imagens não exibidas (formatos só do PowerPoint: ${[...new Set(slide.skipped)].join(', ')}).`}
                    </p>
                  )}
                  {slide.texts.length === 0 && slide.images.length === 0 ? (
                    <p className="text-xs" style={{ color: '#5d6875' }}>
                      (slide vazio)
                    </p>
                  ) : (
                    slide.texts.map((text, textIndex) => (
                      <p
                        // biome-ignore lint/suspicious/noArrayIndexKey: ordem estável do documento.
                        key={`slide-${index}-text-${textIndex}`}
                        className="mb-1 text-sm"
                        style={{ color: '#111' }}
                      >
                        {text}
                      </p>
                    ))
                  )}
                </section>
              ))}
            </div>
          )}
          {kind === 'download' && (
            <div className="py-8 text-center">
              <p className="mb-1 text-sm font-medium">
                Sem visualização embutida para este formato
              </p>
              <p className="mb-4 text-sm" style={{ color: 'var(--kd-muted)' }}>
                ZIP e outros arquivos abrem com download.
              </p>
              <button type="button" className="kd-btn kd-btn-primary" onClick={download}>
                Baixar arquivo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** HTML gerado (mammoth/SheetJS) embrulhado em página neutra para o srcDoc. */
function wrapDocument(innerHtml: string, title: string): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safeTitle}</title><style>body{font-family:system-ui,sans-serif;max-width:70ch;margin:2rem auto;padding:0 1rem;color:#111}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.25rem .5rem}img{max-width:100%}</style></head><body>${innerHtml}</body></html>`;
}
