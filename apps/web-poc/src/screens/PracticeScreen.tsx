import { useEffect, useState, useCallback } from 'react';
import { getToday } from '../lib/today';
import { course, drawChoices, getSign, signsMap, shuffle } from '../lib/content';
import type { Sign } from '../lib/content';
import { ExerciseMc4 } from '../components/ExerciseMc4';
import type { IdbRepo } from '../lib/idbRepo';
import { getDailyQueue } from '@usecases/getDailyQueue.js';
import { reviewSigns } from '@usecases/reviewSigns.js';
import { addDays } from '@apilib/dates.js';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { SPELL_CHALLENGE_SIZE, availableChallengeWords, formatChallengeTime, readBestTime } from '../lib/spellChallenge';

interface QueueItem { signId: string; kind: 'review' | 'new'; }
type Phase = 'loading' | 'list' | 'session' | 'done';
/** review: fila do dia, grava o SRS; free: sinais já vistos, sem afetar o SRS (spec-03 11.12). */
type Mode = 'review' | 'free';

const SESSION_SIZE = 8;

interface SrsItemDisplay {
  signId: string;
  gloss: string;
  daysAgo: number;
  kind: 'review' | 'new';
}

interface Props {
  userId: string;
  repo: IdbRepo;
  onOpenCamera: () => void;
  /** Abre o desafio de soletrar (aparece quando as letras vistas já formam as palavras dele). */
  onOpenSpellChallenge?: () => void;
}

