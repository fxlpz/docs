import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { HealthPage } from './HealthPage.js';

/** Resposta de saúde dentro do contrato do `@krndocs/shared`. */
const validHealth = {
  status: 'ok',
  version: '0.1.0',
  time: '2026-10-06T12:00:00.000Z',
  migrations: 1,
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('App (tela de diagnóstico da Etapa 1)', () => {
  test('renderiza o título e o estado de carregamento', () => {
    // fetch pendente: o estado "loading" é estável e determinístico
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    render(<HealthPage />);
    expect(screen.getByRole('heading', { name: 'KernelDocs' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/verificando a api/i)).toBeTruthy();
  });

  test('exibe os dados reais da API quando a resposta respeita o contrato', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse(validHealth)));
    render(<HealthPage />);
    expect(await screen.findByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('trata resposta fora do contrato sem vazar dados', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse({ qualquer: 'coisa' })));
    render(<HealthPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/fora do contrato/i);
    expect(screen.queryByText('qualquer')).toBeNull();
  });

  test('exibe alerta quando a API responde 503 degraded (corpo dentro do contrato)', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        jsonResponse({ ...validHealth, status: 'degraded', migrations: 0 }, false, 503),
      ),
    );
    render(<HealthPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/degradada/i);
    // Os dados continuam visíveis para diagnóstico
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  test('trata falha de conexão com ação de tentar novamente', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('econnrefused')));
    render(<HealthPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/não foi possível conectar/i);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy(),
    );
  });
});
