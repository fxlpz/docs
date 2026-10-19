import { CircleUserRound } from 'lucide-react';

/**
 * Foto de perfil (`GET /api/users/:id/avatar`) com fallback de ícone.
 * `key` por versão: após trocar a foto, o chamador muda a chave para
 * furar o cache (`no-store` já evita cache, a chave é cinturão duplo).
 */
export function UserAvatar({
  userId,
  hasAvatar,
  name,
  size = 22,
  cacheKey = '',
}: {
  userId: string;
  hasAvatar: boolean;
  name: string;
  size?: number;
  cacheKey?: string | number;
}): React.JSX.Element {
  if (!hasAvatar) {
    return <CircleUserRound size={size} aria-hidden="true" style={{ color: 'var(--kd-muted)' }} />;
  }
  return (
    <img
      key={`${userId}:${cacheKey}`}
      src={`/api/users/${userId}/avatar`}
      alt={`Foto de ${name}`}
      width={size}
      height={size}
      draggable={false}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, background: 'var(--kd-surface-2)' }}
      onError={(event) => {
        // Arquivo sumiu do disco: esconde em vez de ícone quebrado.
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}