function daysDiff(dateStr: string, today: string): number {
  const a = new Date(today + 'T00:00:00');
  const b = new Date(dateStr + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function PracticeScreen({ userId, repo, onOpenCamera, onOpenSpellChallenge }: Props) {
  const { t } = useT();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [session, setSession] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<Mode>('review');
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [items, setItems] = useState<SrsItemDisplay[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const allSignIds = Object.keys(signsMap);

  const load = useCallback(async () => {
    setPhase('loading');
    const today = getToday();
    const q = await getDailyQueue(repo, course, { userId, today, size: SESSION_SIZE }) as QueueItem[];
    const srsItems = await repo.listSrsItems(userId) as { signId: string; dueAt?: string; interval?: number }[];
    const srsMap = new Map(srsItems.map(it => [it.signId, it]));

    const display: SrsItemDisplay[] = q.map(item => {
      const srs = srsMap.get(item.signId);
      // A última revisão foi `interval` dias antes do vencimento
      const lastReviewed = srs?.dueAt ? addDays(srs.dueAt, -(srs.interval ?? 0)) : today;
      return {
        signId: item.signId,
        gloss: signsMap[item.signId]?.gloss ?? item.signId,
        daysAgo: item.kind === 'new' ? 0 : daysDiff(today, lastReviewed),
        kind: item.kind,
      };
    });

    setQueue(q);
    setKnownIds(srsItems.map(it => it.signId).filter(id => signsMap[id]));
    setItems(display);
    setIdx(0);
    setCorrect(0);
    setPhase('list');
  }, [userId, repo]);

  useEffect(() => { load(); }, [load]);

  function startReview() {
    setMode('review');
    setSession(queue);
    setPhase('session');
  }

  // Prática livre: sinais já vistos em ordem aleatória; sem nenhum visto, os da fila do dia
  function startFree() {
    const known = shuffle(knownIds).slice(0, SESSION_SIZE).map(signId => ({ signId, kind: 'review' as const }));
    setMode('free');
    setSession(known.length > 0 ? known : queue);
    setPhase('session');
  }

  function advance() {
    const next = idx + 1;
    if (next >= session.length) setPhase('done');
    else setIdx(next);
  }

  // Cada resposta da revisão vai para o SRS do sinal pelo domínio (spec-03 seção 6), com o mesmo
  // resultado que a lição usa para os receptivos. XP e ofensiva ficam com a conclusão de lição.
  function handleAnswer(signId: string, wasCorrect: boolean) {
    if (wasCorrect) setCorrect(c => c + 1);
    if (mode !== 'review') return;
    const result = wasCorrect ? { state: 'correct', highConfidence: true } : { state: 'failed' };
    reviewSigns(repo, { userId, today: getToday(), reviewed: [{ signId, result }] })
      .catch(err => console.error('[pratica] falha ao gravar o SRS', err));
  }

  if (phase === 'loading') {
    return (
      <div className="practice-screen">
        <div className="loading-spinner"><Icon name="progress_activity" spin /></div>
      </div>
    );
  }

  if (phase === 'done') {
    const total = session.length;
    const pct = Math.round((correct / total) * 100);
    return (
      <div className="practice-screen">
        <div className="practice-done animate__animated animate__fadeIn">
          <div className={`practice-done-icon wow-glow animate__animated animate__bounceIn${pct >= 80 ? '' : ' practice-done-icon--low'}`}>
            <Icon name={pct >= 80 ? 'check' : 'replay'} />
          </div>
          <h2 className="animate__animated animate__fadeInUp" style={{ animationDelay: '150ms' }}>{t('practiceScreen.doneTitle')}</h2>
          <p className="practice-done-score animate__animated animate__fadeInUp" style={{ animationDelay: '250ms' }}>{t('practiceScreen.score', { correct, total, pct })}</p>
          <button className="btn btn-primary" onClick={load}>
            <Icon name="replay" /> {t('practiceScreen.practiceAgain')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'session') {
    const item = session[idx];
    if (!item) return null;
    const sign: Sign = getSign(item.signId);
    const choices = drawChoices(item.signId, allSignIds);
    const pct = Math.round((idx / session.length) * 100);

    return (
      <div className="practice-screen">
        <div className="practice-header">
          <div className="progress-bar-wrap progress-bar-wrap--lesson" role="progressbar" aria-valuemin={0} aria-valuemax={session.length} aria-valuenow={idx} aria-valuetext={`${idx}/${session.length}`}>
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">{idx}/{session.length}</span>
          {mode === 'free' ? (
            <span className="practice-badge practice-badge--review">{t('practiceScreen.freePracticeTitle')}</span>
          ) : (
            <span className={`practice-badge practice-badge--${item.kind}`}>
              {item.kind === 'review' ? <><Icon name="replay" /> {t('practiceScreen.review')}</> : <><Icon name="arrow_forward" /> {t('practiceScreen.new')}</>}
            </span>
          )}
        </div>
        <ExerciseMc4
          key={`${item.signId}-${idx}`}
          sign={sign}
          choices={choices}
          onAnswer={(wasCorrect) => handleAnswer(item.signId, wasCorrect)}
          onNext={advance}
        />
      </div>
    );
  }

  // phase === 'list'
  // Desafio de soletrar: aparece quando as letras já vistas formam palavras suficientes
  const seenLetters = new Set(knownIds.filter(id => signsMap[id]?.category === 'alfabeto').map(id => signsMap[id].gloss));
  const spellChallengeOpen = availableChallengeWords(seenLetters).length >= SPELL_CHALLENGE_SIZE;
  const bestTime = readBestTime();
  return (
    <div className="practice-screen">
      <header className="screen-header animate__animated animate__fadeInDown animate__faster">
        <h1 className="screen-title">
          {items.length === 0 ? t('practiceScreen.allCaughtUp') : t('practiceScreen.todayReview')}
        </h1>
        {items.length > 0 && (
          <p className="screen-subtitle">{t('practiceScreen.pendingSigns', { count: items.length })}</p>
        )}
      </header>

      <div className="practice-list-body">
        {items.length === 0 ? (
          <div className="practice-empty animate__animated animate__fadeIn">
            <div className="practice-empty-icon animate__animated animate__bounceIn"><Icon name="sign_language" filled size="64px" /></div>
            <h2>{t('practiceScreen.emptyTitle')}</h2>
            <p>{t('practiceScreen.emptyDesc')}</p>
          </div>
        ) : (
          <>
            <div className="srs-grid">
              {items.map((item, i) => (
                <div
                  key={item.signId}
                  className={`srs-item-tile srs-item-tile--${item.kind} animate__animated animate__fadeInUp animate__faster`}
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="srs-item-gloss">{item.gloss}</div>
                  {item.kind === 'new'
                    ? <span className="srs-badge srs-badge--new">{t('practiceScreen.new')}</span>
                    : <span className="srs-badge srs-badge--review">
                        {item.daysAgo > 0 ? t('practiceScreen.seenDaysAgo', { count: item.daysAgo }) : t('practiceScreen.seenToday')}
                      </span>
                  }
                </div>
              ))}
            </div>
            <button className="btn btn-primary practice-start-btn" onClick={startReview}>
              <Icon name="play_arrow" /> {t('practiceScreen.startReview')}
            </button>
          </>
        )}

        <div className="free-practice-card animate__animated animate__fadeInUp" style={{ animationDelay: '120ms' }}>
          <div className="free-practice-text">
            <h3>{t('practiceScreen.freePracticeTitle')}</h3>
            <p>{t('practiceScreen.freePracticeDesc')}</p>
          </div>
          <button className="btn btn-ghost" onClick={startFree}>
            {t('practiceScreen.practice')}
          </button>
        </div>

        {onOpenSpellChallenge && spellChallengeOpen && (
          <div className="free-practice-card animate__animated animate__fadeInUp" style={{ animationDelay: '160ms' }}>
            <div className="free-practice-text">
              <h3>{t('spellChallenge.title')}</h3>
              <p>
                {t('spellChallenge.cardDesc', { n: SPELL_CHALLENGE_SIZE })}{' '}
                <span className="tabular">
                  {bestTime !== null ? t('spellChallenge.best', { time: formatChallengeTime(bestTime) }) : t('spellChallenge.noBest')}
                </span>
              </p>
            </div>
            <button className="btn btn-ghost" onClick={onOpenSpellChallenge}>
              <Icon name="timer" /> {t('spellChallenge.open')}
            </button>
          </div>
        )}

        <button className="camera-access-card animate__animated animate__fadeInUp" style={{ animationDelay: '200ms' }} onClick={onOpenCamera}>
          <Icon name="videocam" className="camera-access-icon" />
          <div>
            <div className="camera-access-title">{t('practiceScreen.cameraAccessTitle')}</div>
            <div className="camera-access-desc">{t('practiceScreen.cameraAccessDesc')}</div>
          </div>
          <Icon name="arrow_forward" className="camera-access-arrow" />
        </button>
      </div>
    </div>
  );
}
