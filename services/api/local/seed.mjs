/**
 * Semente do ambiente local: contas de teste no Cognito simulado e dados para o app e o painel,
 * gerados pelas mesmas fabricas e usecases da API (nada escrito direto na tabela).
 *
 * - Contas (config.mjs, ACCOUNTS): criadas uma vez, com o verificador SRP da senha e o grupo
 *   `admin` para a conta admin. Cada conta nova passa pelo gatilho PostConfirmation no dia em
 *   que "se cadastrou", para o painel mostrar contas novas espalhadas.
 * - Atividade das ultimas duas semanas: licoes (POST /v1/lesson/complete, com exerciseStats e
 *   sinais revisados), pratica (POST /v1/practice/review), saidas no meio da licao e squads, em
 *   ordem de tempo e com o relogio do servidor no dia de cada evento. Ao virar a semana roda o
 *   fechamento das ligas (job librax-close-league), como o Scheduler faria.
 * - Job diario do painel (librax-ops-daily) nos 14 dias anteriores, com CloudWatch e Cost
 *   Explorer falsos (fakes.mjs).
 *
 * Idempotente: a atividade so e gerada se nenhuma conta da semente tem perfil na tabela; o job
 * diario regrava os mesmos itens.
 */

import './awsGuard.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { makeLocalFunctions } from './functions.mjs';
import { makeCognitoLocal } from './cognitoLocal.mjs';
import { loadPlan, loadState } from './bootstrap.mjs';
import { periodStartOf } from '../src/domain/leagues.js';
import { ACCOUNTS } from './config.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (date) => date.toISOString().slice(0, 10);

