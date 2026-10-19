import { describe, expect, test } from 'vitest';
import { embedUrlForAttachment, viewerKindFor } from './attachments.js';

describe('embedUrlForAttachment', () => {
  test('mídia vai inline, documento baixa', () => {
    expect(embedUrlForAttachment('a1', 'image/png')).toBe('/api/attachments/a1/download?inline=1');
    expect(embedUrlForAttachment('a2', 'video/mp4')).toBe('/api/attachments/a2/download?inline=1');
    expect(embedUrlForAttachment('a3', 'audio/mpeg')).toBe('/api/attachments/a3/download?inline=1');
    expect(embedUrlForAttachment('a4', 'application/ogg')).toBe(
      '/api/attachments/a4/download?inline=1',
    );
    expect(embedUrlForAttachment('a5', 'application/pdf')).toBe('/api/attachments/a5/download');
    expect(embedUrlForAttachment('a6', 'application/zip')).toBe('/api/attachments/a6/download');
    expect(embedUrlForAttachment('a7', 'text/plain')).toBe('/api/attachments/a7/download');
  });
});

describe('viewerKindFor', () => {
  test('roteia cada família para o render correto', () => {
    expect(viewerKindFor('image/png')).toBe('image');
    expect(viewerKindFor('video/mp4')).toBe('video');
    expect(viewerKindFor('audio/mpeg')).toBe('audio');
    expect(viewerKindFor('application/pdf')).toBe('pdf');
    expect(viewerKindFor('text/plain')).toBe('text');
    expect(
      viewerKindFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
    expect(viewerKindFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      'xlsx',
    );
    expect(
      viewerKindFor('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    ).toBe('pptx');
    expect(viewerKindFor('application/zip')).toBe('download');
    expect(viewerKindFor('application/x-msdownload')).toBe('download');
  });
});
