import { publicTreeResponseSchema, searchResponseSchema } from '@krndocs/shared';
import {
  BookOpenText,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  LogIn,
  Search,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../components/Brand.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

interface PublicTreeNode {
  id: string;
  type: 'folder' | 'page';
  parentId: string | null;
  title: string;
}

interface PublicSearchResult {
  nodeId: string;
  title: string;
  snippet?: string;
}

/**
 * Landing pública (`/`) — sem login.
 *
 * Só mostra o que o admin liberou (`visibility='public'` com cadeia
 * ancestral pública — regra do backend). Documentos abrem somente-leitura.
 *
 * Apresentação pensada para visitantes externos: hero com a identidade,
 * busca em destaque, documentos em cartões e rodapé com a marca — sempre
 * com dados reais da API (nada de seção inventada).
 */
export function LandingPage(): React.JSX.Element {
  const [nodes, setNodes] = useState<PublicTreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicSearchResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const json = await apiFetch('/api/public/tree');
        const parsed = parseWith(publicTreeResponseSchema, json);
        if (!cancelled) {
          setNodes(
            parsed.nodes.map((node) => ({
              id: node.id,
              type: node.type,
              parentId: node.parentId,
              title: node.title,
            })),
          );
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setNodes([]);
          setError(err instanceof ApiError ? err.message : 'Falha ao carregar.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const search = (value: string): void => {
    setQuery(value);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    void (async () => {
      try {
        const json = await apiFetch(`/api/public/search?q=${encodeURIComponent(value.trim())}`);
        const parsed = parseWith(searchResponseSchema, json);
        setResults(parsed.results);
      } catch {
        setResults([]);
      }
    })();
  };

  const childrenOf = (parentId: string | null): PublicTreeNode[] =>
    (nodes ?? [])
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));

  /** Total de documentos (páginas) dentro de uma pasta, contando subpastas. */
  const countPages = (folderId: string): number =>
    childrenOf(folderId).reduce(
      (total, child) => total + (child.type === 'page' ? 1 : countPages(child.id)),
      0,
    );

  const renderList = (list: PublicTreeNode[], depth: number): React.JSX.Element => (
    <ul
      className={depth === 0 ? 'space-y-1' : 'ml-1 space-y-0.5'}
      aria-label={depth === 0 ? undefined : 'Subitens'}
    >
      {list.map((node) => (
        <li key={node.id}>
          {node.type === 'page' ? (
            <Link
              to={`/pub/${node.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--kd-surface-2)]"
              style={{ color: 'var(--kd-text)' }}
            >
              <FileText size={14} aria-hidden="true" style={{ color: 'var(--kd-muted)' }} />
              <span className="truncate">{node.title || 'Sem título'}</span>
            </Link>
          ) : (
            <div>
              <p className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium">
                <FolderOpen size={14} aria-hidden="true" style={{ color: 'var(--kd-accent)' }} />
                <span className="truncate">{node.title || 'Sem pasta'}</span>
              </p>
              {renderList(childrenOf(node.id), depth + 1)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  const roots = childrenOf(null);
  const searching = query.trim().length > 0;
  const publishedPages = (nodes ?? []).filter((node) => node.type === 'page').length;

  return (
    <div className="relative flex min-h-full flex-col">
      {/* Fundo decorativo: brilhos discretos do acento (sem conteúdo) */}
      <div aria-hidden="true" className="kd-landing-bg" />

      <header
        className="kd-landing-header sticky top-0 z-20 border-b"
        style={{ borderColor: 'var(--kd-border)' }}
      >
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark size={18} />
            <span className="truncate text-base font-semibold tracking-tight">KernelDocs</span>
            <span className="kd-badge hidden sm:inline-flex">Documentação pública</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link to="/login" className="kd-btn kd-btn-primary">
              <LogIn size={15} aria-hidden="true" />
              Entrar
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-5 pb-14">
        {/* Hero */}
        <section className="pt-12 text-center sm:pt-16">
          <span className="kd-landing-emblem mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
            <BrandMark size={26} />
          </span>

          <p
            className="mb-3 text-xs font-medium tracking-widest uppercase"
            style={{ color: 'var(--kd-accent)' }}
          >
            Kernel Solutions · Cybersegurança
          </p>

          <h1 className="mx-auto max-w-2xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            Documentação pública da <span className="kd-gradient-text">Kernel Solutions</span>
          </h1>

          <p
            className="mx-auto mt-4 max-w-xl text-sm sm:text-base"
            style={{ color: 'var(--kd-muted)' }}
          >
            Guias e manuais liberados pela nossa equipe. O conteúdo interno continua protegido e
            disponível apenas com login.
          </p>

          <ul className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {['Acesso livre', 'Sem cadastro', 'Somente leitura'].map((item) => (
              <li key={item} className="kd-badge">
                <Check size={11} aria-hidden="true" style={{ color: 'var(--kd-accent)' }} />
                {item}
              </li>
            ))}
            {publishedPages > 0 && (
              <li className="kd-badge kd-badge-accent">
                <FileText size={11} aria-hidden="true" />
                {publishedPages === 1 ? '1 documento' : `${publishedPages} documentos`}
              </li>
            )}
          </ul>

          <search className="kd-card mx-auto mt-7 flex max-w-xl items-center gap-2 p-2 pl-3.5">
            <form
              onSubmit={(event) => event.preventDefault()}
              className="flex w-full items-center gap-2"
            >
              <Search size={16} aria-hidden="true" style={{ color: 'var(--kd-muted)' }} />
              <input
                type="search"
                value={query}
                onChange={(event) => search(event.target.value)}
                placeholder="Buscar nos documentos públicos…"
                aria-label="Buscar nos documentos públicos"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: 'var(--kd-text)' }}
              />
            </form>
          </search>
        </section>

        {/* Conteúdo */}
        <section className="mt-10">
          {error && (
            <div role="alert" className="kd-alert-error mb-4">
              {error}
            </div>
          )}

          {searching ? (
            <div>
              <h2 className="kd-section-title mb-3" style={{ color: 'var(--kd-muted)' }}>
                Resultados para “{query.trim()}”
              </h2>
              {results === null ? (
                <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
                  Buscando…
                </p>
              ) : results.length === 0 ? (
                <div className="kd-card p-8 text-center">
                  <Search
                    size={26}
                    aria-hidden="true"
                    className="mx-auto mb-2"
                    style={{ color: 'var(--kd-muted)' }}
                  />
                  <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
                    Nenhum documento público encontrado.
                  </p>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {results.map((result) => (
                    <li key={result.nodeId}>
                      <Link
                        to={`/pub/${result.nodeId}`}
                        className="kd-card group flex items-start gap-3 p-4 transition-transform hover:-translate-y-0.5"
                      >
                        <span className="kd-icon-tile">
                          <FileText size={16} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {result.title || 'Sem título'}
                          </span>
                          {result.snippet ? (
                            <span
                              className="mt-0.5 block truncate text-xs"
                              style={{ color: 'var(--kd-muted)' }}
                            >
                              {result.snippet}
                            </span>
                          ) : null}
                        </span>
                        <ChevronRight
                          size={15}
                          aria-hidden="true"
                          className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ color: 'var(--kd-muted)' }}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : nodes === null ? (
            <p role="status" className="text-center text-sm" style={{ color: 'var(--kd-muted)' }}>
              Carregando documentos…
            </p>
          ) : roots.length === 0 ? (
            <div className="kd-card mx-auto max-w-xl p-10 text-center">
              <span className="kd-landing-emblem mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
                <BookOpenText size={22} aria-hidden="true" />
              </span>
              <p className="mb-1 text-sm font-medium">Nenhum documento público ainda</p>
              <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
                A equipe ainda não liberou conteúdo público. Se você é da equipe,{' '}
                <Link to="/login" style={{ color: 'var(--kd-accent)' }}>
                  faça login
                </Link>{' '}
                para publicar.
              </p>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="kd-section-title">Documentos</h2>
                <span className="text-xs" style={{ color: 'var(--kd-muted)' }}>
                  {publishedPages === 1
                    ? '1 documento público'
                    : `${publishedPages} documentos públicos`}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {roots.map((node) =>
                  node.type === 'folder' ? (
                    <section key={node.id} className="kd-card p-4">
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        <span className="kd-icon-tile">
                          <FolderOpen size={16} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{node.title || 'Sem pasta'}</span>
                        <span className="kd-badge">
                          {countPages(node.id) === 1 ? '1 doc' : `${countPages(node.id)} docs`}
                        </span>
                      </h3>
                      {renderList(childrenOf(node.id), 1)}
                    </section>
                  ) : (
                    <Link
                      key={node.id}
                      to={`/pub/${node.id}`}
                      className="kd-card group flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5"
                    >
                      <span className="kd-icon-tile">
                        <FileText size={16} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {node.title || 'Sem título'}
                        </span>
                        <span className="block text-xs" style={{ color: 'var(--kd-muted)' }}>
                          Documento público
                        </span>
                      </span>
                      <ChevronRight
                        size={15}
                        aria-hidden="true"
                        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ color: 'var(--kd-muted)' }}
                      />
                    </Link>
                  ),
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="relative z-10 border-t py-6" style={{ borderColor: 'var(--kd-border)' }}>
        <div
          className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-5 text-xs sm:flex-row"
          style={{ color: 'var(--kd-muted)' }}
        >
          <span className="flex items-center gap-2">
            <BrandMark size={14} />
            KernelDocs · Kernel Solutions
          </span>
          <span>Base de conhecimento · acesso interno mediante login</span>
        </div>
      </footer>
    </div>
  );
}
