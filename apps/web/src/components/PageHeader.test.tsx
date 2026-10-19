import { cleanup, render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { afterEach, describe, expect, test } from 'vitest';
import { PageHeader } from './PageHeader.js';

afterEach(cleanup);

describe('PageHeader', () => {
  test('renderiza ícone, título e descrição', () => {
    const { container } = render(
      <PageHeader
        icon={<FileText size={18} aria-hidden="true" />}
        title="Título da seção"
        description="Descrição da seção."
      />,
    );
    expect(screen.getByRole('heading', { name: 'Título da seção' })).toBeTruthy();
    expect(screen.getByText('Descrição da seção.')).toBeTruthy();
    // Ícone renderizado dentro do ladrilho do acento
    expect(container.querySelector('.kd-icon-tile svg')).toBeTruthy();
  });

  test('ações só aparecem quando informadas', () => {
    const { rerender } = render(
      <PageHeader icon={<FileText />} title="Sem ações" description="…" />,
    );
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <PageHeader
        icon={<FileText />}
        title="Com ações"
        description="…"
        actions={<button type="button">Nova</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Nova' })).toBeTruthy();
  });
});
