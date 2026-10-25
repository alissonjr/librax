import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider, adoptLangFromUrl, getInitialLang, useT } from '../i18n';

function Lang() {
  const { lang } = useT();
  return <p data-testid="lang">{lang}</p>;
}

describe('idioma vindo da landing (?lang=)', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    document.documentElement.lang = 'pt-BR';
  });

  it('aplica como a escolha do app, guarda em librax_lang e tira o parâmetro da URL', () => {
    window.history.replaceState(null, '', '/privacidade?lang=es&x=1#topo');
    expect(adoptLangFromUrl()).toBe('es');
    expect(localStorage.getItem('librax_lang')).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(window.location.pathname).toBe('/privacidade');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#topo');
    expect(getInitialLang()).toBe('es');
    render(<I18nProvider><Lang /></I18nProvider>);
    expect(screen.getByTestId('lang')).toHaveTextContent('es');
  });

  it('vale mais que uma escolha antiga guardada no app', () => {
    localStorage.setItem('librax_lang', 'pt-BR');
    window.history.replaceState(null, '', '/?lang=en');
    expect(adoptLangFromUrl()).toBe('en');
    expect(getInitialLang()).toBe('en');
    expect(window.location.search).toBe('');
  });

  it('valor inválido: não muda nada, mas o parâmetro sai da URL', () => {
    localStorage.setItem('librax_lang', 'en');
    window.history.replaceState(null, '', '/?lang=fr');
    expect(adoptLangFromUrl()).toBeNull();
    expect(localStorage.getItem('librax_lang')).toBe('en');
    expect(window.location.search).toBe('');
  });

  it('sem o parâmetro: não mexe na URL nem no idioma', () => {
    window.history.replaceState(null, '', '/licoes?aba=1');
    expect(adoptLangFromUrl()).toBeNull();
    expect(localStorage.getItem('librax_lang')).toBeNull();
    expect(window.location.search).toBe('?aba=1');
  });
});
