import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sendReminders } from '../src/usecases/sendReminders.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// Lambda de lembrete (plano mobile web 3.7, SPEC 05 12.3): o Scheduler chama de hora em hora;
// o usecase acha os candidatos pelo balde de fuso, decide e entrega por Web Push. Sem inscricao
// de push, cai no e-mail se a pessoa fez opt-in. Push e e-mail sao portas injetadas.

const now = new Date('2026-10-23T22:00:00Z'); // 19h em Sao Paulo

function fakePush({ failWith } = {}) {
  const sent = [];
  return {
    sent,
    async send(sub, payload) {
      if (failWith) {
        const err = new Error('push falhou');
        err.statusCode = failWith;
        throw err;
      }
      sent.push({ endpoint: sub.endpoint, payload });
    },
  };
}
function fakeMail() {
  const sent = [];
  return { sent, async send(msg) { sent.push(msg); } };
}

async function seedUser(repo, userId, { notif = {}, profile = {}, push = true } = {}) {
  await repo.seedProfile({ userId, streak: 4, lastActiveDay: '2026-10-22', ...profile });
  await repo.saveNotifState(userId, { reminderHour: 19, timezone: 'America/Sao_Paulo', emailOptIn: false, ...notif }, now);
  if (push) {
    await repo.putPushSubscription(userId, `sub-${userId}`, {
      endpoint: `https://fcm.googleapis.com/fcm/send/${userId}`,
      keys: { p256dh: 'p', auth: 'a' },
    });
  }
}

test('envia push para quem esta no horario e grava o estado', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'u1');
  const push = fakePush();

  const r = await sendReminders(repo, { now, push });

  assert.equal(r.sent, 1);
  assert.equal(push.sent.length, 1);
  assert.equal(push.sent[0].payload.title, 'Libras te espera');
  assert.equal(push.sent[0].payload.url, '/?origem=lembrete');
  const state = await repo.getNotifState('u1');
  assert.equal(state.sentCount, 1);
  assert.equal(state.lastSentAt, now.toISOString());
});

test('rodar duas vezes na mesma hora nao manda de novo', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'u1');
  const push = fakePush();
  await sendReminders(repo, { now, push });
  await sendReminders(repo, { now, push });
  assert.equal(push.sent.length, 1);
});

test('pula quem ja estudou hoje e quem esta em outro horario', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'estudou', { profile: { lastActiveDay: '2026-10-23' } });
  await seedUser(repo, 'manha', { notif: { reminderHour: 8 } });
  const push = fakePush();

  const r = await sendReminders(repo, { now, push });

  assert.equal(r.sent, 0);
  assert.equal(r.skipped.ALREADY_STUDIED, 1);
  assert.equal(r.skipped.NOT_DUE, 1);
});

test('inscricao expirada (410) e removida', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'u1');
  await sendReminders(repo, { now, push: fakePush({ failWith: 410 }) });
  assert.equal((await repo.listPushSubscriptions('u1')).length, 0);
  // nada entregue: o estado nao conta envio
  assert.equal((await repo.getNotifState('u1')).sentCount ?? 0, 0);
});

test('sem push, usa e-mail so com opt-in e se o envio de e-mail estiver ligado', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'com-optin', { push: false, notif: { emailOptIn: true, email: 'ana@exemplo.com' } });
  await seedUser(repo, 'sem-optin', { push: false });
  const mail = fakeMail();

  const r = await sendReminders(repo, { now, push: fakePush(), mail, appUrl: 'https://app.librax.example' });

  assert.equal(r.sent, 1);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'ana@exemplo.com');
  assert.equal(mail.sent[0].subject, 'Libras te espera');
  // HTML e texto: a sequencia, o botao de volta ao app e o link para desligar
  assert.match(mail.sent[0].html, /4 dias/);
  assert.match(mail.sent[0].html, /href="https:\/\/app\.librax\.example\/\?origem=lembrete"/);
  assert.match(mail.sent[0].text, /https:\/\/app\.librax\.example\/configuracoes/);

  const semMail = await sendReminders(new InMemoryRepo(), { now, push: fakePush() });
  assert.equal(semMail.sent, 0);
});

test('fusos diferentes recebem cada um no seu horario', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'sp');
  await seedUser(repo, 'manaus', { notif: { timezone: 'America/Manaus' } }); // 18h agora
  const push = fakePush();

  await sendReminders(repo, { now, push });
  assert.deepEqual(push.sent.map((s) => s.endpoint), ['https://fcm.googleapis.com/fcm/send/sp']);

  await sendReminders(repo, { now: new Date('2026-10-23T23:00:00Z'), push });
  assert.ok(push.sent.some((s) => s.endpoint.endsWith('/manaus')));
});

test('inicio de pausa e gravado mesmo sem envio', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'u1', { notif: { ignoredSince: '2026-10-16T22:00:00.000Z' } });
  await sendReminders(repo, { now, push: fakePush() });
  const state = await repo.getNotifState('u1');
  assert.equal(state.dailyOnly, true);
  assert.equal(state.pausedUntil, '2026-10-26T22:00:00.000Z');
});

test('lembrete no idioma que o app informou (push e e-mail); sem idioma, pt-BR', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'en-push');
  await repo.saveDevices('en-push', { devices: [], lang: 'en', timezone: 'America/Sao_Paulo' });
  await seedUser(repo, 'es-mail', { push: false, notif: { emailOptIn: true, email: 'eva@exemplo.com' } });
  await repo.saveDevices('es-mail', { devices: [], lang: 'es', timezone: 'America/Sao_Paulo' });
  const push = fakePush();
  const mail = fakeMail();

  await sendReminders(repo, { now, push, mail, appUrl: 'https://app.librax.example' });

  assert.equal(push.sent[0].payload.title, 'Libras is waiting for you');
  assert.match(push.sent[0].payload.body, /streak of 4 days/);
  assert.equal(mail.sent[0].subject, 'Libras te espera');
  assert.match(mail.sent[0].html, /lang="es"/);
  assert.match(mail.sent[0].html, /Hacer una lección/);
  assert.match(mail.sent[0].text, /racha de 4 días/);
});

test('sem appUrl o e-mail falha sem derrubar a rodada', async () => {
  const repo = new InMemoryRepo();
  await seedUser(repo, 'x', { push: false, notif: { emailOptIn: true, email: 'x@exemplo.com' } });
  const logs = [];
  const r = await sendReminders(repo, { now, push: fakePush(), mail: fakeMail(), log: (m) => logs.push(m) });
  assert.equal(r.sent, 0);
  assert.deepEqual(logs, ['e-mail falhou']);
});
