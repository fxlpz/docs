/**
 * Formatação de data/hora em pt-BR para a interface (saudação, datas por
 * extenso e tempo relativo "há 2 h"). Todas as funções aceitam `now` para
 * permitir testes determinísticos.
 */

/** Saudação conforme o horário: antes das 12h, antes das 18h ou depois. */
export function greetingFor(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Data por extenso: "quinta-feira, 8 de outubro de 2026". */
export function formatLongDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

/**
 * Tempo relativo curto: "agora há pouco", "há 5 min", "há 3 h",
 * "há 2 dias"; após 7 dias vira a data no formato curto do Brasil.
 * Datas futuras ou inválidas devolvem string vazia.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = now.getTime() - then;
  if (diff < 0) return '';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;

  return new Date(then).toLocaleDateString('pt-BR');
}
