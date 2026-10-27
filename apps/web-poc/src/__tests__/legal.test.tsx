import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { openDB } from 'idb';
import privacidadeMd from '../legal/privacidade.md?raw';
import termosMd from '../legal/termos.md?raw';
import { LEGAL_DOCS, parseBlocks, parseFrontMatter, parseInline, slugify } from '../legal/documents';
import { LegalScreen } from '../screens/LegalScreen';
import { I18nProvider } from '../i18n';
import { routes, ROUTER_FUTURE } from '../router';
import { SessionProvider } from '../hooks/useSession';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';

const SOURCES = { privacidade: privacidadeMd, termos: termosMd };

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(cleanup);

describe('textos (src/legal)', () => {
  it('cada documento tem versão, data de vigência e seções com âncoras únicas', () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      expect(doc.version).toMatch(/^\d+\.\d+$/);
      expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const ids = doc.blocks.flatMap(b => (b.type === 'section' ? [b.id] : []));
      expect(ids.length).toBeGreaterThan(5);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('sem marcadores de dados pendentes nem aviso de rascunho nos textos', () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      expect(source, name).not.toMatch(/\{\{\w+\}\}/);
      expect(source, name).not.toMatch(/\[[A-ZÁÉÍÓÚ /]+\]/);
      expect(source, name).not.toMatch(/rascunho/i);
    }
  });

  it('sem travessão nem meia-risca nos textos', () => {
    for (const [name, source] of Object.entries(SOURCES)) expect(source, name).not.toMatch(/[\u2013\u2014]/);
  });

  it('a política cobre a câmera, a transferência internacional, os direitos e a idade mínima', () => {
    const titles = LEGAL_DOCS.privacy.blocks.flatMap(b => (b.type === 'section' ? [b.text] : []));
    expect(titles).toEqual(expect.arrayContaining([
      '4. A câmera', '9. Transferência internacional', '13. Seus direitos', '15. Idade mínima',
    ]));
    expect(privacidadeMd).toContain('us-east-1');
    expect(privacidadeMd).toMatch(/não usamos ferramentas de análise de uso nem de rastreamento/);
  });

  it('os termos dizem que é ferramenta de estudo, que o reconhecimento pode errar e pedem 18 anos', () => {
    expect(termosMd).toContain('não substitui um curso com professor surdo');
    expect(termosMd).toContain('O reconhecimento pela câmera pode errar');
    expect(termosMd).toContain('18 anos ou mais');
  });

  it('lê o cabeçalho, as seções, as listas, o negrito e os links do texto', () => {
    const { meta, body } = parseFrontMatter('---\nversao: 2.1\nvigencia: 2027-01-31\n---\n\nTexto.\n');
    expect(meta).toEqual({ versao: '2.1', vigencia: '2027-01-31' });
    expect(parseBlocks(body)).toEqual([{ type: 'paragraph', text: 'Texto.' }]);

    expect(parseBlocks('## 1. Olá, câmera\n\nUma linha\ne outra.\n\n- item\n  que continua\n- dois\n### Sub')).toEqual([
      { type: 'section', id: '1-ola-camera', text: '1. Olá, câmera' },
      { type: 'paragraph', text: 'Uma linha e outra.' },
      { type: 'list', items: ['item que continua', 'dois'] },
      { type: 'subsection', text: 'Sub' },
    ]);
    expect(slugify('9. Transferência internacional')).toBe('9-transferencia-internacional');

    expect(parseInline('Veja **os [Termos](/termos)** agora.')).toEqual([
      { type: 'text', text: 'Veja ' },
      { type: 'strong', parts: [{ type: 'text', text: 'os ' }, { type: 'link', href: '/termos', parts: [{ type: 'text', text: 'Termos' }] }] },
      { type: 'text', text: ' agora.' },
    ]);
  });
});

