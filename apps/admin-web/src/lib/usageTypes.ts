// Formato de GET /v1/admin/usage e /v1/admin/feedback (services/api/src/domain/telemetry.js,
// buildUsage, e usecases/telemetry.js, feedbackPage).

export interface ActiveSplit {
  guest: number;
  account: number;
  total: number;
}

export interface UsageDay {
  day: string;
  guest: number;
  account: number;
  newIds: number;
  lessonOpens: number;
  lessonsCompleted: number;
  feedbackCount: number;
  feedbackAverage: number | null;
}

export interface UsagePeriod {
  guest: number;
  account: number;
  feedbackCount: number;
  feedbackAverage: number | null;
}

export interface Cohort {
  day: string;
  size: number;
  d1: number | null;
  d7: number | null;
  d1Rate: number | null;
  d7Rate: number | null;
}

export interface RetentionRate {
  cohortSize: number;
  returned: number;
  rate: number | null;
}

export type FunnelKey = 'app_open' | 'onboarding_done' | 'first_lesson' | 'five_lessons' | 'account_created';

export interface UsageLesson {
  lessonId: string;
  title: string | null;
  unitId: string | null;
  unitTitle: string | null;
  opens: number;
  completes: number;
  abandons: number;
  completionRate: number | null;
  abandonRate: number | null;
  avgDurationSec: number | null;
  avgScore: number | null;
  abandonAt: Array<{ index: number; count: number }>;
}

export interface ReachRow {
  lessonId: string;
  position: number;
  title: string | null;
  unitId: string | null;
  unitTitle: string | null;
  ids: number;
}

export interface FeedbackStats {
  count: number;
  average: number | null;
  distribution: Array<{ rating: number; count: number }>;
}

export interface Usage {
  today: string;
  range: { from: string; to: string };
  active: { day: ActiveSplit; week: ActiveSplit; month: ActiveSplit };
  newIds: number;
  days: UsageDay[];
  weeks: Array<UsagePeriod & { week: string }>;
  months: Array<UsagePeriod & { month: string }>;
  retention: { d1: RetentionRate; d7: RetentionRate; cohorts: Cohort[] };
  funnel: Array<{ key: FunnelKey; count: number; rate: number | null }>;
  events: Record<string, number>;
  lessons: UsageLesson[];
  reach: ReachRow[];
  onboarding: { langs: Array<{ lang: string; count: number }>; goals: Array<{ goal: number; count: number }> };
  platforms: Array<{ platform: string; installed: string; activeDays: number }>;
  practice: { review: number; free: number; items: number; correct: number; accuracy: number | null };
  placementPlaced: number;
  feedback: FeedbackStats;
}

export interface FeedbackItem {
  at: string;
  day: string;
  rating: number;
  text: string;
  lessonsCompleted: number | null;
  currentLessonId: string | null;
  hasAccount: boolean;
  appVersion: string | null;
  lang: string | null;
  platform: string | null;
  installed: string | null;
}

export interface FeedbackPage {
  items: FeedbackItem[];
  cursor: string | null;
}
