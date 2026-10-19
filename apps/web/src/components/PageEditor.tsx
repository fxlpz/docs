import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote, useEditorChange, useEditorSelectionChange } from '@blocknote/react';
import type { PageContent, SaveContentResponse } from '@krndocs/shared';
import { nodeDetailSchema, saveContentResponseSchema } from '@krndocs/shared';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';
import { copyTextToClipboard } from '../lib/clipboard.js';
import { codeSchema } from '../lib/editorSchema.js';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

interface PageEditorProps {
  nodeId: string;
  initialContent: PageContent | null;
  initialVersion: number;
  /** Recarrega o detalhe da página (usado ao resolver conflito). */
  onReload: () => void;
  /**
   * Sobe um arquivo da máquina (aba "Upload" dos blocos de mídia/arquivo).
   * Devolve a URL pública do anexo. O chamador recarrega a lista de anexos.
   */
  uploadFile: (file: File) => Promise<string>;
  /** Chamado após cada upload concluído (para atualizar a lista de anexos). */
  onUploadComplete?: () => void;
}

const AUTOSAVE_DELAY_MS = 1500;

/**
 * Editor rico com salvamento automático (debounce) e controle otimista:
 * se a versão do servidor divergir (409), nada é sobrescrito — a interface
 * oferece recarregar para resolver (resolução completa na Etapa 3).
 */
export function PageEditor({
  nodeId,
  initialContent,
  initialVersion,
  onReload,
  uploadFile,
  onUploadComplete,
}: PageEditorProps): React.JSX.Element {
  const editor: BlockNoteEditor = useCreateBlockNote({
    schema: codeSchema,
    initialContent:
      initialContent && initialContent.length > 0 ? (initialContent as PartialBlock[]) : undefined,
    uploadFile: async (file: File) => {
      const url = await uploadFile(file);
      onUploadComplete?.();
      return url;
    },
  });

  // Texto do bloco de código sob o cursor (null fora de código): base do
  // botão "Copiar código" na barra do editor.
  const [codeText, setCodeText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEditorSelectionChange(() => {
    try {
      const { block } = editor.getTextCursorPosition();
      if (block?.type === 'codeBlock') {
        const text = block.content
          .map((inline: unknown) =>
            typeof inline === 'object' && inline !== null && 'text' in inline
              ? String((inline as { text: unknown }).text ?? '')
              : '',
          )
          .join('');
        setCodeText((prev) => (prev === text ? prev : text));
      } else {
        setCodeText((prev) => (prev === null ? prev : null));
      }
    } catch {
      setCodeText(null);
    }
    setCopied(false);
  }, editor);

  const copyCode = (): void => {
    if (codeText === null) return;
    void (async () => {
      const ok = await copyTextToClipboard(codeText);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 2000);
    })();
  };

  const versionRef = useRef(initialVersion);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const discardOnUnmountRef = useRef(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [dark, setDark] = useState<boolean>(() =>
    document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const save = useCallback(
    async (source: 'autosave' | 'manual'): Promise<void> => {
      if (savingRef.current) {
        return;
      }
      savingRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const revision = revisionRef.current;
      setStatus('saving');
      try {
        const json = await apiFetch<SaveContentResponse>(`/api/nodes/${nodeId}/content`, {
          method: 'PUT',
          body: JSON.stringify({
            content: editor.document as unknown,
            baseVersion: versionRef.current,
            source,
          }),
        });
        const parsed = parseWith(saveContentResponseSchema, json);
        versionRef.current = parsed.version;
        if (revisionRef.current === revision) dirtyRef.current = false;
        setStatus('saved');
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Conflito real: busca a versão corrente para permitir "manter a
          // minha" (salvar como nova versão) sem perder a edição local.
          try {
            const latest = await apiFetch(`/api/nodes/${nodeId}`);
            const detail = parseWith(nodeDetailSchema, latest);
            versionRef.current = detail.version;
          } catch {
            // Sem a versão atual, só resta recarregar (onReload).
          }
          setStatus('conflict');
        } else {
          setStatus('error');
        }
      } finally {
        savingRef.current = false;
        if (revisionRef.current !== revision && dirtyRef.current) {
          timerRef.current = setTimeout(() => void save('autosave'), 0);
        }
      }
    },
    [nodeId, editor],
  );

  useEditorChange(() => {
    revisionRef.current += 1;
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save('autosave'), AUTOSAVE_DELAY_MS);
  }, editor);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (dirtyRef.current && !discardOnUnmountRef.current) void save('autosave');
      }
    },
    [save],
  );

  const statusText: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Salvando…',
    saved: 'Salvo',
    error: 'Erro ao salvar — verifique a conexão e continue editando.',
    conflict:
      'Esta página foi alterada em outra sessão. Sua edição foi preservada: ' +
      'salve para mantê-la como nova versão ou recarregue para descartá-la.',
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span
          role={status === 'error' || status === 'conflict' ? 'alert' : 'status'}
          className="flex items-center gap-1.5"
          style={{
            color:
              status === 'error' || status === 'conflict' ? 'var(--kd-danger)' : 'var(--kd-muted)',
          }}
        >
          {status === 'saved' && (
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--kd-accent)' }}
            />
          )}
          {statusText[status]}
        </span>
        <span className="flex items-center gap-2">
          {codeText !== null && (
            <button
              type="button"
              className="kd-btn kd-btn-ghost"
              onClick={copyCode}
              title="Copiar o código do bloco sob o cursor"
            >
              <Copy size={14} aria-hidden="true" />
              {copied ? 'Copiado!' : 'Copiar código'}
            </button>
          )}
          {status === 'error' && (
            <button
              type="button"
              className="kd-btn kd-btn-ghost"
              onClick={() => void save('manual')}
            >
              Tentar salvar agora
            </button>
          )}
          {status === 'conflict' && (
            <>
              <button
                type="button"
                className="kd-btn kd-btn-primary"
                onClick={() => void save('manual')}
              >
                Salvar minha versão
              </button>
              <button
                type="button"
                className="kd-btn kd-btn-danger-ghost"
                onClick={() => {
                  discardOnUnmountRef.current = true;
                  onReload();
                }}
              >
                Descartar e recarregar
              </button>
            </>
          )}
          <button
            type="button"
            className="kd-btn kd-btn-ghost"
            onClick={() => void save('manual')}
            disabled={status === 'saving'}
          >
            Salvar
          </button>
        </span>
      </div>

      <div className="kd-editor kd-card !p-0 overflow-hidden">
        <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} />
      </div>
    </div>
  );
}
