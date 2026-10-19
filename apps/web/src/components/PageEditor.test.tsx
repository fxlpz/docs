import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PageEditor } from './PageEditor.js';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PageEditor (conflito e salvamento)', () => {
  test('salvamento manual mostra Salvo e envia baseVersion', async () => {
    const calls: Array<{ baseVersion: number }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { baseVersion: number };
        calls.push({ baseVersion: body.baseVersion });
        return jsonResponse({ version: 2, updatedAt: '2026-10-07T12:00:00.000Z' });
      }),
    );
    render(
      <PageEditor
        nodeId="p1"
        initialContent={[]}
        initialVersion={1}
        onReload={() => {}}
        uploadFile={async () => '/x'}
      />,
    );
    fireEvent.click(screen.getByText('Salvar'));
    expect(await screen.findByText('Salvo')).toBeTruthy();
    expect(calls[0]?.baseVersion).toBe(1);
  });

  test('409 busca a versão corrente e permite salvar a minha', async () => {
    const bases: number[] = [];
    let puts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          puts += 1;
          const body = JSON.parse(String(init.body)) as { baseVersion: number };
          bases.push(body.baseVersion);
          if (puts === 1) {
            return jsonResponse({ error: { code: 'VERSION_CONFLICT', message: 'Conflito.' } }, 409);
          }
          return jsonResponse({ version: 3, updatedAt: '2026-10-07T12:00:00.000Z' });
        }
        // GET do detalhe após o conflito (versão corrente do servidor)
        return jsonResponse({
          id: 'p1',
          type: 'page',
          parentId: null,
          title: 'Doc',
          icon: null,
          position: 0,
          updatedAt: '2026-10-07T12:00:00.000Z',
          version: 2,
          content: [],
        });
      }),
    );
    render(
      <PageEditor
        nodeId="p1"
        initialContent={[]}
        initialVersion={1}
        onReload={() => {}}
        uploadFile={async () => '/x'}
      />,
    );
    fireEvent.click(screen.getByText('Salvar'));
    // Conflito: oferece manter a minha OU descartar
    expect(await screen.findByText('Salvar minha versão')).toBeTruthy();
    expect(screen.getByText('Descartar e recarregar')).toBeTruthy();
    fireEvent.click(screen.getByText('Salvar minha versão'));
    expect(await screen.findByText('Salvo')).toBeTruthy();
    // Segunda tentativa usou a base atualizada (2), não a obsoleta (1)
    expect(bases).toEqual([1, 2]);
  });

  test('falha de rede mostra erro com nova tentativa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    render(
      <PageEditor
        nodeId="p1"
        initialContent={[]}
        initialVersion={0}
        onReload={() => {}}
        uploadFile={async () => '/x'}
      />,
    );
    fireEvent.click(screen.getByText('Salvar'));
    expect(await screen.findByText('Tentar salvar agora')).toBeTruthy();
  });
});
