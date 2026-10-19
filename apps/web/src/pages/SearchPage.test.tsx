import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SearchPage } from './SearchPage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSearch(query: string): void {
  render(
    <MemoryRouter initialEntries={[`/buscar?q=${encodeURIComponent(query)}`]}>
      <Routes>
        <Route path="/buscar" element={<SearchPage />} />
        <Route path="/p/:id" element={<div>pagina</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SearchPage', () => {
  test('exibe resultados com link e snippet como texto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          query: 'firewall',
          results: [
            {
              nodeId: 'n1',
              title: 'Runbook <b>firewall</b>',
              snippet: 'trecho com <tag>',
              rank: -1,
            },
          ],
        }),
      ),
    );
    renderSearch('firewall');
    expect(await screen.findByText('Runbook <b>firewall</b>')).toBeTruthy();
    // Snippet renderizado como texto (sem interpretar HTML)
    const snippet = screen.getByText('trecho com <tag>');
    expect(snippet.tagName).toBe('P');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/app/p/n1');
  });

  test('sem termo mostra orientação', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ query: '', results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    renderSearch('');
    expect(await screen.findByText(/caixa de busca/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sem resultados informa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ query: 'zzz', results: [] })),
    );
    renderSearch('zzz');
    expect(await screen.findByText('Nenhum resultado.')).toBeTruthy();
  });

  test('erro da API vira alerta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } }, 500),
      ),
    );
    renderSearch('x');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
