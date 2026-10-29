import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { LeagueBadge } from './LeagueBadge';
import { useAccount } from '../lib/account';
import { fetchLeague, TIER_NAMES, type TierId } from '../lib/league';
import '../styles/league.css';

interface Props {
  onOpen: () => void;
  /** 'social': card da aba Social (seção Ligas). 'profile': insígnia de liga no Perfil. */
  variant: 'social' | 'profile';
}

type Shortcut =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'offline' }
  | { kind: 'league'; tier: TierId; week: number; enrolled: boolean };

/**
 * Atalho para a LeagueScreen (spec-02 12.7, "Acesso"): card na aba Social e insígnia no Perfil.
 * Mostra a liga da semana (forma, cor e nome), o convite para entrar na primeira ou, sem conta, o
 * convite para criar uma.
 */
export function LeagueShortcut({ onOpen, variant }: Props) {
  const { t } = useT();
  const account = useAccount();
  const [state, setState] = useState<Shortcut>({ kind: 'loading' });

  useEffect(() => {
    if (account.status === 'checking') return;
    if (account.status !== 'signedIn') {
      setState({ kind: 'guest' });
      return;
    }
    let alive = true;
    fetchLeague().then(load => {
      if (!alive) return;
      if (load.kind === 'ok') {
        setState({ kind: 'league', tier: load.view.tier, week: load.view.week, enrolled: load.view.enrolled });
      } else setState({ kind: load.kind });
    });
    return () => {
      alive = false;
    };
  }, [account.status]);

  const league = state.kind === 'league' && state.enrolled ? state : null;
  const name = league ? t('league.tierName', { name: TIER_NAMES[league.tier] }) : t('league.weeklyTitle');
  const sub =
    state.kind === 'loading' ? t('common.loading')
      : state.kind === 'guest' ? t('league.shortcutGuest')
        : state.kind === 'offline' ? t('league.shortcutOffline')
          : league ? t('league.weekLong', { n: league.week })
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
