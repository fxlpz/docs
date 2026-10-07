/**
 * Máscara de IP para auditoria.
 *
 * Reduz identificabilidade mantendo o suficiente para investigação:
 * - IPv4: último octeto zerado (192.168.1.0).
 * - IPv6: a partir do 4º grupo, tudo zerado (2001:db8:1:0::).
 * - Indefinido/não IP: null.
 */
export function maskIp(ip: string | undefined | null): string | null {
  if (!ip) return null;

  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }

  if (ip.includes(':')) {
    // Normaliza IPv4-embedido (::ffff:1.2.3.4) e zona/escopo antes de partir.
    const clean = ip.split('%')[0] ?? '';
    const groups = clean.split(':').filter((part) => part.length > 0);
    if (groups.length < 3) return null;
    const head = groups.slice(0, 3);
    const zeros = Array.from({ length: Math.max(8 - head.length, 0) }, () => '0');
    return [...head, ...zeros].join(':');
  }

  return null;
}
