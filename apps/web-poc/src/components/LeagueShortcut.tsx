import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { LeagueBadge } from './LeagueBadge';
import { syncLeague, isoWeek, TIER_NAMES, type LeagueRepo, type TierId } from '../lib/leagueLocal';
import '../styles/league.css';

interface Props {
  userId: string;
  repo: LeagueRepo;
  onOpen: () => void;
  /** 'social': card da aba Social (seção Ligas). 'profile': insígnia de liga no Perfil. */
  variant: 'social' | 'profile';
}

/**
 * Atalho para a LeagueScreen (spec-02 12.7, "Acesso"): card na aba Social e insígnia no Perfil.
 * Mostra a liga atual (forma, cor e nome) ou o convite para entrar na primeira liga.
 */
export function LeagueShortcut({ userId, repo, onOpen, variant }: Props) {
  const { t } = useT();
  const [league, setLeague] = useState<{ tier: TierId; week: number } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    syncLeague(repo, userId, Date.now(), { enroll: false })
      .then(s => {
        if (alive) setLeague(s ? { tier: s.tier, week: isoWeek(s.periodStart).week } : null);
      })
      .catch(() => {
        if (alive) setLeague(null);
      });
    return () => {
      alive = false;
    };
  }, [repo, userId]);

  const name = league ? t('league.tierName', { name: TIER_NAMES[league.tier] }) : t('league.title');
  const sub = league === undefined
    ? t('common.loading')
    : league
      ? t('league.weekLong', { n: league.week })
      : t('league.shortcutNone');

  return (
    <button className={`league-shortcut league-shortcut--${variant}`} onClick={onOpen}>
      <span className="league-shortcut-badge" aria-hidden="true">
        {league ? <LeagueBadge tier={league.tier} size={variant === 'social' ? 48 : 40} /> : <Icon name="trophy" filled />}
      </span>
      <span className="league-shortcut-text">
        {variant === 'profile' && <span className="league-shortcut-kicker">{t('league.yourLeague')}</span>}
        <span className="league-shortcut-title">{name}</span>
        <span className="league-shortcut-sub">{sub}</span>
      </span>
      <Icon name="chevron_right" className="league-shortcut-arrow" />
    </button>
  );
}
