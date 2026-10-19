import JSZip from 'jszip';

/**
 * Leitura simplificada de PowerPoint (`.pptx` = ZIP com XML + mídias).
 *
 * Extrai, por slide e em ordem: textos (agrupados por forma) e imagens.
 * NÃO reproduz layout, tema, animações ou transições — é visualização de
 * conteúdo, com fidelidade total só via download + PowerPoint.
 *
 * Segurança: só saem texto (renderizado com escape pelo React) e bytes de
 * imagem (Blob). Nenhum script/macro é executado — macros nem são lidas.
 */

export interface PptxSlide {
  /** Parágrafos de texto do slide, em ordem de leitura. */
  texts: string[];
  /** Imagens renderizáveis pelo navegador, em ordem de aparição. */
  images: Blob[];
  /**
   * Imagens ignoradas (formatos que o navegador não exibe: EMF, WMF, TIFF...),
   * só com a extensão para a UI avisar. Conteúdo segue intacto no download.
   */
  skippedImages: string[];
}

/** Lê atributo ignorando prefixo de namespace (`r:embed`, `r2:embed`...). */
function attrLocal(element: Element, local: string): string | null {
  for (let i = 0; i < element.attributes.length; i += 1) {
    const attribute = element.attributes[i];
    if (attribute && (attribute.localName === local || attribute.name === local)) {
      return attribute.value;
    }
  }
  return null;
}

/** Extensões de imagem que o navegador renderiza em <img>. */
const WEB_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif',
]);

function mediaExtension(mediaPath: string): string {
  const lower = mediaPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? (lower.slice(dot) as string) : '';
}

function allByLocalName(root: Element | Document, local: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i += 1) {
    const element = all[i];
    if (element && element.localName === local) out.push(element);
  }
  return out;
}

function parseXml(bytes: Uint8Array, what: string): Document {
  const text = new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error(`XML inválido em ${what}.`);
  }
  return doc;
}

