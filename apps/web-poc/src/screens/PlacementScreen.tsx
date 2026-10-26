import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { course } from '../lib/course';
import type { Sign } from '../lib/content';
import type { IdbRepo } from '../lib/idbRepo';
import { loadCourseProgress } from '../lib/progress';
import { getToday } from '../lib/today';
import {
  applyPlacement, buildPlacementPlan, drawPlacementOptions, markPlacementDone, nextItemIndex,
  isReviewLesson, placementLessons, reviewLessonsToSkip, scorePlacement, withinNoCameraCap, withoutCamera,
  NO_CAMERA_MAX_LESSONS,
  type PlacementAnswer, type PlacementCapabilities, type PlacementItem, type PlacementLessonResult,
} from '../lib/placement';
import { hasHand3d, webglAvailable } from '../mao3d/disponivel';
import { loadClassifier } from '../recognition/classifier';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { ScreenSkeleton } from '../components/ScreenSkeleton';
import { PlacementCameraItem, PlacementChoiceItem, PlacementMotionItem, type CameraLoss } from '../components/PlacementItems';
import '../styles/placement.css';

/**
 * /nivelamento: o teste de nivelamento (lib/placement.ts), sempre opcional.
 * Convite -> itens (câmera ou "qual letra é esta?") -> resultado, onde a pessoa escolhe o que pular.
 * Sair no meio não muda nada no curso (a rota pergunta antes, como na lição).
 */

interface Loaded {
  signs: Record<string, Sign>;
  /** Capacidades do aparelho, menos a escolha de usar a câmera. */
  caps: Omit<PlacementCapabilities, 'camera'>;
  completed: Set<string>;
  /** Lições já puladas num teste anterior (contam como origem das revisões). */
  placedBefore: Set<string>;
  /** A câmera avalia algum número neste aparelho (sem isso, a parte dos números não pularia nada). */
  numbersAvailable: boolean;
}

interface TestState {
  camera: boolean;
  /** A parte dos números entrou no teste. */
  numbers: boolean;
  lessonIds: string[];
  plan: PlacementItem[];
  answers: Record<number, PlacementAnswer>;
  index: number;
  cameraLost: boolean;
}

type Phase = 'intro' | 'test' | 'result';

interface Props {
  repo: IdbRepo;
  userId: string;
  /** Sair sem mudar nada (convite recusado, ou o X do teste, que a rota confirma). */
  onClose: () => void;
  /** Resultado decidido: `placed` lições puladas (0 quando a pessoa não pulou nada). */
  onFinished: (placed: number) => void;
  /** O teste está em andamento (a rota segura a saída com "Sair do teste?"). */
  onTestingChange?: (testing: boolean) => void;
  /** "Sair do teste?" aberto: o tempo do item para. */
  paused?: boolean;
  /** Só para os testes: sorteio fixo. */
  rng?: () => number;
}

