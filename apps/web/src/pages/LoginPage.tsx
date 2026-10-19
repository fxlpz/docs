import { Check, Lock, User } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/Brand.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { ApiError } from '../lib/api';

/** Selos do painel de marca (afirmações reais sobre o produto). */
const LOGIN_HIGHLIGHTS = [
  'Acesso restrito e auditado',
  'Conteúdo interno da equipe',
  'Publicação controlada pela administração',
];

/**
 * Tela de login. Sem cadastro público: apenas usuários
 * provisionados entram. Mensagens de erro nunca revelam se a conta existe.
 * (Só o visual mudou — fluxo, contratos e guardas intactos.)
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
      navigate(mustChangePassword ? '/trocar-senha' : '/app', { replace: true });
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
    <div className="relative flex min-h-full items-center justify-center p-6">
      <div aria-hidden="true" className="kd-landing-bg" />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <div className="kd-card relative grid w-full max-w-3xl overflow-hidden !rounded-2xl !p-0 sm:grid-cols-2">
        {/* Branding */}
        <div
          className="relative hidden flex-col justify-between gap-8 overflow-hidden p-8 sm:flex"
          style={{ background: 'var(--kd-surface-2)' }}
        >
          <div aria-hidden="true" className="kd-home-glow" />

          <div className="relative flex items-center gap-2">
            <BrandMark size={24} />
            <span className="text-lg font-semibold tracking-tight">KernelDocs</span>
          </div>

          <div className="relative">
            <p className="mb-2 text-xl leading-snug font-semibold">
              Documentação da equipe de <span className="kd-gradient-text">Cybersegurança</span>
            </p>
            <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
              Base interna de conhecimento da Kernel Solutions — runbooks, guias e procedimentos.
            </p>
            <ul className="mt-5 space-y-2 text-xs" style={{ color: 'var(--kd-muted)' }}>
              {LOGIN_HIGHLIGHTS.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check size={13} aria-hidden="true" style={{ color: 'var(--kd-accent)' }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <p
            className="relative flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--kd-muted)' }}
          >
            <Lock size={13} aria-hidden="true" style={{ color: 'var(--kd-accent)' }} />
            Entrada com usuário provisionado pela equipe
          </p>
        </div>

        {/* Formulário */}
        <main className="p-6 sm:p-8">
          <h1 className="mb-1 text-xl font-semibold tracking-tight">Entrar</h1>
          <p className="mb-5 text-sm" style={{ color: 'var(--kd-muted)' }}>
            Use sua conta provisionada pela equipe.
          </p>

          {error && (
            <div role="alert" className="kd-alert-error mb-4">
              {error}
            </div>
          )}

          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: 'var(--kd-muted)' }}>
                Usuário
              </span>
              <span className="relative block">
                <User
                  size={15}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
                  style={{ color: 'var(--kd-muted)' }}
                />
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="kd-input kd-input-icon"
                />
              </span>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: 'var(--kd-muted)' }}>
                Senha
              </span>
              <span className="relative block">
                <Lock
                  size={15}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
                  style={{ color: 'var(--kd-muted)' }}
                />
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="kd-input kd-input-icon"
                />
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="kd-btn kd-btn-primary kd-btn-block"
            >
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs" style={{ color: 'var(--kd-muted)' }}>
            <Link to="/" style={{ color: 'var(--kd-accent)' }}>
              ← Voltar à página pública
            </Link>
          </p>
        </main>
      </div>
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
