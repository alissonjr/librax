// Dados de exemplo do painel (npm run dev:mock e testes). Mesmo formato das rotas /v1/admin; o
// conteúdo é o de verdade, gerado do bundle do app (services/api/src/content/contentStatus.js).
import contentStatus from '../../../../services/api/src/content/contentStatus.js';
import type { Account, AccountSummary, CameraSignRow, CameraView, ContentStatus, CostView, Overview, SquadRow } from '../lib/types';

/** Números estáveis (sem Math.random), para os prints e os testes saírem sempre iguais. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const DAY_MS = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const glossOf = (signId: string) => (contentStatus as unknown as ContentStatus).signs.find((s) => s.id === signId)?.gloss ?? null;

/** Desempenho da câmera de exemplo: letras que a câmera troca entre si e alguns sinais com movimento. */
export function sampleCamera(): CameraView {
  // [id, acertos, pulos, tentativas, leituras trocadas]
  const raw: Array<[string, number, number, number, Record<string, number>]> = [
    ['letra-K', 52, 41, 168, { H: 61, V: 22, U: 8 }],
    ['letra-M', 70, 30, 190, { N: 74, S: 12 }],
    ['letra-N', 81, 22, 175, { M: 58, U: 9 }],
    ['sinal-OBRIGADO', 18, 9, 52, { 'BOM-DIA': 14, OI: 5 }],
    ['letra-X', 40, 14, 96, { R: 20, D: 9 }],
    ['letra-U', 95, 18, 160, { V: 41, R: 7 }],
    ['sinal-TCHAU', 22, 5, 41, { OI: 12 }],
    ['letra-E', 120, 14, 170, { S: 26, A: 9 }],
    ['letra-A', 160, 6, 175, { S: 9 }],
    ['letra-L', 150, 4, 158, { D: 3 }],
    ['letra-B', 3, 1, 5, { C: 1 }],
  ];
  const rows: CameraSignRow[] = raw.map(([signId, successes, skips, attempts, wrong]) => {
    const runs = successes + skips;
    const skipRate = Math.round((skips / runs) * 1000) / 1000;
    const avgAttempts = successes ? Math.round((attempts / successes) * 100) / 100 : null;
    const sorted = Object.entries(wrong).sort((a, b) => b[1] - a[1]);
    const level = skipRate >= 0.5 || (avgAttempts ?? 0) >= 3 ? 'hard' : skipRate >= 0.2 || (avgAttempts ?? 0) >= 2 ? 'attention' : 'ok';
    return {
      signId, gloss: glossOf(signId), kind: signId.startsWith('letra-') ? 'letter' : 'sign',
      runs, successes, skips, skipRate, attempts, avgAttempts,
      wrongReadings: sorted.reduce((a, [, n]) => a + n, 0),
      topWrong: sorted.slice(0, 3).map(([label, count]) => ({ label, count })),
      level,
    };
  });
  rows.sort((a, b) => b.skipRate - a.skipRate || (b.avgAttempts ?? Infinity) - (a.avgAttempts ?? Infinity) || b.runs - a.runs);
  const confusions = rows
    .flatMap((r) => r.topWrong.map((w) => ({ signId: r.signId, gloss: r.gloss, label: w.label, count: w.count })))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const sum = (f: 'runs' | 'successes' | 'skips' | 'wrongReadings') => rows.reduce((a, r) => a + r[f], 0);
  return {
    totals: { signs: rows.length, runs: sum('runs'), successes: sum('successes'), skips: sum('skips'), wrongReadings: sum('wrongReadings') },
    signs: rows,
    confusions,
  };
}

