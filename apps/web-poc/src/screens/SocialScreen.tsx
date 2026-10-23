import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { LeagueShortcut } from '../components/LeagueShortcut';
import type { LeagueRepo } from '../lib/leagueLocal';

interface Props {
  userId?: string;
  repo?: LeagueRepo | null;
  /** Abre a LeagueScreen (spec-02 12.7). Sem ela, o card de ligas fica como "Em breve". */
  onOpenLeague?: () => void;
}

export function SocialScreen({ userId, repo, onOpenLeague }: Props = {}) {
  const { t } = useT();
  return (
    <div className="social-screen">
      <header className="screen-header animate__animated animate__fadeInDown animate__faster">
        <h1 className="screen-title">{t('socialScreen.title')}</h1>
        <p className="screen-subtitle">{t('socialScreen.subtitle')}</p>
      </header>

      <div className="social-coming-soon">
        {userId && repo && onOpenLeague ? (
          <section className="animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '80ms' }} aria-label={t('socialScreen.leaguesTitle')}>
            <LeagueShortcut userId={userId} repo={repo} onOpen={onOpenLeague} variant="social" />
            <p className="social-feature-desc league-social-desc">{t('socialScreen.leaguesDesc')}</p>
          </section>
        ) : (
          <div className="social-feature-card social-feature-card--coming animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '80ms' }}>
            <Icon name="trophy" filled className="social-feature-icon" />
            <div>
              <div className="social-feature-title">{t('socialScreen.leaguesTitle')}</div>
              <div className="social-feature-desc">{t('socialScreen.leaguesDesc')}</div>
            </div>
            <span className="badge-soon">{t('socialScreen.comingSoon')}</span>
          </div>
        )}

        <div className="social-feature-card social-feature-card--coming animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '180ms' }}>
          <Icon name="group" className="social-feature-icon" />
          <div>
            <div className="social-feature-title">{t('socialScreen.squadsTitle')}</div>
            <div className="social-feature-desc">{t('socialScreen.squadsDesc')}</div>
          </div>
          <span className="badge-soon">{t('socialScreen.comingSoon')}</span>
        </div>

        <div className="social-feature-card social-feature-card--coming animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '280ms' }}>
          <Icon name="lock" className="social-feature-icon" />
          <div>
            <div className="social-feature-title">{t('socialScreen.challengesTitle')}</div>
            <div className="social-feature-desc">{t('socialScreen.challengesDesc')}</div>
          </div>
          <span className="badge-soon">{t('socialScreen.comingSoon')}</span>
        </div>

        <p className="social-early-access">
          {t('socialScreen.earlyAccess')}
        </p>
      </div>
    </div>
  );
}
