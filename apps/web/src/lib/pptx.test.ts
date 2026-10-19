import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { parsePptx } from './pptx.js';

/** Monta um .pptx mínimo válido (1 slide com texto + 1 imagem). */
async function minimalPptx(): Promise<ArrayBuffer> {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
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
    `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Título do slide</a:t></a:r></a:p><a:p><a:r><a:t>Segundo parágrafo.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file('ppt/media/image1.png', png);
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return buffer as ArrayBuffer;
}

describe('parsePptx', () => {
  test('extrai texto e imagem do slide em ordem', async () => {
    const slides = await parsePptx(await minimalPptx());
    expect(slides).toHaveLength(1);
    expect(slides[0]?.texts).toEqual(['Título do slideSegundo parágrafo.']);
    expect(slides[0]?.images).toHaveLength(1);
    expect(slides[0]?.images[0]).toBeInstanceOf(Blob);
    expect(slides[0]?.skippedImages).toEqual([]);
  });

  test('pula EMF/WMF com aviso em vez de ícone quebrado', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
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
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Com vetor</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:blipFill><a:blip r:embed="rId3"/><a:blip r:embed="rId4"/></p:blipFill></p:sld>`,
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/vetor.emf"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/foto.png"/></Relationships>`,
    );
    zip.file('ppt/media/vetor.emf', Buffer.from('emf-falso'));
    zip.file('ppt/media/foto.png', png);
    const slides = await parsePptx(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(slides).toHaveLength(1);
    expect(slides[0]?.texts).toEqual(['Com vetor']);
    expect(slides[0]?.images).toHaveLength(1);
    expect(slides[0]?.skippedImages).toEqual(['.emf']);
  });

  test('lê embed com prefixo de namespace diferente', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
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
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r2="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:blipFill><a:blip r2:embed="rId3"/></p:blipFill></p:sld>`,
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/foto.png"/></Relationships>`,
    );
    zip.file('ppt/media/foto.png', png);
    const slides = await parsePptx(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(slides[0]?.images).toHaveLength(1);
  });

  test('rejeita arquivo que não é ZIP', async () => {
    await expect(parsePptx(new TextEncoder().encode('não é zip').buffer)).rejects.toThrow(
      /inválido ou corrompido/i,
    );
  });

  test('detecta .ppt antigo (OLE) com mensagem específica', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(parsePptx(ole.buffer)).rejects.toThrow(/\.ppt antigo/);
  });

  test('rejeita ZIP sem slides', async () => {
    const zip = new JSZip();
    zip.file('nada.txt', 'oi');
    await expect(parsePptx(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow();
  });

  test('slide quebrado não derruba o deck (segue nos demais)', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId3"/></p:sldIdLst></p:presentation>`,
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`,
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Bom slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    // slide2 referenciado mas ausente no ZIP
    const slides = await parsePptx(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(slides).toHaveLength(1);
    expect(slides[0]?.texts).toEqual(['Bom slide']);
  });

  test('sem rels legíveis, enumera os slides direto do ZIP (ordenados)', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId9"/><p:sldId r:id="rId8"/></p:sldIdLst></p:presentation>`,
    );
    // Sem ppt/_rels/presentation.xml.rels de propósito
    const slide = (text: string): string =>
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    zip.file('ppt/slides/slide2.xml', slide('Segundo'));
    zip.file('ppt/slides/slide10.xml', slide('Décimo'));
    zip.file('ppt/slides/slide1.xml', slide('Primeiro'));
    const slides = await parsePptx(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(slides.map((s) => s.texts[0])).toEqual(['Primeiro', 'Segundo', 'Décimo']);
  });
});
