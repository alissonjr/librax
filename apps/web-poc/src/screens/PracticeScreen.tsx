import { useEffect, useState, useCallback } from 'react';
import { getToday } from '../lib/today';
import { course, getSign, signsMap, shuffle } from '../lib/content';
import type { Sign } from '../lib/content';
import { ExerciseMc4 } from '../components/ExerciseMc4';
import type { IdbRepo } from '../lib/idbRepo';
import { getDailyQueue } from '@usecases/getDailyQueue.js';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';

interface QueueItem { signId: string; kind: 'review' | 'new'; }
type Phase = 'loading' | 'list' | 'session' | 'done';

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
}

function daysDiff(dateStr: string, today: string): number {
  const a = new Date(today + 'T00:00:00');
  const b = new Date(dateStr + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function PracticeScreen({ userId, repo, onOpenCamera }: Props) {
  const { t } = useT();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [items, setItems] = useState<SrsItemDisplay[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const allSignIds = Object.keys(signsMap);

  const load = useCallback(async () => {
    setPhase('loading');
    const today = getToday();
    const q = await getDailyQueue(repo, course, { userId, today, size: 8 }) as QueueItem[];
    const srsItems = await repo.listSrsItems(userId);
    const srsMap = new Map(srsItems.map(it => [it.signId, it]));

    const display: SrsItemDisplay[] = q.map(item => {
      const srs = srsMap.get(item.signId);
      const lastReviewed = srs?.dueAt ?? today;
      return {
        signId: item.signId,
        gloss: signsMap[item.signId]?.gloss ?? item.signId,
        daysAgo: item.kind === 'new' ? 0 : daysDiff(today, lastReviewed),
        kind: item.kind,
      };
    });

    setQueue(q);
    setItems(display);
    setIdx(0);
    setCorrect(0);
    setPhase(q.length === 0 ? 'list' : 'list');
  }, [userId, repo]);

  useEffect(() => { load(); }, [load]);

  function startSession() { setPhase('session'); }

  function advance() {
    const next = idx + 1;
    if (next >= queue.length) setPhase('done');
    else setIdx(next);
  }

  function handleAnswer(wasCorrect: boolean) {
    if (wasCorrect) setCorrect(c => c + 1);
  }

  if (phase === 'loading') {
    return (
      <div className="practice-screen">
        <div className="loading-spinner"><Icon name="progress_activity" spin /></div>
      </div>
    );
  }

  if (phase === 'done') {
    const total = queue.length;
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
    const item = queue[idx];
    if (!item) return null;
    const sign: Sign = getSign(item.signId);
    const wrong = shuffle(allSignIds.filter(s => s !== item.signId)).slice(0, 3);
    const choices = shuffle([item.signId, ...wrong]).map(id => signsMap[id]?.gloss ?? id);
    const pct = Math.round((idx / queue.length) * 100);

    return (
      <div className="practice-screen">
        <div className="practice-header">
          <div className="progress-bar-wrap progress-bar-wrap--lesson" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={idx} aria-valuetext={`${idx}/${queue.length}`}>
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">{idx}/{queue.length}</span>
          <span className={`practice-badge practice-badge--${item.kind}`}>
            {item.kind === 'review' ? <><Icon name="replay" /> {t('practiceScreen.review')}</> : <><Icon name="arrow_forward" /> {t('practiceScreen.new')}</>}
          </span>
        </div>
        <ExerciseMc4
          key={`${item.signId}-${idx}`}
          sign={sign}
          choices={choices}
          onAnswer={handleAnswer}
          onNext={advance}
        />
      </div>
    );
  }

  // phase === 'list'
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
            <button className="btn btn-primary practice-start-btn" onClick={startSession}>
              <Icon name="play_arrow" /> {t('practiceScreen.startReview')}
            </button>
          </>
        )}

        <div className="free-practice-card animate__animated animate__fadeInUp" style={{ animationDelay: '120ms' }}>
          <div className="free-practice-text">
            <h3>{t('practiceScreen.freePracticeTitle')}</h3>
            <p>{t('practiceScreen.freePracticeDesc')}</p>
          </div>
          <button className="btn btn-ghost" onClick={startSession}>
            {t('practiceScreen.practice')}
          </button>
        </div>

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
