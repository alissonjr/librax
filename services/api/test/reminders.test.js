import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideReminder,
  localClock,
  offsetBucket,
  candidateBuckets,
  recordInteraction,
  reminderMessage,
} from '../src/domain/reminders.js';

// SPEC 05 secao 12.3 (inteligencia de timing) e 12.2 (copy). Funcoes puras: o horario
// local vem do fuso IANA do usuario, nunca do relogio do servidor.

const TZ = 'America/Sao_Paulo'; // UTC-3, sem horario de verao
const at = (iso) => new Date(iso);
const prefs = { reminderHour: 19, timezone: TZ };
const profile = { streak: 4, lastActiveDay: '2026-10-22' };

// 19h em Sao Paulo = 22h UTC
const AT_19H = '2026-10-23T22:00:00Z';
const AT_20H = '2026-10-23T23:00:00Z';

// --- relogio local ---

test('localClock converte para o dia e hora do fuso do usuario', () => {
  assert.deepEqual(localClock(at('2026-10-24T01:30:00Z'), TZ), { day: '2026-10-23', hour: 22 });
  assert.deepEqual(localClock(at('2026-10-24T01:30:00Z'), 'Asia/Tokyo'), { day: '2026-10-24', hour: 10 });
});

test('offsetBucket agrupa por deslocamento inteiro de UTC', () => {
  assert.equal(offsetBucket(at(AT_19H), TZ), -3);
  assert.equal(offsetBucket(at(AT_19H), 'Asia/Kolkata'), 5); // +5:30 cai no balde 5
  assert.equal(offsetBucket(at(AT_19H), 'UTC'), 0);
});

test('candidateBuckets so inclui fusos que estao fora do silencio agora', () => {
  const buckets = candidateBuckets(at(AT_19H)); // 22h UTC
  assert.ok(buckets.includes(-3)); // 19h local
  assert.ok(!buckets.includes(2)); // 0h local
  assert.ok(buckets.includes(-12)); // 10h local
  assert.ok(buckets.every((b) => b >= -12 && b <= 14));
});

// --- regras de envio ---

test('envia o lembrete diario no horario escolhido com a copy da spec', () => {
  const d = decideReminder({ now: at(AT_19H), prefs, profile, state: {} });
  assert.equal(d.send, true);
  assert.equal(d.kind, 'daily');
  assert.deepEqual(d.message, reminderMessage('daily', 4));
  assert.equal(d.message.title, 'Libras te espera');
  assert.ok(d.message.body.length <= 60);
  assert.equal(d.nextState.sentCount, 1);
  assert.equal(d.nextState.day, '2026-10-23');
});

test('nunca dispara entre 22h e 7h no fuso do usuario', () => {
  const late = decideReminder({ now: at('2026-10-24T01:00:00Z'), prefs: { ...prefs, reminderHour: 22 }, profile, state: {} });
  assert.deepEqual([late.send, late.reason], [false, 'QUIET_HOURS']);
  const early = decideReminder({ now: at('2026-10-23T09:00:00Z'), prefs: { ...prefs, reminderHour: 6 }, profile, state: {} });
  assert.deepEqual([early.send, early.reason], [false, 'QUIET_HOURS']);
});

test('nao lembra quem ja estudou hoje', () => {
  const d = decideReminder({ now: at(AT_19H), prefs, profile: { ...profile, lastActiveDay: '2026-10-23' }, state: {} });
  assert.deepEqual([d.send, d.reason], [false, 'ALREADY_STUDIED']);
});

test('nao manda o diario se abriu o app nas ultimas 3h', () => {
  const d = decideReminder({ now: at(AT_19H), prefs, profile, state: { lastSeenAt: '2026-10-23T20:30:00.000Z' } });
  assert.deepEqual([d.send, d.reason], [false, 'RECENTLY_ACTIVE']);
  const old = decideReminder({ now: at(AT_19H), prefs, profile, state: { lastSeenAt: '2026-10-23T18:30:00.000Z' } });
  assert.equal(old.send, true);
});

test('fora do horario nao envia; e o mesmo diario nao sai duas vezes no dia', () => {
  const d = decideReminder({ now: at('2026-10-23T18:00:00Z'), prefs, profile, state: {} });
  assert.deepEqual([d.send, d.reason], [false, 'NOT_DUE']);
  const first = decideReminder({ now: at(AT_19H), prefs, profile, state: {} });
  const again = decideReminder({ now: at('2026-10-23T22:30:00Z'), prefs, profile, state: first.nextState });
  assert.deepEqual([again.send, again.reason], [false, 'NOT_DUE']);
});

