import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { LeagueShortcut } from '../components/LeagueShortcut';
import { useAccount } from '../lib/account';
import { fetchMyPrivateLeagues, pendingInvite, PRIVATE_LEAGUE_LIMIT, type Load, type PrivateLeague } from '../lib/social';

interface Props {
  /** Liga da semana (spec-02 12.7). */
  onOpenLeague: () => void;
  /** Liga geral: todo mundo, pelo XP total. */
  onOpenGlobal: () => void;
  onOpenPrivate: (id: string) => void;
  onCreatePrivate: () => void;
  /** Entrar com código; com `code`, vem de um link de convite guardado. */
  onJoinPrivate: (code?: string) => void;
  onAccount: (mode: 'register' | 'login') => void;
}

/**
 * Aba Social: as duas ligas fixas (da semana e geral) e as ligas privadas da pessoa, com criar e
 * entrar com código. Tudo isso só existe com conta; sem conta, cada parte convida a criar uma.
 */
export function SocialScreen({ onOpenLeague, onOpenGlobal, onOpenPrivate, onCreatePrivate, onJoinPrivate, onAccount }: Props) {
  const { t } = useT();
  const account = useAccount();
  const signedIn = account.status === 'signedIn';
  const [mine, setMine] = useState<Load<PrivateLeague[]> | null>(null);
  const invite = pendingInvite();

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    fetchMyPrivateLeagues().then(l => {
      if (alive) setMine(l);
    });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const leagues = mine?.kind === 'ok' ? mine.data : [];
  const atLimit = leagues.length >= PRIVATE_LEAGUE_LIMIT;

  return (
    <div className="social-screen">
      <header className="screen-header animate__animated animate__fadeInDown animate__faster">
        <h1 className="screen-title">{t('socialScreen.title')}</h1>
        <p className="screen-subtitle">{t('socialScreen.subtitle')}</p>
      </header>

      <div className="social-coming-soon">
        <section aria-labelledby="social-fixed-title">
          <h2 id="social-fixed-title" className="social-section-title">{t('socialScreen.fixedTitle')}</h2>
          <div className="social-stack">
            <LeagueShortcut onOpen={onOpenLeague} variant="social" />
            <button className="league-shortcut league-shortcut--social" onClick={onOpenGlobal}>
              <span className="league-shortcut-badge" aria-hidden="true"><Icon name="military_tech" filled /></span>
              <span className="league-shortcut-text">
                <span className="league-shortcut-title">{t('globalLeague.title')}</span>
                <span className="league-shortcut-sub">{t('globalLeague.shortcut')}</span>
              </span>
              <Icon name="chevron_right" className="league-shortcut-arrow" />
            </button>
          </div>
        </section>

        <section aria-labelledby="social-private-title">
          <h2 id="social-private-title" className="social-section-title">{t('socialScreen.privateTitle')}</h2>
          <p className="social-feature-desc">{t('socialScreen.privateDesc')}</p>

          {!signedIn && account.status !== 'checking' && (
            <div className="social-private-guest">
              <p>{t('privateLeague.guestText')}</p>
              <div className="social-private-actions">
                <button className="btn btn-primary" onClick={() => onAccount('register')}>{t('social.inviteCreate')}</button>
                <button className="btn btn-secondary" onClick={() => onAccount('login')}>{t('social.inviteLogin')}</button>
              </div>
            </div>
          )}

          {signedIn && (
            <>
              {invite && !leagues.some(l => l.inviteCode === invite) && (
                <div className="social-invite-banner" role="status">
                  <Icon name="mail" />
                  <span>{t('privateLeague.pendingInvite', { code: invite })}</span>
                  <button className="btn btn-primary btn-sm" onClick={() => onJoinPrivate(invite)}>
                    {t('privateLeague.joinCta')}
                  </button>
                </div>
              )}

              {mine === null && <p className="text-muted">{t('common.loading')}</p>}
              {mine?.kind === 'offline' && <p className="text-muted">{t('social.offlineText')}</p>}

              {leagues.length > 0 && (
                <ul className="social-private-list">
                  {leagues.map(l => (
                    <li key={l.squadId}>
                      <button className="league-shortcut league-shortcut--social" onClick={() => onOpenPrivate(l.squadId)}>
                        <span className="league-shortcut-badge" aria-hidden="true"><Icon name="group" filled /></span>
                        <span className="league-shortcut-text">
                          <span className="league-shortcut-title">{l.name}</span>
                          <span className="league-shortcut-sub">
                            {t('privateLeague.cardSub', { n: l.memberCount, xp: l.xpWeekly ?? 0 })}
                          </span>
                        </span>
                        <Icon name="chevron_right" className="league-shortcut-arrow" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="social-private-actions">
                <button className="btn btn-primary" onClick={onCreatePrivate} disabled={atLimit}>
                  <Icon name="add_box" /> {t('privateLeague.createTitle')}
                </button>
                <button className="btn btn-secondary" onClick={() => onJoinPrivate()} disabled={atLimit}>
                  <Icon name="login" /> {t('privateLeague.joinTitle')}
                </button>
              </div>
              {atLimit && <p className="text-muted">{t('privateLeague.limitNote', { n: PRIVATE_LEAGUE_LIMIT })}</p>}
            </>
          )}
        </section>

        <div className="social-feature-card social-feature-card--coming">
          <Icon name="lock" className="social-feature-icon" />
          <div>
            <div className="social-feature-title">{t('socialScreen.challengesTitle')}</div>
            <div className="social-feature-desc">{t('socialScreen.challengesDesc')}</div>
          </div>
          <span className="badge-soon">{t('socialScreen.comingSoon')}</span>
        </div>
      </div>
    </div>
  );
}
