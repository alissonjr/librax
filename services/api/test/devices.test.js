import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyUserAgent, parseDeviceReport, deviceKey, isFreshLogin, registerDevice, MAX_DEVICES, MAX_ALERTS_PER_DAY,
} from '../src/domain/devices.js';
import { makeDeviceHandlers } from '../src/handlers/devices.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// Aviso de acesso novo (feito por nos): aparelhos conhecidos da conta e e-mail so para aparelho novo
// num login recente, com limite. Sem IP e sem o User-Agent inteiro na tabela.

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
  samsungTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

test('classe do aparelho pelo User-Agent: tipo, sistema e navegador', () => {
  assert.deepEqual(classifyUserAgent(UA.androidChrome), { kind: 'mobile', os: 'Android', browser: 'Chrome' });
  assert.deepEqual(classifyUserAgent(UA.iphoneSafari), { kind: 'mobile', os: 'iOS', browser: 'Safari' });
  assert.deepEqual(classifyUserAgent(UA.ipad), { kind: 'tablet', os: 'iPadOS', browser: 'Safari' });
  assert.deepEqual(classifyUserAgent(UA.windowsEdge), { kind: 'desktop', os: 'Windows', browser: 'Edge' });
  assert.deepEqual(classifyUserAgent(UA.macFirefox), { kind: 'desktop', os: 'macOS', browser: 'Firefox' });
  assert.deepEqual(classifyUserAgent(UA.samsungTablet), { kind: 'tablet', os: 'Android', browser: 'Samsung Internet' });
  assert.deepEqual(classifyUserAgent(UA.linuxChrome), { kind: 'desktop', os: 'Linux', browser: 'Chrome' });
  assert.deepEqual(classifyUserAgent(''), { kind: 'unknown', os: null, browser: null });
  assert.deepEqual(classifyUserAgent('curl/8.0'), { kind: 'unknown', os: null, browser: null });
});

test('corpo: deviceId aleatorio obrigatorio; idioma e fuso invalidos sao ignorados', () => {
  const id = '0b8f1c2e-6d3a-4f5b-9c7d-112233445566';
  assert.deepEqual(parseDeviceReport({ deviceId: id, lang: 'en', timezone: 'Europe/Lisbon' }), { deviceId: id, lang: 'en', timezone: 'Europe/Lisbon' });
  assert.deepEqual(parseDeviceReport({ deviceId: id, lang: 'fr', timezone: 'Lua/Base' }), { deviceId: id, lang: null, timezone: null });
  for (const bad of [null, [], {}, { deviceId: 'curto' }, { deviceId: 'x'.repeat(65) }, { deviceId: 'tem espaco aqui 123' }]) {
    assert.throws(() => parseDeviceReport(bad), /BAD_DEVICE/);
  }
});

test('chave do aparelho: hash com a conta (o mesmo codigo em outra conta e outra chave)', () => {
  const k = deviceKey('u1', 'abcdefghijklmnop');
  assert.match(k, /^[0-9a-f]{32}$/);
  assert.equal(k, deviceKey('u1', 'abcdefghijklmnop'));
  assert.notEqual(k, deviceKey('u2', 'abcdefghijklmnop'));
  assert.doesNotMatch(k, /abcdefghijklmnop/);
});

test('login recente: auth_time com ate 15 minutos', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const s = now.getTime() / 1000;
  assert.equal(isFreshLogin(s - 60, now), true);
  assert.equal(isFreshLogin(String(s - 14 * 60), now), true);
  assert.equal(isFreshLogin(s - 16 * 60, now), false);
  assert.equal(isFreshLogin(undefined, now), false);
});

const device = { kind: 'mobile', os: 'Android', browser: 'Chrome' };
const at = (iso) => new Date(iso);

