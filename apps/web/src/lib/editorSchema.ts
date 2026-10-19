import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';

/**
 * Schema do editor com lista curada de linguagens para o bloco de código
 * (seletor nativo no cabeçalho do bloco + regra ```linguagem).
 *
 * O tipo do bloco (`codeBlock`) e o formato serializado são IDÊNTICOS ao
 * padrão — conteúdo salvo antes continua abrindo normalmente.
 */
export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: 'Texto' },
  javascript: { name: 'JavaScript', aliases: ['js'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  python: { name: 'Python', aliases: ['py'] },
  bash: { name: 'Bash/Shell', aliases: ['sh', 'shell', 'zsh'] },
  powershell: { name: 'PowerShell', aliases: ['ps1'] },
  sql: { name: 'SQL' },
  json: { name: 'JSON' },
  yaml: { name: 'YAML', aliases: ['yml'] },
  html: { name: 'HTML' },
  css: { name: 'CSS' },
  markdown: { name: 'Markdown', aliases: ['md'] },
  xml: { name: 'XML' },
  go: { name: 'Go' },
  rust: { name: 'Rust' },
  c: { name: 'C' },
  cpp: { name: 'C++' },
  java: { name: 'Java' },
  ruby: { name: 'Ruby' },
  php: { name: 'PHP' },
};

export const codeSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec({
      defaultLanguage: 'text',
      supportedLanguages: CODE_LANGUAGES,
    }),
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

export type CodeSchema = typeof codeSchema;
