import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

const user = {
  id: 'u1',
  username: 'wesley.matos',
  displayName: 'Wesley Matos',
  role: 'admin',
  hasAvatar: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div>{`em:${location.pathname}${location.search}`}</div>;
}

function renderProtected(): void {
  render(
    <MemoryRouter initialEntries={['/app']}>
      <AuthProvider>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<div>conteudo-do-workspace</div>} />
            <Route path="buscar" element={<LocationProbe />} />
            <Route path="perfil" element={<div>tela-de-perfil</div>} />
          </Route>
          <Route path="/login" element={<div>tela-de-login</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function stubAuthed(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) return jsonResponse({ user, mustChangePassword: false });
      if (url.includes('/api/tree')) return jsonResponse({ nodes: [] });
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      return jsonResponse({ nodes: [] });
    }),
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

  test('busca no cabeçalho navega para /buscar?q=', async () => {
    stubAuthed();
    renderProtected();
    await screen.findByText('conteudo-do-workspace');
    fireEvent.change(screen.getByLabelText('Buscar na documentação'), {
      target: { value: 'firewall' },
    });
    const searchField = screen.getByLabelText('Buscar na documentação');
    const form = searchField.closest('form');
    if (!form) throw new Error('formulário de busca não encontrado');
    fireEvent.submit(form);
    expect(await screen.findByText('em:/app/buscar?q=firewall')).toBeTruthy();
  });

  test('sair volta para o login', async () => {
    stubAuthed();
    renderProtected();
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('tela-de-login')).toBeTruthy();
  });

  test('alternância de tema troca o rótulo', async () => {
    stubAuthed();
    renderProtected();
    const toggle = await screen.findByRole('button', { name: 'Tema escuro' });
    fireEvent.click(toggle);
    expect(await screen.findByRole('button', { name: 'Tema claro' })).toBeTruthy();
  });

  test('botão do usuário abre o perfil', async () => {
    stubAuthed();
    renderProtected();
    await screen.findByText('conteudo-do-workspace');
    fireEvent.click(screen.getByRole('button', { name: /Wesley Matos/ }));
    expect(await screen.findByText('tela-de-perfil')).toBeTruthy();
  });

  test('link Usuários só aparece para admin', async () => {
    stubAuthed();
    renderProtected();
    expect(await screen.findByRole('link', { name: 'Usuários' })).toBeTruthy();

    cleanup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse({
            user: { ...user, role: 'member' },
            mustChangePassword: false,
          });
        }
        if (url.includes('/api/tree')) return jsonResponse({ nodes: [] });
        if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
        return jsonResponse({ nodes: [] });
      }),
    );
    renderProtected();
    await screen.findByText('conteudo-do-workspace');
    expect(screen.queryByRole('link', { name: 'Usuários' })).toBeNull();
  });
});
