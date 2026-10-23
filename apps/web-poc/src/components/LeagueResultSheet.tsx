import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { LeagueBadge } from './LeagueBadge';
import { TIER_NAMES, type LeagueResult } from '../lib/leagueLocal';
import { launchConfetti } from '../lib/confetti';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { tokens } from '../styles/tokens';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import '../styles/league.css';

interface Props {
  result: LeagueResult;
  onClose: () => void;
  /** "Ver minha nova liga" fora da LeagueScreen (AppOpenFlow): leva à liga. Sem ele, só fecha. */
  onSeeLeague?: () => void;
}

function reducedMotion(): boolean {
  if (document.documentElement.getAttribute('data-reduced-motion') === 'true') return true;
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Resultado da semana encerrada (spec-02 12.7, design system 11.9): mesmo modelo do sheet de
 * conquista, sempre no palco escuro. Promoção: confete na cor da liga nova (desligado com
 * reduzir movimento), som de subida e vibração; permanência e rebaixamento: tom neutro, sem
 * confete e sem som. Tudo o que o som e a vibração reforçam está escrito na tela.
 */
export function LeagueResultSheet({ result, onClose, onSeeLeague }: Props) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const celebrated = useRef(false);
  // Voltar fecha o sheet (design-system 11.13)
  useCloseOnBack(true, onClose);
  const { outcome, fromTier, toTier } = result;
  const from = TIER_NAMES[fromTier];
  const to = TIER_NAMES[toTier];

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    titleRef.current?.focus();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (celebrated.current || outcome !== 'promoted') return;
    celebrated.current = true;
    Sfx.leagueUp();
    Haptics.achievement();
    if (!reducedMotion()) {
      const fill = tokens[`league.${toTier}.fill`];
      const edge = tokens[`league.${toTier}.edge`];
      launchConfetti(40, 2000, [fill, edge, tokens['stage.text']]);
    }
  }, [outcome, toTier]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title =
    outcome === 'promoted' ? t('league.resultPromoted')
      : outcome === 'relegated' ? t('league.resultRelegated')
        : t('league.resultStayed');
  const message =
    outcome === 'promoted' ? t('league.msgPromoted', { tier: to })
      : outcome === 'relegated' ? t('league.msgRelegated')
        : t('league.msgStayed');
  const arrow = outcome === 'promoted' ? 'arrow_upward' : outcome === 'relegated' ? 'arrow_downward' : null;

  return (
    <div
      className={`league-sheet-backdrop${visible ? ' league-sheet-backdrop--visible' : ''}`}
      onClick={onClose}
    >
      <div
        className={`league-sheet league-sheet--${outcome}${visible ? ' league-sheet--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="league-sheet-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="league-sheet-handle" aria-hidden="true" />
        <button className="league-sheet-close" onClick={onClose} aria-label={t('league.close')}>
          <Icon name="close" />
        </button>

        <div className={`league-sheet-hero${outcome === 'promoted' ? ' league-sheet-hero--glow' : ''}`}>
          <LeagueBadge tier={toTier} size={96} className="league-sheet-badge" />
        </div>

        <h2 id="league-sheet-title" ref={titleRef} tabIndex={-1} className="league-sheet-title">
          {title}
        </h2>

        <p className="league-change-row" aria-label={fromTier === toTier ? t('league.tierName', { name: to }) : t('league.changeLabel', { from, to })}>
          {fromTier !== toTier ? (
            <>
              <span className="league-change-tier">
                <LeagueBadge tier={fromTier} size={28} />
                {t('league.tierName', { name: from })}
              </span>
              <span className={`league-change-arrow league-change-arrow--${outcome}`} aria-hidden="true">
                {arrow && <Icon name={arrow} />}
                <Icon name="arrow_forward" />
              </span>
              <span className="league-change-tier">
                <LeagueBadge tier={toTier} size={28} />
                {t('league.tierName', { name: to })}
              </span>
            </>
          ) : (
            <span className="league-change-tier">
              <LeagueBadge tier={toTier} size={28} />
              {t('league.tierName', { name: to })}
            </span>
          )}
        </p>

        <div className="league-sheet-stats">
          <div className="league-sheet-stat">
            <span className="league-sheet-stat-value tabular">#{result.rank}</span>
            <span className="league-sheet-stat-label">{t('league.finalPosition', { total: result.total })}</span>
          </div>
          <div className="league-sheet-stat">
            <span className="league-sheet-stat-value tabular">{result.xp}</span>
            <span className="league-sheet-stat-label">{t('league.weekXp')}</span>
          </div>
        </div>

        <p className="league-sheet-message">{message}</p>

        <button className="btn btn-primary league-sheet-cta" onClick={onSeeLeague ?? onClose}>
          {t('league.seeNewLeague')}
        </button>
      </div>
    </div>
  );
}
