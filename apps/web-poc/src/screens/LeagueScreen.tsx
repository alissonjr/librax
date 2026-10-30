import { Fragment, useCallback, useEffect, useState } from 'react';
import { useT, type TFunc } from '../i18n';
import { Icon } from '../components/Icon';
import { LeagueBadge } from '../components/LeagueBadge';
import { LeagueResultSheet } from '../components/LeagueResultSheet';
import { SocialAccountInvite, SocialOffline } from '../components/SocialAccountInvite';
import { getDisplayName } from '../lib/auth';
import { useAccount } from '../lib/account';
import {
  fetchLeague, markLeagueResultSeen, tierAbove, tierBelow, timeLeft, LEAGUE_MIN_TO_MOVE, LEAGUE_SIZE,
  TIERS, TIER_NAMES, type LeagueLoad, type LeagueResult, type LeagueView, type RankingRow, type TierId,
} from '../lib/league';
import '../styles/league.css';

interface Props {
  onBack: () => void;
  /** Ação do estado vazio ("Estudar agora"). Sem ela, volta para a tela anterior. */
  onStudy?: () => void;
  /** Sem conta: leva para criar conta ou entrar. */
  onAccount: (mode: 'register' | 'login') => void;
  /** Relógio injetável (testes e demonstração). */
  now?: () => number;
}

/** "2d 5h", "5h 12min" ou "12min" (design system 11.9: "Encerra em 2d 5h"). */
export function formatTimeLeft(t: TFunc, nowMs: number, endMs: number): string {
  const { days, hours, minutes } = timeLeft(nowMs, endMs);
  if (days > 0) return t('league.timeDH', { d: days, h: hours });
  if (hours > 0) return t('league.timeHM', { h: hours, m: minutes });
  return t('league.timeM', { m: Math.max(1, minutes) });
}

