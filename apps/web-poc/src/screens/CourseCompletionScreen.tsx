import { useEffect } from 'react';
import { launchConfetti } from '../lib/confetti';
import { Haptics } from '../lib/haptics';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';

interface Props {
  xpTotal: number;
  streak: number;
  signsLearned: number;
  onReview: () => void;
  onProfile: () => void;
}

export function CourseCompletionScreen({ xpTotal, streak, signsLearned, onReview, onProfile }: Props) {
  const { t } = useT();
  useEffect(() => {
    launchConfetti(150, 5000);
    Haptics.courseDone();
    const t = setTimeout(() => launchConfetti(80, 2000), 2000);
    return () => clearTimeout(t);
  }, []);

  function handleShare() {
    const text = t('courseCompletion.shareText');
    if (navigator.share) {
      navigator.share({ title: t('courseCompletion.shareTitle'), text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  }

  return (
    <div className="course-completion-screen animate__animated animate__fadeIn">
      <div className="course-completion-hero">
        <div className="course-completion-icon wow-glow wow-float animate__animated animate__bounceIn">
          <Icon name="trophy" filled />
        </div>
        <h1 className="course-completion-title animate__animated animate__fadeInDown" style={{ animationDelay: '250ms' }}>{t('courseCompletion.title')}</h1>
        <p className="course-completion-subtitle animate__animated animate__fadeInUp" style={{ animationDelay: '350ms' }}>{t('courseCompletion.subtitle')}</p>
      </div>

      <div className="course-stats">
        <div className="course-stat animate__animated animate__zoomIn" style={{ animationDelay: '500ms' }}>
          <span className="course-stat-value">{signsLearned}</span>
          <span className="course-stat-label">{t('courseCompletion.statSigns')}</span>
        </div>
        <div className="course-stat animate__animated animate__zoomIn" style={{ animationDelay: '620ms' }}>
          <span className="course-stat-value">{streak}</span>
          <span className="course-stat-label">{t('courseCompletion.statStreak')}</span>
        </div>
        <div className="course-stat animate__animated animate__zoomIn" style={{ animationDelay: '740ms' }}>
          <span className="course-stat-value">{xpTotal}</span>
          <span className="course-stat-label">{t('courseCompletion.statXp')}</span>
        </div>
      </div>

      <button className="btn btn-secondary course-share-btn" onClick={handleShare}>
        <Icon name="share" /> {t('courseCompletion.shareButton')}
      </button>

      <div className="course-next-steps">
        <p className="course-next-title">{t('courseCompletion.nextTitle')}</p>
        <button className="course-next-item" onClick={onReview}>
          <Icon name="replay" className="course-next-icon" />
          <div>
            <div className="course-next-item-title">{t('courseCompletion.reviewTitle')}</div>
            <div className="course-next-item-desc">{t('courseCompletion.reviewDesc')}</div>
          </div>
          <Icon name="arrow_forward" className="course-next-arrow" />
        </button>
        <div className="course-next-item course-next-item--disabled">
          <Icon name="trophy" className="course-next-icon" />
          <div>
            <div className="course-next-item-title">{t('courseCompletion.a2Title')}</div>
            <div className="course-next-item-desc">{t('courseCompletion.soon')}</div>
          </div>
          <span className="badge-soon">{t('courseCompletion.soon')}</span>
        </div>
      </div>

      <button className="btn btn-text course-profile-btn" onClick={onProfile}>{t('courseCompletion.seeProfile')}</button>
    </div>
  );
}
