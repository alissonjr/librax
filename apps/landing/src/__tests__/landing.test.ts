import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../install';
import { localeFromPath, localePath, matchLocale, suggestLocale, switchHref, LOCALES } from '../locale';
import { COPY, fill, formatNumber } from '../i18n';
import { normalizeAppUrl, appLink } from '../config';
import { renderPage } from '../render';
import { bonesPath, handViewBox, lerpPose, HAND_LINKS, HERO_LETTERS } from '../hands';
import maos from '../maos.json';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

describe('plataforma para instalar', () => {
  it('reconhece iPhone, Android e computador', () => {
    expect(detectPlatform({ userAgent: UA.iphone })).toBe('ios');
    expect(detectPlatform({ userAgent: UA.android })).toBe('android');
    expect(detectPlatform({ userAgent: UA.windows })).toBe('desktop');
  });
  it('iPad com iPadOS (se apresenta como Mac) vira iOS só quando tem toque', () => {
    expect(detectPlatform({ userAgent: UA.ipadOs, maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ userAgent: UA.ipadOs, maxTouchPoints: 0 })).toBe('desktop');
  });
  it('usa a plataforma do userAgentData quando existe', () => {
    expect(detectPlatform({ userAgent: '', uaPlatform: 'Android' })).toBe('android');
  });
});

describe('idiomas', () => {
  it('caminho de cada idioma vai e volta', () => {
    for (const l of LOCALES) expect(localeFromPath(localePath(l))).toBe(l);
    expect(localeFromPath('/en/index.html')).toBe('en');
    expect(localeFromPath('/qualquer')).toBe('pt-BR');
  });
  it('casa a tag do navegador com o idioma suportado', () => {
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('es-AR')).toBe('es');
    expect(matchLocale('pt-PT')).toBe('pt-BR');
    expect(matchLocale('fr-FR')).toBeNull();
  });
  it('sugere o idioma do navegador só quando é outro e a pessoa ainda não escolheu', () => {
    expect(suggestLocale('pt-BR', ['en-US', 'pt-BR'], null)).toBe('en');
    expect(suggestLocale('en', ['en-GB'], null)).toBeNull();
    expect(suggestLocale('pt-BR', ['fr-FR', 'es-MX'], null)).toBe('es');
    expect(suggestLocale('pt-BR', ['en-US'], 'pt-BR')).toBeNull();
    expect(suggestLocale('pt-BR', ['de-DE'], null)).toBeNull();
  });
  it('a troca de idioma mantém a seção aberta', () => {
    expect(switchHref('en', '#instalar')).toBe('/en/#instalar');
    expect(switchHref('pt-BR', '')).toBe('/');
    expect(switchHref('es', '#')).toBe('/es/');
  });
});

/** Todas as folhas (strings) de um objeto, com o caminho. */
function leaves(obj: unknown, path = ''): [string, string][] {
  if (typeof obj === 'string') return [[path, obj]];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('textos', () => {
  const base = leaves(COPY['pt-BR']);
  it('inglês e espanhol têm as mesmas chaves e os mesmos {campos} do português', () => {
    for (const l of ['en', 'es'] as const) {
      const other = new Map(leaves(COPY[l]));
      expect([...other.keys()].sort()).toEqual(base.map(([k]) => k).sort());
      for (const [k, v] of base) expect(placeholders(other.get(k)!), `${l}: ${k}`).toEqual(placeholders(v));
    }
  });
  it('sem travessão, meia-risca nem emoji', () => {
    for (const l of LOCALES) {
      for (const [k, v] of leaves(COPY[l])) {
        expect(v, `${l}: ${k}`).not.toMatch(/[\u2013\u2014]/);
        expect(v, `${l}: ${k}`).not.toMatch(/\p{Emoji_Presentation}/u);
      }
    }
  });
  it('preenche campos e formata números por idioma', () => {
    expect(fill('{a} de {b}', { a: 1, b: 2 })).toBe('1 de 2');
    expect(formatNumber('pt-BR', 6.4, 1)).toBe('6,4');
    expect(formatNumber('en', 6.4, 1)).toBe('6.4');
    expect(formatNumber('pt-BR', 1030)).toBe('1.030');
  });
});

describe('endereço do app', () => {
  it('sempre termina em barra e monta as rotas', () => {
    expect(normalizeAppUrl('https://app.exemplo.com')).toBe('https://app.exemplo.com/');
    expect(normalizeAppUrl('/app/')).toBe('/app/');
    expect(appLink('/privacidade')).toMatch(/\/privacidade$/);
  });
});

describe('páginas geradas', () => {
  for (const l of LOCALES) {
    const html = renderPage(l);
    it(`${l}: lang certo, um h1, nenhum {campo} sobrando, sem travessão`, () => {
      expect(html).toContain(`<html lang="${l}">`);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
      expect(text).not.toMatch(/\{[a-z]\w*\}/);
      expect(html).not.toMatch(/[\u2013\u2014]/);
    });
    it(`${l}: títulos sem pular nível e imagens com alt`, () => {
      const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
      for (const img of html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/alt="[^"]+"/);
    });
  }
});

describe('mãos da abertura', () => {
  it('cada letra de LIBRAX tem poses de 21 pontos', () => {
    for (const L of HERO_LETTERS) {
      const poses = (maos.letras as Record<string, { poses: number[][] }>)[L].poses;
      expect(poses.length).toBeGreaterThanOrEqual(3);
      for (const p of poses) expect(p).toHaveLength(42);
    }
  });
  it('desenha um traço por ligação e mistura poses', () => {
    const p = maos.letras.L.poses[0];
    expect(bonesPath(p).match(/M/g)).toHaveLength(HAND_LINKS.length);
    expect(lerpPose([0, 0], [2, 4], 0.5)).toEqual([1, 2]);
    expect(handViewBox('L').split(' ')).toHaveLength(4);
  });
});
