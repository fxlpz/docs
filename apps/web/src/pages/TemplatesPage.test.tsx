import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TemplatesPage } from './TemplatesPage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const templates = [
  {
    nodeId: 't1',
    name: 'Checklist',
    category: 'Operação',
    description: 'Modelo de checklist',
    position: 0,
    pageTitle: 'Checklist base',
    icon: '✅',
  },
];

function PageMarker(): React.JSX.Element {
  const { id } = useParams();
  return <div>{`pagina-${id}`}</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TemplatesPage', () => {
  test('lista modelos por categoria e cria página navegando até ela', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/templates/t1/pages')) {
          return jsonResponse(
            {
              id: 'nova1',
              type: 'page',
              parentId: null,
              title: 'Checklist',
              icon: null,
              position: 0,
              updatedAt: '2026-10-07T12:00:00.000Z',
            },
            201,
          );
        }
        return jsonResponse({ templates });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/modelos']}>
        <Routes>
          <Route path="/modelos" element={<TemplatesPage />} />
          <Route path="/app/p/:id" element={<PageMarker />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Operação')).toBeTruthy();
    expect(screen.getByText('Checklist')).toBeTruthy();
    // Ícone (emoji) do modelo aparece na lista, como no Notion.
    expect(screen.getByText('✅')).toBeTruthy();
    fireEvent.click(screen.getByText('Nova página deste modelo'));
    expect(await screen.findByText('pagina-nova1')).toBeTruthy();
  });

  test('remover da lista chama DELETE e a página não some da lista de novo', async () => {
    let list = templates;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
        const url = String(input);
        const method = options.method ?? 'GET';
        calls.push(`${method} ${url}`);
        if (method === 'DELETE' && url.includes('/api/templates/t1')) {
          list = [];
          return jsonResponse(null, 204);
        }
        if (method === 'DELETE') return jsonResponse(null, 204);
        if (method === 'POST' && url.includes('/api/templates/defaults')) {
          return jsonResponse({ templates });
        }
        return jsonResponse({ templates: list });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/modelos']}>
        <Routes>
          <Route path="/modelos" element={<TemplatesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Checklist')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remover da lista/ }));
    expect(await screen.findByText(/saiu da lista/)).toBeTruthy();
    expect(calls).toContain('DELETE /api/templates/t1');
    // Lista recarregada sem o modelo removido
    expect(await screen.findByText('Nenhum modelo ainda.')).toBeTruthy();
  });

  test('excluir página chama DELETE do nó (lixeira) e restaurar usa POST', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
        const url = String(input);
        const method = options.method ?? 'GET';
        calls.push(`${method} ${url}`);
        if (method === 'DELETE') return jsonResponse(null, 204);
        if (method === 'POST' && url.includes('/api/templates/defaults')) {
          return jsonResponse({ templates });
        }
        return jsonResponse({ templates });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/modelos']}>
        <Routes>
          <Route path="/modelos" element={<TemplatesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Checklist')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Excluir página/ }));
    expect(await screen.findByText(/movida para a lixeira/)).toBeTruthy();
    expect(calls).toContain('DELETE /api/nodes/t1');

    fireEvent.click(screen.getByRole('button', { name: /Restaurar modelos padrão/ }));
    expect(await screen.findByText('Modelos padrão restaurados.')).toBeTruthy();
    expect(calls).toContain('POST /api/templates/defaults');
  });

  test('sem modelos informa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ templates: [] })),
    );
    render(
      <MemoryRouter initialEntries={['/modelos']}>
        <Routes>
          <Route path="/modelos" element={<TemplatesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nenhum modelo ainda.')).toBeTruthy();
  });
});
