import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote, useEditorChange } from '@blocknote/react';
import type { PageContent, SaveContentResponse } from '@krndocs/shared';
import { saveContentResponseSchema } from '@krndocs/shared';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

interface PageEditorProps {
  nodeId: string;
  initialContent: PageContent | null;
  initialVersion: number;
  /** Recarrega o detalhe da página (usado ao resolver conflito). */
  onReload: () => void;
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
}: PageEditorProps): React.JSX.Element {
  const editor: BlockNoteEditor = useCreateBlockNote({
    initialContent:
      initialContent && initialContent.length > 0 ? (initialContent as PartialBlock[]) : undefined,
  });

  const versionRef = useRef(initialVersion);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  // Tema no momento da montagem (troca global fica no cabeçalho).
  const [dark] = useState<boolean>(() => document.documentElement.classList.contains('dark'));

  const save = useCallback(
    async (source: 'autosave' | 'manual'): Promise<void> => {
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
        setStatus('saved');
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setStatus('conflict');
        } else {
          setStatus('error');
        }
      }
    },
    [nodeId, editor],
  );

  useEditorChange(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save('autosave'), AUTOSAVE_DELAY_MS);
  }, editor);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const statusText: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Salvando…',
    saved: 'Salvo',
    error: 'Erro ao salvar — verifique a conexão e continue editando.',
    conflict: 'Esta página foi alterada em outra sessão.',
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span
          role={status === 'error' || status === 'conflict' ? 'alert' : 'status'}
          style={{
            color: status === 'error' || status === 'conflict' ? '#c0392b' : 'var(--kd-muted)',
          }}
        >
          {statusText[status]}
        </span>
        <span className="flex items-center gap-2">
          {status === 'error' && (
            <button
              type="button"
              className="rounded border px-2 py-1"
              style={{ borderColor: 'var(--kd-border)' }}
              onClick={() => void save('manual')}
            >
              Tentar salvar agora
            </button>
          )}
          {status === 'conflict' && (
            <button
              type="button"
              className="rounded border px-2 py-1"
              style={{ borderColor: '#c0392b', color: '#c0392b' }}
              onClick={onReload}
            >
              Recarregar página
            </button>
          )}
          <button
            type="button"
            className="rounded border px-2 py-1"
            style={{ borderColor: 'var(--kd-border)' }}
            onClick={() => void save('manual')}
            disabled={status === 'saving'}
          >
            Salvar
          </button>
        </span>
      </div>

      <div className="kd-editor rounded-lg border" style={{ borderColor: 'var(--kd-border)' }}>
        <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} />
      </div>
    </div>
  );
}
