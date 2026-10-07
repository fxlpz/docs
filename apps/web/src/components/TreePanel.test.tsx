import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TreePanel, TreeRefreshProvider } from './TreePanel.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const treeNodes = [
  {
    id: 'n1',
    type: 'folder',
    parentId: null,
    title: 'Runbooks',
    icon: null,
    position: 0,
    updatedAt: '2026-10-06T12:00:00.000Z',
  },
  {
    id: 'n2',
    type: 'page',
    parentId: 'n1',
    title: 'Reset de senha',
    icon: null,
    position: 0,
    updatedAt: '2026-10-06T12:00:00.000Z',
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TreePanel', () => {
  test('carrega e exibe a árvore vinda da API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ nodes: treeNodes })),
    );
    render(
      <MemoryRouter>
        <TreeRefreshProvider>
          <TreePanel />
        </TreeRefreshProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Runbooks')).toBeTruthy();
    // Filho visível: pasta expandida por padrão? Não — o estado inicia recolhido,
    // mas o nó raiz sempre renderiza.
    expect(screen.getByRole('navigation', { name: 'Árvore de páginas' })).toBeTruthy();
  });

  test('exibe estado vazio quando não há itens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ nodes: [] })),
    );
    render(
      <MemoryRouter>
        <TreeRefreshProvider>
          <TreePanel />
        </TreeRefreshProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Nenhum conteúdo ainda/i)).toBeTruthy();
  });

  test('mostra alerta quando a API falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } }, 500),
      ),
    );
    render(
      <MemoryRouter>
        <TreeRefreshProvider>
          <TreePanel />
        </TreeRefreshProvider>
      </MemoryRouter>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Erro interno.');
  });
});
