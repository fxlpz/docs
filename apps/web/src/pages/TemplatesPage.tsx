import type { TemplateItem } from '@krndocs/shared';
import { nodeSummarySchema, templateListResponseSchema } from '@krndocs/shared';
import { LayoutTemplate, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.js';
import { useTreeRefresh } from '../components/TreePanel.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

type Template = TemplateItem;

/**
 * Modelos de página: lista por categoria e criação de página a partir do modelo.
 * (Marcar página como modelo fica no painel da página.)
 */
export function TemplatesPage(): React.JSX.Element {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** nodeId do item em operação ('defaults' para o botão de restaurar). */
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refresh } = useTreeRefresh();

  const load = useCallback(async () => {
    try {
      const json = await apiFetch('/api/templates');
      const parsed = parseWith(templateListResponseSchema, json);
      setTemplates(parsed.templates);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar modelos.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyTemplate = (template: Template): void => {
    void (async () => {
      try {
        const json = await apiFetch(`/api/templates/${template.nodeId}/pages`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const created = parseWith(nodeSummarySchema, json);
        navigate(`/app/p/${created.id}`);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao criar página.');
      }
    })();
  };

  /** Tira o modelo da lista — a página continua existindo na árvore. */
  const removeFromList = (template: Template): void => {
    void (async () => {
      setBusy(template.nodeId);
      setNotice(null);
      try {
        await apiFetch(`/api/templates/${template.nodeId}`, { method: 'DELETE' });
        setNotice(`"${template.name}" saiu da lista. A página continua na árvore.`);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao remover o modelo.');
      } finally {
        setBusy(null);
      }
    })();
  };

  /** Manda a página do modelo para a lixeira (some da lista automaticamente). */
  const deleteTemplatePage = (template: Template): void => {
    void (async () => {
      setBusy(template.nodeId);
      setNotice(null);
      try {
        await apiFetch(`/api/nodes/${template.nodeId}`, { method: 'DELETE' });
        setNotice(`"${template.name}" foi movida para a lixeira.`);
        refresh();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao excluir a página.');
      } finally {
        setBusy(null);
      }
    })();
  };

  /** Recria os modelos padrão que não existem mais (não duplica). */
  const restoreDefaults = (): void => {
    void (async () => {
      setBusy('defaults');
      setNotice(null);
      try {
        await apiFetch('/api/templates/defaults', { method: 'POST' });
        setNotice('Modelos padrão restaurados.');
        refresh();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao restaurar os modelos padrão.');
      } finally {
        setBusy(null);
      }
    })();
  };

  const byCategory = new Map<string, Template[]>();
  for (const template of templates ?? []) {
    const list = byCategory.get(template.category) ?? [];
    list.push(template);
    byCategory.set(template.category, list);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        icon={<LayoutTemplate size={18} aria-hidden="true" />}
        title="Modelos"
        description="Páginas-modelo para runbooks, checklists e relatórios. Para criar um modelo, abra uma página e use “Salvar como modelo”. Os modelos podem ser removidos da lista ou excluídos a qualquer momento."
        actions={
          <button
            type="button"
            className="kd-btn kd-btn-ghost"
            onClick={restoreDefaults}
            disabled={busy !== null}
            title="Recria os modelos padrão que não existem mais"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Restaurar modelos padrão
          </button>
        }
      />

      {error && (
        <div role="alert" className="kd-alert-error mb-4">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm" style={{ color: 'var(--kd-accent)' }}>
          {notice}
        </p>
      )}

      {templates === null && !error && (
        <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Carregando…
        </p>
      )}

      {templates !== null && templates.length === 0 && (
        <div className="kd-card p-8 text-center">
          <LayoutTemplate
            size={26}
            aria-hidden="true"
            className="mx-auto mb-2"
            style={{ color: 'var(--kd-muted)' }}
          />
          <p className="text-sm font-medium">Nenhum modelo ainda.</p>
          <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
            Abra uma página e use “Salvar como modelo”.
          </p>
        </div>
      )}

      {[...byCategory.entries()].map(([category, items]) => (
        <section key={category} className="mb-5">
          <h2 className="kd-section-title mb-2" style={{ color: 'var(--kd-muted)' }}>
            {category}
          </h2>
          <ul className="space-y-2">
            {items.map((template) => (
              <li
                key={template.nodeId}
                className="kd-card kd-card-interactive flex flex-wrap items-center gap-2 p-3"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <span className="flex items-center gap-2">
                    {template.icon && (
                      <span aria-hidden="true" className="text-base leading-none">
                        {template.icon}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium">{template.name}</span>
                  </span>
                  {template.description && (
                    <span className="block truncate text-xs" style={{ color: 'var(--kd-muted)' }}>
                      {template.description}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="kd-btn kd-btn-ghost"
                    onClick={() => applyTemplate(template)}
                    disabled={busy !== null}
                  >
                    <Plus size={13} aria-hidden="true" />
                    Nova página deste modelo
                  </button>
                  <button
                    type="button"
                    className="kd-btn kd-btn-ghost"
                    onClick={() => removeFromList(template)}
                    disabled={busy !== null}
                    title="Tira da lista de modelos; a página continua na árvore"
                  >
                    <X size={13} aria-hidden="true" />
                    Remover da lista
                  </button>
                  <button
                    type="button"
                    className="kd-btn kd-btn-danger-ghost"
                    onClick={() => deleteTemplatePage(template)}
                    disabled={busy !== null}
                    title="Move a página para a lixeira"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Excluir página
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
