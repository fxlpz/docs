import { authUserResponseSchema } from '@krndocs/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, apiFetch, parseWith } from '../lib/api';

/**
 * Estado de sessão da aplicação.
 *
 * - `loading`: consultando /api/auth/me no boot (não decidir rota ainda).
 * - `anon`: sem sessão válida (ou API inacessível — o login dirá o resto).
 * - `authed`: sessão ativa com usuário conhecido. Com `mustChangePassword`,
 *   o workspace fica bloqueado até a troca em /trocar-senha.
 */
type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthContextValue {
  status: AuthStatus;
  username: string | null;
  displayName: string | null;
  role: 'admin' | 'member' | null;
  /** true quando a senha é provisória (troca obrigatória pendente). */
  mustChangePassword: boolean;
  /** Lança `ApiError` com a mensagem do servidor em caso de falha. */
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Recarrega /api/auth/me (usado após a troca de senha). */
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<{
    username: string;
    displayName: string;
    role: 'admin' | 'member';
  } | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const loadMe = useCallback(async (): Promise<void> => {
    const json = await apiFetch('/api/auth/me');
    const parsed = parseWith(authUserResponseSchema, json);
    setUser(parsed.user);
    setMustChangePassword(parsed.mustChangePassword);
    setStatus('authed');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const json = await apiFetch('/api/auth/me');
        const parsed = parseWith(authUserResponseSchema, json);
        if (!cancelled) {
          setUser(parsed.user);
          setMustChangePassword(parsed.mustChangePassword);
          setStatus('authed');
        }
      } catch (error) {
        // 401 é o estado normal (sem sessão); outros erros também caem no
        // login — a tentativa de login lá mostrará a causa real.
        if (!cancelled) {
          setUser(null);
          setMustChangePassword(false);
          setStatus('anon');
          if (!(error instanceof ApiError)) console.error(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const json = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const parsed = parseWith(authUserResponseSchema, json);
    setUser(parsed.user);
    setMustChangePassword(parsed.mustChangePassword);
    setStatus('authed');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Mesmo com falha de rede, o estado local vira `anon` (o cookie pode
      // permanecer no navegador, mas a próxima sessão o revogará no servidor).
      setUser(null);
      setMustChangePassword(false);
      setStatus('anon');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      username: user?.username ?? null,
      displayName: user?.displayName ?? null,
      role: user?.role ?? null,
      mustChangePassword,
      login,
      logout,
      refresh: loadMe,
    }),
    [status, user, mustChangePassword, login, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return context;
}
