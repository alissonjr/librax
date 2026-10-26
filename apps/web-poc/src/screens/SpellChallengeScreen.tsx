import { useCallback, useEffect, useRef, useState } from 'react';
import { loadClassifier, loadLetterMotionIndex, resolveExercises, signsMap, type BundleExercise, type Exercise } from '../lib/content';
import {
  ChallengeClock, SPELL_CHALLENGE_SIZE, availableChallengeWords, formatChallengeTime, pickChallengeWords,
  prefersReducedMotion, readBestTime, recordChallengeTime, wordLetters,
} from '../lib/spellChallenge';
import type { IdbRepo } from '../lib/idbRepo';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { ExerciseFingerspell } from '../components/ExerciseFingerspell';
import { ExerciseOrderSequence } from '../components/ExerciseOrderSequence';
import { warmUpHandLandmarker } from '../recognition/landmarker';
import '../styles/spell.css';

type Phase = 'loading' | 'unavailable' | 'intro' | 'countdown' | 'run' | 'done';

interface Props {
  userId: string;
  repo: IdbRepo;
  onBack: () => void;
}

/** Contagem antes de começar (sem ela com menos movimento). */
const COUNTDOWN_FROM = 3;
const TICK_MS = 250;

/** Letras que a pessoa já viu nas lições (itens do SRS das letras). */
async function knownLetters(repo: IdbRepo, userId: string): Promise<Set<string>> {
  const items = await repo.listSrsItems(userId) as { signId: string }[];
  const out = new Set<string>();
  for (const { signId } of items) {
    const sign = signsMap[signId];
    if (sign?.category === 'alfabeto') out.add(sign.gloss);
  }
  return out;
}

/** As palavras como fingerspell do bundle, resolvidas como na lição (leitor de cada letra). */
function challengeExercises(words: string[]): Exercise[] {
  const items: BundleExercise[] = words.map((word, i) => ({
    id: `desafio-${i + 1}`, lesson_id: 'desafio', type: 'fingerspell', order: i + 1,
    payload: { word, letters: wordLetters(word), per_letter_confidence: null },
  }));
  return resolveExercises(items, [`letra-${words[0][0]}`], { displayName: null });
}

/**
 * Desafio de soletrar (lib/spellChallenge.ts): 3 palavras seguidas, o tempo na tela e o melhor
 * tempo no aparelho. Sem limite de tempo nem penalidade; pular uma palavra só tira o tempo do
 * recorde. Com menos movimento não há contagem regressiva nem relógio correndo: o tempo aparece no fim.
 */
