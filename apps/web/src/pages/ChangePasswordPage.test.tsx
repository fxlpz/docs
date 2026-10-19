import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.js';
import { ChangePasswordPage } from './ChangePasswordPage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const user = {
  id: 'u1',
  username: 'felipe.rosa',
  displayName: 'Felipe Rosa',
  role: 'admin',
  hasAvatar: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderChange(fetchImpl: (input: RequestInfo | URL) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => fetchImpl(input)),
  );
  render(
    <MemoryRouter initialEntries={['/trocar-senha']}>
      <AuthProvider>
        <Routes>
          <Route path="/trocar-senha" element={<ChangePasswordPage />} />
          <Route path="/login" element={<div>tela-de-login</div>} />
          <Route path="/app" element={<div>workspace</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(current: string, next: string, confirm: string): Promise<void> {
  await screen.findByRole('heading', { name: 'KernelDocs' });
  fireEvent.change(screen.getByLabelText('Senha provisória (atual)'), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Repita a nova senha'), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Definir nova senha' }));
}

describe('ChangePasswordPage', () => {
  test('sem sessão redireciona para /login', async () => {
    renderChange(async () =>
      jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } }, 401),
    );
    expect(await screen.findByText('tela-de-login')).toBeTruthy();
  });

  test('com senha definitiva não há nada a fazer (vai ao workspace)', async () => {
    renderChange(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) return jsonResponse({ user, mustChangePassword: false });
      return jsonResponse({ nodes: [] });
    });
    expect(await screen.findByText('workspace')).toBeTruthy();
  });

  test('nova senha e confirmação diferentes mostram erro local', async () => {
    renderChange(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) return jsonResponse({ user, mustChangePassword: true });
      return jsonResponse({ nodes: [] });
    });
    await fillAndSubmit('provisoria', 'senha-nova-12345', 'outra-senha-99999');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('não coincidem');
  });

  test('senha atual errada exibe a mensagem do servidor', async () => {
    renderChange(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) return jsonResponse({ user, mustChangePassword: true });
      if (url.includes('/api/auth/change-password')) {
        return jsonResponse(
          { error: { code: 'UNAUTHORIZED', message: 'Senha atual incorreta.' } },
          401,
        );
      }
      return jsonResponse({ nodes: [] });
    });
    await fillAndSubmit('senha-errada', 'senha-nova-12345', 'senha-nova-12345');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Senha atual incorreta.');
  });

  test('troca bem-sucedida libera o workspace', async () => {
    let changed = false;
    renderChange(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return jsonResponse({ user, mustChangePassword: !changed });
      }
      if (url.includes('/api/auth/change-password')) {
        changed = true;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ nodes: [] });
    });
    await fillAndSubmit('senha-provisoria', 'senha-definitiva-1', 'senha-definitiva-1');
    // Após a troca, refresh() recarrega /me sem flag e navega ao workspace
    expect(await screen.findByText('workspace')).toBeTruthy();
  });

  test('senha curta é barrada localmente (sem chamar a API)', async () => {
    const calls: string[] = [];
    renderChange(async (input) => {
      calls.push(String(input));
      if (String(input).includes('/api/auth/change-password')) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ user, mustChangePassword: true });
    });
    await fillAndSubmit('provisoria', 'curta', 'curta');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('10 caracteres');
    expect(calls.some((call) => call.includes('/change-password'))).toBe(false);
  });

  test('sair sem trocar faz logout e volta ao login', async () => {
    renderChange(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/logout')) return jsonResponse({ ok: true });
      return jsonResponse({ user, mustChangePassword: true });
    });
    await screen.findByRole('heading', { name: 'KernelDocs' });
    fireEvent.click(screen.getByRole('button', { name: 'Sair sem trocar' }));
    expect(await screen.findByText('tela-de-login')).toBeTruthy();
  });
});
