// Formato das respostas das rotas /v1/admin (services/api/src/handlers/admin.js).

export interface Me {
  userId: string;
  email: string | null;
  groups: string[];
}

export interface DayRow {
  day: string;
  activeUsers: number;
  newAccounts: number;
  lessonsCompleted: number;
  practiceSessions: number;
  lessonAbandons: number;
  /** null: o job diário ainda não trouxe o CloudWatch desse dia */
  serverErrors: number | null;
  api5xx: number | null;
  lambdaErrors: number | null;
  apiRequests: number | null;
}

export interface PeriodRow {
  activeUsers: number;
  newAccounts: number;
  lessonsCompleted: number;
}

export interface LessonRow {
  lessonId: string;
  title: string | null;
  unitId: string | null;
  unitTitle: string | null;
  done: number;
  abandon: number;
  abandonRate: number | null;
  attempted: number;
  wrong: number;
  wrongRate: number | null;
  failedSigns: number;
  reviewedSigns: number;
}

export interface ExerciseRow {
  type: string;
  attempted: number;
  wrong: number;
  wrongRate: number | null;
  abandon: number;
}

export interface Overview {
  today: string;
  range: { from: string; to: string };
  totals: {
    activeToday: number;
    activeWeek: number;
    activeMonth: number;
    newAccounts: number;
    lessonsCompleted: number;
    lessonAbandons: number;
    serverErrors: number;
  };
  days: DayRow[];
  weeks: Array<PeriodRow & { week: string }>;
  months: Array<PeriodRow & { month: string }>;
  lessons: LessonRow[];
  exercises: ExerciseRow[];
  signs: Array<{ signId: string; gloss: string | null; failed: number }>;
  serverErrors: { collectedThrough: string | null; byFunction: Array<{ name: string; errors: number }> };
}

export type Missing = 'validated' | 'video' | 'avatar' | 'source';

export interface SignStatus {
  id: string;
  gloss: string;
  category: string | null;
  recognition: string | null;
  unitId: string | null;
  lessonId: string | null;
  status: string | null;
  validated: boolean;
  hasVideo: boolean;
  hasAvatar: boolean;
  source: { name: string; url: string | null } | null;
  missing: Missing[];
}

export interface Tally {
  signs: number;
  validated: number;
  withVideo: number;
  withAvatar: number;
  withSource: number;
}

export interface UnitStatus extends Tally {
  id: string;
  title: string;
  lessons: Array<{ id: string; title: string; signCount: number }>;
}

export interface ContentStatus {
  courseId: string | null;
  title: string | null;
  totals: Tally & { units: number; lessons: number; unknownInLessons: string[] };
  units: UnitStatus[];
  signs: SignStatus[];
}

export interface Account {
  userId: string | null;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  provider: string;
  status: string | null;
  enabled: boolean;
  createdAt: string | null;
}

export interface AccountSummary {
  userId: string;
  account: Account | null;
  profile: {
    displayName: string | null;
    timezone: string | null;
    xpTotal: number;
    streak: number;
    lastActiveDay: string | null;
    freezes: number;
    dailyGoalXp: number | null;
    signsLearned: number;
    lessonsCompleted: number;
    alphabetComplete: boolean;
  } | null;
  progress: {
    distinctLessons: number;
    totalLessons: number | null;
    lessons: Array<{ lessonId: string; title: string | null; unitId: string | null; status: string | null; bestScore: number | null; completedAt: string | null }>;
  };
  srs: { signs: number; due: number };
  achievements: string[];
  league: {
    tier: string | null;
    current: { leagueId: string; period: string | null; xpPeriod: number | null } | null;
    lastResult: { period?: string; outcome?: string; rank?: number; total?: number; toTier?: string } | null;
  };
  squads: Array<{ squadId: string; name: string | null; type: string | null; memberCount: number | null; role: string | null; xpWeeklyContrib: number }>;
  activity: { lastDay: string | null; lastWeek: string | null; lastMonth: string | null } | null;
}

export interface SquadRow {
  squadId: string;
  name: string | null;
  type: string | null;
  memberCount: number;
  maxMembers: number | null;
  createdAt: string | null;
  createdBy: string | null;
  xpWeekly: number;
  xpAllTime: number;
}

export interface CostMonth {
  month: string;
  start: string;
  end: string;
  complete: boolean;
  daysElapsed: number;
  daysInMonth: number;
  currency: string;
  total: number;
  projectedTotal: number;
  asOf: string | null;
}

export interface CostView {
  latest: (CostMonth & { byService: Array<{ service: string; amount: number }> }) | null;
  months: CostMonth[];
}
