import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.js';
import { RequireAdmin, UsersPage } from './UsersPage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const admin = {
  id: 'a1',
  username: 'felipe.rosa',
  displayName: 'Felipe Rosa',
  role: 'admin',
  hasAvatar: false,
};
const member = {
  id: 'm1',
  username: 'wesley.matos',
  displayName: 'Wesley Matos',
  role: 'member',
  hasAvatar: false,
};

function managed(user: typeof admin, overrides: Record<string, unknown> = {}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: true,
    mustChangePassword: false,
    hasAvatar: false,
    lastLoginAt: null,
    createdAt: '2026-10-06T12:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderUsers(
  me: typeof admin,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return jsonResponse({ user: me, mustChangePassword: false });
      }
      return fetchImpl(input, init);
    }),
  );
  render(
    <MemoryRouter initialEntries={['/app/usuarios']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/app/usuarios"
            element={
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            }
          />
          <Route path="/login" element={<div>tela-de-login</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('UsersPage (só admin)', () => {
  test('membro vê mensagem de acesso restrito', async () => {
    renderUsers(member, async () => jsonResponse({ users: [] }));
    expect(await screen.findByText(/restrito a administradores/i)).toBeTruthy();
    expect(screen.queryByText('Nova conta')).toBeNull();
  });

  test('admin lista, cria e alterna papel', async () => {
    const calls: string[] = [];
    let created = false;
    renderUsers(admin, async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/users' && init?.method === 'POST') {
        created = true;
        return jsonResponse(managed({ ...admin, id: 'n1', username: 'novo.user' }), 201);
      }
      if (url.includes('/api/users/m1')) {
        return jsonResponse(managed(member, { role: 'admin' }));
      }
      return jsonResponse({
        users: created ? [managed(admin), managed(member)] : [managed(admin), managed(member)],
      });
    });
    expect(await screen.findByText(/felipe\.rosa/)).toBeTruthy();

    // Criar conta
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'novo.user' } });
    fireEvent.change(screen.getByLabelText('Nome de exibição'), { target: { value: 'Novo' } });
    fireEvent.change(screen.getByLabelText('Senha provisória'), {
      target: { value: 'senha-nova-99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText(/criada com senha provisória/)).toBeTruthy();
    expect(calls.some((call) => call.startsWith('POST /api/users'))).toBe(true);

    // Alternar papel (com confirmação)
    vi.stubGlobal('confirm', () => true);
    const selects = screen.getAllByLabelText(/Papel de /);
    fireEvent.change(selects[1] as HTMLElement, { target: { value: 'admin' } });
    await waitFor(() =>
      expect(calls.some((call) => call.includes('PATCH') && call.includes('/api/users/m1'))).toBe(
        true,
      ),
    );
  });

  test('desativar pede confirmação e chama a API', async () => {
    vi.stubGlobal('confirm', () => true);
    const calls: string[] = [];
    renderUsers(admin, async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/api/users/m1')) {
        return jsonResponse(managed(member, { isActive: false }));
      }
      return jsonResponse({ users: [managed(admin), managed(member)] });
    });
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Desativar' }))[1] as HTMLElement,
    );
    await waitFor(() =>
      expect(calls.some((call) => call.includes('PATCH') && call.includes('/api/users/m1'))).toBe(
        true,
      ),
    );
  });

  test('edita nome inline com Enter', async () => {
    const calls: string[] = [];
    const bodies: string[] = [];
    renderUsers(admin, async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/api/users/m1') && init?.method === 'PATCH') {
        bodies.push(String(init.body));
        return jsonResponse(managed(member, { displayName: 'Wesley M.' }));
      }
      return jsonResponse({ users: [managed(admin), managed(member)] });
    });
    await screen.findByText(/wesley\.matos/);
    fireEvent.click(screen.getByRole('button', { name: 'Editar nome de wesley.matos' }));
    const field = await screen.findByLabelText('Nome de exibição de wesley.matos');
    fireEvent.change(field, { target: { value: 'Wesley M.' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(calls.some((call) => call.includes('PATCH') && call.includes('/api/users/m1'))).toBe(
        true,
      ),
    );
    expect(bodies.some((body) => body.includes('Wesley M.'))).toBe(true);
  });

  test('redefine senha com confirmação mínima', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    renderUsers(admin, async (input, init) => {
      const url = String(input);
      if (url.includes('/api/users/m1/reset-password')) {
        calls.push({ url, body: String(init?.body) });
        return jsonResponse(managed(member, { mustChangePassword: true }));
      }
      return jsonResponse({ users: [managed(admin), managed(member)] });
    });
    await screen.findByText(/wesley\.matos/);
    fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    fireEvent.change(screen.getByLabelText('Nova senha provisória para wesley.matos'), {
      target: { value: 'nova-senha-99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Definir' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toContain('nova-senha-99');
    expect(await screen.findByText(/redefinida/)).toBeTruthy();
  });

  test('exclui com confirmação e some da lista', async () => {
    vi.stubGlobal('confirm', () => true);
    const calls: string[] = [];
    let deleted = false;
    renderUsers(admin, async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/api/users/m1') && init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 }) as unknown as Response;
      }
      return jsonResponse({
        users: deleted ? [managed(admin)] : [managed(admin), managed(member)],
      });
    });
    await screen.findByText(/wesley\.matos/);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(calls.some((call) => call.includes('DELETE') && call.includes('/api/users/m1'))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText('Papel de wesley.matos')).toBeNull());
    expect(await screen.findByText(/excluída/)).toBeTruthy();
  });

  test('exibe foto quando o usuário tem avatar', async () => {
    renderUsers(admin, async () => jsonResponse({ users: [managed(admin), managed(member)] }));
    await screen.findByText(/wesley\.matos/);
    // Sem avatar: ícone fallback, sem <img>
    expect(document.querySelector('img[alt^="Foto de"]')).toBeNull();
  });
});