export async function parsePptx(arrayBuffer: ArrayBuffer): Promise<PptxSlide[]> {
  // OLE composto (D0 CF 11 E0) = .ppt 97-2003: não é ZIP, não dá para ler aqui.
  const magic = new Uint8Array(arrayBuffer.slice(0, 8));
  if (
    magic.length === 8 &&
    magic[0] === 0xd0 &&
    magic[1] === 0xcf &&
    magic[2] === 0x11 &&
    magic[3] === 0xe0
  ) {
    throw new Error(
      'Formato .ppt antigo (97-2003) não suportado. Abra no PowerPoint, salve como .pptx e envie de novo.',
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    throw new Error('Arquivo PowerPoint inválido ou corrompido.');
  }

  const readText = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) throw new Error(`Parte ausente no PowerPoint: ${path}.`);
    return file.async('string');
  };
  // Ordem dos slides: presentation.xml -> sldId (r:id em ordem).
  const presentation = parseXml(
    new TextEncoder().encode(await readText('ppt/presentation.xml')),
    'apresentação',
  );
  const slideIds = allByLocalName(presentation, 'sldId')
    .map((element) => attrLocal(element, 'id'))
    .filter((id): id is string => !!id);
  if (slideIds.length === 0) throw new Error('PowerPoint sem slides.');

  const targetOf = new Map<string, string>();
  try {
    const relsText = await readText('ppt/_rels/presentation.xml.rels');
    const presentationRels = parseXml(new TextEncoder().encode(relsText), 'relações');
    for (const rel of allByLocalName(presentationRels, 'Relationship')) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) targetOf.set(id, target);
    }
  } catch {
    // Sem rels legíveis: cai no fallback por enumeração abaixo.
  }

  // Caminho preferencial: ordem exata da apresentação via rels.
  let slidePaths = slideIds
    .map((rid) => targetOf.get(rid))
    .filter((p): p is string => !!p && p.endsWith('.xml'))
    .map((p) => `ppt/${p.replace(/^\//, '')}`);
  if (slidePaths.length === 0) {
    // Fallback: enumera os slides direto do ZIP (rels fora do padrão).
    // A ordem numérica equivale à apresentação na imensa maioria dos casos.
    slidePaths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide[0-9]+\.xml$/i.test(name))
      .sort((a, b) => slideNumber(a) - slideNumber(b));
  }
  if (slidePaths.length === 0) {
    throw new Error('Nenhum slide encontrado no PowerPoint.');
  }

  const slides: PptxSlide[] = [];
  let firstError: Error | null = null;
  for (const fullPath of slidePaths) {
    try {
      slides.push(await parseSlide(zip, fullPath));
    } catch (error) {
      // Slide ilegível não derruba o deck inteiro (segue nos demais).
      if (!firstError) firstError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (slides.length === 0) {
    throw firstError ?? new Error('Nenhum slide legível no PowerPoint.');
  }
  return slides;
}

/** Número do slide para ordenar a enumeração direta (slide12 > slide2). */
function slideNumber(path: string): number {
  const match = /slide([0-9]+)\.xml$/i.exec(path);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

/** Lê um slide (texto + imagens). Lança erro descritivo se ilegível. */
async function parseSlide(zip: JSZip, fullPath: string): Promise<PptxSlide> {
  const readText = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) throw new Error(`Parte ausente no PowerPoint: ${path}.`);
    return file.async('string');
  };

  const slideDoc = parseXml(
    new TextEncoder().encode(await readText(fullPath)),
    `slide ${fullPath}`,
  );

  // Textos agrupados por forma (p:sp); fora de forma, cada um é um bloco.
  const texts: string[] = [];
  const shapes = allByLocalName(slideDoc, 'sp');
  if (shapes.length > 0) {
    for (const shape of shapes) {
      const joined = allByLocalName(shape, 't')
        .map((t) => t.textContent ?? '')
        .join('')
        .trim();
      if (joined) texts.push(joined);
    }
  } else {
    for (const t of allByLocalName(slideDoc, 't')) {
      const value = (t.textContent ?? '').trim();
      if (value) texts.push(value);
    }
  }

  // Imagens: a:blip r:embed -> rels do slide -> ../media/*.
  const images: Blob[] = [];
  const skipped: string[] = [];
  const slideDir = fullPath.includes('/')
    ? fullPath.slice(0, fullPath.lastIndexOf('/'))
    : 'ppt/slides';
  let slideRels: Document | null = null;
  try {
    const slideFile = fullPath.slice(fullPath.lastIndexOf('/') + 1).replace(/\.xml$/, '.xml.rels');
    const relsPath = `${slideDir}/_rels/${slideFile}`;
    slideRels = parseXml(new TextEncoder().encode(await readText(relsPath)), 'relações');
  } catch {
    slideRels = null;
  }
  const imageTargets = new Map<string, string>();
  if (slideRels) {
    for (const rel of allByLocalName(slideRels, 'Relationship')) {
      const id = rel.getAttribute('Id');
      const type = rel.getAttribute('Type') ?? '';
      const target = rel.getAttribute('Target') ?? '';
      if (id && type.includes('/image') && target) {
        const resolved = target.startsWith('../')
          ? `ppt/${target.slice(3)}`
          : `${slideDir}/${target}`;
        imageTargets.set(id, resolved);
      }
    }
  }
  for (const blip of allByLocalName(slideDoc, 'blip')) {
    const embed = attrLocal(blip, 'embed');
    const mediaPath = (embed && imageTargets.get(embed)) || null;
    if (!mediaPath) continue;
    const file = zip.file(mediaPath);
    if (!file) continue;
    const ext = mediaExtension(mediaPath);
    if (!WEB_IMAGE_EXTENSIONS.has(ext)) {
      skipped.push(ext || 'desconhecida');
      continue;
    }
    images.push(await file.async('blob'));
  }

  return { texts, images, skippedImages: skipped };
}
