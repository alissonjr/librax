/**
 * Endereço do app (o PWA do apps/web-poc). A landing fica na raiz do domínio e o app em outro
 * caminho ou domínio, ainda não definido (infra/lib/config.ts usa um domínio provisório).
 *
 * Para trocar: mude o valor padrão aqui ou defina VITE_APP_URL no build
 * (ex.: VITE_APP_URL=https://app.librax.com.br/ npm run build). Termine com "/".
 */
export const APP_URL: string = normalizeAppUrl(
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_URL) || '/app/',
);

export function normalizeAppUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** Caminho dentro do app (rotas do web-poc, ex.: "privacidade"). */
export function appLink(path = ''): string {
  return `${APP_URL}${path.replace(/^\//, '')}`;
}
