import { useEffect, useState } from 'react';
import { getToday } from '../lib/today';
import { useT } from '../i18n';
import type { IdbRepo } from '../lib/idbRepo';
import { Icon } from '../components/Icon';

interface Props {
  userId: string;
  repo: IdbRepo;
  onBack: () => void;
}

interface StreakData {
  streak: number;
  personalRecord: number;
  dayHistory: Set<string>;
  freezeCount: number;
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()];
}

export function StreakScreen({ userId, repo, onBack }: Props) {
  const { t } = useT();
  const [data, setData] = useState<StreakData | null>(null);
  const today = getToday();

  useEffect(() => {
    async function load() {
      const profile = await repo.getProfile(userId) as Record<string, unknown> | null;
      const streak = (profile?.streak as number) ?? 0;
      const personalRecord = (profile?.personalRecord as number) ?? streak;
      const freezeCount = (profile?.freezeCount as number) ?? 1;

      // Build last 14 days from DayXp records
      const dayHistory = new Set<string>();
      for (let i = 0; i < 14; i++) {
        const d = addDays(today, -i);
        const xp = await repo.getDayXp(userId, d);
        if (xp > 0) dayHistory.add(d);
      }

      setData({ streak, personalRecord, dayHistory, freezeCount });
    }
    load();
  }, [userId, repo, today]);

  if (!data) {
    return (
      <div className="sub-screen">
        <div className="sub-screen-bar">
          <button className="back-btn" onClick={onBack} aria-label={t('common.back')}><Icon name="arrow_back" /></button>
          <h1>{t('streakScreen.title')}</h1>
        </div>
        <div className="screen-center">
          <p className="text-muted">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  const { streak, personalRecord, dayHistory, freezeCount } = data;
  const studiedToday = dayHistory.has(today);
  const hoursNow = new Date().getHours();
  const atRisk = streak > 0 && !studiedToday && hoursNow >= 20;
  const state = streak === 0 ? 'zero' : atRisk ? 'risk' : 'active';

  // Build 14-day grid (most recent first, reversed for display)
  const days14: string[] = [];
  for (let i = 13; i >= 0; i--) days14.push(addDays(today, -i));

  const week1 = days14.slice(0, 7);
  const week2 = days14.slice(7, 14);

  return (
    <div className="sub-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('streakScreen.title')}</h1>
      </div>

      <div className="streak-body">
        <div className={`streak-hero streak-hero--${state} animate__animated animate__fadeIn`}>
          <div className="streak-hero-icon wow-glow">
            <Icon name="local_fire_department" filled />
          </div>
          <div className="streak-hero-number animate__animated animate__bounceIn" style={{ animationDelay: '150ms' }}>{streak}</div>
          <div className="streak-hero-label">
            {streak === 1 ? t('streakScreen.day') : t('streakScreen.days')}
          </div>
          {atRisk && (
            <p className="streak-risk-msg">
              {t('streakScreen.riskMsg')}
            </p>
          )}
          {state === 'zero' && (
            <p className="streak-risk-msg">{t('streakScreen.startNew')}</p>
          )}
        </div>

        <div className="streak-heatmap-card animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '200ms' }}>
          <p className="streak-heatmap-title">{t('streakScreen.last2Weeks')}</p>
          <div className="streak-heatmap-week-labels">
            {[t('streakScreen.dowMon'), t('streakScreen.dowTue'), t('streakScreen.dowWed'), t('streakScreen.dowThu'), t('streakScreen.dowFri'), t('streakScreen.dowSat'), t('streakScreen.dowSun')].map((l, i) => (
              <span key={i} className="heatmap-day-label">{l}</span>
            ))}
          </div>
          {[week1, week2].map((week, wi) => (
            <div key={wi} className="streak-heatmap-row">
              {week.map((d) => {
                const studied = dayHistory.has(d);
                const isToday = d === today;
                return (
                  <div
                    key={d}
                    className={`heatmap-cell${studied ? ' heatmap-cell--studied' : ''}${isToday ? ' heatmap-cell--today' : ''}`}
                    title={d}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="streak-record-card animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '300ms' }}>
          <Icon name="trophy" filled className="streak-record-icon" />
          <div>
            <div className="streak-record-label">{t('streakScreen.personalRecord')}</div>
            <div className="streak-record-value">{t('streakScreen.recordDays', { days: Math.max(personalRecord, streak) })}</div>
          </div>
        </div>

        {state !== 'zero' && (
          <div className={`streak-freeze-card animate__animated animate__fadeInUp animate__faster${atRisk ? ' streak-freeze-card--highlighted' : ''}`} style={{ animationDelay: '380ms' }}>
            <Icon name="ac_unit" className="streak-freeze-icon" />
            <div>
              <div className="streak-freeze-label">{t('streakScreen.freezeAvailable')}</div>
              <div className="streak-freeze-count">{freezeCount}</div>
            </div>
            {atRisk && freezeCount > 0 && (
              <button className="btn btn-sm btn-primary btn-inline streak-freeze-btn">
                {t('streakScreen.useFreeze')}
              </button>
            )}
          </div>
        )}

        {state === 'zero' && (
          <div className="streak-recovery-card animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '300ms' }}>
            <h3>{t('streakScreen.endedTitle')}</h3>
            <p>{t('streakScreen.endedSub')}</p>
            <button className="btn btn-primary" onClick={onBack}>
              {t('streakScreen.studyNow')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
