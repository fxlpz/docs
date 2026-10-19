/**
 * Máscara de IP para auditoria.
 *
 * Reduz identificabilidade mantendo o suficiente para investigação:
 * - IPv4: último octeto zerado (192.168.1.0).
 * - IPv6: mantém os 3 primeiros hextetos, zera o resto.
 * - IPv4-mapeado (::ffff:1.2.3.4): tratado como IPv4.
 * - Indefinido/não IP: null.
 */
export function maskIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const noZone = ip.split('%')[0] ?? '';
  if (noZone === '') return null;

  // IPv4-mapeado em endereço IPv6: usa a parte IPv4.
  const v4mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(noZone);
  const v4 = v4mapped?.[1] ?? (noZone.includes(':') ? null : noZone);
  if (v4 !== null) {
    const parts = v4.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }

  // IPv6: expande o '::' para 8 hextetos e mantém os 3 primeiros.
  const halves = noZone.split('::');
  if (halves.length > 2) return null;
  const head = (halves[0] ?? '').split(':').filter((part) => part.length > 0);
  const tail = (halves[1] ?? '').split(':').filter((part) => part.length > 0);
  if (halves.length === 1 && head.length !== 8) return null;
  if (![...head, ...tail].every((part) => /^[0-9a-fA-F]{1,4}$/.test(part))) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const full = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
  return [...full.slice(0, 3), '0', '0', '0', '0', '0'].join(':');
}