test('regras: primeiro aparelho em silencio, conhecido sem aviso, novo com aviso so em login recente', () => {
  const now = at('2026-10-26T12:00:00Z');
  const first = registerDevice(null, { key: 'a', device, lang: 'pt-BR', timezone: 'America/Sao_Paulo', freshLogin: true, now });
  assert.equal(first.reason, 'FIRST_DEVICE');
  assert.equal(first.alert, false);
  assert.equal(first.next.devices.length, 1);

  const again = registerDevice(first.next, { key: 'a', device, lang: 'pt-BR', timezone: 'America/Sao_Paulo', freshLogin: true, now });
  assert.equal(again.reason, 'KNOWN_DEVICE');
  assert.equal(again.changed, false); // mesmo dia, nada muda: nao grava

  const nextDay = registerDevice(first.next, { key: 'a', device, lang: null, timezone: null, freshLogin: false, now: at('2026-10-27T12:00:00Z') });
  assert.equal(nextDay.changed, true);
  assert.equal(nextDay.next.lang, 'pt-BR'); // sem idioma no corpo, fica o anterior

  const novo = registerDevice(first.next, { key: 'b', device, lang: 'en', timezone: null, freshLogin: true, now });
  assert.equal(novo.alert, true);
  assert.equal(novo.previous.lang, 'pt-BR');
  assert.equal(novo.next.lang, 'en');

  const sessaoAntiga = registerDevice(first.next, { key: 'b', device, lang: null, timezone: null, freshLogin: false, now });
  assert.equal(sessaoAntiga.reason, 'OLD_SESSION');
  assert.equal(sessaoAntiga.alert, false);
  assert.equal(sessaoAntiga.next.devices.length, 2);
});

test('limites: ate 10 aparelhos (sai o visto ha mais tempo) e ate 3 avisos em 24 horas', () => {
  const now = at('2026-10-26T12:00:00Z');
  const devices = Array.from({ length: MAX_DEVICES }, (_, i) => ({
    id: `d${i}`, ...device, firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
  }));
  const full = registerDevice({ devices, alertsSentAt: [] }, { key: 'novo', device, lang: null, timezone: null, freshLogin: true, now });
  assert.equal(full.next.devices.length, MAX_DEVICES);
  assert.ok(full.next.devices.some((d) => d.id === 'novo'));
  assert.ok(!full.next.devices.some((d) => d.id === 'd0'));

  const alertsSentAt = ['2026-10-26T01:00:00.000Z', '2026-10-26T02:00:00.000Z', '2026-10-26T03:00:00.000Z'];
  assert.equal(alertsSentAt.length, MAX_ALERTS_PER_DAY);
  const limited = registerDevice({ devices: [devices[0]], alertsSentAt }, { key: 'x', device, lang: null, timezone: null, freshLogin: true, now });
  assert.equal(limited.reason, 'ALERT_LIMIT');
  assert.equal(limited.alert, false);
  // avisos com mais de 24 horas saem da conta
  const old = registerDevice({ devices: [devices[0]], alertsSentAt: ['2026-10-24T01:00:00.000Z'] }, { key: 'y', device, lang: null, timezone: null, freshLogin: true, now });
  assert.equal(old.alert, true);
  assert.deepEqual(old.next.alertsSentAt, []);
});

// --- handler -------------------------------------------------------------------------------------

const NOW = new Date('2026-10-26T23:03:00Z');
const DEVICE_A = '11111111-2222-4333-8444-555555555555';
const DEVICE_B = '66666666-7777-4888-9999-000000000000';

function evt({ deviceId = DEVICE_A, lang = 'pt-BR', timezone = 'America/Sao_Paulo', ua = UA.androidChrome, authAgeS = 30, claims = {}, country = 'BR', body } = {}) {
  return {
    headers: { 'user-agent': ua, 'cloudfront-viewer-country': country },
    body: body ?? JSON.stringify({ deviceId, lang, timezone }),
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'u1',
            email: 'ana@exemplo.com',
            email_verified: 'true',
            given_name: 'Ana',
            auth_time: String(Math.floor(NOW.getTime() / 1000) - authAgeS),
            ...claims,
          },
        },
      },
    },
  };
}

function setup({ mailer = 'fake', failMail = false } = {}) {
  const repo = new InMemoryRepo();
  const sent = [];
  const fake = { async send(msg) { if (failMail) throw new Error('ses fora'); sent.push(msg); } };
  const logs = [];
  const { reportDeviceHandler } = makeDeviceHandlers({
    repo,
    mailer: mailer === 'fake' ? fake : mailer,
    appUrl: 'https://app.librax.example',
    now: () => NOW,
    log: (...a) => logs.push(a),
  });
  return { repo, sent, logs, call: (e) => reportDeviceHandler(e) };
}

