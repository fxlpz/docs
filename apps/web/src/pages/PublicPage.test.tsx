import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PublicPage } from './PublicPage.js';

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: () => ({ document: [] }),
}));

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="bn-readonly" />,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const publicDetail = {
  id: 'p1',
  type: 'page',
  parentId: null,
  title: 'Guia aberto',
  icon: null,
  position: 0,
  updatedAt: '2026-10-07T12:00:00.000Z',
  content: [{ type: 'paragraph', content: 'Leia à vontade.' }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPublic(fetchImpl: (input: RequestInfo | URL) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => fetchImpl(input)),
  );
  render(
    <MemoryRouter initialEntries={['/pub/p1']}>
      <Routes>
        <Route path="/pub/:id" element={<PublicPage />} />
        <Route path="/" element={<div>inicio</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicPage (somente leitura)', () => {
  test('exibe título e conteúdo sem nenhum controle de edição', async () => {
    renderPublic(async (input) => {
      const url = String(input);
      if (url.includes('/attachments')) return jsonResponse({ attachments: [] });
      return jsonResponse(publicDetail);
    });
    expect(await screen.findByText('Guia aberto')).toBeTruthy();
    expect(screen.getByTestId('bn-readonly')).toBeTruthy();
    // Zero controles de escrita (só o toggle de tema, que não edita nada)
    expect(screen.queryByRole('button', { name: 'Baixar' })).toBeNull();
    expect(screen.queryByLabelText('Título da página')).toBeNull();
    expect(screen.queryByText('Salvar')).toBeNull();
    expect(screen.queryByText('Excluir')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tema escuro' })).toBeTruthy();
  });

  test('lista anexos com download', async () => {
    renderPublic(async (input) => {
      const url = String(input);
      if (url.includes('/attachments')) {
        return jsonResponse({
          attachments: [
            { id: 'a1', originalName: 'guia.pdf', mime: 'application/pdf', sizeBytes: 10 },
          ],
        });
      }
      return jsonResponse(publicDetail);
    });
    expect(await screen.findByText('guia.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeTruthy();
  });

  test('página inexistente mostra erro com volta ao início', async () => {
    renderPublic(async () =>
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Página não encontrada.' } }, 404),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Voltar/ })).toBeTruthy();
  });
});