test('maximo de 2 notificacoes por dia', () => {
  const state = { day: '2026-10-23', sentCount: 2 };
  const d = decideReminder({ now: at(AT_19H), prefs, profile, state });
  assert.deepEqual([d.send, d.reason], [false, 'DAILY_CAP']);
  // no dia seguinte o contador zera
  const next = decideReminder({ now: at('2026-10-24T22:00:00Z'), prefs, profile, state });
  assert.equal(next.send, true);
  assert.equal(next.nextState.sentCount, 1);
});

test('streak em risco as 20h (streak >= 3) e excecao ao limite diario', () => {
  const state = { day: '2026-10-23', sentCount: 2 };
  const d = decideReminder({ now: at(AT_20H), prefs, profile, state });
  assert.equal(d.send, true);
  assert.equal(d.kind, 'streak_risk');
  assert.equal(d.message.title, 'Sua sequência vai até meia-noite');
  assert.equal(d.nextState.sentCount, 3);
  // uma vez por dia
  const again = decideReminder({ now: at('2026-10-23T23:30:00Z'), prefs, profile, state: d.nextState });
  assert.equal(again.send, false);
});

test('sem streak em risco abaixo de 3 dias', () => {
  const d = decideReminder({ now: at(AT_20H), prefs, profile: { ...profile, streak: 2 }, state: {} });
  assert.deepEqual([d.send, d.reason], [false, 'NOT_DUE']);
});

test('7 dias sem interagir: pausa tudo por 3 dias e depois volta so o diario', () => {
  const ignoredSince = '2026-10-16T22:00:00.000Z';
  const paused = decideReminder({ now: at(AT_19H), prefs, profile, state: { ignoredSince } });
  assert.deepEqual([paused.send, paused.reason], [false, 'PAUSED']);
  assert.equal(paused.nextState.pausedUntil, '2026-10-26T22:00:00.000Z');
  assert.equal(paused.nextState.dailyOnly, true);

  const during = decideReminder({ now: at('2026-10-25T22:00:00Z'), prefs, profile, state: paused.nextState });
  assert.deepEqual([during.send, during.reason], [false, 'PAUSED']);

  // depois da pausa: streak em risco nao volta, o diario sim
  const risk = decideReminder({ now: at('2026-10-26T23:00:00Z'), prefs, profile, state: paused.nextState });
  assert.equal(risk.send, false);
  const daily = decideReminder({ now: at('2026-10-27T22:00:00Z'), prefs, profile, state: paused.nextState });
  assert.equal(daily.send, true);
  assert.equal(daily.kind, 'daily');
});

test('interagir com uma notificacao zera a contagem de ignoradas e a pausa', () => {
  const state = recordInteraction(
    { ignoredSince: '2026-10-16T22:00:00.000Z', dailyOnly: true, pausedUntil: '2026-10-30T00:00:00.000Z' },
    at('2026-10-23T12:00:00Z'),
  );
  assert.deepEqual(
    { ignoredSince: state.ignoredSince, dailyOnly: state.dailyOnly, pausedUntil: state.pausedUntil, lastInteractionAt: state.lastInteractionAt },
    { ignoredSince: null, dailyOnly: false, pausedUntil: null, lastInteractionAt: '2026-10-23T12:00:00.000Z' },
  );
  assert.equal(decideReminder({ now: at(AT_19H), prefs, profile, state }).send, true);
});

test('o primeiro envio depois de uma interacao marca o inicio da contagem de ignoradas', () => {
  const d = decideReminder({ now: at(AT_19H), prefs, profile, state: {} });
  assert.equal(d.nextState.ignoredSince, '2026-10-23T22:00:00.000Z');
  const later = decideReminder({ now: at('2026-10-24T22:00:00Z'), prefs, profile, state: d.nextState });
  assert.equal(later.nextState.ignoredSince, '2026-10-23T22:00:00.000Z');
});

test('sem horario configurado nao ha lembrete diario', () => {
  const d = decideReminder({ now: at(AT_19H), prefs: { ...prefs, reminderHour: null }, profile, state: {} });
  assert.equal(d.send, false);
});

test('copy do diario sem sequencia nao fala em "0 dias"', () => {
  const m = reminderMessage('daily', 0);
  assert.ok(!m.body.includes('0 dias'));
  assert.ok(m.body.length <= 60);
});
