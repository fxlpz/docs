import { LogOut, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
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
  const [search, setSearch] = useState('');

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
        <div className="flex h-full flex-col">
          <header
            className="z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-5"
            style={{
              borderColor: 'var(--kd-border)',
              background: 'var(--kd-surface)',
              boxShadow: 'var(--kd-shadow)',
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
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

            <div className="flex shrink-0 items-center gap-2 text-sm">
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

          <div className="flex min-h-0 flex-1">
            <aside
              className="w-64 shrink-0 overflow-y-auto border-r p-3"
              style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-surface)' }}
            >
              <TreePanel />
            </aside>

            <main className="min-w-0 flex-1 overflow-y-auto p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </TreeRefreshProvider>
    </RequireAuth>
  );
}
