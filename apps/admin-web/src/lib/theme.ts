// Tema do painel: segue o sistema (tokens.css já trata prefers-color-scheme) ou fixa claro/escuro
// pelo data-theme da raiz, como o app. Só uma preferência deste navegador.

export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'librax_admin_theme';

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // sem armazenamento: vale so ate recarregar
  }
}

export const nextTheme = (c: ThemeChoice): ThemeChoice => (c === 'auto' ? 'light' : c === 'light' ? 'dark' : 'auto');
export const THEME_LABEL: Record<ThemeChoice, string> = { auto: 'Tema do sistema', light: 'Tema claro', dark: 'Tema escuro' };
