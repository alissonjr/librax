import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KEYS, MAX_BATCH, MAX_QUEUE, FEEDBACK_TEXT_MAX,
  __resetTelemetryForTests, buildBatch, coarsePlatform, configureTelemetry, currentSnapshot, flushFeedback,
  flushTelemetry, getTelemetryId, isTelemetryEnabled, pendingEvents, prepareDataReset, processPendingDeletes,
  sendFeedback, setTelemetryContext, setTelemetryEnabled, setTelemetryProgress, startTelemetry, track,
  trackLessonAbandon, trackLessonComplete, trackLessonOpen,
} from '../lib/telemetry';
import { getDeviceId } from '../lib/device';
import { getUserId } from '../lib/auth';

// Dados de uso anônimos (lib/telemetry.ts): fila com teto, lotes, mão única, código próprio e
// separado do código do aparelho, nada de dado pessoal no que sai e o interruptor das Configurações.
// A API é falsa: nada sai do teste.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let clock = Date.UTC(2026, 9, 27, 15, 0, 0);

function setup(over: Record<string, unknown> = {}) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"accepted":1,"dropped":0}', { status: 200 }));
  const beacon = vi.fn((_url: string, _data: Blob) => true);
  configureTelemetry({
    fetch: fetch as unknown as typeof globalThis.fetch,
    sendBeacon: beacon,
    storage: localStorage,
    apiBase: '/api',
    now: () => clock,
    online: () => true,
    onboarded: () => true,
    ...over,
  });
  return { fetch, beacon };
}

const body = (init?: RequestInit) => JSON.parse(String(init?.body));

beforeEach(() => {
  localStorage.clear();
  __resetTelemetryForTests();
  clock = Date.UTC(2026, 9, 27, 15, 0, 0);
});
afterEach(() => vi.restoreAllMocks());

describe('código anônimo', () => {
  it('é um UUID próprio, guardado à parte e diferente do código do aparelho e do id local', () => {
    setup();
    const deviceId = getDeviceId(localStorage);
    const userId = getUserId();
    const id = getTelemetryId();
    expect(id).toMatch(UUID);
    expect(id).not.toBe(deviceId);
    expect(`usr-${id}`).not.toBe(userId);
    expect(localStorage.getItem(KEYS.id)).toBe(id);
    expect(localStorage.getItem('librax_deviceId')).toBe(deviceId);
    expect(getTelemetryId()).toBe(id);
  });

  it('nunca repete o código do aparelho, nem se o sorteio cair nele', () => {
    const deviceId = getDeviceId(localStorage);
    const fresh = '0b6a3c1e-5f2d-4a8b-9c7e-1d2f3a4b5c6d';
    const ids = [deviceId, fresh];
    setup({ randomId: () => ids.shift() ?? fresh });
    expect(getTelemetryId()).toBe(fresh);
  });
});

