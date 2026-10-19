import { ShieldCheck } from 'lucide-react';

/**
 * Marca do KernelDocs: escudo (Cybersecurity) sobre fundo do acento.
 * Vetorial (lucide): nítido em qualquer tamanho e tema, sem arquivo externo.
 */
export function BrandMark({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md"
      style={{ background: 'var(--kd-accent)', width: size + 8, height: size + 8 }}
      aria-hidden="true"
    >
      <ShieldCheck size={size} color="#ffffff" />
    </span>
  );
}
