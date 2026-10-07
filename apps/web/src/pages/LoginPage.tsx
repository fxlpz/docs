import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';

/**
 * Tela de login (Etapa 2). Sem cadastro público: apenas usuários
 * provisionados entram. Mensagens de erro nunca revelam se a conta existe.
 */
export function LoginPage(): React.JSX.Element {
  const { status, mustChangePassword, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authed')
      navigate(mustChangePassword ? '/trocar-senha' : '/', { replace: true });
  }, [status, mustChangePassword, navigate]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center" role="status">
        <span className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Verificando sessão…
        </span>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // O redirecionamento (workspace ou troca obrigatória) é decidido pelo
      // efeito acima a partir da flag devolvida no login.
      await login(username, password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível conectar ao servidor. Tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">KernelDocs</h1>
        <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Documentação privada — Equipe de Cybersegurança · Kernel Solutions
        </p>
      </header>

      <main
        className="w-full max-w-sm rounded-xl border p-5"
        style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-surface)' }}
      >
        <h2 className="mb-4 text-sm font-medium">Entrar</h2>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border p-2 text-sm"
            style={{ borderColor: '#c0392b', color: '#c0392b' }}
          >
            {error}
          </div>
        )}

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: 'var(--kd-muted)' }}>
              Usuário
            </span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: 'var(--kd-muted)' }}>
              Senha
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--kd-accent)', color: '#ffffff' }}
          >
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </main>

      <footer className="text-xs" style={{ color: 'var(--kd-muted)' }}>
        Acesso restrito à equipe. Tentativas são auditadas.
      </footer>
    </div>
  );
}

/** Guarda de rota: sem sessão => /login. */
export function RequireAuth({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center" role="status">
        <span className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Carregando…
        </span>
      </div>
    );
  }
  if (status === 'anon') return <Navigate to="/login" replace />;
  return children;
}
