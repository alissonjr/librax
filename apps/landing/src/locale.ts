/**
 * Idiomas da landing: português (padrão, na raiz), inglês em /en/ e espanhol em /es/.
 * Cada idioma é uma página própria gerada no build (lang certo no <html>, sem esperar o JS).
 */
export type Locale = 'pt-BR' | 'en' | 'es';

export const LOCALES: readonly Locale[] = ['pt-BR', 'en', 'es'];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

/** Chave que o app (web-poc) usa para o idioma. Mesma origem: o app abre no idioma escolhido aqui. */
export const APP_LANG_KEY = 'librax_lang';
/** Escolha feita no seletor da landing (para não sugerir outro idioma de novo). */
export const LANDING_LANG_KEY = 'librax_landing_lang';

const PREFIX: Record<Locale, string> = { 'pt-BR': '/', en: '/en/', es: '/es/' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Caminho da página de um idioma. */
export function localePath(locale: Locale): string {
  return PREFIX[locale];
}

/** Idioma de uma página pelo caminho ("/en/", "/es/index.html", "/"). */
export function localeFromPath(pathname: string): Locale {
  const first = pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  if (first === 'en') return 'en';
  if (first === 'es') return 'es';
  return DEFAULT_LOCALE;
}

/** Idioma suportado mais próximo de uma tag do navegador ("en-US" -> "en"), ou null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  const t = (tag ?? '').toLowerCase();
  if (t.startsWith('pt')) return 'pt-BR';
  if (t.startsWith('en')) return 'en';
  if (t.startsWith('es')) return 'es';
  return null;
}

/**
 * Idioma a sugerir para quem chega numa página: o primeiro idioma do navegador que temos,
 * se for diferente do atual. Nunca sugere depois de a pessoa escolher no seletor.
 */
export function suggestLocale(
  current: Locale,
  browserLanguages: readonly string[],
  stored: string | null,
): Locale | null {
  if (isLocale(stored)) return null;
  for (const tag of browserLanguages) {
    const match = matchLocale(tag);
    if (match) return match === current ? null : match;
  }
  return null;
}

/** Link de troca de idioma que mantém a seção aberta (#instalar continua #instalar). */
export function switchHref(target: Locale, hash = ''): string {
  const clean = hash && hash !== '#' ? hash : '';
  return `${localePath(target)}${clean}`;
}
