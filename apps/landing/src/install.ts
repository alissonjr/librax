/**
 * Plataforma de quem visita, para abrir já na aba certa das instruções de instalação.
 * O app é um PWA: no Android o Chrome instala pelo menu, no iPhone é pelo Compartilhar do
 * Safari e no computador pelo ícone de instalar do Chrome ou do Edge.
 */
export type Platform = 'android' | 'ios' | 'desktop';

export const PLATFORMS: readonly Platform[] = ['android', 'ios', 'desktop'];

export interface PlatformHints {
  userAgent: string;
  /** navigator.maxTouchPoints: o iPad com iPadOS se apresenta como Mac, mas tem toque. */
  maxTouchPoints?: number;
  /** navigator.userAgentData?.platform, quando existe (Chrome). */
  uaPlatform?: string;
}

export function detectPlatform({ userAgent, maxTouchPoints = 0, uaPlatform }: PlatformHints): Platform {
  const ua = userAgent || '';
  const plat = (uaPlatform || '').toLowerCase();
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  if (plat === 'android' || /Android/i.test(ua)) return 'android';
  return 'desktop';
}
