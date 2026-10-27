// Uso anônimo e notas de exemplo (npm run dev:mock e testes). Mesmo formato de GET /v1/admin/usage e
// /v1/admin/feedback; as lições são as de verdade, do bundle do app (contentStatus.js).
import contentStatus from '../../../../services/api/src/content/contentStatus.js';
import type { ContentStatus } from '../lib/types';
import type { FeedbackItem, FeedbackPage, Usage } from '../lib/usageTypes';

const DAY_MS = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const TODAY = Date.UTC(2026, 9, 27);

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const lessonList = (contentStatus as unknown as ContentStatus).units.flatMap((u) =>
  u.lessons.map((l) => ({ lessonId: l.id, title: l.title, unitId: u.id, unitTitle: u.title })));

export function sampleUsage(): Usage {
  const rnd = seeded(7);
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = iso(TODAY - (29 - i) * DAY_MS);
    const guest = Math.round(120 + i * 4 + rnd() * 30);
    const account = Math.round(40 + i * 2 + rnd() * 10);
    const feedbackCount = Math.round(rnd() * 6);
    return {
      day,
      guest,
      account,
      newIds: Math.round(30 + rnd() * 20),
      lessonOpens: Math.round((guest + account) * 2.4),
      lessonsCompleted: Math.round((guest + account) * 2),
      feedbackCount,
      feedbackAverage: feedbackCount ? Math.round((3.4 + rnd() * 1.4) * 100) / 100 : null,
    };
  });
  const cohorts = days.map((d, i) => {
    const size = d.newIds;
    const d1 = i <= 27 ? Math.round(size * (0.35 + rnd() * 0.1)) : null;
    const d7 = i <= 21 ? Math.round(size * (0.15 + rnd() * 0.08)) : null;
    return { day: d.day, size, d1, d7, d1Rate: d1 == null ? null : Math.round((d1 / size) * 1000) / 1000, d7Rate: d7 == null ? null : Math.round((d7 / size) * 1000) / 1000 };
  });
  const sumC = (f: 'size' | 'd1' | 'd7', rows = cohorts) => rows.reduce((a, c) => a + (c[f] ?? 0), 0);
  const d1Rows = cohorts.filter((c) => c.d1 != null);
  const d7Rows = cohorts.filter((c) => c.d7 != null);
  const opened = sumC('size');
  const funnelCounts = [opened, Math.round(opened * 0.82), Math.round(opened * 0.64), Math.round(opened * 0.31), Math.round(opened * 0.12)];
  const keys = ['app_open', 'onboarding_done', 'first_lesson', 'five_lessons', 'account_created'] as const;
  const lessons = lessonList.slice(0, 14).map((l, i) => {
    const opens = Math.round(900 / (1 + i * 0.35));
    const completes = Math.round(opens * (0.88 - (i % 4) * 0.07));
    const abandons = Math.round(opens * (0.06 + (i % 4) * 0.05));
    return {
      ...l,
      opens,
      completes,
      abandons,
      completionRate: Math.round((completes / opens) * 1000) / 1000,
      abandonRate: Math.round((abandons / (completes + abandons)) * 1000) / 1000,
      avgDurationSec: 150 + i * 12,
      avgScore: Math.round((0.92 - (i % 5) * 0.04) * 100) / 100,
      abandonAt: [{ index: 3 + (i % 4), count: Math.ceil(abandons * 0.5) }, { index: 1, count: Math.floor(abandons * 0.3) }],
    };
  });
  const reach = lessonList.map((l, i) => ({ ...l, position: i + 1, ids: Math.max(0, Math.round(1800 * 0.9 ** i)) }));
  const distribution = [{ rating: 1, count: 6 }, { rating: 2, count: 9 }, { rating: 3, count: 31 }, { rating: 4, count: 74 }, { rating: 5, count: 112 }];
  const fbCount = distribution.reduce((a, d) => a + d.count, 0);
  const fbSum = distribution.reduce((a, d) => a + d.rating * d.count, 0);
  const last = days[days.length - 1];
  return {
    today: last.day,
    range: { from: days[0].day, to: last.day },
    active: {
      day: { guest: last.guest, account: last.account, total: last.guest + last.account },
      week: { guest: 740, account: 260, total: 1000 },
      month: { guest: 2400, account: 820, total: 3220 },
    },
    newIds: days.reduce((a, d) => a + d.newIds, 0),
    days,
    weeks: Array.from({ length: 12 }, (_, i) => ({
      week: `2026-w${String(33 + i).padStart(2, '0')}`,
      guest: 300 + i * 40, account: 90 + i * 15, feedbackCount: 10 + i * 2, feedbackAverage: Math.round((3.8 + i * 0.03) * 100) / 100,
    })),
    months: [
      { month: '2026-09', guest: 1500, account: 480, feedbackCount: 60, feedbackAverage: 3.9 },
      { month: '2026-10', guest: 2400, account: 820, feedbackCount: 172, feedbackAverage: 4.1 },
    ],
    retention: {
      d1: { cohortSize: sumC('size', d1Rows), returned: sumC('d1', d1Rows), rate: Math.round((sumC('d1', d1Rows) / sumC('size', d1Rows)) * 1000) / 1000 },
      d7: { cohortSize: sumC('size', d7Rows), returned: sumC('d7', d7Rows), rate: Math.round((sumC('d7', d7Rows) / sumC('size', d7Rows)) * 1000) / 1000 },
      cohorts,
    },
    funnel: keys.map((key, i) => ({ key, count: funnelCounts[i], rate: Math.round((funnelCounts[i] / opened) * 1000) / 1000 })),
    events: {
      app_open: 9100, onboarding_done: 1050, lesson_open: 14200, lesson_complete: 12100, lesson_abandon: 1300,
      daily_goal_met: 3900, placement_started: 210, placement_done: 180, practice_done: 2600, account_created: 160,
    },
    lessons,
    reach,
    onboarding: {
      langs: [{ lang: 'pt-BR', count: 980 }, { lang: 'es', count: 44 }, { lang: 'en', count: 26 }],
      goals: [{ goal: 5, count: 210 }, { goal: 10, count: 330 }, { goal: 20, count: 420 }, { goal: 50, count: 90 }],
    },
    platforms: [
      { platform: 'android', installed: 'twa', activeDays: 2100 },
      { platform: 'android', installed: 'browser', activeDays: 1800 },
      { platform: 'ios', installed: 'pwa', activeDays: 640 },
      { platform: 'desktop', installed: 'browser', activeDays: 520 },
    ],
    practice: { review: 1900, free: 700, items: 26000, correct: 21000, accuracy: 0.808 },
    placementPlaced: 860,
    feedback: { count: fbCount, average: Math.round((fbSum / fbCount) * 100) / 100, distribution },
  };
}

