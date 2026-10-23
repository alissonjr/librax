import { useT } from '../i18n';
import { Icon } from '../components/Icon';

export function SocialScreen() {
  const { t } = useT();
  return (
    <div className="social-screen">
      <header className="screen-header animate__animated animate__fadeInDown animate__faster">
        <h1 className="screen-title">{t('socialScreen.title')}</h1>
        <p className="screen-subtitle">{t('socialScreen.subtitle')}</p>
      </header>

      <div className="social-coming-soon">
        <div className="social-feature-card social-feature-card--coming animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '80ms' }}>
          <Icon name="trophy" filled className="social-feature-icon" />
          <div>
            <div className="social-feature-title">{t('socialScreen.leaguesTitle')}</div>
            <div className="social-feature-desc">{t('socialScreen.leaguesDesc')}</div>
          </div>
          <span className="badge-soon">{t('socialScreen.comingSoon')}</span>
        </div>

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
