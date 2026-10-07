import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './LoginPage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const user = { id: 'u1', username: 'felipe.rosa', displayName: 'Felipe Rosa', role: 'admin' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLogin(): void {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>workspace</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function typeAndSubmit(username: string, password: string): Promise<void> {
  const usernameField = await screen.findByLabelText('Usuário');
  fireEvent.change(usernameField, { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  test('renderiza o formulário de entrada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } }, 401),
      ),
    );
    renderLogin();
    expect(await screen.findByRole('heading', { name: 'KernelDocs' })).toBeTruthy();
    expect(screen.getByLabelText('Usuário')).toBeTruthy();
    expect(screen.getByLabelText('Senha')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
  });

  test('exibe a mensagem do envelope de erro (401)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse(
            { error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } },
            401,
          );
        }
        return jsonResponse(
          { error: { code: 'UNAUTHORIZED', message: 'Usuário ou senha incorretos.' } },
          401,
        );
      }),
    );
    renderLogin();
    await typeAndSubmit('felipe.rosa', 'senha-errada');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Usuário ou senha incorretos.');
  });

  test('login bem-sucedido leva ao workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse(
            { error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } },
            401,
          );
        }
        return jsonResponse({ user, mustChangePassword: false });
      }),
    );
    renderLogin();
    await typeAndSubmit('felipe.rosa', 'senha-correta');
    expect(await screen.findByText('workspace')).toBeTruthy();
  });

  test('login com senha provisória leva à troca obrigatória', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse(
            { error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } },
            401,
          );
        }
        return jsonResponse({ user, mustChangePassword: true });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/trocar-senha" element={<div>tela-trocar-senha</div>} />
            <Route path="/" element={<div>workspace</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await typeAndSubmit('felipe.rosa', 'senha-provisoria');
    expect(await screen.findByText('tela-trocar-senha')).toBeTruthy();
    expect(screen.queryByText('workspace')).toBeNull();
  });

  test('falha de rede vira mensagem amigável', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse(
            { error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } },
            401,
          );
        }
        throw new TypeError('fetch failed');
      }),
    );
    renderLogin();
    await typeAndSubmit('felipe.rosa', 'qualquer');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Não foi possível conectar ao servidor.');
  });
});