const COMMENTS: Array<[number, string]> = [
  [5, 'Adorei as lições com a câmera, aprendi o alfabeto em uma semana.'],
  [4, 'Muito bom, mas a letra K demora para reconhecer.'],
  [2, 'O teste de nivelamento pulou lições que eu ainda não sabia.'],
  [5, 'Uso todo dia no ônibus.'],
  [3, '<b>Sem</b> som no meu celular, <script>alert(1)</script> não sei se é o app.'],
  [1, 'A câmera não abre no meu aparelho.'],
  [4, ''],
  [5, 'Queria mais sinais do dia a dia.\nE frases.'],
];

export function sampleFeedbackItems(): FeedbackItem[] {
  return COMMENTS.map(([rating, text], i) => ({
    at: new Date(TODAY + 15 * 3600000 - i * 7 * 3600000).toISOString(),
    day: iso(TODAY - Math.floor(i / 3) * DAY_MS),
    rating,
    text,
    lessonsCompleted: 3 + i * 4,
    currentLessonId: lessonList[i + 2]?.lessonId ?? null,
    hasAccount: i % 3 === 0,
    appVersion: '2026-10-27+abc1234',
    lang: i === 2 ? 'es' : 'pt-BR',
    platform: i % 2 ? 'ios' : 'android',
    installed: i % 2 ? 'pwa' : 'twa',
  }));
}

/** Páginas de 3, como a API (cursor opaco), com o filtro por nota. */
export function sampleFeedbackPage({ rating = null, cursor = null }: { rating?: number | null; cursor?: string | null } = {}): FeedbackPage {
  const all = sampleFeedbackItems().filter((f) => rating == null || f.rating === rating);
  const start = cursor ? Number(cursor) : 0;
  const items = all.slice(start, start + 3);
  return { items, cursor: start + 3 < all.length ? String(start + 3) : null };
}