describe('fila e lotes', () => {
  it('guarda os eventos com o horário e manda num lote só, com o retrato e o fuso', async () => {
    const { fetch } = setup();
    setTelemetryProgress({ lessonsCompleted: 3, xpTotal: 40, streak: 2, currentLessonId: 'u1-l4' });
    setTelemetryContext({ hasAccount: true, lang: 'en' });
    track({ type: 'app_open' });
    trackLessonOpen('u1-l4');
    clock += 95_000;
    trackLessonComplete('u1-l4', 0.9, 10);
    expect(pendingEvents().map(e => e.type)).toEqual(['app_open', 'lesson_open', 'lesson_complete']);

    expect(await flushTelemetry()).toBe('sent');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/telemetry');
    expect(init?.method).toBe('POST');
    expect(init?.keepalive).toBe(true);
    // sem token: rota pública, nunca leva a sessão da conta
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/Authorization/i);
    const batch = body(init);
    expect(batch.v).toBe(1);
    expect(batch.id).toBe(getTelemetryId());
    expect(typeof batch.tz).toBe('number');
    expect(batch.events[2]).toEqual({ type: 'lesson_complete', lessonId: 'u1-l4', score: 0.9, xp: 10, durationSec: 95, at: clock });
    expect(batch.snapshot).toMatchObject({ lessonsCompleted: 3, xpTotal: 40, streak: 2, currentLessonId: 'u1-l4', hasAccount: true, lang: 'en' });
    expect(pendingEvents()).toEqual([]);
  });

  it('nada de dado pessoal no lote: só os campos da lista', async () => {
    const { fetch } = setup();
    localStorage.setItem('librax_displayName', 'Ana Souza');
    const deviceId = getDeviceId(localStorage);
    const userId = getUserId();
    track({ type: 'onboarding_done', lang: 'pt-BR', dailyGoal: 10 });
    trackLessonAbandon('u1-l1', 3, 8);
    await flushTelemetry();
    const raw = String(fetch.mock.calls[0][1]?.body);
    for (const pii of ['Ana Souza', deviceId, userId, 'email', 'userId', 'deviceId', 'name']) expect(raw).not.toContain(pii);
    const batch = JSON.parse(raw);
    expect(Object.keys(batch).sort()).toEqual(['events', 'id', 'snapshot', 'tz', 'v']);
    expect(Object.keys(batch.snapshot).sort()).toEqual([
      'appVersion', 'currentLessonId', 'hasAccount', 'installed', 'lang', 'lessonsCompleted', 'platform', 'streak', 'xpTotal',
    ]);
    expect(batch.events[1]).toEqual({ type: 'lesson_abandon', lessonId: 'u1-l1', exerciseIndex: 3, exerciseCount: 8, at: clock });
  });

  it('teto da fila: os mais velhos saem; lote de no máximo MAX_BATCH', async () => {
    const { fetch } = setup({ online: () => false });
    for (let i = 0; i < MAX_QUEUE + 5; i += 1) {
      clock += 1;
      track({ type: 'app_open' });
    }
    expect(pendingEvents()).toHaveLength(MAX_QUEUE);
    expect(await flushTelemetry()).toBe('kept'); // sem rede: fica
    configureTelemetry({ online: () => true });
    await flushTelemetry();
    // um lote e, com a fila ainda cheia, mais um
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(body(fetch.mock.calls[0][1]).events).toHaveLength(MAX_BATCH);
    expect(pendingEvents()).toHaveLength(MAX_QUEUE - 2 * MAX_BATCH);
  });

  it('erro de rede ou 5xx guarda para depois; 400 descarta; nunca lança', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('{"error":{}}', { status: 400 }));
    setup({ fetch });
    track({ type: 'app_open' });
    expect(await flushTelemetry()).toBe('kept');
    expect(await flushTelemetry()).toBe('kept');
    expect(await flushTelemetry()).toBe('kept');
    expect(pendingEvents()).toHaveLength(1);
    expect(await flushTelemetry()).toBe('dropped');
    expect(pendingEvents()).toHaveLength(0);
  });

  it('ao sair da tela vai por sendBeacon, em texto simples', async () => {
    const { fetch, beacon } = setup();
    track({ type: 'app_open' });
    const stop = startTelemetry();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(beacon).toHaveBeenCalled());
    stop();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe('/api/v1/telemetry');
    expect(blob.type).toBe('text/plain;charset=utf-8');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    const sent = JSON.parse(text);
    expect(sent.events.map((e: { type: string }) => e.type)).toEqual(['app_open', 'app_open']);
    expect(fetch).not.toHaveBeenCalledWith('/api/v1/telemetry', expect.anything());
    expect(pendingEvents()).toEqual([]);
  });

  it('nada sai antes de terminar as boas-vindas (o aceite da política): os eventos esperam', async () => {
    let onboarded = false;
    const { fetch } = setup({ onboarded: () => onboarded });
    track({ type: 'app_open' });
    expect(await flushTelemetry()).toBe('waiting');
    expect(fetch).not.toHaveBeenCalled();
    onboarded = true;
    expect(await flushTelemetry()).toBe('sent');
  });

  it('plataforma aproximada tirada no aparelho', () => {
    expect(coarsePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130')).toBe('android');
    expect(coarsePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe('ios');
    expect(coarsePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe('desktop');
    expect(coarsePlatform('curl/8')).toBe('other');
    setup();
    expect(['browser', 'pwa', 'twa']).toContain(currentSnapshot().installed);
  });
});

describe('interruptor e exclusão', () => {
  it('desligado: não guarda nem manda; a fila e o código somem e a cópia na nuvem é apagada', async () => {
    const { fetch } = setup();
    track({ type: 'app_open' });
    const id = getTelemetryId();
    setTelemetryEnabled(false);
    expect(isTelemetryEnabled()).toBe(false);
    expect(localStorage.getItem(KEYS.id)).toBeNull();
    expect(pendingEvents()).toEqual([]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/v1/telemetry/${id}`, expect.objectContaining({ method: 'DELETE' })));
    await vi.waitFor(() => expect(localStorage.getItem(KEYS.deletes)).toBeNull());

    track({ type: 'app_open' });
    expect(pendingEvents()).toEqual([]);
    expect(await flushTelemetry()).toBe('off');

    // ligar de novo cria outro código
    setTelemetryEnabled(true);
    expect(getTelemetryId()).not.toBe(id);
  });

  it('sem rede ao desligar: a exclusão fica guardada e vai na próxima vez', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    setup({ fetch });
    const id = getTelemetryId();
    setTelemetryEnabled(false);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem(KEYS.deletes) ?? '[]')).toEqual([id]);
    expect(await processPendingDeletes()).toBe(1);
    expect(localStorage.getItem(KEYS.deletes)).toBeNull();
  });

  it('"Excluir conta e dados": apaga o código dos dados de uso e o da nota, e sobrevive ao localStorage.clear()', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('offline');
    });
    setup({ fetch });
    const id = getTelemetryId();
    setTelemetryEnabled(false);
    await sendFeedback(4, 'bom'); // com os dados de uso desligados: código só da nota
    const feedbackId = localStorage.getItem(KEYS.feedbackId);
    expect(feedbackId).toMatch(UUID);
    expect(feedbackId).not.toBe(id);

    const restore = prepareDataReset();
    localStorage.clear();
    restore();
    expect(JSON.parse(localStorage.getItem(KEYS.deletes) ?? '[]')).toEqual([id, feedbackId]);
    expect(localStorage.getItem(KEYS.off)).toBe('1'); // a escolha de desligar continua
    expect(localStorage.getItem(KEYS.feedback)).toBeNull();
  });
});

describe('nota do app', () => {
  it('vai com o código dos dados de uso, o texto limpo e o retrato; sem rede fica guardada', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    setup({ fetch });
    setTelemetryProgress({ lessonsCompleted: 2, currentLessonId: 'u1-l3' });
    expect(await sendFeedback(5, '  Gostei\u0007 muito  ')).toBe('queued');
    expect(JSON.parse(localStorage.getItem(KEYS.feedback) ?? 'null')).toMatchObject({ id: getTelemetryId(), rating: 5, text: 'Gostei muito' });
    expect(await flushFeedback()).toBe(true);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe('/api/v1/feedback');
    const payload = body(init);
    expect(Object.keys(payload).sort()).toEqual(['id', 'rating', 'snapshot', 'text']);
    expect(payload.snapshot).toMatchObject({ lessonsCompleted: 2, currentLessonId: 'u1-l3' });
    expect(localStorage.getItem(KEYS.feedback)).toBeNull();
  });

  it('com os dados de uso desligados ainda manda (é ação da pessoa), com um código só para a nota', async () => {
    const { fetch } = setup();
    const telemetryId = getTelemetryId();
    setTelemetryEnabled(false);
    expect(await sendFeedback(3, 'x'.repeat(FEEDBACK_TEXT_MAX + 50))).toBe('sent');
    const payload = body(fetch.mock.calls.find(([u]) => u === '/api/v1/feedback')?.[1]);
    expect(payload.id).toMatch(UUID);
    expect(payload.id).not.toBe(telemetryId);
    expect(payload.text).toHaveLength(FEEDBACK_TEXT_MAX);
  });

  it('o lote é o mesmo formato que o servidor espera', () => {
    setup();
    const batch = buildBatch([{ type: 'app_open', at: clock }]);
    expect(batch).toMatchObject({ v: 1, id: getTelemetryId(), events: [{ type: 'app_open', at: clock }] });
  });
});
