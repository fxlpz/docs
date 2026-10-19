import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.js';
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

const authedUser = {
  id: 'u1',
  username: 'felipe.rosa',
  displayName: 'Felipe Rosa',
  role: 'admin',
  hasAvatar: false,
};

function withAuth(children: React.JSX.Element): React.JSX.Element {
  return (
    <MemoryRouter>
      <AuthProvider>
        <TreeRefreshProvider>{children}</TreeRefreshProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

/** fetch mock que também responde /api/auth/me (TreePanel usa useAuth). */
function stubFetch(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  calls?: string[],
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls?.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).includes('/api/auth/me')) {
        return jsonResponse({ user: authedUser, mustChangePassword: false });
      }
      return fetchImpl(input, init);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TreePanel', () => {
  test('carrega e exibe a árvore vinda da API', async () => {
    stubFetch(async () => jsonResponse({ nodes: treeNodes }));
    render(withAuth(<TreePanel />));
    expect(await screen.findByText('Runbooks')).toBeTruthy();
    // Filho visível: pasta expandida por padrão? Não — o estado inicia recolhido,
    // mas o nó raiz sempre renderiza.
    expect(screen.getByRole('navigation', { name: 'Árvore de páginas' })).toBeTruthy();
  });

  test('exibe estado vazio quando não há itens', async () => {
    stubFetch(async () => jsonResponse({ nodes: [] }));
    render(withAuth(<TreePanel />));
    expect(await screen.findByText(/Nenhum conteúdo ainda/i)).toBeTruthy();
  });

  test('mostra alerta quando a API falha', async () => {
    stubFetch(async () =>
      jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } }, 500),
    );
    // Árvore falha, mas a sessão continua válida (AuthProvider não cai)
    render(withAuth(<TreePanel />));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Erro interno.');
  });

  function renderTree(
    fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ): {
    calls: string[];
  } {
    const calls: string[] = [];
    stubFetch(fetchImpl, calls);
    render(withAuth(<TreePanel />));
    return { calls };
  }

  test('expande pasta e mostra o filho', async () => {
    renderTree(async (input) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      return jsonResponse({ nodes: treeNodes });
    });
    expect(await screen.findByText('Runbooks')).toBeTruthy();
    expect(screen.queryByText('Reset de senha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pasta' }));
    expect(await screen.findByText('Reset de senha')).toBeTruthy();
  });

  test('criar pasta chama POST e entra em renomeação', async () => {
    const created = {
      id: 'novo',
      type: 'folder',
      parentId: null,
      title: '',
      icon: null,
      position: 1,
      updatedAt: '2026-10-07T12:00:00.000Z',
    };
    renderTree(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url === '/api/nodes' && init?.method === 'POST') {
        return jsonResponse(created, 201);
      }
      return jsonResponse({ nodes: [...treeNodes, created] });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Nova pasta' }));
    // Entra em modo de renomeação do item criado
    expect(await screen.findByLabelText('Novo título')).toBeTruthy();
  });

  test('renomear inline envia PATCH ao confirmar com Enter', async () => {
    const { calls } = renderTree(async (input) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      return jsonResponse({ nodes: treeNodes });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Expandir pasta' }));
    const link = await screen.findByText('Reset de senha');
    fireEvent.doubleClick(link);
    const field = await screen.findByLabelText('Novo título');
    fireEvent.change(field, { target: { value: 'Reset de senha v2' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(calls.some((call) => call.includes('PATCH') && call.includes('/api/nodes/n2'))).toBe(
        true,
      ),
    );
  });

  test('excluir com confirmação chama DELETE; sem confirmação não chama', async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);
    const { calls } = renderTree(async (input) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      return jsonResponse({ nodes: treeNodes });
    });
    await screen.findByText('Runbooks');
    fireEvent.click(screen.getAllByRole('button', { name: 'Excluir' })[0] as HTMLElement);
    await waitFor(() =>
      expect(calls.some((call) => call.includes('DELETE') && call.includes('/api/nodes/n1'))).toBe(
        true,
      ),
    );

    cleanup();
    confirmMock.mockReturnValue(false);
    const second = renderTree(async (input) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      return jsonResponse({ nodes: treeNodes });
    });
    await screen.findByText('Runbooks');
    fireEvent.click(screen.getAllByRole('button', { name: 'Excluir' })[0] as HTMLElement);
    await screen.findByText('Runbooks');
    expect(second.calls.some((call) => call.includes('DELETE'))).toBe(false);
  });

  test('favoritos aparecem no topo', async () => {
    renderTree(async (input) => {
      const url = String(input);
      if (url.includes('/api/favorites')) {
        return jsonResponse({
          favorites: [{ nodeId: 'n2', title: 'Reset de senha', type: 'page', position: 0 }],
        });
      }
      return jsonResponse({ nodes: treeNodes });
    });
    expect(await screen.findByText('Favoritos')).toBeTruthy();
    expect(screen.getByText('Reset de senha')).toBeTruthy();
  });

  test('admin vê o toggle de visibilidade; membro não vê', async () => {
    renderTree(async (input) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      return jsonResponse({ nodes: treeNodes });
    });
    expect(await screen.findByLabelText('Tornar público')).toBeTruthy();

    cleanup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse({
            user: { ...authedUser, role: 'member' },
            mustChangePassword: false,
          });
        }
        if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
        return jsonResponse({ nodes: treeNodes });
      }),
    );
    render(withAuth(<TreePanel />));
    await screen.findByText('Runbooks');
    expect(screen.queryByLabelText('Tornar público')).toBeNull();
    expect(screen.queryByLabelText('Tornar privado')).toBeNull();
  });

  test('tornar página pública chama a API sem cascata', async () => {
    const bodies: unknown[] = [];
    renderTree(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/visibility')) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ...treeNodes[1], visibility: 'public' });
      }
      return jsonResponse({ nodes: treeNodes });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Expandir pasta' }));
    const toggles = await screen.findAllByLabelText('Tornar público');
    // [0] = pasta, [1] = página filha
    fireEvent.click(toggles[1] as HTMLElement);
    await waitFor(() =>
      expect(
        bodies.some(
          (body) =>
            (body as { visibility?: string }).visibility === 'public' &&
            (body as { cascade?: boolean }).cascade === false,
        ),
      ).toBe(true),
    );
  });

  test('pasta pública pergunta cascata: OK publica tudo, Cancelar só a pasta', async () => {
    const bodies: unknown[] = [];
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);
    renderTree(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/visibility')) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ...treeNodes[0], visibility: 'public' });
      }
      return jsonResponse({ nodes: treeNodes });
    });
    fireEvent.click(await screen.findByLabelText('Tornar público'));
    await waitFor(() =>
      expect(bodies.some((body) => (body as { cascade?: boolean }).cascade === true)).toBe(true),
    );

    cleanup();
    confirmMock.mockReturnValue(false);
    const bodies2: unknown[] = [];
    stubFetch(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/visibility')) {
        bodies2.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ...treeNodes[0], visibility: 'public' });
      }
      return jsonResponse({ nodes: treeNodes });
    });
    render(withAuth(<TreePanel />));
    await screen.findByText('Runbooks');
    fireEvent.click(screen.getAllByLabelText('Tornar público')[0] as HTMLElement);
    await waitFor(() =>
      expect(
        bodies2.some(
          (body) =>
            (body as { visibility?: string }).visibility === 'public' &&
            (body as { cascade?: boolean }).cascade === false,
        ),
      ).toBe(true),
    );
  });

  function fakeTransfer(): {
    setData: (type: string, value: string) => void;
    getData: (type: string) => string;
    types: string[];
    effectAllowed: string;
    dropEffect: string;
  } {
    const store = new Map<string, string>();
    return {
      setData: (type: string, value: string) => {
        store.set(type, value);
      },
      getData: (type: string) => store.get(type) ?? '',
      types: ['text/krndocs-node'],
      effectAllowed: 'none',
      dropEffect: 'none',
    };
  }

  /**
   * Dispara drop com clientY controlado (o jsdom descarta clientY no Event
   * genérico; sem isso a razão dá NaN e a posição é indeterminada).
   */
  function fireDrop(target: HTMLElement, clientY: number, transfer: object): void {
    const event = createEvent.drop(target, { dataTransfer: transfer });
    Object.defineProperty(event, 'clientY', { value: clientY, configurable: true });
    fireEvent(target, event);
  }

  function rowOf(title: string): HTMLElement {
    const titleEl = screen.getByText(title);
    const row = titleEl.closest('div[draggable="true"]');
    if (!(row instanceof HTMLElement)) throw new Error(`linha arrastável não encontrada: ${title}`);
    return row;
  }

  test('arrastar página para dentro da pasta move (into)', async () => {
    const bodies: unknown[] = [];
    const { calls } = renderTree(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/nodes/n3/move')) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ...treeNodes[1], id: 'n3' });
      }
      return jsonResponse({
        nodes: [...treeNodes, { ...treeNodes[1], id: 'n3', parentId: null, title: 'Solta' }],
      });
    });
    await screen.findByText('Runbooks');
    const transfer = fakeTransfer();
    fireEvent.dragStart(rowOf('Solta'), { dataTransfer: transfer });
    transfer.setData('text/krndocs-node', 'n3');
    // Meio da pasta (ratio 0.5) = soltar DENTRO
    fireDrop(rowOf('Runbooks'), 0.5, transfer);
    await waitFor(() =>
      expect(
        bodies.some(
          (body) =>
            (body as { parentId?: string }).parentId === 'n1' &&
            (body as { beforeId?: string | null }).beforeId === null,
        ),
      ).toBe(true),
    );
    expect(calls.some((call) => call.includes('POST') && call.includes('/nodes/n3/move'))).toBe(
      true,
    );
  });

  test('arrastar para o topo da linha move para antes (before)', async () => {
    const bodies: unknown[] = [];
    renderTree(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/nodes/n1/move')) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse(treeNodes[0]);
      }
      return jsonResponse({ nodes: treeNodes });
    });
    await screen.findByText('Runbooks');
    const transfer = fakeTransfer();
    fireEvent.dragStart(rowOf('Runbooks'), { dataTransfer: transfer });
    transfer.setData('text/krndocs-node', 'n1');
    // Topo da linha (ratio 0) = antes do alvo (raiz)
    fireDrop(rowOf('Runbooks'), 0, transfer);
    // Soltar sobre si mesmo não chama a API
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bodies).toHaveLength(0);
  });

  test('soltar no fundo da barra move para a raiz', async () => {
    const bodies: unknown[] = [];
    renderTree(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/nodes/n2/move')) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse(treeNodes[1]);
      }
      return jsonResponse({ nodes: treeNodes });
    });
    await screen.findByText('Runbooks');
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pasta' }));
    const transfer = fakeTransfer();
    fireEvent.dragStart(rowOf('Reset de senha'), { dataTransfer: transfer });
    transfer.setData('text/krndocs-node', 'n2');
    const nav = screen.getByRole('navigation', { name: 'Árvore de páginas' });
    fireEvent.drop(nav, { dataTransfer: transfer });
    await waitFor(() =>
      expect(
        bodies.some(
          (body) =>
            (body as { parentId?: string | null }).parentId === null &&
            (body as { beforeId?: string | null }).beforeId === null,
        ),
      ).toBe(true),
    );
  });
});
