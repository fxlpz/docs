import {
  type NodeSummary,
  nodeSummarySchema,
  type TreeResponse,
  treeResponseSchema,
} from '@krndocs/shared';
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

  const renderList = (list: NodeSummary[], depth: number): ReactNode =>
    list.map((node) => {
      const children = childrenOf.get(node.id) ?? [];
      const isExpanded = expanded[node.id] ?? false;
      const isActive = location.pathname === `/p/${node.id}`;

      return (
        <div key={node.id}>
          <div
            className="group flex items-center gap-1 rounded-md py-1 pr-1 text-sm"
            style={{
              paddingLeft: `${depth * 12 + 8}px`,
              background: isActive ? 'rgba(15, 111, 79, 0.12)' : undefined,
            }}
          >
            {node.type === 'folder' ? (
              <button
                type="button"
                aria-label={isExpanded ? 'Recolher pasta' : 'Expandir pasta'}
                aria-expanded={isExpanded}
                className="w-4 shrink-0 text-xs"
                style={{ color: 'var(--kd-muted)' }}
                onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isExpanded }))}
              >
                {isExpanded ? '▾' : '▸'}
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
                to={`/p/${node.id}`}
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
                ＋
              </button>
              <button
                type="button"
                aria-label="Renomear"
                title="Renomear"
                className="rounded px-1"
                style={{ color: 'var(--kd-muted)' }}
                onClick={() => setRenamingId(node.id)}
              >
                ✎
              </button>
              <button
                type="button"
                aria-label="Excluir"
                title="Excluir"
                className="rounded px-1"
                style={{ color: '#c0392b' }}
                onClick={() => remove(node)}
              >
                ✕
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
    <nav aria-label="Árvore de páginas" className="flex flex-col gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          className="flex-1 rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
          onClick={() => create(null, 'folder')}
        >
          + Nova pasta
        </button>
        <button
          type="button"
          className="flex-1 rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
          onClick={() => create(null, 'page')}
        >
          + Nova página
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