export function PlacementScreen({ repo, userId, onClose, onFinished, onTestingChange, paused = false, rng = Math.random }: Props) {
  const { t } = useT();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [includeNumbers, setIncludeNumbers] = useState(false);
  const [test, setTest] = useState<TestState | null>(null);
  const [results, setResults] = useState<PlacementLessonResult[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let alive = true;
    (async () => {
      const content = await import('../lib/content');
      // Os índices dos modelos decidem o que a câmera avalia (como na rota da lição)
      await Promise.all([
        loadClassifier(), content.loadLetterMotionIndex(), content.loadNumberIndex(),
      ]).catch(() => {});
      const progress = await loadCourseProgress(repo, userId);
      const completed = new Set([...progress.lessonStatuses].filter(([, st]) => st === 'completed').map(([id]) => id));
      const signs = content.signsMap;
      const caps: Loaded['caps'] = {
        letterMotion: s => content.isLetterMotionEvaluable(signs[s.id]),
        staticLetter: s => content.isCameraEvaluable(signs[s.id]),
        number: s => content.isNumberEvaluable(signs[s.id]),
        hand3d: s => hasHand3d(s) && webglAvailable(),
      };
      const numbersAvailable = (course.units[1]?.lessons ?? []).some(l => l.signIds.some(id => signs[id] && caps.number(signs[id])));
      const placedBefore = new Set(progress.placedLessons ?? []);
      if (alive) setLoaded({ signs, caps, completed, placedBefore, numbersAvailable });
    })().catch(() => { if (alive) closeRef.current(); });
    return () => { alive = false; };
  }, [repo, userId]);

  useEffect(() => {
    onTestingChange?.(phase === 'test');
  }, [phase, onTestingChange]);

  const start = (camera: boolean) => {
    if (!loaded) return;
    const numbers = includeNumbers && loaded.numbersAvailable && camera;
    const plan = buildPlacementPlan({
      completed: loaded.completed,
      includeNumbers: numbers,
      caps: { ...loaded.caps, camera },
      signs: loaded.signs,
      rng,
    });
    const lessonIds = [...new Set(plan.map(it => it.lessonId))];
    setTest({ camera, numbers, lessonIds, plan, answers: {}, index: 0, cameraLost: !camera });
    setPhase('test');
  };

  const finishTest = useCallback((state: TestState) => {
    const res = scorePlacement(state.lessonIds, state.plan, state.answers);
    setResults(res);
    setChosen(new Set(res.filter(r => r.outcome === 'mastered').map(r => r.lessonId)));
    setPhase('result');
  }, []);

  const handleAnswer = useCallback((answer: PlacementAnswer) => {
    setTest(prev => {
      if (!prev) return prev;
      const answers = { ...prev.answers, [prev.index]: answer };
      const index = nextItemIndex(prev.plan, answers, prev.index + 1);
      return { ...prev, answers, index };
    });
  }, []);

  const handleCameraLost = useCallback((reason: CameraLoss) => {
    setTest(prev => {
      if (!prev || prev.plan[prev.index]?.kind === 'choice') return prev;
      if (reason === 'model') {
        const plan = prev.plan.map((it, i) => (i === prev.index ? { ...it, kind: 'choice' as const } : it));
        return { ...prev, plan };
      }
      const plan = withoutCamera(prev.plan, prev.answers, prev.index);
      const index = nextItemIndex(plan, prev.answers, prev.index);
      return { ...prev, plan, index, cameraLost: true };
    });
  }, []);

  // Acabaram os itens: o resultado
  useEffect(() => {
    if (phase === 'test' && test && test.index >= test.plan.length) finishTest(test);
  }, [phase, test, finishTest]);

  const current = test && phase === 'test' ? test.plan[test.index] : null;
  const currentSign = current ? loaded?.signs[current.signId] : undefined;
  const options = useMemo(() => {
    if (!current || !currentSign || current.kind !== 'choice' || !loaded) return [];
    return drawPlacementOptions(currentSign, course.lessonsMap[current.lessonId]?.signIds ?? [], loaded.signs, rng);
  // Um sorteio por item: muda quando o item (ou o tipo dele) muda
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test?.index, current?.signId, current?.kind, loaded]);

  async function applyChosen() {
    if (saving) return;
    setSaving(true);
    const picked = [
      ...results.filter(r => chosen.has(r.lessonId)),
      ...reviewSkips().map(lessonId => ({ lessonId, passedSigns: [] as string[] })),
    ];
    try {
      const placed = await applyPlacement(repo, userId, picked, getToday());
      onFinished(placed);
    } catch {
      setSaving(false);
    }
  }

  /** Revisões puladas junto com as lições marcadas (lib/placement.ts reviewLessonsToSkip). */
  function reviewSkips(): string[] {
    if (!test || !loaded) return [];
    const skipped = new Set([...loaded.placedBefore, ...results.filter(r => chosen.has(r.lessonId)).map(r => r.lessonId)]);
    return reviewLessonsToSkip(test.numbers, skipped, loaded.completed);
  }

  function keepAll() {
    markPlacementDone(getToday());
    onFinished(0);
  }

  if (!loaded) return <ScreenSkeleton />;

  /* ---------- convite ---------- */
  if (phase === 'intro') {
    // Só as lições com sinais novos são testadas (as revisões vão junto no resultado)
    const remaining = (course.units[0]?.lessons ?? []).filter(l => !loaded.completed.has(l.id) && !isReviewLesson(l));
    // Sem câmera o teste só cobre as primeiras lições: se já foram feitas, não há o que oferecer
    const noCameraPossible = remaining.some(l => withinNoCameraCap(l.id));
    return (
      <div className="lesson-screen placement-screen">
        <div className="lesson-topbar">
          <button className="back-btn" onClick={onClose} aria-label={t('common.back')}>
            <Icon name="arrow_back" />
          </button>
          <span className="placement-topbar-title">{t('placement.title')}</span>
        </div>
        <div className="placement-body">
          <div className="placement-hero" aria-hidden="true"><Icon name="sign_language" /></div>
          <h1 className="placement-title">{t('placement.introTitle')}</h1>
          {remaining.length === 0 ? (
            <>
              <p className="placement-text">{t('placement.nothingToTest')}</p>
              <button className="btn btn-primary" onClick={onClose}>{t('placement.backToMap')}</button>
            </>
          ) : (
            <>
              <p className="placement-text">{t('placement.introText')}</p>
              <ul className="placement-facts">
                <li><Icon name="timer" /> {t('placement.introTime')}</li>
                <li><Icon name="skip_next" /> {t('placement.introSkip')}</li>
                <li><Icon name="bolt" /> {t('placement.introNoXp')}</li>
                <li><Icon name="replay" /> {t('placement.introUndo')}</li>
              </ul>
              {loaded.numbersAvailable && (
                <label className="placement-check">
                  <input
                    type="checkbox"
                    checked={includeNumbers}
                    onChange={e => setIncludeNumbers(e.target.checked)}
                  />
                  <span>{t('placement.includeNumbers')}</span>
                </label>
              )}
              <div className="placement-actions">
                <button className="btn btn-primary" onClick={() => start(true)}>
                  <Icon name="videocam" /> {t('placement.start')}
                </button>
                <button className="btn btn-secondary" onClick={onClose}>
                  {t('placement.notNow')}
                </button>
                {noCameraPossible && (
                  <>
                    <button className="btn-text placement-nocam" onClick={() => start(false)}>
                      <Icon name="videocam_off" /> {t('placement.noCamera')}
                    </button>
                    <p className="placement-note">{t('placement.noCameraNote', { count: NO_CAMERA_MAX_LESSONS })}</p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ---------- resultado ---------- */
  if (phase === 'result') {
    const mastered = results.filter(r => r.outcome === 'mastered');
    const reviewSkip = new Set(reviewSkips());
    const count = mastered.filter(r => chosen.has(r.lessonId)).length + reviewSkip.size;
    // Linhas na ordem do curso: as testadas e as revisões que o teste cobre
    const byId = new Map(results.map(r => [r.lessonId, r]));
    const rows = placementLessons(test?.numbers ?? false)
      .filter(l => byId.has(l.id) || (isReviewLesson(l) && !loaded.completed.has(l.id)));
    const toggle = (id: string) => setChosen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    return (
      <div className="lesson-screen placement-screen">
        <div className="lesson-topbar">
          <span className="placement-topbar-title placement-topbar-title--solo">{t('placement.title')}</span>
        </div>
        <div className="placement-body">
          <h1 className="placement-title">{t('placement.resultTitle')}</h1>
          <p className="placement-text">
            {mastered.length > 0
              ? t('placement.resultSome', { count: mastered.length, total: results.length })
              : t('placement.resultNone')}
          </p>
          {mastered.length > 0 && <p className="placement-note">{t('placement.resultHint')}</p>}
          {results.length > 0 && (
            <ul className="placement-results">
              {rows.map(lesson => {
                const r = byId.get(lesson.id);
                const title = t(`course.${lesson.id}`);
                if (!r) {
                  const skip = reviewSkip.has(lesson.id);
                  return (
                    <li key={lesson.id} className={`placement-result placement-result--${skip ? 'review' : 'missed'}`}>
                      <span className="placement-result-main">
                        <Icon name="replay" className="placement-result-icon" />
                        <span className="placement-result-title">{title}</span>
                      </span>
                      <span className={`placement-chip placement-chip--${skip ? 'mastered' : 'missed'}`}>
                        {t(skip ? 'placement.outcomeReviewSkip' : 'placement.outcomeReviewKeep')}
                      </span>
                    </li>
                  );
                }
                const outcomeKey = r.outcome === 'mastered' ? 'outcomeMastered' : r.outcome === 'missed' ? 'outcomeMissed' : 'outcomeNeedsCamera';
                return (
                  <li key={r.lessonId} className={`placement-result placement-result--${r.outcome}`}>
                    {r.outcome === 'mastered' ? (
                      <label className="placement-result-main">
                        <input type="checkbox" checked={chosen.has(r.lessonId)} onChange={() => toggle(r.lessonId)} />
                        <span className="placement-result-title">{title}</span>
                      </label>
                    ) : (
                      <span className="placement-result-main">
                        <Icon name={r.outcome === 'missed' ? 'school' : 'videocam_off'} className="placement-result-icon" />
                        <span className="placement-result-title">{title}</span>
                      </span>
                    )}
                    <span className={`placement-chip placement-chip--${r.outcome}`}>{t(`placement.${outcomeKey}`)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {rows.some(l => !byId.has(l.id)) && <p className="placement-note"><Icon name="replay" /> {t('placement.reviewNote')}</p>}
          <p className="placement-note"><Icon name="info" /> {t('placement.noXpNote')}</p>
          <div className="placement-actions">
            {count > 0 ? (
              <>
                <button className="btn btn-primary" onClick={applyChosen} disabled={saving} aria-busy={saving || undefined}>
                  <Icon name="skip_next" /> {t('placement.applyCount', { count })}
                </button>
                <button className="btn btn-secondary" onClick={keepAll} disabled={saving}>{t('placement.keepAll')}</button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={keepAll}>{t('placement.applyNone')}</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- itens ---------- */
  if (!test || !current || !currentSign) return <ScreenSkeleton />;
  const onStage = current.kind !== 'choice';
  // Itens que ainda vão aparecer (um item errado tira o resto da lição)
  const reachable = test.plan
    .map((_, i) => i)
    .filter(i => (i < test.index ? test.answers[i] !== undefined : nextItemIndex(test.plan, test.answers, i) === i));
  const position = reachable.indexOf(test.index) + 1;
  const total = reachable.length;
  const pct = Math.round(((position - 1) / Math.max(1, total)) * 100);

  return (
    <div className={`lesson-screen placement-screen${onStage ? ' lesson-screen--stage lx-theme-dark' : ''}`}>
      <div className="lesson-topbar">
        <button className="back-btn" onClick={onClose} aria-label={t('placement.close')}>
          <Icon name="close" />
        </button>
        <div
          className="progress-bar-wrap progress-bar-wrap--lesson"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={position - 1}
          aria-valuetext={t('placement.progress', { current: position, total })}
        >
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-label">{position}/{total}</span>
      </div>
      {test.cameraLost && test.camera && (
        <p className="placement-banner" role="status"><Icon name="videocam_off" /> {t('placement.cameraLost', { count: NO_CAMERA_MAX_LESSONS })}</p>
      )}
      <div key={`${test.index}-${current.kind}`} className="lesson-exercise-wrap animate__animated animate__fadeIn animate__faster">
        {current.kind === 'choice' && (
          <PlacementChoiceItem sign={currentSign} options={options} onAnswer={handleAnswer} paused={paused} />
        )}
        {current.kind === 'camera-motion' && (
          <PlacementMotionItem sign={currentSign} onAnswer={handleAnswer} onCameraLost={handleCameraLost} paused={paused} />
        )}
        {(current.kind === 'camera-letter' || current.kind === 'camera-number') && (
          <PlacementCameraItem sign={currentSign} onAnswer={handleAnswer} onCameraLost={handleCameraLost} paused={paused} />
        )}
      </div>
    </div>
  );
}