export function SpellChallengeScreen({ userId, repo, onBack }: Props) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('loading');
  const [pool, setPool] = useState<string[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [now, setNow] = useState(0);
  const [result, setResult] = useState<{ ms: number; complete: boolean; newBest: boolean; best: number | null } | null>(null);
  const [best, setBest] = useState<number | null>(() => readBestTime());
  const [reduced] = useState(prefersReducedMotion);
  const clockRef = useRef(new ChallengeClock());
  const skippedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [letters] = await Promise.all([knownLetters(repo, userId), loadLetterMotionIndex(), loadClassifier()]);
      if (!alive) return;
      const words = availableChallengeWords(letters);
      setPool(words);
      setPhase(words.length >= SPELL_CHALLENGE_SIZE ? 'intro' : 'unavailable');
    })().catch(err => {
      console.error('[desafio] falha ao abrir', err);
      if (alive) setPhase('unavailable');
    });
    return () => { alive = false; };
  }, [repo, userId]);

  const begin = useCallback(() => {
    clockRef.current = new ChallengeClock();
    skippedRef.current = false;
    setIdx(0);
    setResult(null);
    clockRef.current.start(performance.now());
    setNow(performance.now());
    setPhase('run');
  }, []);

  function start() {
    warmUpHandLandmarker();
    setExercises(challengeExercises(pickChallengeWords(pool)));
    if (reduced) {
      begin();
      return;
    }
    setCount(COUNTDOWN_FROM);
    setPhase('countdown');
  }

  // Contagem 3, 2, 1 (só sem a preferência de menos movimento)
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) { begin(); return; }
    const timer = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, count, begin]);

  // Relógio na tela enquanto uma palavra está em andamento
  useEffect(() => {
    if (phase !== 'run' || reduced) return;
    const timer = setInterval(() => setNow(performance.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [phase, reduced]);

  function onAnswer(correct: boolean) {
    clockRef.current.pause(performance.now());
    setNow(performance.now());
    if (!correct) skippedRef.current = true;
  }

  function onNext() {
    const next = idx + 1;
    if (next < exercises.length) {
      setIdx(next);
      clockRef.current.start(performance.now());
      return;
    }
    const ms = clockRef.current.elapsed(performance.now());
    const complete = !skippedRef.current;
    const previous = readBestTime();
    const newBest = complete && recordChallengeTime(ms);
    setBest(readBestTime());
    setResult({ ms, complete, newBest, best: previous });
    setPhase('done');
  }

  const elapsed = clockRef.current.elapsed(now);

  if (phase === 'run') {
    const ex = exercises[idx];
    return (
      <div className="lesson-screen lesson-screen--stage lx-theme-dark spell-challenge">
        <div className="lesson-topbar">
          <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
            <Icon name="arrow_back" />
          </button>
          <span className="spell-challenge-count tabular">
            {t('spellChallenge.wordCount', { n: idx + 1, total: exercises.length })}
          </span>
          {reduced ? (
            <span className="spell-challenge-clock">{t('spellChallenge.clockHidden')}</span>
          ) : (
            <span className="spell-challenge-clock tabular" role="timer" aria-label={t('spellChallenge.clock', { time: formatChallengeTime(elapsed) })}>
              <Icon name="timer" /> {formatChallengeTime(elapsed)}
            </span>
          )}
        </div>
        <div key={idx} className="lesson-exercise-wrap">
          {ex?.type === 'fingerspell' && ex.word && ex.letters && (
            <ExerciseFingerspell
              word={ex.word}
              letters={ex.letters}
              readers={ex.spellReaders}
              perLetterConfidence={ex.perLetterConfidence}
              onAnswer={onAnswer}
              onNext={onNext}
            />
          )}
          {ex?.type === 'order_sequence' && (
            <ExerciseOrderSequence
              steps={ex.steps ?? []}
              correctOrder={ex.correctOrder ?? []}
              prompt={t('exerciseOrderSequence.spellPrompt', { word: ex.word ?? '' })}
              onAnswer={onAnswer}
              onNext={onNext}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="spell-challenge-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('spellChallenge.title')}</h1>
      </div>

      <div className="spell-challenge-body">
        {phase === 'loading' && (
          <div className="loading-spinner"><Icon name="progress_activity" spin /></div>
        )}

        {phase === 'unavailable' && (
          <div className="spell-challenge-card">
            <Icon name="lock" size="48px" />
            <p>{t('spellChallenge.unavailable')}</p>
            <button className="btn btn-secondary" onClick={onBack}>{t('spellChallenge.backToPractice')}</button>
          </div>
        )}

        {phase === 'intro' && (
          <div className="spell-challenge-card">
            <Icon name="timer" size="48px" />
            <p className="spell-challenge-lead">{t('spellChallenge.desc', { n: SPELL_CHALLENGE_SIZE })}</p>
            <p className="spell-challenge-best tabular">
              {best !== null ? t('spellChallenge.best', { time: formatChallengeTime(best) }) : t('spellChallenge.noBest')}
            </p>
            <button className="btn btn-primary" onClick={start}>
              <Icon name="play_arrow" /> {t('spellChallenge.start')}
            </button>
          </div>
        )}

        {phase === 'countdown' && (
          <div className="spell-challenge-card" aria-live="assertive">
            <p className="spell-challenge-countdown tabular" key={count} aria-label={t('spellChallenge.countdown', { n: count })}>{count}</p>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="spell-challenge-card">
            <Icon name={result.newBest ? 'trophy' : 'check_circle'} size="48px" />
            <h2>{t('spellChallenge.doneTitle')}</h2>
            <p className="spell-challenge-time tabular">{t('spellChallenge.yourTime', { time: formatChallengeTime(result.ms) })}</p>
            {result.newBest && <p className="spell-challenge-chip">{t('spellChallenge.newBest')}</p>}
            {!result.newBest && result.complete && result.best !== null && (
              <p className="spell-challenge-best tabular">{t('spellChallenge.best', { time: formatChallengeTime(result.best) })}</p>
            )}
            {!result.complete && <p className="spell-challenge-best">{t('spellChallenge.skippedNote')}</p>}
            <button className="btn btn-primary" onClick={start}>
              <Icon name="replay" /> {t('spellChallenge.again')}
            </button>
            <button className="btn btn-ghost" onClick={onBack}>{t('spellChallenge.backToPractice')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
