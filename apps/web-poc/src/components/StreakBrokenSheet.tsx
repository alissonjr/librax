import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';

interface Props {
  brokenStreak: number;
  onStudyNow: () => void;
  /** "Ver meu histórico": abre a StreakScreen no estado zerada (spec-02 12.10). */
  onOpenHistory?: () => void;
  onDismiss: () => void;
}

/** Aviso de sequência quebrada (spec-02 12.10, passo 2 do AppOpenFlow). */
export function StreakBrokenSheet({ brokenStreak, onStudyNow, onOpenHistory, onDismiss }: Props) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    titleRef.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      className={`streak-sheet-backdrop${visible ? ' streak-sheet-backdrop--visible' : ''}`}
      onClick={onDismiss}
    >
      <div
        className={`streak-sheet${visible ? ' streak-sheet--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="streak-sheet-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="streak-sheet-handle" aria-hidden="true" />

        <div className="streak-sheet-icon streak-sheet-icon--broken animate__animated animate__headShake animate__delay-1s">
          <Icon name="local_fire_department" filled />
        </div>

        <h2 id="streak-sheet-title" ref={titleRef} tabIndex={-1} className="streak-sheet-title">
          {t('streakBrokenSheet.title', { days: brokenStreak })}
        </h2>
        <p className="streak-sheet-sub">
          {t('streakBrokenSheet.sub')}
        </p>

        <div className="streak-sheet-actions">
          <button className="btn btn-primary" onClick={onStudyNow}>
            {t('streakBrokenSheet.startNew')} <Icon name="arrow_forward" />
          </button>
          {onOpenHistory && (
            <button className="btn btn-ghost" onClick={onOpenHistory}>
              <Icon name="history" /> {t('streakBrokenSheet.history')}
            </button>
          )}
          <button className="btn-text-muted" onClick={onDismiss}>
            {t('streakBrokenSheet.notNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
