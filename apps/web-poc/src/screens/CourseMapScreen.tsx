import { useEffect, useState } from 'react';
import { course } from '../lib/course';
import { loadCourseProgress, type LessonStatus } from '../lib/progress';
import { getDisplayName } from '../lib/auth';
import { getToday } from '../lib/today';
import type { IdbRepo } from '../lib/idbRepo';
import { useT, type TFunc } from '../i18n';
import { Icon } from '../components/Icon';
import { ScreenSkeleton } from '../components/ScreenSkeleton';
import { useScrollRestore } from '../hooks/useScrollRestore';
import { TraceArc, TraceOrbit, Wordmark } from '../components/Brand';
import { latestLessonRun } from '../lib/lessonRun';
import { scheduleCameraPrefetch } from '../lib/assetDownload';
import { CameraPrepChip } from '../components/CameraPrepChip';
import { InstallBanner } from '../components/InstallBanner';

interface MapState {
  xpTotal: number;
  streak: number;
  dayXp: number;
  dailyGoalXp: number;
  achievements: string[];
  lessonStatuses: Map<string, LessonStatus>;
  bestScores: Map<string, number>;
  nextLesson: string | null;
}

interface Props {
  repo: IdbRepo;
  userId: string;
  onStartLesson: (lessonId: string) => void;
  onOpenStreak: () => void;
  onOpenProfile: () => void;
  /** O convite completo de instalar está na vez (AppOpenFlow): a faixa do topo não aparece junto. */
  installInvitePending?: boolean;
}

function stars(score: number): number {
  if (score >= 0.95) return 3;
  if (score >= 0.7) return 2;
  return 1;
}

