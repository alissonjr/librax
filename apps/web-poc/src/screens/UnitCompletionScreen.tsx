import { useEffect } from 'react';
import { course } from '../lib/content';
import { launchConfetti } from '../lib/confetti';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';

interface Props {
  unitId: string;
  signsLearned: number;
  xpGained: number;
  onContinue: () => void;
}

export function UnitCompletionScreen({ unitId, signsLearned, xpGained, onContinue }: Props) {
  const { t } = useT();
  const unit = course.units.find(u => u.id === unitId);
  const unitIndex = course.units.findIndex(u => u.id === unitId);
  const nextUnit = course.units[unitIndex + 1];

  useEffect(() => {
    launchConfetti(80, 3000);
    Haptics.achievement();
    Sfx.unitDone();
  }, []);

  return (
    <div className="unit-completion-screen animate__animated animate__fadeIn">
      <div className="unit-completion-hero">
        <div className="unit-completion-icon wow-glow wow-float animate__animated animate__bounceIn">
          <Icon name="military_tech" filled />
        </div>
        <h1 className="unit-completion-title animate__animated animate__fadeInDown" style={{ animationDelay: '200ms' }}>
          {t('unitCompletion.title', { num: unitIndex + 1 })}
        </h1>
        <p className="unit-completion-subtitle animate__animated animate__fadeInUp" style={{ animationDelay: '300ms' }}>{unit ? t(`course.${unit.id}.title`) : ''}</p>
      </div>

      <div className="unit-stats-row">
        <div className="unit-stat animate__animated animate__zoomIn" style={{ animationDelay: '450ms' }}>
          <span className="unit-stat-value">{signsLearned}</span>
          <span className="unit-stat-label">{t('unitCompletion.statSigns')}</span>
        </div>
        <div className="unit-stat animate__animated animate__zoomIn" style={{ animationDelay: '550ms' }}>
          <span className="unit-stat-value">+{xpGained}</span>
          <span className="unit-stat-label">{t('unitCompletion.statXp')}</span>
        </div>
        <div className="unit-stat animate__animated animate__zoomIn" style={{ animationDelay: '650ms' }}>
          <span className="unit-stat-value">{unit?.lessons.length ?? 0}</span>
          <span className="unit-stat-label">{t('unitCompletion.statLessons')}</span>
        </div>
      </div>

      {nextUnit && (
        <div className="unit-next-preview animate__animated animate__fadeInUp" style={{ animationDelay: '750ms' }}>
          <p className="unit-next-label">{t('unitCompletion.next')}</p>
          <div className="unit-next-card">
            <Icon name="trophy" className="unit-next-icon" />
            <div>
              <div className="unit-next-title">{t('unitCompletion.nextTitle', { num: unitIndex + 2, title: t(`course.${nextUnit.id}.title`) })}</div>
              <div className="unit-next-desc">{t(`course.${nextUnit.id}.desc`)}</div>
            </div>
          </div>
        </div>
      )}

      <button className="btn btn-primary unit-completion-cta" onClick={onContinue}>
        {nextUnit ? t('unitCompletion.continueToUnit', { num: unitIndex + 2 }) : t('common.continue')}
        <Icon name="arrow_forward" />
      </button>
    </div>
  );
}
