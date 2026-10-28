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
  /** Lembretes do dia: notificações entregues, e-mails enviados e envios que deram erro. */
  remindersPush: number;
  remindersEmail: number;
  remindersFailed: number;
}

/** Dias que a tela de Operação aceita (GET /v1/admin/overview?days=). */
export type OverviewDays = 7 | 30 | 90;

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
  /** Puladas pelo teste de nivelamento e desfeitas (Configurações > Desfazer), na janela. */
  placementSkips: number;
  placementUndos: number;
}

export interface ExerciseRow {
  type: string;
  attempted: number;
  wrong: number;
  wrongRate: number | null;
  abandon: number;
}

export type CameraLevel = 'hard' | 'attention' | 'ok';

/** Uma letra ou sinal na câmera, somando todas as pessoas na janela da tela. */
export interface CameraSignRow {
  signId: string;
  gloss: string | null;
  /** letter: alfabeto; sign: os outros sinais. null: sinal que saiu do curso. */
  kind: 'letter' | 'sign' | null;
  runs: number;
  successes: number;
  skips: number;
  /** Pulos / vezes (0 a 1). */
  skipRate: number;
  /** Soma das tentativas das vezes que terminaram em acerto. */
  attempts: number;
  /** Média de tentativas até acertar; null sem nenhum acerto. */
  avgAttempts: number | null;
  wrongReadings: number;
  /** Leituras de outro sinal no lugar deste, da mais comum para a menos. */
  topWrong: Array<{ label: string; count: number }>;
  level: CameraLevel;
}

export interface CameraView {
  totals: { signs: number; runs: number; successes: number; skips: number; wrongReadings: number };
  /** Do mais difícil para o mais fácil. */
  signs: CameraSignRow[];
  /** Leituras trocadas mais comuns (K lida como H). */
  confusions: Array<{ signId: string; gloss: string | null; label: string; count: number }>;
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
    /** Média de pessoas ativas por dia no período (dá para comparar entre períodos). */
    activeAvg: number;
    remindersSent: number;
    remindersFailed: number;
  };
  /** Os mesmos totais nos dias antes do período; null sem dado lá. */
  previous: { activeAvg: number; newAccounts: number; lessonsCompleted: number; lessonAbandons: number } | null;
  /** Pessoas com lembrete ligado e com e-mail, no último retrato do job diário (null antes do primeiro). */
  reminders: { day: string; enabled: number; email: number } | null;
  days: DayRow[];
  weeks: Array<PeriodRow & { week: string }>;
  months: Array<PeriodRow & { month: string }>;
  lessons: LessonRow[];
  exercises: ExerciseRow[];
  signs: Array<{ signId: string; gloss: string | null; failed: number }>;
  camera: CameraView;
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
  /** Nome no User Pool (o sub nas contas de e-mail, google_<id> nas do Google). */
  username?: string | null;
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
    /** Lições puladas pelo teste de nivelamento (status 'placement'), ainda não refeitas. */
    placementSkipped?: number;
    totalLessons: number | null;
    lessons: Array<{
      lessonId: string;
      title: string | null;
      unitId: string | null;
      /** 'completed' ou 'placement' (pulada pelo nivelamento, sem nota). */
      status: string | null;
      bestScore: number | null;
      completedAt: string | null;
      skippedAt?: string | null;
    }>;
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
  /** Orçamento mensal (o do AWS Budget, librax:monthlyBudgetUsd); null sem ele. */
  budgetUsd?: number | null;
}
