import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TreeRefreshProvider } from '../components/TreePanel.js';
import { PagePanel } from './PagePanel.js';

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: () => ({ document: [] }),
  useEditorChange: () => {},
  useEditorSelectionChange: () => {},
}));

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="bn-view" />,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const detail = {
  id: 'p1',
  type: 'page',
  parentId: null,
  title: 'Documento',
  icon: null,
  position: 0,
  updatedAt: '2026-10-07T12:00:00.000Z',
  version: 1,
  content: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): {
  calls: string[];
} {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return fetchImpl(input, init);
    }),
  );
  render(
    <MemoryRouter initialEntries={['/p/p1']}>
      <TreeRefreshProvider>
        <Routes>
          <Route path="/p/:id" element={<PagePanel />} />
        </Routes>
      </TreeRefreshProvider>
    </MemoryRouter>,
  );
  return { calls };
}

describe('PagePanel (favoritos, anexos, histórico, modelo)', () => {
  test('carrega título, favorito vazio e anexos vazios', async () => {
    renderPage(async (input) => {
      const url = String(input);
      if (url.includes('/api/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/attachments')) return jsonResponse({ attachments: [] });
      return jsonResponse(detail);
    });
    expect(await screen.findByLabelText('Título da página')).toBeTruthy();
    expect(screen.getByLabelText('Adicionar aos favoritos')).toBeTruthy();
    expect(screen.getByText(/Nenhum anexo/)).toBeTruthy();
  });

  test('favoritar chama POST e alterna o botão', async () => {
    let favorite = false;
    const { calls } = renderPage(async (input, init) => {
      const url = String(input);
      if (url === '/api/favorites' && init?.method !== 'POST') {
        return jsonResponse({ favorites: favorite ? [{ nodeId: 'p1' }] : [] });
      }
      if (url === '/api/favorites' && init?.method === 'POST') {
        favorite = true;
        return jsonResponse({
          favorites: [{ nodeId: 'p1', title: 'Documento', type: 'page', position: 0 }],
        });
      }
      if (url.includes('/attachments')) return jsonResponse({ attachments: [] });
      return jsonResponse(detail);
    });
    fireEvent.click(await screen.findByLabelText('Adicionar aos favoritos'));
    await waitFor(() => expect(screen.getByLabelText('Remover dos favoritos')).toBeTruthy());
    expect(calls.some((call) => call.startsWith('POST /api/favorites'))).toBe(true);
  });

  test('histórico lista versões e restaura com confirmação', async () => {
    vi.stubGlobal('confirm', () => true);
    const { calls } = renderPage(async (input, _init) => {
      const url = String(input);
      if (url.includes('/versions/restore')) {
        return jsonResponse({ version: 3, updatedAt: '2026-10-07T12:00:00.000Z' });
      }
      if (url.includes('/versions')) {
        return jsonResponse({
          versions: [
            {
              version: 2,
              titleSnapshot: 'Documento',
              source: 'manual',
              byteSize: 10,
              createdAt: '2026-10-07T12:00:00.000Z',
              createdByName: 'Felipe Rosa',
            },
          ],
        });
      }
      if (url.includes('/favorites') || url.includes('/attachments')) {
        return jsonResponse(url.includes('favorites') ? { favorites: [] } : { attachments: [] });
      }
      return jsonResponse(detail);
    });
    fireEvent.click(await screen.findByText('Ver histórico'));
    expect(await screen.findByText('v2')).toBeTruthy();
    fireEvent.click(screen.getByText('Restaurar esta'));
    await waitFor(() =>
      expect(
        calls.some((call) => call.includes('POST') && call.includes('/versions/restore')),
      ).toBe(true),
    );
  });

  test('salvar como modelo envia o nome', async () => {
    const { calls } = renderPage(async (input, _init) => {
      const url = String(input);
      if (url.includes('/make-template')) return jsonResponse({ templates: [] });
      if (url.includes('/favorites') || url.includes('/attachments')) {
        return jsonResponse(url.includes('favorites') ? { favorites: [] } : { attachments: [] });
      }
      return jsonResponse(detail);
    });
    fireEvent.click(await screen.findByText('Salvar como modelo'));
    fireEvent.change(screen.getByLabelText('Nome do modelo'), {
      target: { value: 'Checklist' },
    });
    fireEvent.click(screen.getByText('Salvar modelo'));
    await waitFor(() =>
      expect(calls.some((call) => call.includes('POST') && call.includes('/make-template'))).toBe(
        true,
      ),
    );
    expect(await screen.findByText('Página salva como modelo.')).toBeTruthy();
  });

  test('renomear no blur envia PATCH com o título novo', async () => {
    const { calls } = renderPage(async (input, init) => {
      const url = String(input);
      if (url.includes('/favorites') || url.includes('/attachments')) {
        return jsonResponse(url.includes('favorites') ? { favorites: [] } : { attachments: [] });
      }
      if (init?.method === 'PATCH') {
        return jsonResponse({ ...detail, title: 'Documento renomeado' });
      }
      return jsonResponse(detail);
    });
    const title = await screen.findByLabelText('Título da página');
    fireEvent.change(title, { target: { value: 'Documento renomeado' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(calls.some((call) => call.includes('PATCH') && call.includes('/api/nodes/p1'))).toBe(
        true,
      ),
    );
  });

  test('upload envia FormData e atualiza a lista', async () => {
    let uploaded = false;
    renderPage(async (input, init) => {
      const url = String(input);
      if (url.includes('/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/attachments') && init?.method === 'POST') {
        uploaded = true;
        expect(init.body instanceof FormData).toBe(true);
        return jsonResponse(
          {
            id: 'a1',
            nodeId: 'p1',
            originalName: 'nota.txt',
            mime: 'text/plain',
            sizeBytes: 4,
            sha256: 'a'.repeat(64),
            uploadedAt: '2026-10-07T12:00:00.000Z',
          },
          201,
        );
      }
      if (url.includes('/attachments')) {
        return jsonResponse({
          attachments: uploaded
            ? [
                {
                  id: 'a1',
                  nodeId: 'p1',
                  originalName: 'nota.txt',
                  mime: 'text/plain',
                  sizeBytes: 4,
                  sha256: 'a'.repeat(64),
                  uploadedAt: '2026-10-07T12:00:00.000Z',
                },
              ]
            : [],
        });
      }
      return jsonResponse(detail);
    });
    const file = new File(['upan'], 'nota.txt', { type: 'text/plain' });
    fireEvent.change(await screen.findByLabelText('Enviar anexo'), {
      target: { files: [file] },
    });
    expect(await screen.findByText('nota.txt')).toBeTruthy();
  });

  test('download usa blob com o nome original', async () => {
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = ((_blob: Blob) => {
      createdUrls.push('blob:fake');
      return 'blob:fake';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revokedUrls.push(url);
    }) as typeof URL.revokeObjectURL;
    try {
      const clicked: string[] = [];
      const originalCreate = document.createElement.bind(document);
      const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const element = originalCreate(tag);
        if (tag === 'a') {
          element.click = () => {
            clicked.push((element as HTMLAnchorElement).download);
          };
        }
        return element;
      }) as typeof document.createElement);

      renderPage(async (input) => {
        const url = String(input);
        if (url.includes('/favorites')) return jsonResponse({ favorites: [] });
        if (url.includes('/download')) {
          return new Response('upan', { status: 200 }) as Response;
        }
        if (url.includes('/attachments')) {
          return jsonResponse({
            attachments: [
              {
                id: 'a1',
                nodeId: 'p1',
                originalName: 'nota.txt',
                mime: 'text/plain',
                sizeBytes: 4,
                sha256: 'a'.repeat(64),
                uploadedAt: '2026-10-07T12:00:00.000Z',
              },
            ],
          });
        }
        return jsonResponse(detail);
      });
      fireEvent.click(await screen.findByText('Baixar'));
      await waitFor(() => expect(clicked).toEqual(['nota.txt']));
      expect(createdUrls).toEqual(['blob:fake']);
      expect(revokedUrls).toEqual(['blob:fake']);
      spy.mockRestore();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  test('soltar arquivo na página anexa via FormData e mostra dica visual', async () => {
    const { calls } = renderPage(async (input, init) => {
      const url = String(input);
      if (url.includes('/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/attachments') && init?.method === 'POST') {
        expect(init.body instanceof FormData).toBe(true);
        return jsonResponse(
          {
            id: 'drop1',
            nodeId: 'p1',
            originalName: 'solto.png',
            mime: 'image/png',
            sizeBytes: 4,
            sha256: 'b'.repeat(64),
            uploadedAt: '2026-10-07T12:00:00.000Z',
          },
          201,
        );
      }
      if (url.includes('/attachments')) return jsonResponse({ attachments: [] });
      return jsonResponse(detail);
    });
    await screen.findByLabelText('Título da página');
    const article = document.querySelector('article');
    if (!article) throw new Error('article não renderizou');
    const file = new File(['upan'], 'solto.png', { type: 'image/png' });

    fireEvent.dragEnter(article, { dataTransfer: { types: ['Files'] } });
    expect(await screen.findByText('Solte para anexar nesta página')).toBeTruthy();

    fireEvent.drop(article, { dataTransfer: { types: ['Files'], files: [file] } });
    await waitFor(() =>
      expect(
        calls.some((call) => call.includes('POST') && call.includes('/api/nodes/p1/attachments')),
      ).toBe(true),
    );
  });

  test('soltar sem arquivos não chama a API', async () => {
    const { calls } = renderPage(async (input) => {
      const url = String(input);
      if (url.includes('/favorites')) return jsonResponse({ favorites: [] });
      if (url.includes('/attachments')) return jsonResponse({ attachments: [] });
      return jsonResponse(detail);
    });
    await screen.findByLabelText('Título da página');
    const article = document.querySelector('article');
    if (!article) throw new Error('article não renderizou');
    fireEvent.drop(article, { dataTransfer: { types: ['Files'], files: [] } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.some((call) => call.includes('POST'))).toBe(false);
  });
});
