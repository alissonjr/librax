import { useEffect, useState } from 'react';
import type { IdbRepo } from '../lib/idbRepo';
import { useT } from '../i18n';
import { Icon, type IconName } from '../components/Icon';

interface ProgressData {
  streak: number;
  xpTotal: number;
  signsLearned: number;
  lessonsCompleted: number;
  achievements: string[];
}

interface Props {
  userId: string;
  repo: IdbRepo;
}

const ACHIEVEMENT_KEYS: Record<string, string> = {
  first_lesson:      'progressScreen.achievements.first_lesson',
  three_day_streak:  'progressScreen.achievements.three_day_streak',
  five_lessons:      'progressScreen.achievements.five_lessons',
  ten_signs:         'progressScreen.achievements.ten_signs',
  perfect_lesson:    'progressScreen.achievements.perfect_lesson',
  seven_day_streak:  'progressScreen.achievements.seven_day_streak',
  all_unit1:         'progressScreen.achievements.all_unit1',
};

export function ProgressScreen({ userId, repo }: Props) {
  const { t } = useT();
  const [data, setData] = useState<ProgressData | null>(null);

  useEffect(() => {
    async function load() {
      const profile = await repo.getProfile(userId);
      const achievements = await repo.listEarnedAchievements(userId);
      const srsItems = await repo.listSrsItems(userId);

      // Conta licoes completadas via SRS (quantas licoes ja tiveram itens criados)
      const lessonsWithSrs = new Set(srsItems.map((s: { signId: string }) => s.signId.slice(0, 4))).size;

      setData({
        streak: (profile as { currentStreak?: number } | null)?.currentStreak ?? 0,
        xpTotal: (profile as { xpTotal?: number } | null)?.xpTotal ?? 0,
        signsLearned: srsItems.filter((s: { reps: number }) => s.reps > 0).length,
        lessonsCompleted: lessonsWithSrs,
        achievements,
      });
    }
    load();
  }, [userId, repo]);

  if (!data) {
    return (
      <div className="progress-screen">
        <div className="loading-spinner">
          <Icon name="trending_up" />
        </div>
      </div>
    );
  }

  const stats: { icon: IconName; label: string; value: string | number; tone: string }[] = [
    { icon: 'local_fire_department', label: t('progressScreen.currentStreak'), value: t('progressScreen.daysValue', { count: data.streak }), tone: 'streak' },
    { icon: 'bolt',                  label: t('progressScreen.xpTotal'),        value: data.xpTotal,      tone: 'xp' },
    { icon: 'sign_language',         label: t('progressScreen.signsSeen'),      value: data.signsLearned, tone: 'hand' },
    { icon: 'school',                label: t('progressScreen.lessonsCompleted'), value: data.lessonsCompleted, tone: 'brand' },
  ];

  return (
    <div className="progress-screen">
      <header className="screen-header animate__animated animate__fadeInDown animate__faster">
        <h1 className="screen-title">{t('progressScreen.title')}</h1>
      </header>

      <div className="stats-grid">
        {stats.map((s, i) => (
          <div key={s.label} className="stat-card animate__animated animate__zoomIn animate__faster" style={{ animationDelay: `${i * 80}ms` }}>
            <div className={`stat-icon stat-icon--${s.tone}`}>
              <Icon name={s.icon} filled />
            </div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <section className="achievements-section">
        <h2 className="section-title">
          <Icon name="trophy" /> {t('progressScreen.achievementsTitle')}
        </h2>
        {data.achievements.length === 0 ? (
          <p className="achievements-empty">
            {t('progressScreen.achievementsEmpty')}
          </p>
        ) : (
          <ul className="achievements-list-full">
            {data.achievements.map((id, i) => (
              <li key={id} className="achievement-item-full animate__animated animate__fadeInUp animate__faster" style={{ animationDelay: `${350 + i * 60}ms` }}>
                <Icon name="trophy" className="achievement-icon-gold" />
                {ACHIEVEMENT_KEYS[id] ? t(ACHIEVEMENT_KEYS[id]) : id}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
