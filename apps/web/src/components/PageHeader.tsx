import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Ícone lucide exibido no ladrilho do acento. */
  icon: ReactNode;
  title: string;
  /** Descrição curta (texto puro ou elementos). */
  description: ReactNode;
  /** Ações à direita (botões). */
  actions?: ReactNode;
}

/**
 * Cabeçalho padrão das páginas internas: ladrilho com ícone no acento,
 * título e descrição — mesmo padrão visual da página inicial, para as
 * seções parecerem parte do mesmo produto.
 */
export function PageHeader({
  icon,
  title,
  description,
  actions,
}: PageHeaderProps): React.JSX.Element {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="kd-icon-tile">{icon}</span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 max-w-2xl text-sm" style={{ color: 'var(--kd-muted)' }}>
            {description}
          </p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