/** LeagueTimer: atualiza a cada 30 s; o texto é a informação (o ícone é só apoio). */
function LeagueTimer({ endMs, now, prefixKey }: { endMs: number; now: () => number; prefixKey: string }) {
  const { t } = useT();
  const [tick, setTick] = useState(() => now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(now()), 30_000);
    return () => window.clearInterval(id);
  }, [now]);
  return (
    <p className="league-timer" role="timer" aria-live="off">
      <Icon name="schedule" />
      <span>{t(prefixKey, { time: formatTimeLeft(t, tick, endMs) })}</span>
    </p>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

/** Nome da linha: o seu vem do aparelho; quem não mandou nome aparece como "Estudante". */
export function rowName(t: TFunc, row: Pick<RankingRow, 'name' | 'isYou'>): string {
  if (row.isYou) return getDisplayName() ?? row.name ?? t('common.defaultName');
  return row.name?.trim() || t('league.anonymousName');
}

function rowLabel(t: TFunc, row: RankingRow): string {
  const zone =
    row.zone === 'promotion' ? t('league.zonePromotionShort')
      : row.zone === 'relegation' ? t('league.zoneRelegationShort')
        : '';
  const name = row.isYou ? `${rowName(t, row)} (${t('league.you')})` : rowName(t, row);
  return [t('league.rowPlace', { rank: row.rank }), name, t('league.xp', { xp: row.xpPeriod }), zone]
    .filter(Boolean)
    .join(', ');
}

function RankingItem({ row }: { row: RankingRow }) {
  const { t } = useT();
  const name = rowName(t, row);
  return (
    <li
      className={`league-row league-row--${row.zone}${row.isYou ? ' league-row--you' : ''}`}
      aria-current={row.isYou ? 'true' : undefined}
    >
      <span className="sr-only">{rowLabel(t, row)}</span>
      <span className="league-row-rank tabular" aria-hidden="true">{row.rank}</span>
      <span className="league-row-zone" aria-hidden="true">
        {row.zone === 'promotion' && <Icon name="arrow_upward" />}
        {row.zone === 'relegation' && <Icon name="arrow_downward" />}
      </span>
      <span className="league-row-avatar" aria-hidden="true">{initials(name)}</span>
      <span className="league-row-name" aria-hidden="true">
        <span className="league-row-name-text">{name}</span>
        {row.isYou && <span className="league-row-you">{t('league.you')}</span>}
      </span>
      <span className="league-row-xp tabular" aria-hidden="true">{t('league.xp', { xp: row.xpPeriod })}</span>
    </li>
  );
}

function ZoneDivider({ zone }: { zone: 'promotion' | 'stay' | 'relegation' }) {
  const { t } = useT();
  const text =
    zone === 'promotion' ? t('league.zonePromotion')
      : zone === 'relegation' ? t('league.zoneRelegation')
        : t('league.zoneStay');
  const icon = zone === 'promotion' ? 'arrow_upward' : zone === 'relegation' ? 'arrow_downward' : null;
  return (
    <li className={`league-zone-divider league-zone-divider--${zone}`} aria-hidden="true">
      {icon && <Icon name={icon} />}
      <span>{text}</span>
    </li>
  );
}

function TierLadder({ current }: { current?: TierId }) {
  const { t } = useT();
  return (
    <ol className="league-ladder" aria-label={t('league.tiersLabel')}>
      {TIERS.map(tier => (
        <li
          key={tier}
          className={`league-ladder-item${tier === current ? ' league-ladder-item--current' : ''}`}
          aria-current={tier === current ? 'true' : undefined}
        >
          <LeagueBadge tier={tier} size={32} />
          <span className="league-ladder-name">{TIER_NAMES[tier]}</span>
        </li>
      ))}
    </ol>
  );
}

function PromotionLegend({ view }: { view: LeagueView }) {
  const { t } = useT();
  const above = tierAbove(view.tier);
  const below = tierBelow(view.tier);
  return (
    <ul className="league-legend">
      <li className="league-legend-item league-legend-item--up">
        <Icon name="arrow_upward" />
        <span>
          {above
            ? t('league.legendPromote', { n: view.promote, tier: TIER_NAMES[above] })
            : t('league.legendTop', { tier: TIER_NAMES[view.tier] })}
        </span>
      </li>
      <li className="league-legend-item league-legend-item--down">
        <Icon name="arrow_downward" />
        <span>
          {below
            ? t('league.legendRelegate', { n: view.relegate, tier: TIER_NAMES[below] })
            : t('league.legendBottom', { tier: TIER_NAMES[view.tier] })}
        </span>
      </li>
    </ul>
  );
}

function RankingList({ view }: { view: LeagueView }) {
  const { t } = useT();
  const firstStay = view.rows.findIndex(r => r.zone === 'stay');
  const firstReleg = view.rows.findIndex(r => r.zone === 'relegation');
  return (
    <ol className="league-ranking" aria-label={t('league.rankingLabel')}>
      {view.rows.map((row, i) => (
        <Fragment key={row.userId}>
          {i === 0 && row.zone === 'promotion' && <ZoneDivider zone="promotion" />}
          {i === firstStay && i > 0 && <ZoneDivider zone="stay" />}
          {i === firstReleg && <ZoneDivider zone="relegation" />}
          <RankingItem row={row} />
        </Fragment>
      ))}
    </ol>
  );
}

function EmptyState({ view, now, onStudy }: { view: LeagueView; now: () => number; onStudy: () => void }) {
  const { t } = useT();
  return (
    <div className="league-empty">
      <Icon name="trophy" className="league-empty-icon" />
      <h2 className="league-empty-title">{t('league.emptyTitle')}</h2>
      <p className="league-empty-text">{t('league.emptyText', { tier: TIER_NAMES[view.tier] })}</p>
      <LeagueTimer endMs={view.periodEnd} now={now} prefixKey="league.emptyTimer" />
      <TierLadder current={view.tier} />
      <button className="btn btn-primary league-empty-cta" onClick={onStudy}>
        {t('league.emptyCta')} <Icon name="arrow_forward" />
      </button>
    </div>
  );
}

/**
 * LeagueScreen (spec-02 12.7, design system 11.9, spec-05 11.3): a liga da semana, lida do
 * servidor (lib/league.ts). Sem conta, convida a criar uma; sem rede, pede para tentar de novo.
 * Com pouca gente na liga, avisa que ela enche conforme mais pessoas estudam na semana.
 */
export function LeagueScreen({ onBack, onStudy, onAccount, now = Date.now }: Props) {
  const { t } = useT();
  const account = useAccount();
  const [load, setLoad] = useState<LeagueLoad | null>(null);
  const [result, setResult] = useState<LeagueResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (account.status === 'checking') return;
    if (account.status !== 'signedIn') {
      setLoad({ kind: 'guest' });
      return;
    }
    let alive = true;
    setLoad(null);
    fetchLeague({ fresh: true, now }).then(l => {
      if (!alive) return;
      setLoad(l);
      if (l.kind === 'ok' && l.view.pendingResult) {
        // Visto ao exibir, não ao fechar (spec-02 12.7)
        markLeagueResultSeen(l.view.pendingResult);
        setResult(l.view.pendingResult);
      }
    });
    return () => {
      alive = false;
    };
  }, [account.status, now, attempt]);

  const closeResult = useCallback(() => setResult(null), []);
  const view = load?.kind === 'ok' ? load.view : null;
  const ranked = view?.enrolled ? view : null;
  const title = ranked ? t('league.tierName', { name: TIER_NAMES[ranked.tier] }) : t('league.weeklyTitle');

  return (
    <div className="sub-screen league-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{title}</h1>
        {view && <span className="league-bar-week">{t('league.week', { n: view.week })}</span>}
      </div>

      <div className="league-body" aria-hidden={result ? true : undefined}>
        {load === null && <p className="text-muted league-loading">{t('common.loading')}</p>}

        {load?.kind === 'guest' && (
          <SocialAccountInvite
            text={t('league.guestText')}
            onCreateAccount={() => onAccount('register')}
            onLogin={() => onAccount('login')}
          />
        )}

        {load?.kind === 'offline' && <SocialOffline onRetry={() => setAttempt(a => a + 1)} />}

        {view && !view.enrolled && <EmptyState view={view} now={now} onStudy={onStudy ?? onBack} />}

        {ranked && (
          <>
            <section className="league-header" aria-labelledby="league-header-name">
              <LeagueBadge tier={ranked.tier} size={72} className="league-header-badge" />
              <div className="league-header-text">
                <p id="league-header-name" className="league-header-name">
                  {t('league.tierName', { name: TIER_NAMES[ranked.tier] })}
                </p>
                <LeagueTimer endMs={ranked.periodEnd} now={now} prefixKey="league.endsIn" />
              </div>
            </section>

            <TierLadder current={ranked.tier} />
            {ranked.rows.length < LEAGUE_MIN_TO_MOVE ? (
              // Pouca gente: ninguém muda de liga nesta semana (no lugar da legenda de subir e descer)
              <p className="league-demo-note">
                <Icon name="info" />
                <span>{t('league.smallLeagueNote', { n: ranked.rows.length, min: LEAGUE_MIN_TO_MOVE })}</span>
              </p>
            ) : (
              <PromotionLegend view={ranked} />
            )}
            <RankingList view={ranked} />

            {ranked.rows.length >= LEAGUE_MIN_TO_MOVE && ranked.rows.length < LEAGUE_SIZE && (
              <p className="league-demo-note">
                <Icon name="info" />
                <span>{t('league.fillingNote', { n: ranked.rows.length })}</span>
              </p>
            )}
          </>
        )}
      </div>

      {result && <LeagueResultSheet result={result} onClose={closeResult} />}
    </div>
  );
}
