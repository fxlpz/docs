import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme.js';

/**
 * Botão de alternância claro/escuro — o MESMO em todas as páginas
 * (área logada, login, landing, leitor público, diagnóstico, troca de senha).
 * Estado centralizado em `useTheme` (classe `.dark` + localStorage).
 */
export function ThemeToggle({ className = '' }: { className?: string }): React.JSX.Element {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      title={dark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
      className={`kd-btn kd-btn-ghost ${className}`}
    >
      {dark ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
      {dark ? 'Tema claro' : 'Tema escuro'}
    </button>
  );
}
