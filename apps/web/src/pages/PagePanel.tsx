import {
  type Attachment,
  attachmentListResponseSchema,
  attachmentSchema,
  type NodeDetail,
  nodeDetailSchema,
  nodeSummarySchema,
  type VersionItem,
  versionListResponseSchema,
} from '@krndocs/shared';
import { Download, Eye, History, Paperclip, Star, StarOff, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AttachmentViewer } from '../components/AttachmentViewer.js';
import { PageEditor } from '../components/PageEditor.js';
import { useTreeRefresh } from '../components/TreePanel.js';
import { ApiError, apiFetch, apiFetchBlob, parseWith } from '../lib/api.js';
import { embedUrlForAttachment } from '../lib/attachments.js';

/**
 * Detalhe da página: título editável + editor com autosave + favorito,
 * anexos, histórico de versões e "salvar como modelo".
 * Pastas não têm conteúdo: mostram orientação em vez do editor.
 */
export function PagePanel(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [versions, setVersions] = useState<VersionItem[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const detailRequest = useRef(0);
  const extrasRequest = useRef(0);
  const { refresh } = useTreeRefresh();

  const load = useCallback(async () => {
    if (!id) return;
    const request = ++detailRequest.current;
    setDetail(null);
    setError(null);
    setVersions(null);
    setShowHistory(false);
    setNotice(null);
    try {
      const json = await apiFetch(`/api/nodes/${id}`);
      const parsed = parseWith(nodeDetailSchema, json);
      if (request === detailRequest.current) setDetail(parsed);
    } catch (err) {
      if (request === detailRequest.current) {
        setError(err instanceof ApiError ? err.message : 'Não foi possível carregar a página.');
      }
    }
  }, [id]);

  const loadExtras = useCallback(async () => {
    if (!id) return;
    const request = ++extrasRequest.current;
    try {
      const [favJson, attachJson] = await Promise.all([
        apiFetch('/api/favorites'),
        apiFetch(`/api/nodes/${id}/attachments`),
      ]);
      const favorites = (favJson as { favorites: Array<{ nodeId: string }> }).favorites;
      if (request !== extrasRequest.current) return;
      setIsFavorite(favorites.some((favorite) => favorite.nodeId === id));
      setAttachments(parseWith(attachmentListResponseSchema, attachJson).attachments);
      setAttachError(null);
    } catch (err) {
      if (request === extrasRequest.current) {
        setAttachError(err instanceof ApiError ? err.message : 'Falha ao carregar extras.');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => {
      detailRequest.current += 1;
      extrasRequest.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (detail) void loadExtras();
  }, [detail, loadExtras]);

  const rename = (title: string): void => {
    if (!detail || title === detail.title) return;
    void (async () => {
      try {
        const json = await apiFetch(`/api/nodes/${detail.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title }),
        });
        const updated = parseWith(nodeSummarySchema, json);
        setDetail({ ...detail, ...updated });
        refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao renomear.');
      }
    })();
  };

  const toggleFavorite = (): void => {
    if (!detail) return;
    void (async () => {
      try {
        if (isFavorite) {
          await apiFetch(`/api/favorites/${detail.id}`, { method: 'DELETE' });
          setIsFavorite(false);
        } else {
          await apiFetch('/api/favorites', {
            method: 'POST',
            body: JSON.stringify({ nodeId: detail.id }),
          });
          setIsFavorite(true);
        }
        refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao favoritar.');
      }
    })();
  };

  const upload = (file: File): void => {
    if (!detail) return;
    setUploading(true);
    setAttachError(null);
    void (async () => {
      try {
        await uploadFile(file);
        await loadExtras();
      } catch (err) {
        setAttachError(err instanceof ApiError ? err.message : 'Falha no upload.');
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    })();
  };

  /**
   * Sobe um arquivo e devolve a URL para o editor embutir: inline para
   * imagem/vídeo/áudio, download direto para o resto (PDF, DOCX...).
   */
  const uploadFile = async (file: File): Promise<string> => {
    if (!detail) throw new ApiError(0, 'NO_NODE', 'Página não carregada.');
    const form = new FormData();
    form.append('file', file, file.name);
    const json = await apiFetch(`/api/nodes/${detail.id}/attachments`, {
      method: 'POST',
      body: form,
    });
    const meta = parseWith(attachmentSchema, json);
    return embedUrlForAttachment(meta.id, meta.mime);
  };

  const removeAttachment = (attachmentId: string): void => {
    if (!window.confirm('Excluir este anexo?')) return;
    void (async () => {
      try {
        await apiFetch(`/api/attachments/${attachmentId}`, { method: 'DELETE' });
        await loadExtras();
      } catch (err) {
        setAttachError(err instanceof ApiError ? err.message : 'Falha ao excluir anexo.');
      }
    })();
  };

  const download = (attachment: Attachment): void => {
    void (async () => {
      try {
        const blob = await apiFetchBlob(`/api/attachments/${attachment.id}/download`);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = attachment.originalName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setAttachError(err instanceof ApiError ? err.message : 'Falha no download.');
      }
    })();
  };

  const loadHistory = (): void => {
    if (!detail) return;
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (versions !== null) return;
    const requestedId = detail.id;
    void (async () => {
      try {
        const json = await apiFetch(`/api/nodes/${requestedId}/versions`);
        const parsed = parseWith(versionListResponseSchema, json);
        if (requestedId === id) setVersions(parsed.versions);
      } catch (err) {
        if (requestedId === id) {
          setError(err instanceof ApiError ? err.message : 'Falha ao carregar histórico.');
        }
      }
    })();
  };

  const restoreVersion = (version: number): void => {
    if (!detail) return;
    if (
      !window.confirm(
        `Restaurar a versão ${version}? O conteúdo atual será preservado como nova versão.`,
      )
    ) {
      return;
    }
    void (async () => {
      try {
        await apiFetch(`/api/nodes/${detail.id}/versions/restore`, {
          method: 'POST',
          body: JSON.stringify({ version }),
        });
        setVersions(null);
        refresh();
        await load();
        await loadExtras();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao restaurar versão.');
      }
    })();
  };

  const saveAsTemplate = (): void => {
    if (!detail || !templateName.trim()) return;
    void (async () => {
      try {
        await apiFetch(`/api/nodes/${detail.id}/make-template`, {
          method: 'POST',
          body: JSON.stringify({ name: templateName.trim() }),
        });
        setTemplateName('');
        setShowTemplateForm(false);
        setNotice('Página salva como modelo.');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao salvar modelo.');
      }
    })();
  };

  if (error) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p style={{ color: '#c0392b' }}>{error}</p>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5"
          style={{ borderColor: 'var(--kd-border)' }}
          onClick={() => void load()}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
        Carregando…
      </p>
    );
  }

  if (detail.type === 'folder') {
    return (
      <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
        Esta é uma pasta — use a barra lateral para abrir ou criar itens dentro dela.
      </p>
    );
  }

  const sourceLabel: Record<string, string> = {
    autosave: 'automático',
    manual: 'manual',
    restore: 'restauração',
    conflict_resolution: 'resolução de conflito',
  };

  const viewing = attachments.find((attachment) => attachment.id === viewingId) ?? null;

  return (
    <article
      className="relative mx-auto flex max-w-5xl flex-col gap-4"
      onDragEnter={(event) => {
        if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(dragDepth.current - 1, 0);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length === 0 || !detail) return;
        setUploading(true);
        setAttachError(null);
        void (async () => {
          try {
            for (const file of files) {
              await uploadFile(file);
            }
            await loadExtras();
          } catch (err) {
            setAttachError(err instanceof ApiError ? err.message : 'Falha no upload.');
          } finally {
            setUploading(false);
          }
        })();
      }}
    >
      {dragging && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed"
          style={{ borderColor: 'var(--kd-accent)', background: 'var(--kd-accent-soft)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--kd-accent)' }}>
            Solte para anexar nesta página
          </p>
        </div>
      )}
      <div className="flex items-start gap-2">
        {detail.icon && (
          <span aria-hidden="true" className="mt-1 text-2xl leading-none">
            {detail.icon}
          </span>
        )}
        <input
          key={detail.id}
          defaultValue={detail.title}
          placeholder="Sem título"
          aria-label="Título da página"
          onBlur={(event) => rename(event.target.value.trim())}
          className="w-full flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:opacity-40"
          style={{ color: 'var(--kd-text)' }}
        />
        <button
          type="button"
          aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          aria-pressed={isFavorite}
          title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          className="kd-btn kd-btn-ghost shrink-0"
          onClick={toggleFavorite}
        >
          {isFavorite ? (
            <Star size={15} aria-hidden="true" style={{ color: 'var(--kd-accent)' }} />
          ) : (
            <StarOff size={15} aria-hidden="true" />
          )}
        </button>
      </div>

      {notice && (
        <p role="status" className="text-sm" style={{ color: 'var(--kd-accent)' }}>
          {notice}
        </p>
      )}

      <PageEditor
        key={`${detail.id}:${editorKey}`}
        nodeId={detail.id}
        initialContent={detail.content}
        initialVersion={detail.version}
        onReload={() => {
          setEditorKey((current) => current + 1);
          void load();
        }}
        uploadFile={uploadFile}
        onUploadComplete={() => void loadExtras()}
      />

      <section className="kd-card p-3">
        <h2 className="kd-section-title mb-2 flex items-center gap-2">
          <Paperclip size={14} aria-hidden="true" />
          Anexos
        </h2>
        {attachError && (
          <p role="alert" className="mb-2 text-xs" style={{ color: '#c0392b' }}>
            {attachError}
          </p>
        )}
        {attachments.length === 0 ? (
          <p className="mb-2 text-xs" style={{ color: 'var(--kd-muted)' }}>
            Nenhum anexo. Até 25 MiB por arquivo: imagens, vídeos, áudios, PDF, Word, Excel,
            PowerPoint, ZIP e texto. Arraste arquivos para esta página para anexar.
          </p>
        ) : (
          <ul className="mb-2 space-y-1">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={attachment.originalName}>
                  {attachment.originalName}
                </span>
                <span className="shrink-0 text-xs" style={{ color: 'var(--kd-muted)' }}>
                  {(attachment.sizeBytes / 1024).toFixed(1)} KiB
                </span>
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
                <button
                  type="button"
                  aria-label={`Excluir anexo ${attachment.originalName}`}
                  className="kd-btn kd-btn-danger-ghost shrink-0 !px-2 !py-0.5 !text-xs"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileRef}
          type="file"
          aria-label="Enviar anexo"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
          }}
          className="text-xs"
        />
        {uploading && (
          <p className="mt-1 text-xs" style={{ color: 'var(--kd-muted)' }}>
            Enviando…
          </p>
        )}
      </section>

      <section className="kd-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="kd-section-title flex flex-1 items-center gap-2">
            <History size={14} aria-hidden="true" />
            Histórico
          </h2>
          <button
            type="button"
            className="kd-btn kd-btn-ghost"
            onClick={loadHistory}
            aria-expanded={showHistory}
          >
            {showHistory ? 'Ocultar histórico' : 'Ver histórico'}
          </button>
        </div>
        {showHistory &&
          (versions === null ? (
            <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
              Carregando versões…
            </p>
          ) : versions.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
              Nenhuma versão salva ainda.
            </p>
          ) : (
            <ul className="space-y-1">
              {versions.map((version) => (
                <li key={version.version} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">v{version.version}</span>
                  <span className="text-xs" style={{ color: 'var(--kd-muted)' }}>
                    {sourceLabel[version.source] ?? version.source} ·{' '}
                    {new Date(version.createdAt).toLocaleString('pt-BR')}
                    {version.createdByName ? ` · ${version.createdByName}` : ''}
                  </span>
                  <button
                    type="button"
                    className="kd-btn kd-btn-ghost ml-auto shrink-0 !px-2 !py-0.5 !text-xs"
                    onClick={() => restoreVersion(version.version)}
                  >
                    Restaurar esta
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section className="kd-card p-3">
        <div className="flex items-center gap-2">
          <h2 className="flex flex-1 items-center gap-2 text-sm font-medium">Modelo</h2>
          <button
            type="button"
            className="kd-btn kd-btn-ghost"
            onClick={() => setShowTemplateForm((current) => !current)}
            aria-expanded={showTemplateForm}
          >
            Salvar como modelo
          </button>
        </div>
        {showTemplateForm && (
          <div className="mt-2 flex gap-2">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Nome do modelo"
              aria-label="Nome do modelo"
              className="kd-input min-w-0 flex-1 !py-1"
            />
            <button
              type="button"
              className="kd-btn kd-btn-primary shrink-0"
              onClick={saveAsTemplate}
              disabled={!templateName.trim()}
            >
              Salvar modelo
            </button>
          </div>
        )}
      </section>

      {viewing && (
        <AttachmentViewer
          attachment={viewing}
          baseUrl="/api/attachments"
          onClose={() => setViewingId(null)}
        />
      )}
    </article>
  );
}
