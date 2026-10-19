import { LogOut, Menu, Search, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { BrandMark } from '../components/Brand.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { TreePanel, TreeRefreshProvider } from '../components/TreePanel.js';
import { UserAvatar } from '../components/UserAvatar.js';
import { RequireAuth } from '../pages/LoginPage.js';

/**
 * Casca da aplicação (Etapa 2): guarda de sessão + cabeçalho + árvore.
 * O conteúdo da rota entra por <Outlet />.
 */
export function AppLayout(): React.JSX.Element {
  const { userId, displayName, username, role, hasAvatar, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [treeOpen, setTreeOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const lastPath = useRef(location.pathname);

  // Fecha painéis móveis ao navegar entre páginas, mas preserva mudanças de query.
  useEffect(() => {
    const path = location.pathname;
    if (lastPath.current === path) return;
    lastPath.current = path;
    setTreeOpen(false);
    setMobileSearchOpen(false);
  }, [location.pathname]);

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (search.trim()) navigate(`/app/buscar?q=${encodeURIComponent(search.trim())}`);
  }

  return (
    <RequireAuth>
      <TreeRefreshProvider>
        <div className="kd-app-shell flex h-full flex-col">
          <header
            className="kd-app-header z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-5"
            style={{
              borderColor: 'var(--kd-border)',
              background: 'var(--kd-surface)',
              boxShadow: 'var(--kd-shadow)',
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="kd-btn kd-btn-ghost !px-2 md:hidden"
                aria-label={treeOpen ? 'Fechar árvore de páginas' : 'Abrir árvore de páginas'}
                aria-expanded={treeOpen}
                aria-controls="kd-tree-panel"
                onClick={() => setTreeOpen((open) => !open)}
              >
                {treeOpen ? (
                  <X size={16} aria-hidden="true" />
                ) : (
                  <Menu size={16} aria-hidden="true" />
                )}
              </button>
              <Link
                to="/app"
                className="flex shrink-0 items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold tracking-tight"
              >
                <BrandMark />
                KernelDocs
              </Link>
              <span
                className="hidden truncate text-xs lg:inline"
                style={{ color: 'var(--kd-muted)' }}
              >
                Cybersegurança
              </span>
            </div>

            <search className="hidden min-w-0 flex-1 justify-center sm:flex">
              <form onSubmit={handleSearch} className="w-full max-w-sm">
                <span
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
                  style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-bg)' }}
                >
                  <Search size={14} aria-hidden="true" style={{ color: 'var(--kd-muted)' }} />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar na documentação…"
                    aria-label="Buscar na documentação"
                    className="w-full bg-transparent text-xs outline-none"
                    style={{ color: 'var(--kd-text)' }}
                  />
                </span>
              </form>
            </search>

            <nav className="hidden shrink-0 items-center gap-1 text-xs md:flex" aria-label="Seções">
              <Link
                to="/app/modelos"
                className="rounded-md px-2 py-1.5 transition-colors hover:opacity-80"
                style={{ color: 'var(--kd-muted)' }}
              >
                Modelos
              </Link>
              <Link
                to="/app/lixeira"
                className="rounded-md px-2 py-1.5 transition-colors hover:opacity-80"
                style={{ color: 'var(--kd-muted)' }}
              >
                Lixeira
              </Link>
              {role === 'admin' && (
                <Link
                  to="/app/usuarios"
                  className="rounded-md px-2 py-1.5 transition-colors hover:opacity-80"
                  style={{ color: 'var(--kd-muted)' }}
                >
                  Usuários
                </Link>
              )}
            </nav>

            <div className="flex shrink-0 items-center gap-1.5 text-sm">
              <button
                type="button"
                className="kd-btn kd-btn-ghost !px-2 sm:hidden"
                aria-label={mobileSearchOpen ? 'Fechar busca' : 'Abrir busca'}
                aria-expanded={mobileSearchOpen}
                onClick={() => setMobileSearchOpen((open) => !open)}
              >
                {mobileSearchOpen ? (
                  <X size={15} aria-hidden="true" />
                ) : (
                  <Search size={15} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => navigate('/app/perfil')}
                title="Abrir meu perfil"
                className="kd-btn kd-btn-ghost"
              >
                <UserAvatar
                  userId={userId ?? ''}
                  hasAvatar={hasAvatar}
                  name={displayName ?? username ?? '?'}
                  size={18}
                />
                <span title={username ?? undefined} className="max-w-28 truncate">
                  {displayName ?? username}
                </span>
                {role === 'admin' && <span className="kd-badge">admin</span>}
              </button>
              <ThemeToggle />
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="kd-btn kd-btn-ghost"
              >
                <LogOut size={14} aria-hidden="true" />
                Sair
              </button>
            </div>
          </header>

          {mobileSearchOpen && (
            <form onSubmit={handleSearch} className="kd-mobile-search border-b p-3 sm:hidden">
              <label className="sr-only" htmlFor="kd-mobile-search">
                Buscar na documentação
              </label>
              <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                <Search size={15} aria-hidden="true" style={{ color: 'var(--kd-muted)' }} />
                <input
                  id="kd-mobile-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar na documentação…"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none"
                  style={{ color: 'var(--kd-text)' }}
                />
                <button type="submit" className="kd-btn kd-btn-primary">
                  Buscar
                </button>
              </div>
            </form>
          )}

          <div className="relative flex min-h-0 flex-1">
            <aside
              id="kd-tree-panel"
              className={`kd-tree-panel shrink-0 overflow-y-auto border-r p-3 ${treeOpen ? 'kd-tree-panel-open' : ''}`}
              style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-surface)' }}
            >
              <TreePanel />
            </aside>
            {treeOpen && (
              <button
                type="button"
                className="kd-tree-backdrop md:hidden"
                aria-label="Fechar árvore de páginas"
                onClick={() => setTreeOpen(false)}
              />
            )}

            <main className="kd-app-main min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </TreeRefreshProvider>
    </RequireAuth>
  );
}
