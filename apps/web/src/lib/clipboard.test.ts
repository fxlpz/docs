import { afterEach, describe, expect, test, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyTextToClipboard', () => {
  test('usa navigator.clipboard quando disponível', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyTextToClipboard('código')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('código');
  });

  test('recorre ao textarea quando sem clipboard', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: () => boolean }).execCommand = execCommand;
    expect(await copyTextToClipboard('código')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  test('devolve false quando tudo falha', async () => {
    vi.stubGlobal('navigator', {});
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('negado');
    };
    expect(await copyTextToClipboard('código')).toBe(false);
  });
});
