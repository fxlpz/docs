import { type NodeDetail, nodeDetailSchema, nodeSummarySchema } from '@krndocs/shared';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageEditor } from '../components/PageEditor.js';
import { useTreeRefresh } from '../components/TreePanel.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

/**
 * Detalhe da página: título editável + editor com autosave.
 * Pastas não têm conteúdo: mostram orientação em vez do editor.
 */
export function PagePanel(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const { refresh } = useTreeRefresh();

  const load = useCallback(async () => {
    if (!id) return;
    setDetail(null);
    setError(null);
    try {
      const json = await apiFetch(`/api/nodes/${id}`);
      setDetail(parseWith(nodeDetailSchema, json));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar a página.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4">
      <input
        key={detail.id}
        defaultValue={detail.title}
        placeholder="Sem título"
        aria-label="Título da página"
        onBlur={(event) => rename(event.target.value.trim())}
        className="w-full bg-transparent text-2xl font-semibold outline-none"
        style={{ color: 'var(--kd-text)' }}
      />
      <PageEditor
        key={`${detail.id}:${editorKey}`}
        nodeId={detail.id}
        initialContent={detail.content}
        initialVersion={detail.version}
        onReload={() => {
          setEditorKey((current) => current + 1);
          void load();
        }}
      />
    </article>
  );
}
