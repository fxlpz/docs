import { searchResponseSchema } from '@krndocs/shared';
import { FileSearch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

/**
 * Resultado da busca full-text (título + corpo).
 * O snippet é texto puro do índice — renderizado como texto, nunca HTML.
 */
export function SearchPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; results: Array<{ nodeId: string; title: string; snippet: string }> }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    if (!query.trim()) {
      setState({ kind: 'ready', results: [] });
      return;
    }
    void (async () => {
      try {
        const json = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
        const parsed = parseWith(searchResponseSchema, json);
        if (!cancelled) setState({ kind: 'ready', results: parsed.results });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof ApiError ? err.message : 'Falha na busca.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        icon={<FileSearch size={18} aria-hidden="true" />}
        title="Busca"
        description={
          query ? (
            <span>
              Resultados para “<span style={{ color: 'var(--kd-text)' }}>{query}</span>”
            </span>
          ) : (
            'Digite um termo na caixa de busca do cabeçalho.'
          )
        }
      />

      {state.kind === 'loading' && (
        <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Buscando…
        </p>
      )}

      {state.kind === 'error' && (
        <div role="alert" className="kd-alert-error">
          {state.message}
        </div>
      )}

      {state.kind === 'ready' &&
        (state.results.length === 0 ? (
          <div className="kd-card p-8 text-center">
            <FileSearch
              size={26}
              aria-hidden="true"
              className="mx-auto mb-2"
              style={{ color: 'var(--kd-muted)' }}
            />
            <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
              {query ? 'Nenhum resultado.' : ''}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {state.results.map((result) => (
              <li key={result.nodeId} className="kd-card kd-card-interactive">
                <Link to={`/app/p/${result.nodeId}`} className="flex items-start gap-3 p-3">
                  <span className="kd-icon-tile !h-8 !w-8">
                    <FileSearch size={15} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-sm font-medium"
                      style={{ color: 'var(--kd-accent)' }}
                    >
                      {result.title || 'Sem título'}
                    </span>
                    {result.snippet && (
                      <p className="mt-1 text-sm" style={{ color: 'var(--kd-muted)' }}>
                        {result.snippet}
                      </p>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
