import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TreeRefreshProvider } from '../components/TreePanel.js';
import { TrashPage } from './TrashPage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const trashNodes = [
  {
    id: 'n1',
    type: 'page',
    parentId: null,
    title: 'Excluída',
    icon: null,
    position: 0,
    updatedAt: '2026-10-06T12:00:00.000Z',
    deletedAt: '2026-10-07T10:00:00.000Z',
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTrash(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => fetchImpl(input, init)),
  );
  render(
    <MemoryRouter initialEntries={['/lixeira']}>
      <TreeRefreshProvider>
        <Routes>
          <Route path="/lixeira" element={<TrashPage />} />
        </Routes>
      </TreeRefreshProvider>
    </MemoryRouter>,
  );
}

describe('TrashPage', () => {
  test('lista itens da lixeira', async () => {
    renderTrash(async () => jsonResponse({ nodes: trashNodes }));
    expect(await screen.findByText('Excluída')).toBeTruthy();
    expect(screen.getByText(/Excluído em/)).toBeTruthy();
  });

  test('lixeira vazia informa', async () => {
    renderTrash(async () => jsonResponse({ nodes: [] }));
    expect(await screen.findByText('Lixeira vazia.')).toBeTruthy();
  });

  test('restaurar chama a API e recarrega', async () => {
    const calls: string[] = [];
    renderTrash(async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).includes('/restore')) return jsonResponse({ ok: true });
      return jsonResponse({ nodes: trashNodes });
    });
    fireEvent.click(await screen.findByText('Restaurar'));
    await screen.findByText('Excluída');
    expect(calls.some((call) => call.includes('POST') && call.includes('/restore'))).toBe(true);
  });

  test('exclusão definitiva exige dois passos e usa ?confirm=true', async () => {
    const calls: string[] = [];
    let nodes: unknown[] = [...trashNodes];
    renderTrash(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/permanent')) {
        nodes = [];
        return new Response(null, { status: 204 }) as unknown as Response;
      }
      return jsonResponse({ nodes });
    });
    fireEvent.click(await screen.findByText('Excluir para sempre'));
    // Primeiro passo só arma a confirmação (nada chamado ainda)
    expect(calls.some((call) => call.includes('/permanent'))).toBe(false);
    fireEvent.click(await screen.findByText('Confirmar exclusão definitiva'));
    expect(calls.some((call) => call.includes('DELETE') && call.includes('?confirm=true'))).toBe(
      true,
    );
    expect(await screen.findByText('Lixeira vazia.')).toBeTruthy();
  });
});
