import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { useCloseOnBack } from '../hooks/useCloseOnBack';

interface Props {
  brokenStreak: number;
  onStudyNow: () => void;
  onDismiss: () => void;
}

export function StreakBrokenSheet({ brokenStreak, onStudyNow, onDismiss }: Props) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  // Voltar fecha o sheet (design-system 11.13)
  useCloseOnBack(true, onDismiss);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`streak-sheet-backdrop${visible ? ' streak-sheet-backdrop--visible' : ''}`}
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`streak-sheet${visible ? ' streak-sheet--open' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="streak-sheet-handle" />

        <div className="streak-sheet-icon streak-sheet-icon--broken animate__animated animate__headShake animate__delay-1s">
          <Icon name="local_fire_department" filled />
        </div>

        <h2 className="streak-sheet-title">{t('streakBrokenSheet.title', { days: brokenStreak })}</h2>
        <p className="streak-sheet-sub">
          {t('streakBrokenSheet.sub')}
        </p>

        <div className="streak-sheet-actions">
          <button className="btn btn-primary" onClick={onStudyNow}>
            {t('streakBrokenSheet.startNew')} <Icon name="arrow_forward" />
          </button>
          <button className="btn btn-ghost streak-sheet-freeze" onClick={onDismiss}>
            <Icon name="ac_unit" /> {t('streakBrokenSheet.useFreeze')}
          </button>
          <button className="btn-text-muted" onClick={onDismiss}>
            {t('streakBrokenSheet.notNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
