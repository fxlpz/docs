import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LandingPage } from './LandingPage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const publicNodes = [
  {
    id: 'f1',
    type: 'folder',
    parentId: null,
    title: 'Guias',
    icon: null,
    position: 0,
    updatedAt: '2026-10-07T12:00:00.000Z',
  },
  {
    id: 'p1',
    type: 'page',
    parentId: 'f1',
    title: 'Guia aberto',
    icon: null,
    position: 0,
    updatedAt: '2026-10-07T12:00:00.000Z',
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLanding(fetchImpl: (input: RequestInfo | URL) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => fetchImpl(input)),
  );
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/pub/:id" element={<div>leitor</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LandingPage (pública, sem login)', () => {
  test('exibe árvore pública e botão Entrar sem pedir sessão', async () => {
    const calls: string[] = [];
    renderLanding(async (input) => {
      calls.push(String(input));
      return jsonResponse({ nodes: publicNodes });
    });
    expect(await screen.findByText('Guias')).toBeTruthy();
    expect(await screen.findByText('Guia aberto')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeTruthy();
    // Nenhuma chamada autenticada: só a árvore pública
    expect(calls).toEqual(['/api/public/tree']);
    expect(calls.some((call) => call.includes('/api/auth/'))).toBe(false);
  });

  test('hero apresenta marca, selos e busca em destaque', async () => {
    renderLanding(async () => jsonResponse({ nodes: publicNodes }));
    expect(
      await screen.findByRole('heading', { name: /Documentação pública da Kernel Solutions/ }),
    ).toBeTruthy();
    expect(screen.getByText('Acesso livre')).toBeTruthy();
    expect(screen.getByText('Sem cadastro')).toBeTruthy();
    expect(screen.getByText('Somente leitura')).toBeTruthy();
    // 1 página publicada no selo do hero
    expect(screen.getByText('1 documento')).toBeTruthy();
    // Pasta-raiz vira cartão com contagem de documentos
    expect(screen.getByText('1 doc')).toBeTruthy();
    expect(screen.getByLabelText('Buscar nos documentos públicos')).toBeTruthy();
  });

  test('estado vazio amigável convida ao login', async () => {
    renderLanding(async () => jsonResponse({ nodes: [] }));
    expect(await screen.findByText('Nenhum documento público ainda')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'faça login' })).toBeTruthy();
  });

  test('busca pública lista resultados navegáveis', async () => {
    renderLanding(async (input) => {
      const url = String(input);
      if (url.includes('/api/public/search')) {
        return jsonResponse({
          query: 'guia',
          results: [{ nodeId: 'p1', title: 'Guia aberto', snippet: 'trecho', rank: -1 }],
        });
      }
      return jsonResponse({ nodes: publicNodes });
    });
    fireEvent.change(screen.getByLabelText('Buscar nos documentos públicos'), {
      target: { value: 'guia' },
    });
    // Nome do link inclui o título (+ trecho de contexto exibido)
    const link = await screen.findByRole('link', { name: /Guia aberto/ });
    expect(link.getAttribute('href')).toBe('/pub/p1');
  });

  test('falha da API vira alerta sem quebrar a página', async () => {
    renderLanding(async () =>
      jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } }, 500),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    // Entrar continua disponível
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeTruthy();
  });
});
