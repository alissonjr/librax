import { tokens } from '../styles/tokens';

/**
 * Tema claro/escuro (seção 12.1 da proposta): "Sistema" segue prefers-color-scheme;
 * "Claro" e "Escuro" gravam data-theme no <html>, que os tokens.css respeitam.
 */
export type ThemePref = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'librax_theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* localStorage indisponível */
  }
  return 'system';
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);

  // A cor da barra do navegador acompanha o modo escolhido no app
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach(meta => {
    const media = meta.getAttribute('media') ?? '';
    const systemMode = media.includes('dark') ? 'dark' : 'light';
    const mode = pref === 'system' ? systemMode : pref;
    meta.content = tokens[`theme.${mode}.bg.canvas`];
  });
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* segue só na sessão */
  }
  applyTheme(pref);
}
