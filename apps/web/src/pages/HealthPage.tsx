import { type HealthResponse, healthResponseSchema } from '@krndocs/shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * Tela inicial de diagnóstico da Etapa 1.
 *
 * Demonstra os três estados obrigatórios da interface:
 *   - carregando
 *   - erro (API indisponível / resposta fora do contrato)
 *   - sucesso (dados reais da API, nunca fictícios)
 *
 * A tela inicial com atalhos e atividades recentes é da Etapa 2.
 */
type Status =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; health: HealthResponse };

export function HealthPage(): React.JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('kd-theme');
    return stored === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('kd-theme', theme);
  }, [theme]);

  const loadHealth = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const response = await fetch('/api/health', {
        headers: { accept: 'application/json' },
      });
      // Corpo primeiro: um 503 "degraded" VEM com o contrato válido e deve ir
      // ao estado pronto (com alerta), não ao erro genérico de HTTP.
      const json: unknown = await response.json().catch(() => null);
      const parsed = healthResponseSchema.safeParse(json);
      if (!parsed.success) {
        setStatus({
          kind: 'error',
          message: response.ok
            ? 'Resposta da API fora do contrato esperado.'
            : `API respondeu ${response.status}.`,
        });
        return;
      }
      setStatus({ kind: 'ready', health: parsed.data });
    } catch {
      setStatus({
        kind: 'error',
        message: 'Não foi possível conectar à API. Verifique se ela está em execução.',
      });
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">KernelDocs</h1>
        <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Documentação privada — Equipe de Cybersegurança · Kernel Solutions
        </p>
      </header>

      <main
        className="w-full max-w-lg rounded-xl border p-5"
        style={{
          borderColor: 'var(--kd-border)',
          background: 'var(--kd-surface)',
        }}
      >
        {status.kind === 'loading' && (
          <div role="status" className="flex items-center gap-3 text-sm">
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <span style={{ color: 'var(--kd-muted)' }}>Verificando a API…</span>
          </div>
        )}

        {status.kind === 'error' && (
          <div role="alert" className="space-y-3">
            <p className="text-sm font-medium" style={{ color: '#c0392b' }}>
              Falha ao consultar a API
            </p>
            <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
              {status.message}
            </p>
            <button
              type="button"
              onClick={() => void loadHealth()}
              className="rounded-md border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--kd-border)' }}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {status.kind === 'ready' && (
          <dl className="space-y-2 text-sm">
            {status.health.status === 'degraded' && (
              <div
                role="alert"
                className="rounded-md border p-2"
                style={{ borderColor: '#c0392b' }}
              >
                <p className="text-sm font-medium" style={{ color: '#c0392b' }}>
                  API degradada — o banco de dados não respondeu.
                </p>
              </div>
            )}
            <div className="flex justify-between">
              <dt style={{ color: 'var(--kd-muted)' }}>Status</dt>
              <dd className="font-medium" style={{ color: 'var(--kd-accent)' }}>
                {status.health.status}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt style={{ color: 'var(--kd-muted)' }}>Versão</dt>
              <dd>{status.health.version}</dd>
            </div>
            <div className="flex justify-between">
              <dt style={{ color: 'var(--kd-muted)' }}>Migrações aplicadas</dt>
              <dd>{status.health.migrations}</dd>
            </div>
            <div className="flex justify-between">
              <dt style={{ color: 'var(--kd-muted)' }}>Hora do servidor</dt>
              <dd>{new Date(status.health.time).toLocaleString('pt-BR')}</dd>
            </div>
          </dl>
        )}
      </main>

      <footer className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--kd-border)' }}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </button>
        <button
          type="button"
          onClick={() => void loadHealth()}
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--kd-border)' }}
        >
          Atualizar status
        </button>
      </footer>
    </div>
  );
}
