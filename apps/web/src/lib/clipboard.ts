/**
 * Copia texto para a área de transferência.
 *
 * Tenta a API moderna (`navigator.clipboard`, exige contexto seguro/HTTPS ou
 * localhost); sem ela, recorre ao `textarea + execCommand` (HTTP na LAN).
 * Devolve true se copiou, false caso contrário (o chamador avisa).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Cai no fallback abaixo.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
