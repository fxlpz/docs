import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiFetch, apiFetchBlob, parseWith } from './api.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('apiFetch (FormData)', () => {
  test('não força content-type JSON com FormData', async () => {
    const seen: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        Object.assign(seen, headers);
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }),
    );
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.txt');
    const body = await apiFetch<{ ok: boolean }>('/api/nodes/n1/attachments', {
      method: 'POST',
      body: form,
    });
    expect(body.ok).toBe(true);
    expect(seen['content-type']).toBeUndefined();
    expect(seen.accept).toBe('application/json');
  });
});

describe('apiFetchBlob', () => {
  test('devolve o Blob em sucesso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bytes-do-arquivo', { status: 200 })),
    );
    const blob = await apiFetchBlob('/api/attachments/a/download');
    expect(await blob.text()).toBe('bytes-do-arquivo');
  });

  test('erro da API vira ApiError com o envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Sumiu.' } }), {
            status: 404,
          }),
      ),
    );
    try {
      await apiFetchBlob('/api/attachments/a/download');
      expect.unreachable('deveria lançar');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).message).toBe('Sumiu.');
    }
  });

  test('falha de rede vira NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    try {
      await apiFetchBlob('/api/attachments/a/download');
      expect.unreachable('deveria lançar');
    } catch (error) {
      expect((error as ApiError).code).toBe('NETWORK_ERROR');
    }
  });
});

describe('parseWith', () => {
  test('fora do contrato lança OUT_OF_CONTRACT', () => {
    try {
      parseWith(z.object({ a: z.string() }), { a: 1 });
      expect.unreachable('deveria lançar');
    } catch (error) {
      expect((error as ApiError).code).toBe('OUT_OF_CONTRACT');
    }
  });
});
