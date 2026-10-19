import {
  type FavoriteItem,
  favoriteListResponseSchema,
  type NodeSummary,
  nodeSummarySchema,
  type TreeResponse,
  treeResponseSchema,
} from '@krndocs/shared';
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderPlus,
  Globe,
  Lock,
  Pencil,
  Plus,
  Star,
  X,
} from 'lucide-react';
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

/**
 * Árvore lateral (pastas e páginas).
 *
 * - Recarrega quando qualquer parte da UI muta dados (`TreeRefreshProvider`).
 * - Exclusão SEMPRE com confirmação explícita (exclusão lógica; lixeira na Etapa 3).
 * - Renomear é edição inline (Enter confirma, Esc cancela) — sem prompts do SO.
 */

const TreeRefreshContext = createContext<{ version: number; refresh: () => void }>({
  version: 0,
  refresh: () => {},
});

export function TreeRefreshProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  const value = useMemo(() => ({ version, refresh }), [version, refresh]);
  return <TreeRefreshContext.Provider value={value}>{children}</TreeRefreshContext.Provider>;
}

export function useTreeRefresh(): { version: number; refresh: () => void } {
  return useContext(TreeRefreshContext);
}

function RenameField({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  // Foco programático ao entrar em modo de edição (sem atributo autoFocus).
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onSave(value);
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          doneRef.current = true;
          onCancel();
        }
      }}
      className="w-full min-w-0 rounded border bg-transparent px-1 py-0.5 text-sm"
      style={{ borderColor: 'var(--kd-accent)', color: 'var(--kd-text)' }}
      aria-label="Novo título"
    />
  );
}

