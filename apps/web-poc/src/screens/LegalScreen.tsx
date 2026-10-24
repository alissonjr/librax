import { Fragment, useEffect, useId, type MouseEvent, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { LegalLink, type LegalPath } from '../components/LegalLinks';
import { LEGAL_DOCS, parseInline, type InlinePart, type LegalBlock, type LegalDocId } from '../legal/documents';
import { pendingResponsavel } from '../legal/responsavel';
import { ROUTES } from '../lib/routes';

interface Props {
  doc: LegalDocId;
  onBack: () => void;
}

const INTERNAL: ReadonlySet<string> = new Set([ROUTES.privacy, ROUTES.terms]);
const EMAIL_RE = /^[^\s@[\]]+@[^\s@[\]]+\.[^\s@[\]]+$/;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Leva até a seção (índice no topo ou endereço com #) e põe o foco no título dela. */
function scrollToSection(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
  return true;
}

/** 'AAAA-MM-DD' por extenso no idioma da tela, sem passar por UTC (o dia não muda com o fuso). */
function formatDate(iso: string, lang: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}

function renderParts(parts: InlinePart[]): ReactNode {
  return parts.map((part, i) => <Fragment key={i}>{renderPart(part)}</Fragment>);
}

function renderPart(part: InlinePart): ReactNode {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'strong':
      return <strong>{renderParts(part.parts)}</strong>;
    case 'link':
      if (INTERNAL.has(part.href)) return <LegalLink to={part.href as LegalPath}>{renderParts(part.parts)}</LegalLink>;
      return <a href={part.href} target="_blank" rel="noopener noreferrer">{renderParts(part.parts)}</a>;
    case 'responsavel':
      if (part.key === 'email' && EMAIL_RE.test(part.value)) return <a href={`mailto:${part.value}`}>{part.value}</a>;
      // Marcador ainda não preenchido (responsavel.ts): destacado para ninguém publicar sem ver
      return /^\[.*\]$/.test(part.value) ? <span className="legal-pending">{part.value}</span> : part.value;
  }
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case 'section':
      return <h2 id={block.id} tabIndex={-1}>{block.text}</h2>;
    case 'subsection':
      return <h3>{block.text}</h3>;
    case 'paragraph':
      return <p>{renderParts(parseInline(block.text))}</p>;
    case 'list':
      return <ul>{block.items.map((item, i) => <li key={i}>{renderParts(parseInline(item))}</li>)}</ul>;
  }
}

/**
 * Política de Privacidade (/privacidade) e Termos de Uso (/termos), abertas sem conta e sem
 * onboarding. O texto vem de src/legal (só em português); a moldura segue o idioma da tela.
 * Leitura no celular: coluna limitada, índice das seções no topo e títulos que recebem o foco.
 */
export function LegalScreen({ doc, onBack }: Props) {
  const { t, lang } = useT();
  const ids = useId();
  const current = LEGAL_DOCS[doc];
  const other = LEGAL_DOCS[doc === 'privacy' ? 'terms' : 'privacy'];
  const sections = current.blocks.filter((b): b is Extract<LegalBlock, { type: 'section' }> => b.type === 'section');
  const draft = pendingResponsavel().length > 0;

  // Endereço com âncora (/privacidade#13-seus-direitos): a tela carrega sob demanda, então a
  // seção só existe depois de montar
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) scrollToSection(hash);
  }, [doc]);

  function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
    if (scrollToSection(id)) e.preventDefault();
  }

  return (
    <div className="sub-screen legal-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t(current.titleKey)}</h1>
      </div>

      <div className="legal-body">
        <ul className="legal-meta" aria-label={t('legal.aboutDocument')}>
          <li className="legal-chip">{t('legal.version', { version: current.version })}</li>
          <li className="legal-chip">{t('legal.effectiveSince', { date: formatDate(current.effectiveDate, lang) })}</li>
          {draft && <li className="legal-chip legal-chip--draft">{t('legal.draft')}</li>}
        </ul>

        {lang !== 'pt-BR' && (
          <p className="legal-notice">
            <Icon name="language" /> <span>{t('legal.onlyPortuguese')}</span>
          </p>
        )}

        {sections.length > 0 && (
          <nav className="legal-toc" aria-labelledby={`${ids}-toc`}>
            <p id={`${ids}-toc`} className="legal-toc-title">{t('legal.contents')}</p>
            {/* Os títulos já trazem o número da seção */}
            <ul>
              {sections.map(s => (
                <li key={s.id}>
                  <a href={`#${s.id}`} onClick={e => jump(e, s.id)}>{s.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <article className="legal-doc" lang="pt-BR">
          {current.blocks.map((block, i) => <Block key={i} block={block} />)}
        </article>

        <p className="legal-related">
          <span>{t('legal.seeAlso')}</span>{' '}
          <LegalLink to={other.path as LegalPath}>{t(other.titleKey)}</LegalLink>
        </p>
      </div>
    </div>
  );
}