/** Gerador pseudoaleatorio estavel por texto (mesma semente, mesmos dados). */
function random(seedText) {
  let s = createHash('sha256').update(seedText).digest().readUInt32BE(0);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ritmo de cada conta: dias ativos (dias atras), licoes por dia, pratica e saidas.
 * `signupDaysAgo` e o dia do cadastro (PostConfirmation).
 */
const PERSONAS = {
  aluno: { signupDaysAgo: 20, activeDays: [13, 12, 11, 10, 8, 7, 6, 5, 3, 2, 1], lessonsPerDay: [1, 2], practiceDays: [10, 6, 2], abandons: [7, 2] },
  admin: { signupDaysAgo: 25, activeDays: [9, 4, 1], lessonsPerDay: [1, 1], practiceDays: [], abandons: [] },
  bia: { signupDaysAgo: 18, activeDays: [12, 11, 9, 8, 7, 6, 4, 3, 1], lessonsPerDay: [1, 3], practiceDays: [8, 3], abandons: [11] },
  caio: { signupDaysAgo: 15, activeDays: [10, 9, 7, 5, 2], lessonsPerDay: [1, 2], practiceDays: [5], abandons: [9, 5] },
  davi: { signupDaysAgo: 12, activeDays: [9, 8, 6, 1], lessonsPerDay: [1, 1], practiceDays: [], abandons: [6] },
  eva: { signupDaysAgo: 10, activeDays: [8, 7, 6, 5, 4, 2, 1], lessonsPerDay: [1, 2], practiceDays: [4], abandons: [] },
  fabi: { signupDaysAgo: 8, activeDays: [6, 3, 2], lessonsPerDay: [1, 2], practiceDays: [], abandons: [3] },
};

/** Squads: quem cria, tipo e quem entra pelo codigo. */
const SQUADS = [
  { owner: 'aluno', name: 'Mãos que Falam', description: 'Turma de Libras do bairro', type: 'public', members: ['bia', 'caio', 'fabi'], daysAgo: 14 },
  { owner: 'davi', name: 'Turma da Noite', description: 'Quem estuda depois do trabalho', type: 'private', members: ['eva'], daysAgo: 11 },
];

const EXERCISES = ['watch_choose_word', 'word_choose_video', 'match_pairs', 'perform_sign', 'build_phrase', 'fingerspell'];

/** Evento do API Gateway minimo para chamar um handler pela fabrica. */
const apiEvent = (routeKey, userId, body) => ({
  version: '2.0',
  routeKey,
  requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

async function call(handler, event, label) {
  const res = await handler(event);
  if (res.statusCode >= 300) throw new Error(`semente: ${label} respondeu ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body);
}

export async function seed({ plan = loadPlan(), state = loadState(), log = (...a) => console.log('[semente]', ...a), now = new Date() } = {}) {
  const functions = makeLocalFunctions({ plan, state, log: () => {} });
  const local = makeCognitoLocal({ state, plan, invoke: (name, event, at) => functions.invoke(name, event, at), log });
  const { repo, catalog } = functions;

  // --- Contas ----------------------------------------------------------------
  const users = {};
  for (const account of ACCOUNTS) {
    let user = await local.findByEmail(account.email);
    if (!user) {
      user = await local.createAccount({
        email: account.email,
        password: account.password,
        name: account.name,
        groups: account.admin ? ['admin'] : [],
      });
      const signup = new Date(now.getTime() - (PERSONAS[account.key]?.signupDaysAgo ?? 0) * DAY_MS);
      await local.postConfirmation('PostConfirmation_ConfirmSignUp', user, null, () => signup);
      log(`conta ${account.email} criada`);
    } else if (!local.srpStore.get(state.userPoolId, user.attributes.sub)) {
      await local.setPassword(user.username, account.password);
      log(`senha de ${account.email} registrada de novo (verificador SRP)`);
    }
    users[account.key] = { ...account, userId: user.attributes.sub };
  }

  // --- Atividade ---------------------------------------------------------------
  const profiles = await Promise.all(Object.values(users).map((u) => repo.getProfile(u.userId)));
  if (profiles.some(Boolean)) {
    log('atividade ja gerada antes (perfis na tabela): pulando');
  } else {
    await seedActivity({ functions, users, catalog, now, log });
  }

  // --- Job diario do painel ------------------------------------------------------
  const today = dayOf(now);
  const monthStart = new Date(`${today.slice(0, 8)}01T03:30:00Z`);
  // mes anterior fechado (o job do dia 1 faz isso) e, abaixo, o mes atual
  if (monthStart <= now) {
    await functions.invoke('librax-ops-daily', { skipCost: false, day: dayOf(new Date(monthStart.getTime() - DAY_MS)) }, () => monthStart);
  }
  // as 14 ultimas execucoes das 03:30 UTC que ja passaram
  let lastRun = Date.parse(`${today}T03:30:00Z`);
  if (lastRun > now.getTime()) lastRun -= DAY_MS;
  for (let k = 13; k >= 0; k -= 1) {
    const at = new Date(lastRun - k * DAY_MS);
    await functions.invoke('librax-ops-daily', { skipCost: k !== 0 }, () => at);
  }
  log('job diario do painel rodado nos ultimos 14 dias (CloudWatch e Cost Explorer simulados)');
  return users;
}

async function seedActivity({ functions, users, catalog, now, log }) {
  const lessonIds = Object.keys(catalog.lessons);
  const signsOrder = catalog.signsOrder ?? [];
  // sinais de cada licao: a ordem do curso dividida pelo signCount (aproximacao para o SRS)
  const lessonSigns = {};
  let offset = 0;
  for (const id of lessonIds) {
    const n = catalog.lessons[id].signCount ?? 0;
    lessonSigns[id] = signsOrder.slice(offset, offset + n);
    offset += n;
  }

  const at = (daysAgo, rand) => {
    const d = new Date(now.getTime() - daysAgo * DAY_MS);
    // entre 13h e 23h UTC (10h e 20h em Brasilia): o dia local e o mesmo do UTC
    return new Date(Date.parse(`${dayOf(d)}T13:00:00Z`) + Math.floor(rand() * 10 * 60) * 60 * 1000);
  };

  // eventos em ordem de tempo: squads, licoes, pratica e saidas
  const events = [];
  for (const squad of SQUADS) {
    const rand = random(`squad:${squad.name}`);
    events.push({ at: at(squad.daysAgo, rand), kind: 'squad', squad });
  }
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const rand = random(`persona:${key}`);
    for (const daysAgo of persona.activeDays) {
      const [min, max] = persona.lessonsPerDay;
      const count = min + Math.floor(rand() * (max - min + 1));
      for (let i = 0; i < count; i += 1) events.push({ at: at(daysAgo, rand), kind: 'lesson', key });
    }
    for (const daysAgo of persona.practiceDays) events.push({ at: at(daysAgo, rand), kind: 'practice', key });
    for (const daysAgo of persona.abandons) events.push({ at: at(daysAgo, rand), kind: 'abandon', key });
  }
  // a liga sai do relogio do servidor: tudo no passado (o evento de hoje vira "agora")
  events.sort((a, b) => a.at - b.at);

  const progress = Object.fromEntries(Object.keys(users).map((k) => [k, 0]));
  let week = null;
  const totals = { lesson: 0, practice: 0, abandon: 0, squad: 0, leagueClosures: 0 };

  for (const ev of events) {
    const clock = () => ev.at;
    const evWeek = periodStartOf(ev.at.getTime());
    if (week !== null && evWeek > week) {
      // virada de semana: o Scheduler fecha as ligas na segunda 00:05 UTC
      const monday = new Date(evWeek + 5 * 60 * 1000);
      await functions.invoke('librax-close-league', {}, () => monday);
      totals.leagueClosures += 1;
    }
    week = evWeek;
    const http = functions.httpHandlers(clock);
    const rand = random(`${ev.kind}:${ev.key ?? ev.squad?.name}:${ev.at.toISOString()}`);
    const today = dayOf(ev.at);

    if (ev.kind === 'squad') {
      const { squad } = ev;
      const created = await call(
        http.createSquadHandler,
        apiEvent('POST /v1/squads', users[squad.owner].userId, { name: squad.name, description: squad.description, type: squad.type }),
        'criar squad',
      );
      for (const member of squad.members) {
        await call(http.joinSquadHandler, apiEvent('POST /v1/squads/join', users[member].userId, { inviteCode: created.inviteCode }), 'entrar na squad');
      }
      totals.squad += 1;
    } else if (ev.kind === 'lesson') {
      const user = users[ev.key];
      const lessonId = lessonIds[Math.min(progress[ev.key], lessonIds.length - 1)];
      progress[ev.key] += 1;
      const signs = lessonSigns[lessonId];
      const reviewed = signs.map((signId) => ({
        signId,
        result: { state: rand() < 0.15 ? 'failed' : rand() < 0.3 ? 'retry_resolved' : 'correct' },
      }));
      const exerciseStats = {};
      for (const type of EXERCISES.slice(0, 3 + Math.floor(rand() * 3))) {
        const attempted = 2 + Math.floor(rand() * 3);
        exerciseStats[type] = { attempted, wrong: Math.floor(rand() * attempted * 0.5) };
      }
      await call(http.completeLessonHandler, apiEvent('POST /v1/lesson/complete', user.userId, {
        lessonAttemptId: `seed-${ev.key}-${ev.at.getTime()}`,
        lessonId,
        today,
        score: Number((0.7 + rand() * 0.3).toFixed(2)),
        completedAt: ev.at.toISOString(),
        reviewed,
        signsLearnedDelta: signs.length,
        exerciseStats,
      }), `licao ${lessonId}`);
      totals.lesson += 1;
    } else if (ev.kind === 'practice') {
      const learned = lessonIds.slice(0, Math.max(1, progress[ev.key])).flatMap((id) => lessonSigns[id]);
      if (learned.length === 0) continue;
      const reviewed = learned.slice(0, 6).map((signId) => ({ signId, result: { state: rand() < 0.2 ? 'failed' : 'correct' } }));
      await call(http.reviewSignsHandler, apiEvent('POST /v1/practice/review', users[ev.key].userId, {
        reviewAttemptId: `seed-pratica-${ev.key}-${ev.at.getTime()}`,
        today,
        reviewed,
      }), 'pratica');
      totals.practice += 1;
    } else if (ev.kind === 'abandon') {
      const lessonId = lessonIds[Math.min(progress[ev.key], lessonIds.length - 1)];
      const exerciseCount = 10 + Math.floor(rand() * 6);
      await call(http.abandonLessonHandler, apiEvent('POST /v1/lesson/abandon', users[ev.key].userId, {
        lessonId,
        today,
        exerciseIndex: Math.floor(rand() * exerciseCount),
        exerciseCount,
        exerciseType: EXERCISES[Math.floor(rand() * EXERCISES.length)],
      }), 'saida da licao');
      totals.abandon += 1;
    }
  }

  // Inscricao de Web Push da conta comum (endpoint de servico conhecido, nunca chamado: o job
  // de lembretes usa o Web Push falso), feita ha 2 dias para o lembrete poder sair
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);
  await call(functions.httpHandlers(() => twoDaysAgo).subscribePushHandler, apiEvent('POST /v1/push/subscriptions', users.aluno.userId, {
    endpoint: `https://fcm.googleapis.com/fcm/send/simulado-local-${users.aluno.userId}`,
    keys: { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') },
    timezone: 'America/Sao_Paulo',
  }), 'inscricao de push');

  // semana atual sem evento ainda: fecha a que passou, como o job de segunda
  const currentWeek = periodStartOf(now.getTime());
  if (week !== null && currentWeek > week) {
    await functions.invoke('librax-close-league', {}, () => new Date(currentWeek + 5 * 60 * 1000));
    totals.leagueClosures += 1;
  }
  log(`atividade gerada: ${totals.lesson} licoes, ${totals.practice} praticas, ${totals.abandon} saidas, ${totals.squad} squads, ${totals.leagueClosures} fechamento(s) de liga`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().catch((err) => {
    console.error('[semente] falhou:', err);
    process.exit(1);
  });
}
