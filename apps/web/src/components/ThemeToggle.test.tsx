import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
  test('alterna rótulo, classe e persistência', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Tema escuro' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Tema claro' })).toBeTruthy();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('kd-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Tema claro' }));
    expect(screen.getByRole('button', { name: 'Tema escuro' })).toBeTruthy();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('respeita o tema salvo', () => {
    localStorage.setItem('kd-theme', 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Tema claro' })).toBeTruthy();
  });
});
