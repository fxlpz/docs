import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { TreePanel, TreeRefreshProvider } from '../components/TreePanel.js';
import { RequireAuth } from '../pages/LoginPage.js';
import { useTheme } from '../theme.js';

/**
 * Casca da aplicação (Etapa 2): guarda de sessão + cabeçalho + árvore.
 * O conteúdo da rota entra por <Outlet />.
 */
export function AppLayout(): React.JSX.Element {
  const { displayName, username, role, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <RequireAuth>
      <TreeRefreshProvider>
        <div className="flex h-full flex-col">
          <header
            className="flex items-center justify-between border-b px-4 py-2"
            style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-surface)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">KernelDocs</span>
              <span className="text-xs" style={{ color: 'var(--kd-muted)' }}>
                Cybersegurança
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <span style={{ color: 'var(--kd-text)' }} title={username ?? undefined}>
                {displayName ?? username}
              </span>
              {role === 'admin' && (
                <span
                  className="rounded border px-1 py-0.5 text-xs"
                  style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-muted)' }}
                >
                  admin
                </span>
              )}
              <button
                type="button"
                onClick={toggle}
                aria-pressed={theme === 'dark'}
                className="rounded-md border px-2 py-1 text-xs"
                style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
              >
                {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-md border px-2 py-1 text-xs"
                style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
              >
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
