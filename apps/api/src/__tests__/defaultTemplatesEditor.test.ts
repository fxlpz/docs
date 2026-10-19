// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES } from '../services/defaultTemplates.js';

/**
 * Garante que o conteúdo dos modelos padrão carrega no BlockNote de verdade
 * (mesmo caminho do `useCreateBlockNote(initialContent)` do editor da UI).
 * Um bloco malformado aqui seria uma página quebrada para o usuário.
 */
describe('modelos padrão x editor (BlockNote)', () => {
  for (const template of DEFAULT_TEMPLATES) {
    it(`"${template.name}" abre no editor sem erro`, () => {
      const source = JSON.stringify(template.blocks);
      const editor = BlockNoteEditor.create({ initialContent: template.blocks as never });
      expect(editor.document).toHaveLength(template.blocks.length);

      const plain = JSON.stringify(editor.document);
      // Trechos de texto com conteúdo em string (títulos, parágrafos) sobrevivem.
      for (const block of template.blocks) {
        if (typeof block.content !== 'string') continue;
        const snippet = block.content.slice(0, 12);
        if (snippet.length < 6 || snippet.includes('"')) continue;
        expect(plain).toContain(snippet);
      }
      // Estilos usados no conteúdo continuam válidos após o parse.
      if (source.includes('"bold"')) expect(plain).toContain('"bold"');
      if (source.includes('"italic"')) expect(plain).toContain('"italic"');
      if (source.includes('"code"')) expect(plain).toContain('"code"');
    });
  }
});
