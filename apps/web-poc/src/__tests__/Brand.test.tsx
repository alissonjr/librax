import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Wordmark } from '../components/Brand';
import { I18nProvider, type Lang } from '../i18n';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('marca Beta', () => {
  it.each([
    ['pt-BR', 'Versão beta'], ['en', 'Beta version'], ['es', 'Versión beta'],
  ] as [Lang, string][])('mantém o nome e o selo acessíveis em %s', (lang, label) => {
    localStorage.setItem('librax_lang', lang);
    render(<I18nProvider><Wordmark size={18} /></I18nProvider>);
    expect(screen.getByRole('img', { name: 'Librax' })).toBeInTheDocument();
    expect(screen.getByText(label)).toHaveClass('sr-only');
    expect(screen.getByText('Beta')).toBeVisible();
    expect(screen.getByText('Beta')).toHaveAttribute('aria-hidden', 'true');
  });
});
