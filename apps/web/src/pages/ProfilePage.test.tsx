import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.js';
import { ProfilePage } from './ProfilePage.js';

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
  role: 'member',
  hasAvatar: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderProfile(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): {
  calls: Array<{ method: string; url: string; body: string }>;
} {
  const calls: Array<{ method: string; url: string; body: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(input),
        body: String(init?.body ?? ''),
      });
      return fetchImpl(input, init);
    }),
  );
  render(
    <MemoryRouter initialEntries={['/app/perfil']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/perfil" element={<ProfilePage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { calls };
}

const authed =
  async (extra?: (url: string) => Promise<Response>) =>
  async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes('/api/auth/me')) return jsonResponse({ user, mustChangePassword: false });
    if (extra) return extra(url);
    return jsonResponse({});
  };

describe('ProfilePage', () => {
  test('exibe dados imutáveis e permite trocar o nome', async () => {
    const { calls } = renderProfile(
      await authed(async (url) => {
        if (url.includes('/api/users/me')) {
          return jsonResponse({ ...user, displayName: 'Felipe R.' });
        }
        return jsonResponse({});
      }),
    );
    expect(await screen.findByText('felipe.rosa')).toBeTruthy();
    expect(screen.getByText('Usuário padrão')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Nome de exibição'), {
      target: { value: 'Felipe R.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === 'PATCH' && call.url.includes('/api/users/me')),
      ).toBe(true),
    );
    expect(await screen.findByText('Nome atualizado.')).toBeTruthy();
  });

  test('troca de senha valida confirmação e mínimo localmente', async () => {
    const { calls } = renderProfile(await authed());
    await screen.findByText('felipe.rosa');
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'atual-123' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'nova-123' } });
    fireEvent.change(screen.getByLabelText('Repita a nova senha'), {
      target: { value: 'outra-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText(/não coincidem/)).toBeTruthy();
    expect(calls.some((call) => call.url.includes('/change-password'))).toBe(false);
  });

  test('troca de senha bem-sucedida limpa o formulário', async () => {
    renderProfile(
      await authed(async (url) => {
        if (url.includes('/change-password')) return jsonResponse({ ok: true });
        return jsonResponse({});
      }),
    );
    await screen.findByText('felipe.rosa');
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'atual-123' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), {
      target: { value: 'senha-nova-99' },
    });
    fireEvent.change(screen.getByLabelText('Repita a nova senha'), {
      target: { value: 'senha-nova-99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText('Senha alterada com sucesso.')).toBeTruthy();
  });

  test('alerta quando a senha ainda é provisória', async () => {
    renderProfile(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return jsonResponse({ user, mustChangePassword: true });
      }
      return jsonResponse({});
    });
    expect(await screen.findByText(/provisória/)).toBeTruthy();
  });

  test('envia foto e mostra estado, depois remove', async () => {
    let avatar = false;
    const { calls } = renderProfile(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return jsonResponse({ user: { ...user, hasAvatar: avatar }, mustChangePassword: false });
      }
      if (url.includes('/api/users/me/avatar')) {
        if ((init?.method ?? 'GET') === 'DELETE') {
          avatar = false;
          return jsonResponse({ ok: true });
        }
        avatar = true;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    });
    await screen.findByText('felipe.rosa');

    const file = new File(['bytes'], 'foto.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Enviar foto de perfil'), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === 'POST' && call.url.includes('/api/users/me/avatar')),
      ).toBe(true),
    );
    expect(await screen.findByText('Foto atualizada.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === 'DELETE' && call.url.includes('/api/users/me/avatar')),
      ).toBe(true),
    );
    expect(await screen.findByText('Foto removida.')).toBeTruthy();
  });

  test('erro no envio mostra mensagem do servidor', async () => {
    renderProfile(
      await authed(async (url) => {
        if (url.includes('/api/users/me/avatar')) {
          return jsonResponse(
            { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Envie uma imagem.' } },
            400,
          );
        }
        return jsonResponse({});
      }),
    );
    await screen.findByText('felipe.rosa');
    const file = new File(['x'], 'doc.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Enviar foto de perfil'), {
      target: { files: [file] },
    });
    expect(await screen.findByText('Envie uma imagem.')).toBeTruthy();
  });
});
