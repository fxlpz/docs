import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.js';
import { AppLayout } from './AppLayout.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const user = { id: 'u1', username: 'wesley.matos', displayName: 'Wesley Matos', role: 'admin' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderProtected(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>conteudo-do-workspace</div>} />
          </Route>
          <Route path="/login" element={<div>tela-de-login</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AppLayout (guarda de sessão)', () => {
  test('sem sessão redireciona para /login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } }, 401),
      ),
    );
    renderProtected();
    expect(await screen.findByText('tela-de-login')).toBeTruthy();
    expect(screen.queryByText('conteudo-do-workspace')).toBeNull();
  });

  test('com sessão exibe o workspace, o usuário e a árvore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) return jsonResponse({ user, mustChangePassword: false });
        if (url.includes('/api/tree')) return jsonResponse({ nodes: [] });
        return jsonResponse({ nodes: [] });
      }),
    );
    renderProtected();
    expect(await screen.findByText('conteudo-do-workspace')).toBeTruthy();
    expect(screen.getByText('Wesley Matos')).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Árvore de páginas' })).toBeTruthy();
    // Botão de sair presente
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
  });
});
