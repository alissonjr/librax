import { useEffect, useState } from 'react';
import { getDisplayName } from '../lib/auth';
import { getToday } from '../lib/today';
import { course } from '../lib/content';
import { useT } from '../i18n';
import type { IdbRepo } from '../lib/idbRepo';
import { Icon } from '../components/Icon';

interface Props {
  userId: string;
  repo: IdbRepo;
  onOpenStreak: () => void;
  onOpenAchievements: () => void;
  onOpenSettings: () => void;
}

interface ProfileData {
  xpTotal: number;
  streak: number;
  dailyGoalXp: number;
  dayXp: number;
  achievements: string[];
  lessonsCompleted: number;
  totalLessons: number;
}

function xpLevel(xp: number) {
  const levels = [0, 50, 150, 300, 500, 800, 1200, 1800, 2500, 3500];
  let level = 1;
  for (let i = 0; i < levels.length; i++) {
    if (xp >= levels[i]) level = i + 1;
  }
  const currentFloor = levels[Math.min(level - 1, levels.length - 1)] ?? 0;
  const nextThreshold = levels[Math.min(level, levels.length - 1)] ?? currentFloor + 500;
  const pct = Math.min(100, Math.round(((xp - currentFloor) / (nextThreshold - currentFloor)) * 100));
  return { level, pct, next: nextThreshold };
}

