/**
 * Painel inicial sem sessão de página aberta: instruções reais de uso,
 * sem conteúdo fictício apresentado como documentação.
 */
export function HomePanel(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-xl font-semibold">Bem-vindo ao KernelDocs</h1>
      <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
        Selecione uma página na barra lateral, ou crie uma nova pasta/página para começar a
        documentar.
      </p>
      <ul
        className="mt-4 list-inside list-disc space-y-1 text-sm"
        style={{ color: 'var(--kd-muted)' }}
      >
        <li>Duplo clique em um item da árvore para renomear.</li>
        <li>Use os botões ao passar o mouse para criar dentro de pastas ou excluir.</li>
        <li>As alterações de conteúdo são salvas automaticamente.</li>
      </ul>
    </div>
  );
}
