import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AttachmentViewer } from './AttachmentViewer.js';

vi.mock('mammoth', () => ({
  convertToHtml: vi.fn(async () => ({ value: '<p>docx convertido</p>', messages: [] })),
}));

vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Plan1'], Sheets: { Plan1: {} } })),
  utils: { sheet_to_html: vi.fn(() => '<table><tr><td>A1</td></tr></table>') },
}));

function blobResponse(body: BodyInit, status = 200, type = 'application/octet-stream'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': type },
  }) as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderViewer(mime: string, id = 'a1'): void {
  render(
    <AttachmentViewer
      attachment={{ id, originalName: 'arquivo', mime }}
      baseUrl="/api/attachments"
      onClose={() => {}}
    />,
  );
}

describe('AttachmentViewer', () => {
  test('imagem renderiza <img> com blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => blobResponse('bytes-img', 200, 'image/png')),
    );
    renderViewer('image/png');
    const img = (await screen.findByAltText('arquivo')) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.src.startsWith('blob:')).toBe(true);
  });

  test('pdf renderiza iframe sem sandbox (viewer nativo do Edge/Chrome)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => blobResponse('%PDF-fake', 200, 'application/pdf')),
    );
    renderViewer('application/pdf');
    const frame = (await screen.findByTitle('arquivo')) as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.src.startsWith('blob:')).toBe(true);
  });

  test('texto aparece com escape (sem HTML)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => blobResponse('<script>alert(1)</script>', 200, 'text/plain')),
    );
    renderViewer('text/plain');
    const pre = await screen.findByText('<script>alert(1)</script>');
    expect(pre.tagName).toBe('PRE');
  });

  test('docx converte e isola em srcDoc sem scripts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => blobResponse('fake-docx', 200, 'application/octet-stream')),
    );
    renderViewer('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const frame = (await screen.findByTitle('arquivo')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcDoc')).toContain('docx convertido');
  });

  test('xlsx converte a primeira aba', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => blobResponse('fake-xlsx', 200, 'application/octet-stream')),
    );
    renderViewer('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const frame = (await screen.findByTitle('arquivo')) as HTMLIFrameElement;
    expect(frame.getAttribute('srcDoc')).toContain('A1');
  });

  test('pptx renderiza slides simplificados (sem layout original)', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>`,
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Olá do slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const pptx = await zip.generateAsync({ type: 'blob' });
    // Sem round-trip por `new Response` (quirk de Blob entre reinos no jsdom);
    // o caminho real usa Blob nativo do navegador.
    const blobResponse = { ok: true, status: 200, blob: async () => pptx } as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => blobResponse),
    );
    renderViewer('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(await screen.findByText('Slide 1')).toBeTruthy();
    expect(screen.getByText('Olá do slide')).toBeTruthy();
    expect(screen.getByText(/simplificada/)).toBeTruthy();
  });

  test('imagem ignorada aparece como aviso, não como ícone quebrado', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>`,
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:sld>`,
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/vetor.emf"/></Relationships>`,
    );
    zip.file('ppt/media/vetor.emf', Buffer.from('emf-falso'));
    const pptx = await zip.generateAsync({ type: 'blob' });
    const blobResponse = { ok: true, status: 200, blob: async () => pptx } as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => blobResponse),
    );
    renderViewer('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(await screen.findByText(/não exibida/)).toBeTruthy();
    expect(screen.getByText(/\.emf/)).toBeTruthy();
  });

  test('zip mostra fallback com download (sem fechar nada)', async () => {
    const fetchMock = vi.fn(async () => blobResponse('x', 200));
    vi.stubGlobal('fetch', fetchMock);
    renderViewer('application/zip');
    expect(await screen.findByText(/Sem visualização embutida/)).toBeTruthy();
    // Nada foi baixado sozinho: só o fetch da lista, nenhum GET de download
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  test('erro de rede vira alerta e Escape fecha', async () => {
    const onClose = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    render(
      <AttachmentViewer
        attachment={{ id: 'a1', originalName: 'arquivo', mime: 'image/png' }}
        baseUrl="/api/attachments"
        onClose={onClose}
      />,
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