export function sampleOverview(today = '2026-10-23'): Overview {
  const rnd = seeded(43);
  const end = Date.parse(`${today}T12:00:00Z`);
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = iso(end - (29 - i) * DAY_MS);
    const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    const active = Math.round((weekend ? 28 : 40) + i * 0.9 + rnd() * 12);
    const collected = i < 29;
    const errors = collected ? (rnd() < 0.7 ? 0 : Math.ceil(rnd() * 4)) : null;
    return {
      day,
      activeUsers: active,
      newAccounts: Math.round(2 + rnd() * 6),
      lessonsCompleted: Math.round(active * (1.6 + rnd())),
      practiceSessions: Math.round(active * 0.4),
      lessonAbandons: Math.round(active * 0.2 * rnd()),
      serverErrors: errors,
      api5xx: errors,
      lambdaErrors: collected ? 0 : null,
      apiRequests: collected ? active * 30 : null,
    };
  });
  const weeks = Array.from({ length: 12 }, (_, i) => ({
    week: `2026-w${String(32 + i).padStart(2, '0')}`,
    activeUsers: Math.round(60 + i * 9 + rnd() * 15),
    newAccounts: Math.round(20 + rnd() * 20),
    lessonsCompleted: Math.round(400 + i * 30),
  }));
  const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month, i) => ({
    month,
    activeUsers: Math.round(40 + i * 60 + rnd() * 20),
    newAccounts: Math.round(30 + i * 25),
    lessonsCompleted: Math.round(300 + i * 700),
  }));
  const lesson = (lessonId: string, title: string, unitTitle: string, done: number, abandon: number, attempted: number, wrong: number) => ({
    lessonId, title, unitId: lessonId.split('-')[0], unitTitle, done, abandon,
    abandonRate: Math.round((abandon / (done + abandon)) * 1000) / 1000,
    attempted, wrong, wrongRate: Math.round((wrong / attempted) * 1000) / 1000,
    failedSigns: Math.round(wrong * 0.6), reviewedSigns: Math.round(attempted * 0.8),
    placementSkips: 0, placementUndos: 0,
  });
  const placement = (lessonId: string, title: string, unitTitle: string, placementSkips: number, placementUndos: number) => ({
    ...lesson(lessonId, title, unitTitle, 1, 0, 1, 0), done: 0, abandonRate: null, attempted: 0, wrongRate: null,
    failedSigns: 0, reviewedSigns: 0, placementSkips, placementUndos,
  });
  return {
    today,
    range: { from: days[0].day, to: today },
    totals: {
      activeToday: days[29].activeUsers,
      activeWeek: weeks[11].activeUsers,
      activeMonth: months[4].activeUsers,
      newAccounts: days.reduce((a, d) => a + d.newAccounts, 0),
      lessonsCompleted: days.reduce((a, d) => a + d.lessonsCompleted, 0),
      lessonAbandons: days.reduce((a, d) => a + d.lessonAbandons, 0),
      serverErrors: days.reduce((a, d) => a + (d.serverErrors ?? 0), 0),
    },
    days,
    weeks,
    months,
    lessons: [
      lesson('u2-l2', 'Números 6 a 10', 'Números', 120, 48, 900, 210),
      lesson('u1-l5', 'Letras U a Z', 'Alfabeto', 300, 60, 2100, 380),
      lesson('u8-l4', 'Meses do ano', 'Tempo', 80, 30, 640, 190),
      lesson('u4-l2', 'Meu nome é', 'Apresentação', 210, 22, 1500, 140),
      lesson('u1-l1', 'Letras A a E', 'Alfabeto', 640, 40, 4200, 260),
      lesson('u3-l1', 'Cumprimentos', 'Saudações e cortesia', 400, 18, 2800, 120),
      placement('u1-l2', 'Letras F a J', 'Alfabeto', 34, 3),
      placement('u1-l3', 'Letras K a O', 'Alfabeto', 21, 2),
    ],
    exercises: [
      { type: 'perform_sign', attempted: 3200, wrong: 900, wrongRate: 0.281, abandon: 120 },
      { type: 'fingerspell', attempted: 1400, wrong: 350, wrongRate: 0.25, abandon: 64 },
      { type: 'build_phrase', attempted: 800, wrong: 160, wrongRate: 0.2, abandon: 12 },
      { type: 'watch_choose_word', attempted: 5200, wrong: 520, wrongRate: 0.1, abandon: 20 },
      { type: 'match_pairs', attempted: 2400, wrong: 190, wrongRate: 0.079, abandon: 6 },
    ],
    signs: [
      { signId: 'letra-H', gloss: 'H', failed: 96 },
      { signId: 'letra-K', gloss: 'K', failed: 81 },
      { signId: 'numero-8', gloss: '8', failed: 64 },
      { signId: 'letra-Y', gloss: 'Y', failed: 52 },
      { signId: 'obrigado', gloss: 'OBRIGADO', failed: 31 },
    ],
    camera: sampleCamera(),
    serverErrors: {
      collectedThrough: days[28].day,
      byFunction: [{ name: 'librax-complete-lesson', errors: 3 }, { name: 'librax-get-league', errors: 1 }],
    },
  };
}

export const sampleContent = contentStatus as unknown as ContentStatus;

export const SAMPLE_USER = '22222222-2222-4222-8222-222222222222';

