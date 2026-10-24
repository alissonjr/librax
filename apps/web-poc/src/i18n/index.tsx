import {
  createContext, Fragment, useContext, useState, useCallback, useMemo, type ReactNode,
} from 'react';
import ptBR from './locales/pt-BR.json';
import en from './locales/en.json';
import es from './locales/es.json';

export type Lang = 'pt-BR' | 'en' | 'es';

export interface LanguageOption {
  code: Lang;
  /** Nome do idioma no próprio idioma. */
  label: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'pt-BR', label: 'Português', flag: '🇧🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

type Dict = Record<string, unknown>;

const DICTS: Record<Lang, Dict> = {
  'pt-BR': ptBR as Dict,
  en: en as Dict,
  es: es as Dict,
};

const STORAGE_KEY = 'librax_lang';
const FALLBACK: Lang = 'pt-BR';

function isLang(value: string | null): value is Lang {
  return value === 'pt-BR' || value === 'en' || value === 'es';
}

/** Mapeia o idioma do navegador para um idioma suportado. */
function detectBrowserLang(): Lang {
  const nav = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  if (nav.startsWith('pt')) return 'pt-BR';
  if (nav.startsWith('es')) return 'es';
  if (nav.startsWith('en')) return 'en';
  return FALLBACK;
}

export function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* localStorage indisponível */
  }
  return detectBrowserLang();
}

/** Resolve uma chave aninhada ("a.b.c") em um dicionário. */
function lookup(dict: Dict, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Dict)[part];
    return undefined;
  }, dict);
  return typeof value === 'string' ? value : undefined;
}

/** Substitui {placeholders} pelos valores fornecidos. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Monta um texto traduzido com elementos (links) no lugar de {chaves}. */
export function withLinks(template: string, links: Record<string, ReactNode>): ReactNode {
  return template.split(/\{(\w+)\}/).map((part, i) => (
    <Fragment key={i}>{i % 2 === 1 ? links[part] ?? part : part}</Fragment>
  ));
}

export type TFunc = (key: string, params?: Record<string, string | number>) => string;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

/** Cria uma função de tradução para um idioma, com fallback para pt-BR. */
function makeT(lang: Lang): TFunc {
  return (key, params) => {
    const resolved = lookup(DICTS[lang], key) ?? lookup(DICTS[FALLBACK], key) ?? key;
    return interpolate(resolved, params);
  };
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Contexto padrão usado quando não há <I18nProvider> acima (ex.: testes que
 * renderizam um componente isolado). Usa o idioma de fallback e não persiste.
 */
const DEFAULT_CONTEXT: I18nContextValue = {
  lang: FALLBACK,
  setLang: () => {},
  t: makeT(FALLBACK),
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = next;
  }, []);

  const t = useCallback<TFunc>(makeT(lang), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  return useContext(I18nContext) ?? DEFAULT_CONTEXT;
}
