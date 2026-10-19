import { describe, expect, test } from 'vitest';
import { formatLongDate, formatRelativeTime, greetingFor } from './time.js';

describe('greetingFor', () => {
  const at = (hour: number): string => greetingFor(new Date(2026, 9, 8, hour, 30));

  test('muda conforme o horário do dia', () => {
    expect(at(6)).toBe('Bom dia');
    expect(at(11)).toBe('Bom dia');
    expect(at(12)).toBe('Boa tarde');
    expect(at(17)).toBe('Boa tarde');
    expect(at(18)).toBe('Boa noite');
    expect(at(23)).toBe('Boa noite');
  });
});

describe('formatLongDate', () => {
  test('escreve a data por extenso em pt-BR', () => {
    expect(formatLongDate(new Date(2026, 9, 8))).toBe('quinta-feira, 8 de outubro de 2026');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-08T15:00:00.000Z');
  const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();

  test('agora para diferenças de menos de um minuto', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('agora há pouco');
    expect(formatRelativeTime(now.toISOString(), now)).toBe('agora há pouco');
  });

  test('minutos, horas e dias', () => {
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('há 5 min');
    expect(formatRelativeTime(ago(59 * 60_000), now)).toBe('há 59 min');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('há 3 h');
    expect(formatRelativeTime(ago(23 * 3_600_000), now)).toBe('há 23 h');
    expect(formatRelativeTime(ago(24 * 3_600_000), now)).toBe('há 1 dia');
    expect(formatRelativeTime(ago(3 * 24 * 3_600_000), now)).toBe('há 3 dias');
  });

  test('após 7 dias usa a data curta', () => {
    const old = ago(10 * 24 * 3_600_000);
    expect(formatRelativeTime(old, now)).toBe(new Date(old).toLocaleDateString('pt-BR'));
  });

  test('datas inválidas ou futuras devolvem vazio', () => {
    expect(formatRelativeTime('não é data', now)).toBe('');
    expect(formatRelativeTime(ago(-3_600_000), now)).toBe('');
  });
});
