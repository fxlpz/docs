import { changePasswordResponseSchema, PASSWORD_MIN_LENGTH } from '@krndocs/shared';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, apiFetch, parseWith } from '../lib/api';

/**
 * Troca obrigatória de senha (primeiro acesso com senha provisória).
 *
 * - Exige a senha atual (anti-sequestro de sessão aberta) + nova com confirmação.
 * - Em sucesso, recarrega a sessão (a flag cai) e libera o workspace.
 * - Sem sessão => /login; com senha já definitiva => / (nada a fazer aqui).
 */
export function ChangePasswordPage(): React.JSX.Element {
  const { status, mustChangePassword, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center" role="status">
        <span className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Verificando sessão…
        </span>
      </div>
    );
  }
  if (status === 'anon') return <Navigate to="/login" replace />;
  if (!mustChangePassword) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError('A nova senha e a confirmação não coincidem.');
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`A nova senha precisa de ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    setSubmitting(true);
    try {
      const json = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      parseWith(changePasswordResponseSchema, json);
      await refresh();
      navigate('/', { replace: true });
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

  const fieldClass = 'w-full rounded-md border bg-transparent px-3 py-2 text-sm';

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">KernelDocs</h1>
        <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Primeiro acesso: defina sua senha definitiva
        </p>
      </header>

      <main
        className="w-full max-w-sm rounded-xl border p-5"
        style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-surface)' }}
      >
        <p className="mb-4 text-sm" style={{ color: 'var(--kd-muted)' }}>
          Você entrou com uma senha provisória. Escolha uma senha pessoal com ao menos{' '}
          {PASSWORD_MIN_LENGTH} caracteres para continuar.
        </p>

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
              Senha provisória (atual)
            </span>
            <input
              type="password"
              name="current-password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={fieldClass}
              style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: 'var(--kd-muted)' }}>
              Nova senha
            </span>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={fieldClass}
              style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: 'var(--kd-muted)' }}>
              Repita a nova senha
            </span>
            <input
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={fieldClass}
              style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--kd-accent)', color: '#ffffff' }}
          >
            {submitting ? 'Salvando…' : 'Definir nova senha'}
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--kd-border)', color: 'var(--kd-text)' }}
          >
            Sair sem trocar
          </button>
        </form>
      </main>
    </div>
  );
}

/**
 * Guarda do workspace: com senha provisória, todo o AppLayout dá lugar à
 * tela de troca (o servidor também bloqueia as rotas — defesa em profundidade).
 */
export function RequireFreshPassword({
  children,
}: {
  children: React.JSX.Element;
}): React.JSX.Element {
  const { status, mustChangePassword } = useAuth();
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
  if (mustChangePassword) return <Navigate to="/trocar-senha" replace />;
  return children;
}
