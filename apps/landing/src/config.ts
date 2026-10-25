import type { Locale } from './locale';

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

/** Parâmetro com o idioma da landing nos links para o app (o app aplica e tira da URL). */
export const APP_LANG_PARAM = 'lang';

/**
 * Caminho dentro do app (rotas do web-poc, ex.: "privacidade"). Com o idioma, o link leva
 * ?lang=pt-BR|en|es: a landing e o app ficam em endereços diferentes e não dividem o
 * armazenamento do navegador, então o idioma escolhido aqui vai junto no link.
 */
export function appLink(path = '', locale?: Locale): string {
  const base = `${APP_URL}${path.replace(/^\//, '')}`;
  return locale ? `${base}?${APP_LANG_PARAM}=${encodeURIComponent(locale)}` : base;
}
