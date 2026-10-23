import { useEffect, useRef } from 'react';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { useT, type TFunc } from '../i18n';
import type { LessonSessionResult } from './LessonScreen';
import { Icon } from '../components/Icon';
import { signsMap } from '../lib/content';
import { TraceBurst } from '../components/Brand';

function achievementLabel(code: string, t: TFunc): string {
  const labels: Record<string, string> = {
    PRIMEIRA_LICAO: t('lessonCompletion.achievement.primeiraLicao'),
    SEQUENCIA_3: t('lessonCompletion.achievement.sequencia3'),
    SEQUENCIA_7: t('lessonCompletion.achievement.sequencia7'),
    SEQUENCIA_30: t('lessonCompletion.achievement.sequencia30'),
    SINAIS_5: t('lessonCompletion.achievement.sinais5'),
    SINAIS_10: t('lessonCompletion.achievement.sinais10'),
    SINAIS_26: t('lessonCompletion.achievement.sinais26'),
    CAMERA_ESTREANTE: t('lessonCompletion.achievement.cameraEstreante'),
    U1_COMPLETA: t('lessonCompletion.achievement.u1Completa'),
  };
  return labels[code] ?? code;
}

export interface CompletionData {
  result: LessonSessionResult;
  xpAwarded: number;
  xpTotal: number;
  streak: number;
  goalMet: boolean;
  achievementsEarned: string[];
}

interface Props {
  data: CompletionData;
  onContinue: () => void;
}

/** +XP no centro da explosão de setas (Traço): as setas saem do número, uma depois da outra. */
function XpBurst({ xp, trophy }: { xp: number; trophy: boolean }) {
  const { t } = useT();
  return (
    <div className="completion-burst">
      {trophy && <Icon name="trophy" filled size="40px" className="completion-burst-trophy" />}
      <TraceBurst value={`+${xp}`} unit="XP" label={t('lessonCompletion.xpGain', { xp })} />
    </div>
  );
}

export function LessonCompletionScreen({ data, onContinue }: Props) {
  const { t } = useT();
  const { result, xpAwarded, xpTotal, streak, goalMet, achievementsEarned } = data;
  const pct = Math.round(result.score * 100);
  const isLastLesson = result.isLastLesson;
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    if (goalMet) Haptics.goalMet();
    else Haptics.correct();
    Sfx.lessonDone();
    // A celebração é a explosão de setas (XpBurst), desenhada na própria tela
  }, [goalMet]);

  // Som da conquista junto com o banner (que entra com 1 s de atraso, animate__delay-1s)
  useEffect(() => {
    if (achievementsEarned.length === 0) return;
    const timer = setTimeout(Sfx.achievement, 1000);
    return () => clearTimeout(timer);
  }, [achievementsEarned.length]);

  const signsReviewed = [...new Set(result.reviewed.map(r => r.signId))];

  return (
    <div className="completion-screen animate__animated animate__fadeIn">
      {achievementsEarned.length > 0 && (
        <div className="achievement-unlocked-banner animate__animated animate__tada animate__delay-1s">
          {achievementsEarned.map(code => (
            <div key={code} className="achievement-unlocked-item">
              <Icon name="military_tech" filled />
              <span>{achievementLabel(code, t)}</span>
            </div>
          ))}
        </div>
      )}

      <XpBurst xp={xpAwarded} trophy={isLastLesson} />

      <h1 className="animate__animated animate__fadeInUp" style={{ animationDelay: '200ms' }}>
        {isLastLesson ? t('lessonCompletion.titleAlphabet') : pct >= 80 ? t('lessonCompletion.titleGreat') : t('lessonCompletion.titleDone')}
      </h1>

      <p className="completion-sub animate__animated animate__fadeInUp" style={{ animationDelay: '300ms' }}>
        {isLastLesson
          ? t('lessonCompletion.subAlphabet')
          : t('lessonCompletion.subScore', { pct })}
      </p>

      <div className="stats-row">
        <div className="stat-item animate__animated animate__zoomIn" style={{ animationDelay: '450ms' }}>
          <Icon name="bolt" filled size="24px" className="stat-item-icon tone-xp" />
          <span className="stat-value">+{xpAwarded}</span>
          <span className="stat-label">{t('lessonCompletion.statXp')}</span>
        </div>
        <div className="stat-item animate__animated animate__zoomIn" style={{ animationDelay: '550ms' }}>
          <Icon name="local_fire_department" filled size="24px" className="stat-item-icon tone-streak" />
          <span className="stat-value">{streak}</span>
          <span className="stat-label">{t('lessonCompletion.statStreak')}</span>
        </div>
        <div className="stat-item animate__animated animate__zoomIn" style={{ animationDelay: '650ms' }}>
          <Icon name="sign_language" filled size="24px" className="stat-item-icon tone-hand" />
          <span className="stat-value">{result.signsLearnedDelta}</span>
          <span className="stat-label">{t('lessonCompletion.statNewSigns')}</span>
        </div>
      </div>

      {signsReviewed.length > 0 && (
        <div className="signs-practiced-row">
          <p className="signs-practiced-label">{t('lessonCompletion.signsPracticed')}</p>
          <div className="signs-practiced-list">
            {signsReviewed.map((signId, i) => {
              const gloss = signsMap[signId]?.gloss ?? signId;
              return (
                <div
                  key={signId}
                  className="signs-practiced-chip animate__animated animate__zoomIn"
                  style={{ animationDelay: `${700 + i * 60}ms` }}
                >{gloss}</div>
              );
            })}
          </div>
        </div>
      )}

      {goalMet && (
        <div className="goal-met-banner animate__animated animate__bounceIn" style={{ animationDelay: '800ms' }}>
          <Icon name="bolt" filled /> {t('lessonCompletion.goalMet')}
        </div>
      )}

      <p className="completion-total">{t('lessonCompletion.totalAccrued', { xp: xpTotal })}</p>

      <button className="btn btn-primary completion-cta" onClick={onContinue}>
        {isLastLesson ? t('lessonCompletion.seeProgress') : t('common.continue')}
        <Icon name="arrow_forward" />
      </button>
    </div>
  );
}