/** Listagem de contas (32 = duas páginas): a Ana primeiro e contas de exemplo depois. */
export function sampleAccountList(): Account[] {
  const nomes = ['bruno', 'carla', 'davi', 'elisa', 'fabio', 'gabi', 'hugo', 'iara'];
  const outras = Array.from({ length: 31 }, (_, i): Account => ({
    userId: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`,
    email: `${nomes[i % nomes.length]}${i + 1}@exemplo.com`,
    emailVerified: i % 5 !== 0,
    name: null,
    provider: i % 3 === 0 ? 'Google' : 'email',
    status: i % 3 === 0 ? 'EXTERNAL_PROVIDER' : 'CONFIRMED',
    enabled: i !== 7,
    createdAt: new Date(Date.UTC(2026, 9, 26) - i * 86_400_000).toISOString(),
  }));
  return [sampleAccount.account!, ...outras];
}

export const sampleAccount: AccountSummary = {
  userId: SAMPLE_USER,
  account: {
    userId: SAMPLE_USER, email: 'ana@exemplo.com', emailVerified: true, name: 'Ana', provider: 'Google',
    status: 'EXTERNAL_PROVIDER', enabled: true, createdAt: '2026-09-02T13:20:00.000Z',
  },
  profile: {
    displayName: 'Ana', timezone: 'America/Sao_Paulo', xpTotal: 640, streak: 12, lastActiveDay: '2026-10-23',
    freezes: 1, dailyGoalXp: 20, signsLearned: 48, lessonsCompleted: 14, alphabetComplete: true,
  },
  progress: {
    distinctLessons: 3,
    placementSkipped: 1,
    totalLessons: 57,
    lessons: [
      { lessonId: 'u2-l1', title: 'Números 0 a 5', unitId: 'u2', status: 'completed', bestScore: 0.8, completedAt: '2026-10-23' },
      { lessonId: 'u1-l5', title: 'Letras U a Z', unitId: 'u1', status: 'completed', bestScore: 0.9, completedAt: '2026-10-20' },
      { lessonId: 'u1-l2', title: 'Letras F a J', unitId: 'u1', status: 'placement', bestScore: null, completedAt: null, skippedAt: '2026-10-02' },
      { lessonId: 'u1-l1', title: 'Letras A a E', unitId: 'u1', status: 'completed', bestScore: 1, completedAt: '2026-10-02' },
    ],
  },
  srs: { signs: 48, due: 6 },
  achievements: ['ALFABETO', 'PRIMEIRA_LICAO', 'SEQUENCIA_7'],
  league: {
    tier: 'prata',
    current: { leagueId: 'prata-2026-w43', period: '2026-w43', xpPeriod: 120 },
    lastResult: { period: '2026-w42', outcome: 'promoted', rank: 2, total: 30, toTier: 'prata' },
  },
  squads: [{ squadId: 's1', name: 'Turma de quinta', type: 'private', memberCount: 8, role: 'admin', xpWeeklyContrib: 60 }],
  activity: { lastDay: '2026-10-23', lastWeek: '2026-w43', lastMonth: '2026-10' },
};

export function sampleSquads(): SquadRow[] {
  const names = ['Turma de quinta', 'Libras no trabalho', 'Família Souza', 'Clube do alfabeto', 'Escola Bilíngue', 'Amigos da Bia'];
  return names.map((name, i) => ({
    squadId: `s${i + 1}`,
    name,
    type: i % 3 === 0 ? 'private' : 'public',
    memberCount: [8, 27, 4, 15, 30, 2][i],
    maxMembers: 30,
    createdAt: new Date(Date.parse('2026-10-22T12:00:00Z') - i * 4 * DAY_MS).toISOString(),
    createdBy: SAMPLE_USER,
    xpWeekly: [60, 410, 20, 180, 520, 0][i],
    xpAllTime: [900, 4100, 120, 1600, 6000, 10][i],
  }));
}

export const sampleCost: CostView = {
  latest: {
    month: '2026-10', start: '2026-10-01', end: '2026-10-23', complete: false, daysElapsed: 22, daysInMonth: 31,
    currency: 'USD', total: 3.84, projectedTotal: 5.41, asOf: '2026-10-23T03:30:12.000Z',
    byService: [
      { service: 'Amazon CloudFront', amount: 1.52 },
      { service: 'Amazon DynamoDB', amount: 0.97 },
      { service: 'AWS Lambda', amount: 0.61 },
      { service: 'Amazon Simple Storage Service', amount: 0.42 },
      { service: 'AmazonCloudWatch', amount: 0.21 },
      { service: 'AWS Cost Explorer', amount: 0.11 },
    ],
  },
  months: [
    { month: '2026-10', start: '2026-10-01', end: '2026-10-23', complete: false, daysElapsed: 22, daysInMonth: 31, currency: 'USD', total: 3.84, projectedTotal: 5.41, asOf: '2026-10-23T03:30:12.000Z' },
    { month: '2026-09', start: '2026-09-01', end: '2026-10-01', complete: true, daysElapsed: 30, daysInMonth: 30, currency: 'USD', total: 4.12, projectedTotal: 4.12, asOf: '2026-10-01T03:30:09.000Z' },
    { month: '2026-08', start: '2026-08-01', end: '2026-09-01', complete: true, daysElapsed: 31, daysInMonth: 31, currency: 'USD', total: 2.3, projectedTotal: 2.3, asOf: '2026-09-01T03:30:11.000Z' },
  ],
};