export function CourseMapScreen({
  repo, userId, onStartLesson, onOpenStreak, onOpenProfile, installInvitePending = false,
}: Props) {
  const { t } = useT();
  const [state, setState] = useState<MapState | null>(null);
  const today = getToday();
  const name = getDisplayName() ?? t('common.defaultName');
  const hoursNow = new Date().getHours();
  // Ao voltar de uma lição, o mapa volta à posição em que estava, depois que os dados carregam
  useScrollRestore(state !== null);

  // Quem chegou ao mapa vai usar a câmera: os arquivos dela baixam em segundo plano, depois da
  // abertura e com o app ocioso (uma vez por sessão; nada se a conexão for lenta ou economizando dados)
  useEffect(() => { scheduleCameraPrefetch(); }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const profile = await repo.getProfile(userId) as Record<string, unknown> | null;
      const xpTotal = (profile?.xpTotal as number) ?? 0;
      const streak = (profile?.streak as number) ?? 0;
      const dailyGoalXp = (profile?.dailyGoalXp as number) ?? 20;
      const achievements = (profile?.achievements as string[]) ?? [];
      const dayXp = await repo.getDayXp(userId, today);
      // Mesma regra de desbloqueio da guarda de /licao/:id (lib/progress.ts)
      const { lessonStatuses, bestScores, nextLesson } = await loadCourseProgress(repo, userId);

      if (!cancelled) setState({ xpTotal, streak, dayXp, dailyGoalXp, achievements, lessonStatuses, bestScores, nextLesson });
    }
    load();
    return () => { cancelled = true; };
  }, [repo, userId, today]);

  if (!state) return <ScreenSkeleton />;

  const dailyPct = Math.min(100, Math.round((state.dayXp / state.dailyGoalXp) * 100));
  const goalDone = state.dayXp >= state.dailyGoalXp;
  const atRisk = state.streak > 0 && state.dayXp === 0 && hoursNow >= 20;
  const allDone = [...state.lessonStatuses.values()].every(s => s === 'completed');

  const nextLessonObj = state.nextLesson
    ? course.units.flatMap(u => u.lessons).find(l => l.id === state.nextLesson)
    : null;
  // Lição em andamento (a página recarregou ou a pessoa saiu pelo menu): Retomar volta ao ponto onde parou
  const run = latestLessonRun(userId);
  const inProgress = run && course.lessonsMap[run.lessonId] ? run : null;

  return (
    <>
      <div className="coursemap-topbar animate__animated animate__fadeInDown animate__faster">
        <div className="coursemap-hello">
          <Wordmark size={18} />
          <div className="coursemap-greeting">
            {greetingTime(t)}, <strong>{name}</strong>
          </div>
        </div>
        <div className="coursemap-stats">
          <button className="topbar-stat topbar-stat--btn" onClick={onOpenStreak} aria-label={t('courseMap.streakAria')}>
            <Icon name="local_fire_department" filled className="topbar-stat-icon topbar-stat-icon--streak" />
            <span>{state.streak}</span>
          </button>
          <button className="topbar-stat topbar-stat--btn" onClick={onOpenProfile} aria-label={t('courseMap.profileAria')}>
            <Icon name="bolt" filled className="topbar-stat-icon topbar-stat-icon--xp" />
            <span>{state.xpTotal}</span>
          </button>
        </div>
      </div>

      <div className="coursemap-body">
        {/* Instalar o app: só numa aba do navegador, monta junto com o mapa (decisão 13) */}
        <InstallBanner suppressed={installInvitePending} />

        {/* Daily Goal Bar */}
        <div className="xp-bar-card">
          <div className="xp-bar-header">
            {goalDone
              ? <span className="xp-bar-done">
                  <Icon name="check_circle" filled /> {t('courseMap.goalDoneToday')}
                </span>
              : <span className="xp-bar-title"><Icon name="bolt" filled className="xp-bar-icon" /> {t('courseMap.goalToday')}</span>
            }
            <span className="xp-bar-value">{state.dayXp} / {state.dailyGoalXp} XP</span>
          </div>
          <div
            className="progress-bar-wrap progress-bar-wrap--goal"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={state.dailyGoalXp}
            aria-valuenow={Math.min(state.dayXp, state.dailyGoalXp)}
            aria-label={t('courseMap.goalToday')}
          >
            <div className="progress-bar-fill progress-bar-fill--xp" style={{ width: `${dailyPct}%` }} />
          </div>
        </div>

        {/* Streak at risk */}
        {atRisk && (
          <button className="streak-risk-banner animate__animated animate__headShake" onClick={onOpenStreak}>
            <Icon name="warning" filled />
            <span>
              {t('courseMap.streakAtRisk').split('{days}')[0]}
              <strong>{state.streak}</strong>
              {t('courseMap.streakAtRisk').split('{days}')[1]}
            </span>
          </button>
        )}

        {/* Unidades e trilha de lições (seção 11.4 da proposta) */}
        {course.units.map((unit, ui) => {
          const doneInUnit = unit.lessons.filter(l => state.lessonStatuses.get(l.id) === 'completed').length;
          const unitPct = Math.round((doneInUnit / (unit.lessons.length || 1)) * 100);
          return (
          <section key={unit.id} className="unit-section">
            <div className="unit-header">
              <div className="unit-header-text">
                <span className="unit-badge">{t('courseMap.unitLabel', { num: ui + 1 })}</span>
                <div className="unit-title">{t(`course.${unit.id}.title`)}</div>
                <div className="unit-desc">{t(`course.${unit.id}.desc`)}</div>
              </div>
              <div className="unit-progress">
                <span className="unit-progress-label">{t('courseMap.unitProgress', { done: doneInUnit, total: unit.lessons.length })}</span>
                <div className="unit-progress-bar" aria-hidden="true">
                  <div className="unit-progress-fill" style={{ width: `${unitPct}%` }} />
                </div>
              </div>
            </div>

            <ol className="lesson-trail">
            {unit.lessons.map((lesson, li) => {
              const st = state.lessonStatuses.get(lesson.id) ?? 'locked';
              const score = state.bestScores.get(lesson.id) ?? 0;
              const markCount = st === 'completed' ? stars(score) : 0;
              const isCurrent = st === 'available';
              const statusLabel = st === 'completed' ? t('courseMap.statusCompleted') : st === 'available' ? t('courseMap.statusAvailable') : st === 'due_srs' ? t('courseMap.statusReview') : t('courseMap.statusLocked');
              const title = t(`course.${lesson.id}`);
              return (
                <li
                  key={lesson.id}
                  className={`lesson-row ${st}${isCurrent ? ' current' : ''} animate__animated animate__fadeInUp animate__faster`}
                  style={{ animationDelay: `${li * 60}ms` }}
                  onClick={() => st !== 'locked' && onStartLesson(lesson.id)}
                  role="button"
                  tabIndex={st !== 'locked' ? 0 : -1}
                  aria-disabled={st === 'locked' ? true : undefined}
                  aria-label={t('courseMap.nodeAria', { num: li + 1, title, status: statusLabel })}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && st !== 'locked' && onStartLesson(lesson.id)}
                >
                  <span className="lesson-node" aria-hidden="true">
                    {st === 'completed' && <Icon name="check" size="28px" />}
                    {st === 'available' && <Icon name="play_arrow" filled size="32px" />}
                    {isCurrent && <TraceOrbit />}
                    {st === 'due_srs' && <Icon name="replay" size="28px" />}
                    {st === 'locked' && <Icon name="lock" filled size="24px" />}
                  </span>
                  <div className="lesson-info">
                    <h3>{title}</h3>
                    <p>{t('courseMap.signsXp', { count: lesson.signIds.length, xp: lesson.xpReward })}</p>
                    {markCount > 0 && (
                      <span className="lesson-marks" aria-hidden="true">
                        {[1, 2, 3].map(n => (
                          <i key={n} className={`lesson-mark${n <= markCount ? ' lesson-mark--on' : ''}`} />
                        ))}
                      </span>
                    )}
                  </div>
                  {isCurrent
                    ? <span className="lesson-badge next">{t('courseMap.start')}</span>
                    : st === 'due_srs'
                      ? <span className="lesson-badge srs">{statusLabel}</span>
                      : null}
                </li>
              );
            })}
            </ol>
          </section>
          );
        })}

        <p className="coursemap-footnote">
          {t('courseMap.progressSaved')}
        </p>
      </div>

      {/* Resume banner, com o selo da câmera flutuando acima dele (fora do fluxo: o mapa não se mexe) */}
      <div className="coursemap-dock">
        <CameraPrepChip />
        <div className="resume-banner animate__animated animate__slideInUp">
          <TraceArc className="resume-banner-arc" />
          {inProgress ? (
            <button className="resume-banner-content" onClick={() => onStartLesson(inProgress.lessonId)}>
              <Icon name="play_arrow" filled />
              <span>{t('courseMap.resume', { title: t(`course.${inProgress.lessonId}`) })}</span>
              <Icon name="arrow_forward" className="resume-arrow" />
            </button>
          ) : allDone ? (
            <button className="resume-banner-content" onClick={() => onStartLesson(state.nextLesson ?? '')}>
              <Icon name="replay" />
              <span>{t('courseMap.reviewSrs')}</span>
              <Icon name="arrow_forward" className="resume-arrow" />
            </button>
          ) : goalDone ? (
            <button className="resume-banner-content resume-banner-content--goal" onClick={() => onStartLesson(state.nextLesson ?? '')}>
              <Icon name="check_circle" filled />
              <span>{t('courseMap.goalDoneKeepPracticing')}</span>
              <Icon name="arrow_forward" className="resume-arrow" />
            </button>
          ) : nextLessonObj ? (
            <button className="resume-banner-content" onClick={() => onStartLesson(nextLessonObj.id)}>
              <Icon name="play_arrow" filled />
              <span>{t('courseMap.resume', { title: t(`course.${nextLessonObj.id}`) })}</span>
              <Icon name="arrow_forward" className="resume-arrow" />
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

function greetingTime(t: TFunc): string {
  const h = new Date().getHours();
  const key = h < 12 ? 'greetingMorning' : h < 18 ? 'greetingAfternoon' : 'greetingEvening';
  return t(`courseMap.${key}`);
}
