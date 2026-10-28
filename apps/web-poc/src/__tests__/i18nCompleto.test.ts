import { describe, it, expect } from 'vitest';
import pt from '../i18n/locales/pt-BR.json';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';

// Inglês e espanhol com todos os textos do português: uma chave que falta cai no português e a tela
// fica misturada (por exemplo "Sign in" ao lado de "Senha").

type Dict = { [k: string]: string | Dict };

function keys(d: Dict, prefix = ''): string[] {
  return Object.entries(d).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

function value(d: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = d;
  for (const part of key.split('.')) cur = typeof cur === 'object' ? cur[part] : undefined;
  return typeof cur === 'string' ? cur : undefined;
}

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('idiomas completos', () => {
  for (const [lang, dict] of [['en', en], ['es', es]] as const) {
    it(`${lang} tem todas as chaves do pt-BR, com os mesmos {campos}`, () => {
      const faltam = keys(pt as Dict).filter(k => value(dict as Dict, k) === undefined);
      expect(faltam).toEqual([]);
      for (const k of keys(pt as Dict)) {
        expect(placeholders(value(dict as Dict, k)!), `${lang}: ${k}`).toEqual(placeholders(value(pt as Dict, k)!));
      }
    });
  }
});
