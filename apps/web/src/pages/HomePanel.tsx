import type { FavoriteItem, TreeResponse } from '@krndocs/shared';
import {
  favoriteListResponseSchema,
  templateListResponseSchema,
  treeResponseSchema,
} from '@krndocs/shared';
import {
  ChevronRight,
  FileText,
  FolderOpen,
  Globe,
  LayoutGrid,
  Search,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { useTreeRefresh } from '../components/TreePanel.js';
import { apiFetch, parseWith } from '../lib/api.js';
import { formatLongDate, formatRelativeTime, greetingFor } from '../lib/time.js';

interface RecentPage {
  id: string;
  title: string;
  updatedAt: string;
  /** Caminho de pastas ("Guias / Operações") ou vazio se estiver na raiz. */
  path: string;
}

/** Caminho de pastas de um nó (títulos dos pais, separados por " / "). */
function folderPath(
  nodeId: string,
  parents: Map<string, { title: string; parentId: string | null }>,
): string {
  const parts: string[] = [];
  let current = parents.get(nodeId);
  let guard = 0;
  while (current?.parentId && guard < 20) {
    const parent = parents.get(current.parentId);
    if (!parent) break;
    parts.unshift(parent.title);
    current = parent;
    guard += 1;
  }
  return parts.join(' / ');
}

/**
 * Início do workspace: saudação, visão geral real do conteúdo (árvore,
 * favoritos e modelos), páginas recentes e acesso rápido — sem conteúdo
 * fictício. Público misto (infra, gestão e diretoria): prioriza leitura
 * rápida e caminhos diretos para as seções.
 */
export function HomePanel(): React.JSX.Element {
  const { displayName, username, role } = useAuth();
  const { version: treeVersion } = useTreeRefresh();
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [favorites, setFavorites] = useState<FavoriteItem[] | null>(null);
  const [modelCount, setModelCount] = useState<number | null>(null);

  // A mudança da versão sinaliza que árvore/favoritos/modelos devem ser recarregados.
  // biome-ignore lint/correctness/useExhaustiveDependencies: treeVersion é gatilho intencional da recarga.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const [treeResult, favResult, tplResult] = await Promise.allSettled([
        apiFetch('/api/tree').then((json) => parseWith(treeResponseSchema, json)),
        apiFetch('/api/favorites').then((json) => parseWith(favoriteListResponseSchema, json)),
        apiFetch('/api/templates').then((json) => parseWith(templateListResponseSchema, json)),
      ]);
      if (cancelled) return;
      if (treeResult.status === 'fulfilled') setTree(treeResult.value);
      if (favResult.status === 'fulfilled') setFavorites(favResult.value.favorites);
      if (tplResult.status === 'fulfilled') setModelCount(tplResult.value.templates.length);
      // Falhas individuais ficam como "sem dado" (…); as demais seções seguem.
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [treeVersion]);

  const nodes = tree?.nodes ?? [];
  const pages = nodes.filter((node) => node.type === 'page');
  const folderCount = nodes.length - pages.length;
  const publicCount = nodes.filter((node) => node.visibility === 'public').length;
  const favoriteList = favorites ?? [];

  const parents = new Map(
    nodes.map((node) => [node.id, { title: node.title, parentId: node.parentId }]),
  );
  const recent: RecentPage[] = pages
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 6)
    .map((node) => ({
      id: node.id,
      title: node.title,
      updatedAt: node.updatedAt,
      path: folderPath(node.id, parents),
    }));

  const stats = [
    {
      label: 'Páginas',
      value: tree === null ? undefined : pages.length,
      hint: 'documentos no workspace',
      icon: <FileText size={16} aria-hidden="true" />,
    },
    {
      label: 'Pastas',
      value: tree === null ? undefined : folderCount,
      hint: 'estrutura de organização',
      icon: <FolderOpen size={16} aria-hidden="true" />,
    },
    {
      label: 'Publicadas',
      value: tree === null ? undefined : publicCount,
      hint: 'visíveis no portal público',
      icon: <Globe size={16} aria-hidden="true" />,
    },
    {
      label: 'Modelos',
      value: modelCount === null ? undefined : modelCount,
      hint: 'runbooks e checklists',
      icon: <LayoutGrid size={16} aria-hidden="true" />,
    },
    {
      label: 'Favoritos',
      value: favorites === null ? undefined : favoriteList.length,
      hint: 'seus atalhos pessoais',
      icon: <Star size={16} aria-hidden="true" />,
    },
  ];

  const shortcuts = [
    {
      to: '/app/buscar',
      icon: <Search size={15} aria-hidden="true" />,
      title: 'Buscar',
      hint: 'Encontre qualquer conteúdo',
    },
    {
      to: '/app/modelos',
      icon: <LayoutGrid size={15} aria-hidden="true" />,
      title: 'Modelos',
      hint: 'Runbooks, checklists e relatórios',
    },
    {
      to: '/app/lixeira',
      icon: <Trash2 size={15} aria-hidden="true" />,
      title: 'Lixeira',
      hint: 'Restaure itens excluídos',
    },
    ...(role === 'admin'
      ? [
          {
            to: '/app/usuarios',
            icon: <Users size={15} aria-hidden="true" />,
            title: 'Usuários',
            hint: 'Gerenciar acessos da equipe',
          },
        ]
      : []),
    ...(publicCount > 0
      ? [
          {
            to: '/',
            icon: <Globe size={15} aria-hidden="true" />,
            title: 'Portal público',
            hint: 'Ver como visitante vê',
          },
        ]
      : []),
  ];

  const summary =
    tree === null
      ? 'Carregando a visão geral da documentação…'
      : pages.length === 0
        ? 'Ainda não há páginas aqui. Crie a primeira na barra lateral para começar.'
        : `${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} em ${folderCount} ${
            folderCount === 1 ? 'pasta' : 'pastas'
          }${publicCount > 0 ? `, ${publicCount} ${publicCount === 1 ? 'publicada' : 'publicadas'}` : ''}.`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      {/* Boas-vindas */}
      <section className="kd-card relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden="true" className="kd-home-glow" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p
              className="text-xs font-medium tracking-wider uppercase"
              style={{ color: 'var(--kd-accent)' }}
            >
              {formatLongDate()}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {greetingFor()}, {displayName ?? username ?? 'bem-vindo'}
            </h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--kd-muted)' }}>
              {summary}
            </p>
          </div>
          <Link to="/app/buscar" className="kd-btn">
            <Search size={14} aria-hidden="true" />
            Buscar na documentação
          </Link>
        </div>
      </section>

      {/* Visão geral */}
      <section
        aria-label="Visão geral"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {stats.map((stat) => (
          <div key={stat.label} className="kd-card p-4">
            <span
              className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'var(--kd-accent-soft)', color: 'var(--kd-accent)' }}
            >
              {stat.icon}
            </span>
            <p className="text-xl font-semibold" style={{ color: 'var(--kd-accent)' }}>
              {stat.value ?? '…'}
            </p>
            <p className="text-xs font-medium">{stat.label}</p>
            <p className="text-[0.6875rem]" style={{ color: 'var(--kd-muted)' }}>
              {stat.hint}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recentes */}
        <section className="kd-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="kd-section-title">Atualizadas recentemente</h2>
            <Link
              to="/app/buscar"
              className="text-xs transition-opacity hover:opacity-80"
              style={{ color: 'var(--kd-accent)' }}
            >
              Buscar outra
            </Link>
          </div>
          {tree === null ? (
            <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
              Carregando…
            </p>
          ) : recent.length === 0 ? (
            <div>
              <p className="mb-1 text-sm" style={{ color: 'var(--kd-muted)' }}>
                Nenhuma página ainda. Crie a primeira na barra lateral.
              </p>
              <ul
                className="list-inside list-disc space-y-1 text-xs"
                style={{ color: 'var(--kd-muted)' }}
              >
                <li>Duplo clique em um item da árvore para renomear.</li>
                <li>Use os botões ao passar o mouse para criar dentro de pastas ou excluir.</li>
                <li>As alterações de conteúdo são salvas automaticamente.</li>
              </ul>
            </div>
          ) : (
            <ul className="flex flex-col">
              {recent.map((page) => (
                <li key={page.id}>
                  <Link
                    to={`/app/p/${page.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-[var(--kd-surface-2)]"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ background: 'var(--kd-surface-2)', color: 'var(--kd-muted)' }}
                    >
                      <FileText size={14} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {page.title || 'Sem título'}
                      </span>
                      <span className="block truncate text-xs" style={{ color: 'var(--kd-muted)' }}>
                        {page.path || 'Na raiz do workspace'}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--kd-muted)' }}>
                      {formatRelativeTime(page.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          {/* Favoritos */}
          <section className="kd-card p-4">
            <h2 className="kd-section-title mb-3">Favoritos</h2>
            {favorites === null ? (
              <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
                Carregando…
              </p>
            ) : favoriteList.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
                Marque páginas com a estrela na árvore para achá-las aqui rápido.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {favoriteList.map((favorite) => (
                  <li key={favorite.nodeId}>
                    <Link
                      to={`/app/p/${favorite.nodeId}`}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--kd-surface-2)]"
                      title={favorite.title || 'Sem título'}
                    >
                      <Star
                        size={13}
                        aria-hidden="true"
                        className="shrink-0"
                        style={{ color: 'var(--kd-accent)' }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {favorite.title || 'Sem título'}
                      </span>
                      {favorite.type === 'folder' && <span className="kd-badge">pasta</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Acesso rápido */}
          <section className="kd-card p-4">
            <h2 className="kd-section-title mb-3">Acesso rápido</h2>
            <ul className="flex flex-col">
              {shortcuts.map((shortcut) => (
                <li key={shortcut.to}>
                  <Link
                    to={shortcut.to}
                    className="group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-[var(--kd-surface-2)]"
                  >
                    <span style={{ color: 'var(--kd-accent)' }}>{shortcut.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{shortcut.title}</span>
                      <span className="block truncate text-xs" style={{ color: 'var(--kd-muted)' }}>
                        {shortcut.hint}
                      </span>
                    </span>
                    <ChevronRight
                      size={14}
                      aria-hidden="true"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ color: 'var(--kd-muted)' }}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
