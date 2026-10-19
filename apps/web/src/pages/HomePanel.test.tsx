import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.js';
import { formatLongDate } from '../lib/time.js';
import { HomePanel } from './HomePanel.js';

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

const tree = {
  nodes: [
    {
      id: 'f1',
      type: 'folder',
      parentId: null,
      title: 'Guias',
      icon: null,
      position: 0,
      visibility: 'public',
      updatedAt: '2026-10-06T12:00:00.000Z',
    },
    {
      id: 'p1',
      type: 'page',
      parentId: 'f1',
      title: 'Doc A',
      icon: null,
      position: 0,
      visibility: 'private',
      updatedAt: '2026-10-07T12:00:00.000Z',
    },
    {
      id: 'p2',
      type: 'page',
      parentId: null,
      title: 'Doc B',
      icon: null,
      position: 1,
      visibility: 'private',
      updatedAt: '2026-10-05T12:00:00.000Z',
    },
  ],
};

const favorites = {
  favorites: [{ nodeId: 'p2', title: 'Doc B', type: 'page', position: 0 }],
};

const templates = {
  templates: [
    {
      nodeId: 't1',
      name: 'Runbook',
      category: 'Operações',
      description: null,
      position: 0,
      pageTitle: 'Runbook de incidentes',
      icon: '🚨',
    },
  ],
};

/** Mock com rotas explícitas: auth, árvore, favoritos e modelos. */
function stubFetch(nodes = tree.nodes): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return jsonResponse({ user, mustChangePassword: false });
      }
      if (url.includes('/api/favorites')) {
        return jsonResponse(favorites);
      }
      if (url.includes('/api/templates')) {
        return jsonResponse(templates);
      }
      return jsonResponse({ nodes });
    }),
  );
}

function renderHome(): void {
  stubFetch();
  render(
    <MemoryRouter initialEntries={['/app']}>
      <AuthProvider>
        <Routes>
          <Route path="/app" element={<HomePanel />} />
          <Route path="/app/p/:id" element={<div>pagina</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HomePanel', () => {
  test('saúda pelo nome e mostra estatísticas reais', async () => {
    renderHome();
    // Saudação + data por extenso no topo
    expect(await screen.findByText(/, Felipe Rosa/)).toBeTruthy();
    expect(screen.getAllByText(formatLongDate()).length).toBeGreaterThan(0);
    // 2 páginas, 1 pasta, 1 publicada, 1 modelo, 1 favorito
    expect(screen.getByText('2')).toBeTruthy();
    for (const label of ['Páginas', 'Pastas', 'Publicadas', 'Modelos', 'Favoritos']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  test('lista recentes com caminho, link e atalhos', async () => {
    renderHome();
    // Doc A (mais recente) antes de Doc B, com o caminho da pasta
    const linkA = await screen.findByRole('link', { name: /Doc A/ });
    expect(linkA.getAttribute('href')).toBe('/app/p/p1');
    expect(screen.getByText('Guias')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Modelos/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Lixeira/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Buscar na documentação/ })).toBeTruthy();
    // Papel admin: atalho de usuários
    expect(screen.getByRole('link', { name: /Usuários/ })).toBeTruthy();
    // Favorito (Doc B) com link direto, dentro da seção de favoritos
    const favSection = screen.getByRole('heading', { name: 'Favoritos' }).closest('section');
    expect(favSection).toBeTruthy();
    const fav = within(favSection as HTMLElement).getByRole('link');
    expect(fav.textContent).toContain('Doc B');
    expect(fav.getAttribute('href')).toBe('/app/p/p2');
  });

  test('vazio mostra orientação sem dados fictícios', async () => {
    stubFetch([]);
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AuthProvider>
          <Routes>
            <Route path="/app" element={<HomePanel />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Nenhuma página ainda/)).toBeTruthy();
    expect(screen.queryByText('Doc A')).toBeNull();
    // Sem páginas: resumo deixa claro que está vazio
    expect(screen.getByText(/Ainda não há páginas aqui/)).toBeTruthy();
  });
});
