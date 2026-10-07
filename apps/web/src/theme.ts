import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Tema claro/escuro persistido em localStorage e aplicado na classe
 * `.dark` de <html> (mesmos tokens --kd-* do styles.css).
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem('kd-theme') === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('kd-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}