export function TreePanel(): React.JSX.Element {
  const [nodes, setNodes] = useState<NodeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const { version } = useTreeRefresh();
  const location = useLocation();
  // O botão de visibilidade só aparece para admin; a autorização real é do backend.
  const { role } = useAuth();

  const toggleVisibility = (node: NodeSummary): void => {
    const next = node.visibility === 'public' ? 'private' : 'public';
    let cascade = false;
    if (next === 'public' && node.type === 'folder') {
      // Cascata NUNCA é o padrão: confirmação explícita, com semântica clara.
      cascade = window.confirm(
        `Tornar "${node.title || 'Sem pasta'}" pública COM todo o conteúdo dela?\n\nOK = pasta + conteúdo\nCancelar = só esta pasta`,
      );
    } else if (node.type === 'folder') {
      const label = node.title || 'Sem pasta';
      if (
        !window.confirm(
          `Tornar "${label}" privada? O conteúdo continua com a visibilidade própria (pode seguir público, mas invisível sem cadeia pública).`,
        )
      ) {
        return;
      }
    }
    void run(async () => {
      await apiFetch(`/api/nodes/${node.id}/visibility`, {
        method: 'POST',
        body: JSON.stringify({ visibility: next, cascade }),
      });
    });
  };

  // `_refreshKey` sinaliza recarga: quando `TreeRefreshProvider` incrementa a
  // versão, o efeito roda de novo (parâmetro é ignorado dentro do load).
  const load = useCallback(async (_refreshKey?: number) => {
    try {
      const json = await apiFetch<TreeResponse>('/api/tree');
      setNodes(parseWith(treeResponseSchema, json).nodes);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar a árvore.');
    }
  }, []);

  useEffect(() => {
    void load(version);
  }, [load, version]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, NodeSummary[]>();
    for (const node of nodes ?? []) {
      const key = node.parentId ?? '';
      const list = map.get(key) ?? [];
      list.push(node);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, 'pt-BR'));
    }
    return map;
  }, [nodes]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        setError(null);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Ação não concluída.');
      }
    },
    [load],
  );

  const create = (parentId: string | null, type: 'folder' | 'page'): void => {
    void run(async () => {
      const json = await apiFetch('/api/nodes', {
        method: 'POST',
        body: JSON.stringify({ type, parentId, title: '' }),
      });
      const node = parseWith(nodeSummarySchema, json);
      if (parentId) setExpanded((prev) => ({ ...prev, [parentId]: true }));
      await load();
      setRenamingId(node.id);
    });
  };

  const saveRename = (id: string, title: string): void => {
    setRenamingId(null);
    void run(async () => {
      await apiFetch(`/api/nodes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    });
  };

  const remove = (node: NodeSummary): void => {
    const label = node.title || '(sem título)';
    const question =
      node.type === 'folder'
        ? `Excluir a pasta "${label}" com todo o conteúdo dela?`
        : `Excluir a página "${label}"?`;
    if (!window.confirm(question)) return;
    void run(() => apiFetch(`/api/nodes/${node.id}`, { method: 'DELETE' }));
  };

  type DropHint = { id: string; where: 'before' | 'after' | 'into' } | null;
  const [dropHint, setDropHint] = useState<DropHint>(null);

  const DRAG_MIME = 'text/krndocs-node';

  const dropMove = (
    dragId: string,
    target: NodeSummary,
    where: 'before' | 'after' | 'into',
  ): void => {
    if (dragId === target.id) return;
    setDropHint(null);
    void run(async () => {
      if (where === 'into') {
        if (target.type !== 'folder' || dragId === target.id) return;
        await apiFetch(`/api/nodes/${dragId}/move`, {
          method: 'POST',
          body: JSON.stringify({ parentId: target.id, beforeId: null }),
        });
        setExpanded((prev) => ({ ...prev, [target.id]: true }));
        return;
      }
      // before/after: mesmo pai do alvo; after = antes do próximo irmão.
      const siblings = childrenOf.get(target.parentId ?? '') ?? [];
      const index = siblings.findIndex((sibling) => sibling.id === target.id);
      const next = where === 'after' ? (siblings[index + 1]?.id ?? null) : target.id;
      // Soltar sobre si mesmo (vizinho idêntico) não faz nada.
      if (next === dragId) return;
      await apiFetch(`/api/nodes/${dragId}/move`, {
        method: 'POST',
        body: JSON.stringify({ parentId: target.parentId, beforeId: next }),
      });
    });
  };

  const renderList = (list: NodeSummary[], depth: number): ReactNode =>
    list.map((node) => {
      const children = childrenOf.get(node.id) ?? [];
      const isExpanded = expanded[node.id] ?? false;
      const isActive = location.pathname === `/app/p/${node.id}`;
      const hint = dropHint?.id === node.id ? dropHint.where : null;

      return (
        <div key={node.id}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: linha é alvo de
              arrastar-soltar (melhoria progressiva); todas as ações têm botões
              operáveis por teclado e a API valida o movimento no servidor. */}
          <div
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_MIME, node.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              if (
                ![...(event.dataTransfer?.types ?? [])].some((t) => String(t).startsWith('text/'))
              ) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
              const where =
                node.type === 'folder' && ratio > 0.3 && ratio < 0.7
                  ? 'into'
                  : ratio <= 0.5
                    ? 'before'
                    : 'after';
              setDropHint((prev) =>
                prev?.id === node.id && prev.where === where ? prev : { id: node.id, where },
              );
            }}
            onDragLeave={() => {
              setDropHint((prev) => (prev?.id === node.id ? null : prev));
            }}
            onDrop={(event) => {
              event.preventDefault();
              const dragId = event.dataTransfer.getData(DRAG_MIME);
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
              const where =
                node.type === 'folder' && ratio > 0.3 && ratio < 0.7
                  ? 'into'
                  : ratio <= 0.5
                    ? 'before'
                    : 'after';
              if (dragId) dropMove(dragId, node, where);
              else setDropHint(null);
            }}
            onDragEnd={() => setDropHint(null)}
            className={`kd-tree-row group flex items-center gap-1 rounded-lg py-1 pr-1 text-sm${isActive ? ' kd-tree-row-active' : ''}`}
            style={{
              paddingLeft: `${depth * 10 + 6}px`,
              boxShadow:
                hint === 'before'
                  ? 'inset 0 2px 0 var(--kd-accent)'
                  : hint === 'after'
                    ? 'inset 0 -2px 0 var(--kd-accent)'
                    : hint === 'into'
                      ? 'inset 0 0 0 2px var(--kd-accent)'
                      : isActive
                        ? 'inset 2px 0 0 var(--kd-accent)'
                        : undefined,
              background: hint === 'into' ? 'var(--kd-accent-soft)' : undefined,
            }}
          >
            {node.type === 'folder' ? (
              <button
                type="button"
                aria-label={isExpanded ? 'Recolher pasta' : 'Expandir pasta'}
                aria-expanded={isExpanded}
                className="w-4 shrink-0"
                style={{ color: 'var(--kd-muted)' }}
                onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isExpanded }))}
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : (
              <span className="w-4 shrink-0 text-center text-xs" aria-hidden="true">
                {node.icon ?? '·'}
              </span>
            )}

            {renamingId === node.id ? (
              <RenameField
                initial={node.title}
                onSave={(title) => saveRename(node.id, title)}
                onCancel={() => setRenamingId(null)}
              />
            ) : node.type === 'page' ? (
              <NavLink
                to={`/app/p/${node.id}`}
                onDoubleClick={() => setRenamingId(node.id)}
                className="min-w-0 flex-1 truncate rounded px-1 py-0.5"
                style={{ color: 'var(--kd-text)' }}
                title={node.title || 'Sem título'}
              >
                {node.title || 'Sem título'}
              </NavLink>
            ) : (
              <button
                type="button"
                className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left"
                style={{ color: 'var(--kd-text)' }}
                title={node.title || 'Sem pasta'}
                onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isExpanded }))}
                onDoubleClick={() => setRenamingId(node.id)}
              >
                {node.title || 'Sem pasta'}
              </button>
            )}

            <span className="hidden shrink-0 gap-0.5 group-hover:flex">
              <button
                type="button"
                aria-label="Novo item aqui"
                title="Novo item aqui"
                className="rounded px-1"
                style={{ color: 'var(--kd-muted)' }}
                onClick={() => create(node.type === 'folder' ? node.id : node.parentId, 'page')}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                aria-label="Renomear"
                title="Renomear"
                className="rounded px-1"
                style={{ color: 'var(--kd-muted)' }}
                onClick={() => setRenamingId(node.id)}
              >
                <Pencil size={13} />
              </button>
              {role === 'admin' && (
                <button
                  type="button"
                  aria-label={node.visibility === 'public' ? 'Tornar privado' : 'Tornar público'}
                  title={
                    node.visibility === 'public'
                      ? 'Visível na landing — clique para tornar privado'
                      : 'Privado — clique para tornar público'
                  }
                  className="rounded px-1"
                  style={{
                    color: node.visibility === 'public' ? 'var(--kd-accent)' : 'var(--kd-muted)',
                  }}
                  onClick={() => toggleVisibility(node)}
                >
                  {node.visibility === 'public' ? <Globe size={13} /> : <Lock size={13} />}
                </button>
              )}
              <button
                type="button"
                aria-label="Excluir"
                title="Excluir"
                className="rounded px-1"
                style={{ color: '#c0392b' }}
                onClick={() => remove(node)}
              >
                <X size={13} />
              </button>
            </span>
          </div>

          {node.type === 'folder' && isExpanded && children.length > 0 && (
            <div>{renderList(children, depth + 1)}</div>
          )}
        </div>
      );
    });

  const roots = childrenOf.get('') ?? [];

  return (
    <nav
      aria-label="Árvore de páginas"
      className="flex flex-col gap-2"
      onDragOver={(event) => {
        // Fundo da barra: aceita soltar para mover à raiz.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        const dragId = event.dataTransfer.getData(DRAG_MIME);
        if (!dragId) return;
        setDropHint(null);
        void run(async () => {
          await apiFetch(`/api/nodes/${dragId}/move`, {
            method: 'POST',
            body: JSON.stringify({ parentId: null, beforeId: null }),
          });
        });
      }}
    >
      <FavoritesSection />
      <div className="flex gap-1.5">
        <button
          type="button"
          className="kd-btn kd-btn-ghost flex-1 !text-xs"
          onClick={() => create(null, 'folder')}
        >
          <FolderPlus size={13} aria-hidden="true" />
          Nova pasta
        </button>
        <button
          type="button"
          className="kd-btn kd-btn-ghost flex-1 !text-xs"
          onClick={() => create(null, 'page')}
        >
          <FilePlus2 size={13} aria-hidden="true" />
          Nova página
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border p-2 text-xs"
          style={{ borderColor: '#c0392b', color: '#c0392b' }}
        >
          {error}
        </div>
      )}

      {nodes === null && !error && (
        <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
          Carregando árvore…
        </p>
      )}

      {nodes !== null && roots.length === 0 && !error && (
        <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
          Nenhum conteúdo ainda. Crie a primeira pasta ou página.
        </p>
      )}

      {renderList(roots, 0)}
    </nav>
  );
}

/** Favoritos do usuário no topo da barra lateral. */
function FavoritesSection(): React.JSX.Element | null {
  const [favorites, setFavorites] = useState<FavoriteItem[] | null>(null);
  const { version } = useTreeRefresh();

  useEffect(() => {
    let cancelled = false;
    // `_refreshKey` sinaliza recarga (mesmo padrão do `load` acima).
    void (async (_refreshKey?: number) => {
      try {
        const json = await apiFetch('/api/favorites');
        const parsed = parseWith(favoriteListResponseSchema, json);
        if (!cancelled) setFavorites(parsed.favorites);
      } catch {
        if (!cancelled) setFavorites([]);
      }
    })(version);
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!favorites || favorites.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-1 text-xs font-medium" style={{ color: 'var(--kd-muted)' }}>
        Favoritos
      </p>
      {favorites.map((favorite) => (
        <NavLink
          key={favorite.nodeId}
          to={favorite.type === 'page' ? `/app/p/${favorite.nodeId}` : '/app'}
          className="flex items-center gap-1.5 truncate rounded px-1 py-0.5 text-sm"
          style={{ color: 'var(--kd-text)' }}
          title={favorite.title || 'Sem título'}
        >
          <Star size={13} aria-hidden="true" style={{ color: 'var(--kd-accent)' }} />
          <span className="truncate">{favorite.title || 'Sem título'}</span>
        </NavLink>
      ))}
    </div>
  );
}