export function ProfileScreen({ userId, repo, onOpenStreak, onOpenAchievements, onOpenSettings }: Props) {
  const { t } = useT();
  const [data, setData] = useState<ProfileData | null>(null);
  const name = getDisplayName() ?? t('common.defaultName');
  const today = getToday();
  const initials = name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  useEffect(() => {
    async function load() {
      const profile = await repo.getProfile(userId) as Record<string, unknown> | null;
      const xpTotal = (profile?.xpTotal as number) ?? 0;
      const streak = (profile?.streak as number) ?? 0;
      const dailyGoalXp = (profile?.dailyGoalXp as number) ?? 20;
      const achievements = (profile?.achievements as string[]) ?? [];
      const dayXp = await repo.getDayXp(userId, today);

      const allLessons = course.units.flatMap(u => u.lessons);
      let lessonsCompleted = 0;
      for (const lesson of allLessons) {
        const prog = await repo.getProgress(userId, lesson.id) as Record<string, unknown> | null;
        if (prog?.status === 'completed') lessonsCompleted++;
      }

      setData({ xpTotal, streak, dailyGoalXp, dayXp, achievements, lessonsCompleted, totalLessons: allLessons.length });
    }
    load();
  }, [userId, repo, today]);

  if (!data) {
    return (
      <div className="profile-screen">
        <div className="screen-center">
          <p className="text-muted">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  const { xpTotal, streak, dailyGoalXp, dayXp, achievements, lessonsCompleted, totalLessons } = data;
  const { level, pct: lvlPct, next: nextXp } = xpLevel(xpTotal);
  const goalPct = Math.min(100, Math.round((dayXp / dailyGoalXp) * 100));
  const coursePct = totalLessons > 0 ? Math.round((lessonsCompleted / totalLessons) * 100) : 0;

  return (
    <div className="profile-screen">
      {/* Header */}
      <div className="profile-header animate__animated animate__fadeInDown animate__faster">
        <button className="profile-settings-btn" onClick={onOpenSettings} aria-label={t('profileScreen.settings')}>
          <Icon name="settings" />
        </button>
        <div className="profile-avatar wow-glow animate__animated animate__bounceIn">{initials}</div>
        <h1 className="profile-name">{name}</h1>
        <p className="profile-meta">{t('profileScreen.level', { level })}</p>

        {/* XP Level Bar */}
        <div className="profile-xp-bar-wrap">
          <div className="profile-xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={lvlPct} aria-label={t('profileScreen.level', { level })}>
            <div className="profile-xp-bar-fill" style={{ width: `${lvlPct}%` }} />
          </div>
          <div className="profile-xp-label">
            <span>{xpTotal} XP</span>
            <span>{t('profileScreen.next', { xp: nextXp })}</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="profile-stats-row">
        <button className="profile-stat-card animate__animated animate__zoomIn animate__faster" style={{ animationDelay: '100ms' }} onClick={onOpenStreak}>
          <Icon name="local_fire_department" filled size="28px" className="tone-streak" />
          <span className="profile-stat-value">{streak}</span>
          <span className="profile-stat-label">{t('profileScreen.days')}</span>
        </button>
        <div className="profile-stat-card animate__animated animate__zoomIn animate__faster" style={{ animationDelay: '180ms' }}>
          <Icon name="bolt" filled size="28px" className="tone-xp" />
          <span className="profile-stat-value">{xpTotal}</span>
          <span className="profile-stat-label">{t('profileScreen.xpTotal')}</span>
        </div>
        <div className="profile-stat-card animate__animated animate__zoomIn animate__faster" style={{ animationDelay: '260ms' }}>
          <Icon name="sign_language" filled size="28px" className="tone-hand" />
          <span className="profile-stat-value">{lessonsCompleted}</span>
          <span className="profile-stat-label">{t('profileScreen.lessons')}</span>
        </div>
      </div>

      {/* Course progress */}
      <div className="profile-card animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '320ms' }}>
        <div className="profile-card-header">
          <span className="profile-card-title">{t('profileScreen.courseTitle')}</span>
          <span className="profile-card-sub">{t('profileScreen.percentDone', { pct: coursePct })}</span>
        </div>
        <div className="progress-bar-wrap" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coursePct} aria-label={t('profileScreen.courseTitle')}>
          <div className="progress-bar-fill" style={{ width: `${coursePct}%` }} />
        </div>
        <p className="profile-card-meta">{t('profileScreen.lessonsWithProgress', { completed: lessonsCompleted, total: totalLessons })}</p>
      </div>

      {/* Daily goal */}
      <div className="profile-card animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '400ms' }}>
        <div className="profile-card-header">
          <span className="profile-card-title">{t('profileScreen.dailyGoal')}</span>
          <span className="profile-card-sub">{dayXp} / {dailyGoalXp} XP</span>
        </div>
        <div className="progress-bar-wrap progress-bar-wrap--goal" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPct} aria-label={t('profileScreen.dailyGoal')}>
          <div className="progress-bar-fill progress-bar-fill--xp" style={{ width: `${goalPct}%` }} />
        </div>
        {goalPct >= 100 && (
          <p className="profile-goal-done">{t('profileScreen.goalDone')}</p>
        )}
      </div>

      {/* Achievements preview */}
      <button className="profile-card profile-card--btn animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '480ms' }} onClick={onOpenAchievements}>
        <div className="profile-card-header">
          <span className="profile-card-title">
            <Icon name="trophy" filled className="tone-xp" />
            {t('profileScreen.achievements')}
          </span>
          <span className="profile-card-sub">{achievements.length} / 24</span>
        </div>
        <div className="profile-ach-preview">
          {achievements.slice(-3).map(code => (
            <div key={code} className="profile-ach-badge">{code.slice(0, 2)}</div>
          ))}
          {achievements.length === 0 && (
            <p className="profile-card-meta">{t('profileScreen.noAchievements')}</p>
          )}
        </div>
        <div className="profile-card-footer">
          {t('profileScreen.viewAll')} <Icon name="chevron_right" />
        </div>
      </button>

      {/* Settings / logout */}
      <button className="profile-card profile-card--btn animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: '560ms' }} onClick={onOpenSettings}>
        <span className="profile-card-row">
          <Icon name="settings" className="profile-card-row-icon" />
          <span className="profile-card-title">{t('profileScreen.settings')}</span>
          <Icon name="chevron_right" className="profile-card-row-arrow" />
        </span>
      </button>
    </div>
  );
}