describe('LegalScreen', () => {
  it('mostra título, versão, vigência, índice e o link para o outro documento', () => {
    const onBack = vi.fn();
    render(<LegalScreen doc="privacy" onBack={onBack} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeInTheDocument();
    const meta = screen.getByRole('list', { name: 'Sobre este documento' });
    expect(meta).toHaveTextContent(`Versão ${LEGAL_DOCS.privacy.version}`);
    expect(meta).toHaveTextContent('Em vigor desde 26 de outubro de 2026');
    expect(meta).not.toHaveTextContent('Rascunho');

    const toc = screen.getByRole('navigation', { name: 'Nesta página' });
    expect(within(toc).getByRole('link', { name: '13. Seus direitos' })).toHaveAttribute('href', '#13-seus-direitos');
    expect(screen.getByRole('heading', { level: 2, name: '13. Seus direitos' })).toHaveAttribute('id', '13-seus-direitos');

    // Fora do roteador, o link interno é um link comum para a rota
    expect(screen.getAllByRole('link', { name: 'Termos de Uso' }).at(-1)).toHaveAttribute('href', '/termos');
    // O texto é em português, mesmo com a tela em outro idioma
    expect(document.querySelector('article')).toHaveAttribute('lang', 'pt-BR');
    expect(screen.queryByText('Este documento está disponível só em português.')).not.toBeInTheDocument();
  });

  it('o índice leva o foco ao título da seção', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<LegalScreen doc="terms" onBack={vi.fn()} />);
    const toc = screen.getByRole('navigation', { name: 'Nesta página' });
    await userEvent.click(within(toc).getByRole('link', { name: '6. O reconhecimento pela câmera pode errar' }));
    const heading = screen.getByRole('heading', { level: 2, name: '6. O reconhecimento pela câmera pode errar' });
    expect(heading).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('em inglês, a moldura muda e avisa que o texto é só em português', () => {
    localStorage.setItem('librax_lang', 'en');
    const onBack = vi.fn();
    render(<I18nProvider><LegalScreen doc="terms" onBack={onBack} /></I18nProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeInTheDocument();
    expect(screen.getByText('This document is available in Portuguese only.')).toBeInTheDocument();
    expect(screen.getByText(/Effective since October 26, 2026/)).toBeInTheDocument();
    screen.getByRole('button', { name: 'Back' }).click();
    expect(onBack).toHaveBeenCalled();
  });
});

async function renderAt(entries: string[]) {
  const db = await openDB(`librax-legal-${Date.now()}-${Math.random()}`, 1, { upgrade: upgradeLibraxDb });
  const repo = new IdbRepo(db, 'user-test');
  await repo.saveProfile({ userId: 'user-test', xpTotal: 0, streak: 0, achievements: [] });
  const router = createMemoryRouter(routes, {
    initialEntries: entries,
    initialIndex: entries.length - 1,
    future: ROUTER_FUTURE,
  });
  render(
    <SessionProvider repo={repo} userId="user-test" brokenStreak={0}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </SessionProvider>,
  );
  return router;
}

const path = (router: ReturnType<typeof createMemoryRouter>) => router.state.location.pathname;

describe('rotas /privacidade e /termos', () => {
  it('abrem pelo link direto, sem onboarding nem conta', async () => {
    const router = await renderAt(['/privacidade']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeInTheDocument();
    expect(path(router)).toBe('/privacidade');

    await act(() => router.navigate('/termos'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeInTheDocument();
    expect(path(router)).toBe('/termos');
  });

  it('o voltar sem histórico (link direto) vai para o início', async () => {
    const router = await renderAt(['/termos']);
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(path(router)).toBe('/boas-vindas'));
  });

  it('as boas-vindas abrem os Termos e o voltar retorna a elas', async () => {
    const router = await renderAt(['/boas-vindas']);
    // Os links ficam no passo do nome, depois do idioma
    await userEvent.click(await screen.findByRole('button', { name: /Continuar/ }));
    await userEvent.click(await screen.findByRole('link', { name: 'Termos de Uso' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeInTheDocument();
    expect(path(router)).toBe('/termos');
    // O link empilha a página: o voltar do navegador (e a seta, com histórico) retorna às boas-vindas
    await act(() => router.navigate(-1));
    await waitFor(() => expect(path(router)).toBe('/boas-vindas'));
  });

  it('as Configurações levam à Política e aos Termos, e o voltar retorna a elas', async () => {
    localStorage.setItem('librax_displayName', 'Ana');
    const router = await renderAt(['/perfil', '/configuracoes']);
    await userEvent.click(await screen.findByRole('link', { name: /Política de Privacidade/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeInTheDocument();
    expect(path(router)).toBe('/privacidade');

    // Da política para os termos pelo link do texto, e voltando duas vezes
    await userEvent.click(screen.getAllByRole('link', { name: 'Termos de Uso' })[0]);
    await waitFor(() => expect(path(router)).toBe('/termos'));
    await act(() => router.navigate(-1));
    await waitFor(() => expect(path(router)).toBe('/privacidade'));
    await act(() => router.navigate(-1));
    await waitFor(() => expect(path(router)).toBe('/configuracoes'));
    expect(await screen.findByRole('link', { name: /Termos de Uso/ })).toHaveAttribute('href', '/termos');
  });
});