test('POST /v1/users/me/devices: primeiro aparelho registra sem e-mail; o segundo, num login recente, avisa', async () => {
  const { repo, sent, call } = setup();
  let r = await call(evt());
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { known: false });
  assert.equal(sent.length, 0);

  r = await call(evt());
  assert.deepEqual(JSON.parse(r.body), { known: true });

  // aparelho novo (outro navegador), app em ingles: o e-mail sai no idioma que a conta ja tinha
  r = await call(evt({ deviceId: DEVICE_B, ua: UA.windowsEdge, lang: 'en', country: 'PT' }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@exemplo.com');
  assert.equal(sent[0].subject, 'Novo acesso à sua conta do Librax');
  assert.match(sent[0].text, /Computador \(Windows\)/);
  assert.match(sent[0].text, /Navegador: Edge/);
  assert.match(sent[0].text, /20:03/); // 23:03 UTC no fuso de Sao Paulo
  assert.match(sent[0].text, /País aproximado: Portugal/);
  assert.match(sent[0].html, /Olá, Ana!/);

  const saved = await repo.getDevices('u1');
  assert.equal(saved.devices.length, 2);
  assert.equal(saved.lang, 'en'); // o idioma atual do app vale dali em diante (lembretes)
  assert.equal(saved.alertsSentAt.length, 1);
  // o que fica guardado: hash, classe e datas; nada de codigo do aparelho, User-Agent, IP ou pais
  const raw = JSON.stringify(saved);
  for (const leak of [DEVICE_A, DEVICE_B, 'Mozilla', 'PT', 'Portugal']) assert.ok(!raw.includes(leak), leak);
  assert.deepEqual(Object.keys(saved.devices[0]).sort(), ['browser', 'firstSeenAt', 'id', 'kind', 'lastSeenAt', 'os']);
});

test('sessao antiga, e-mail nao verificado ou SES desligado: registra sem e-mail', async () => {
  const old = setup();
  await old.call(evt());
  await old.call(evt({ deviceId: DEVICE_B, authAgeS: 3600 }));
  assert.equal(old.sent.length, 0);
  assert.equal((await old.repo.getDevices('u1')).devices.length, 2);

  const unverified = setup();
  await unverified.call(evt());
  await unverified.call(evt({ deviceId: DEVICE_B, claims: { email_verified: 'false' } }));
  assert.equal(unverified.sent.length, 0);

  const noSes = setup({ mailer: null });
  await noSes.call(evt());
  const r = await noSes.call(evt({ deviceId: DEVICE_B }));
  assert.equal(r.statusCode, 200);
  assert.equal((await noSes.repo.getDevices('u1')).alertsSentAt.length, 0);
});

test('SES falhando nao quebra o login: 200, aparelho registrado, sem contar aviso', async () => {
  const { repo, call, logs } = setup({ failMail: true });
  await call(evt());
  const r = await call(evt({ deviceId: DEVICE_B }));
  assert.equal(r.statusCode, 200);
  assert.equal((await repo.getDevices('u1')).devices.length, 2);
  assert.equal((await repo.getDevices('u1')).alertsSentAt.length, 0);
  assert.equal(logs.length, 1);
});

test('no maximo 3 avisos em 24 horas', async () => {
  const { sent, call } = setup();
  await call(evt());
  for (let i = 0; i < 5; i += 1) {
    await call(evt({ deviceId: `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${i}` }));
  }
  assert.equal(sent.length, MAX_ALERTS_PER_DAY);
});

test('corpo invalido: 400 BAD_DEVICE; sem token: 401', async () => {
  const { call } = setup();
  let r = await call(evt({ body: JSON.stringify({ deviceId: 'x' }) }));
  assert.equal(r.statusCode, 400);
  assert.equal(JSON.parse(r.body).error.code, 'BAD_DEVICE');
  r = await call({ ...evt(), requestContext: {} });
  assert.equal(r.statusCode, 401);
  r = await call(evt({ body: 'x'.repeat(2000) }));
  assert.equal(r.statusCode, 413);
});

test('exclusao de conta leva junto os aparelhos', async () => {
  const { repo, call } = setup();
  await call(evt());
  await repo.deleteUserItems('u1');
  assert.equal(await repo.getDevices('u1'), null);
});
