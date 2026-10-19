import { trashResponseSchema } from '@krndocs/shared';
import { FolderOpen, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.js';
import { useTreeRefresh } from '../components/TreePanel.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

interface TrashNode {
  id: string;
  type: 'folder' | 'page';
  title: string;
  deletedAt: string;
}

/**
 * Lixeira: itens com exclusão lógica, com restaurar e exclusão definitiva.
 * A exclusão definitiva exige confirmação em dois passos na UI + `?confirm=true`
 * na API (sem o flag, nada é apagado).
 */
export function TrashPage(): React.JSX.Element {
  const [nodes, setNodes] = useState<TrashNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { refresh } = useTreeRefresh();

  const load = useCallback(async () => {
    try {
      const json = await apiFetch('/api/trash');
      const parsed = parseWith(trashResponseSchema, json);
      setNodes(
        parsed.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          title: node.title,
          deletedAt: node.deletedAt,
        })),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar a lixeira.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = (id: string): void => {
    void (async () => {
      try {
        await apiFetch(`/api/nodes/${id}/restore`, { method: 'POST' });
        setError(null);
        refresh();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao restaurar.');
      }
    })();
  };

  const purge = (id: string): void => {
    void (async () => {
      try {
        await apiFetch(`/api/nodes/${id}/permanent?confirm=true`, { method: 'DELETE' });
        setConfirmId(null);
        setError(null);
        refresh();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao excluir.');
      }
    })();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        icon={<Trash2 size={18} aria-hidden="true" />}
        title="Lixeira"
        description="Itens excluídos. Restaurar reativa o item (e as pastas acima dele, se preciso). A exclusão definitiva apaga para sempre, incluindo anexos."
      />

      {error && (
        <div role="alert" className="kd-alert-error mb-4">
          {error}
        </div>
      )}

      {nodes === null && !error && (
        <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Carregando…
        </p>
      )}

      {nodes !== null && nodes.length === 0 && (
        <div className="kd-card p-8 text-center">
          <Trash2
            size={26}
            aria-hidden="true"
            className="mx-auto mb-2"
            style={{ color: 'var(--kd-muted)' }}
          />
          <p className="text-sm font-medium">Lixeira vazia.</p>
          <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
            Nada por aqui — bom sinal.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {(nodes ?? []).map((node) => (
          <li key={node.id} className="kd-card kd-card-interactive flex items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              {node.type === 'page' ? (
                <span className="block truncate text-sm font-medium">
                  {node.title || 'Sem título'}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <FolderOpen size={14} aria-hidden="true" style={{ color: 'var(--kd-muted)' }} />
                  {node.title || 'Sem pasta'}
                </span>
              )}
              <span className="block text-xs" style={{ color: 'var(--kd-muted)' }}>
                Excluído em {new Date(node.deletedAt).toLocaleString('pt-BR')}
              </span>
              {node.type === 'page' && (
                <Link
                  to={`/app/p/${node.id}`}
                  className="text-xs"
                  style={{ color: 'var(--kd-accent)' }}
                >
                  (abrir retorna 404 enquanto excluída)
                </Link>
              )}
            </div>

            {confirmId === node.id ? (
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="kd-btn kd-btn-danger-ghost"
                  onClick={() => purge(node.id)}
                >
                  Confirmar exclusão definitiva
                </button>
                <button
                  type="button"
                  className="kd-btn kd-btn-ghost"
                  onClick={() => setConfirmId(null)}
                >
                  Cancelar
                </button>
              </span>
            ) : (
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="kd-btn kd-btn-ghost"
                  onClick={() => restore(node.id)}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  Restaurar
                </button>
                <button
                  type="button"
                  className="kd-btn kd-btn-danger-ghost"
                  onClick={() => setConfirmId(node.id)}
                >
                  Excluir para sempre
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
