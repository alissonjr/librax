import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sessão (Amplify) mockada pelo módulo de auth; fetch mockado por teste.
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  listeners: [] as Array<(e: string) => void>,
}));
vi.mock('../lib/auth', () => ({
  getSession: auth.getSession,
  onAuthEvent: async (cb: (e: string) => void) => {
    auth.listeners.push(cb);
    return () => {
      auth.listeners = auth.listeners.filter((l) => l !== cb);
    };
  },
}));

import {
  configureSync,
  enqueueLessonCompletion,
  pendingEntries,
  flushOutbox,
  migrateGuest,
  startSync,
  clearOutbox,
  MIGRATE_BATCH,
  reportLessonAbandon,
  deleteAccountOnServer,
  __resetSyncForTests,
} from '../lib/sync';

type Call = { url: string; method: string; auth: string | null; body: unknown };

function reply(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** fetch falso: guarda as chamadas e responde com `handler`. */
function mockFetch(handler: (call: Call) => ReturnType<typeof reply> | Promise<never>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const call = { url, method: init.method ?? 'GET', auth: headers.Authorization ?? null, body: JSON.parse(String(init.body)) };
    calls.push(call);
    return handler(call);
  });
  configureSync({ fetch: fn as unknown as typeof fetch });
  return calls;
}

/** Servidor que aplica tudo (e responde duplicate para o que já viu). */
function serverOk() {
  const seen = new Set<string>();
  return (call: Call) => {
    if (call.url.endsWith('/v1/guest/migrate')) {
      const { entries } = call.body as { entries: { lessonAttemptId: string }[] };
      const results = entries.map((e) => {
        const status = seen.has(e.lessonAttemptId) ? 'duplicate' : 'applied';
        seen.add(e.lessonAttemptId);
        return { lessonAttemptId: e.lessonAttemptId, status };
      });
      return reply(200, { results });
    }
    const { lessonAttemptId } = call.body as { lessonAttemptId: string };
    const duplicate = seen.has(lessonAttemptId);
    seen.add(lessonAttemptId);
    return reply(200, { duplicate });
  };
}

const lesson = (over: Record<string, unknown> = {}) => ({
  lessonId: 'u1-l1',
  today: '2026-10-23',
  score: 0.9,
  reviewed: [{ signId: 'letra-A', result: { state: 'correct', highConfidence: true } }],
  signsLearnedDelta: 2,
  ...over,
});

const signedIn = () => auth.getSession.mockResolvedValue({ token: 'jwt.id', userId: 'sub-1' });
const guest = () => auth.getSession.mockResolvedValue(null);

beforeEach(async () => {
  vi.clearAllMocks();
  auth.listeners = [];
  __resetSyncForTests();
  configureSync({ apiBase: '/api', now: () => new Date('2026-10-23T15:00:00.000Z') });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await clearOutbox();
});

describe('outbox em IndexedDB', () => {
  it('guarda cada conclusão com lessonAttemptId único e horário', async () => {
    guest();
    const a = await enqueueLessonCompletion(lesson());
    const b = await enqueueLessonCompletion(lesson({ lessonId: 'u1-l2' }));

    expect(a.lessonAttemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.lessonAttemptId).not.toBe(b.lessonAttemptId);
    expect(a.completedAt).toBe('2026-10-23T15:00:00.000Z');
    expect(a.owner).toBeNull(); // convidado
    expect((await pendingEntries()).map((e) => e.lessonId)).toEqual(['u1-l1', 'u1-l2']);
  });

  it('com conta, a conclusão fica marcada com o dono', async () => {
    signedIn();
    const e = await enqueueLessonCompletion(lesson());
    expect(e.owner).toBe('sub-1');
  });

  it('reusar o mesmo lessonAttemptId não duplica na fila', async () => {
    guest();
    await enqueueLessonCompletion(lesson({ lessonAttemptId: 'tentativa-0001' }));
    await enqueueLessonCompletion(lesson({ lessonAttemptId: 'tentativa-0001' }));
    expect(await pendingEntries()).toHaveLength(1);
  });
});

describe('flushOutbox', () => {
  it('convidado: não envia nada (espera a conta)', async () => {
    guest();
    const calls = mockFetch(serverOk());
    await enqueueLessonCompletion(lesson());
    const r = await flushOutbox();
    expect(r.skipped).toBe('signed_out');
    expect(calls).toHaveLength(0);
    expect(await pendingEntries()).toHaveLength(1);
  });

  it('offline: não tenta', async () => {
    signedIn();
    const calls = mockFetch(serverOk());
    await enqueueLessonCompletion(lesson());
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect((await flushOutbox()).skipped).toBe('offline');
    expect(calls).toHaveLength(0);
  });

  it('com conta: manda cada conclusão em ordem para /v1/lesson/complete com o token', async () => {
    signedIn();
    const calls = mockFetch(serverOk());
    const a = await enqueueLessonCompletion(lesson());
    const b = await enqueueLessonCompletion(lesson({ lessonId: 'u1-l2' }));

    const r = await flushOutbox();

    expect(r).toMatchObject({ sent: 2, dropped: 0, remaining: 0 });
    expect(calls.map((c) => [c.method, c.url, c.auth])).toEqual([
      ['POST', '/api/v1/lesson/complete', 'Bearer jwt.id'],
      ['POST', '/api/v1/lesson/complete', 'Bearer jwt.id'],
    ]);
    expect(calls.map((c) => (c.body as { lessonAttemptId: string }).lessonAttemptId)).toEqual([a.lessonAttemptId, b.lessonAttemptId]);
    expect(calls[0].body).toEqual({
      lessonAttemptId: a.lessonAttemptId,
      lessonId: 'u1-l1',
      today: '2026-10-23',
      score: 0.9,
      completedAt: '2026-10-23T15:00:00.000Z',
      reviewed: [{ signId: 'letra-A', result: { state: 'correct', highConfidence: true } }],
      signsLearnedDelta: 2,
    });
    expect(await pendingEntries()).toHaveLength(0);
  });

  it('erro de rede ou 5xx: para e mantém a fila para a próxima vez, sem perder a ordem', async () => {
    signedIn();
    await enqueueLessonCompletion(lesson());
    await enqueueLessonCompletion(lesson({ lessonId: 'u1-l2' }));
    const calls = mockFetch(() => reply(503));

    const r = await flushOutbox();

    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ sent: 0, remaining: 2 });
    const [first] = await pendingEntries();
    expect(first.lessonId).toBe('u1-l1');
    expect(first.attempts).toBe(1);
  });

  it('reenvio depois de falha não duplica: o servidor responde duplicate e a fila esvazia', async () => {
    signedIn();
    const server = serverOk();
    let failNext = true;
    // o servidor grava, mas a resposta se perde na rede
    const calls = mockFetch((call) => {
      const res = server(call);
      if (failNext) {
        failNext = false;
        return Promise.reject(new TypeError('Failed to fetch')) as Promise<never>;
      }
      return res;
    });
    await enqueueLessonCompletion(lesson());

    await flushOutbox();
    expect(await pendingEntries()).toHaveLength(1);
    const r = await flushOutbox();

    expect(r.sent).toBe(1);
    expect(calls).toHaveLength(2);
    expect((calls[0].body as { lessonAttemptId: string }).lessonAttemptId).toBe(
      (calls[1].body as { lessonAttemptId: string }).lessonAttemptId,
    );
    expect(await pendingEntries()).toHaveLength(0);
  });

  it('400 (conclusão inválida): descarta, porque reenviar não adianta', async () => {
    signedIn();
    mockFetch(() => reply(400, { error: { code: 'UNKNOWN_LESSON' } }));
    await enqueueLessonCompletion(lesson({ lessonId: 'removida' }));
    expect(await flushOutbox()).toMatchObject({ dropped: 1, remaining: 0 });
  });

  it('401: para sem descartar (token expirou)', async () => {
    signedIn();
    mockFetch(() => reply(401));
    await enqueueLessonCompletion(lesson());
    expect(await flushOutbox()).toMatchObject({ skipped: 'signed_out', remaining: 1 });
  });

  it('conclusões de outra conta no mesmo aparelho ficam guardadas', async () => {
    auth.getSession.mockResolvedValue({ token: 'jwt.outra', userId: 'sub-2' });
    await enqueueLessonCompletion(lesson());
    signedIn();
    const calls = mockFetch(serverOk());
    await flushOutbox();
    expect(calls).toHaveLength(0);
    expect(await pendingEntries()).toHaveLength(1);
  });

  it('chamadas simultâneas compartilham o mesmo envio', async () => {
    signedIn();
    const calls = mockFetch(serverOk());
    await enqueueLessonCompletion(lesson());
    await Promise.all([flushOutbox(), flushOutbox(), flushOutbox()]);
    expect(calls).toHaveLength(1);
  });
});

describe('migrateGuest (ao criar conta)', () => {
  it('manda o log do convidado em lote para /v1/guest/migrate e limpa a fila', async () => {
    guest();
    const a = await enqueueLessonCompletion(lesson());
    const b = await enqueueLessonCompletion(lesson({ lessonId: 'u1-l2', today: '2026-10-24' }));
    signedIn();
    const calls = mockFetch(serverOk());

    const r = await migrateGuest();

    expect(r).toMatchObject({ sent: 2, remaining: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/v1/guest/migrate');
    expect(calls[0].auth).toBe('Bearer jwt.id');
    const { entries } = calls[0].body as { entries: { lessonAttemptId: string }[] };
    expect(entries.map((e) => e.lessonAttemptId)).toEqual([a.lessonAttemptId, b.lessonAttemptId]);
    expect(await pendingEntries()).toHaveLength(0);
  });

  it('divide em lotes de MIGRATE_BATCH', async () => {
    guest();
    for (let i = 0; i < MIGRATE_BATCH + 5; i += 1) await enqueueLessonCompletion(lesson());
    signedIn();
    const calls = mockFetch(serverOk());
    await migrateGuest();
    expect(calls.map((c) => (c.body as { entries: unknown[] }).entries.length)).toEqual([MIGRATE_BATCH, 5]);
  });

  it('rejeitadas pelo servidor saem da fila; as sem resposta ficam', async () => {
    guest();
    const a = await enqueueLessonCompletion(lesson());
    const b = await enqueueLessonCompletion(lesson());
    signedIn();
    mockFetch(() => reply(200, { results: [{ lessonAttemptId: a.lessonAttemptId, status: 'rejected', reason: 'BAD_DATE' }] }));
    const r = await migrateGuest();
    expect(r).toMatchObject({ dropped: 1, remaining: 1 });
    expect((await pendingEntries())[0].lessonAttemptId).toBe(b.lessonAttemptId);
  });

  it('413: divide o lote ao meio e tenta de novo', async () => {
    guest();
    for (let i = 0; i < 4; i += 1) await enqueueLessonCompletion(lesson());
    signedIn();
    const server = serverOk();
    const calls = mockFetch((call) =>
      (call.body as { entries: unknown[] }).entries.length > 2 ? reply(413) : server(call),
    );
    const r = await migrateGuest();
    expect(r.sent).toBe(4);
    expect(calls.map((c) => (c.body as { entries: unknown[] }).entries.length)).toEqual([4, 2, 2]);
  });

  it('sem conta não faz nada', async () => {
    guest();
    await enqueueLessonCompletion(lesson());
    const calls = mockFetch(serverOk());
    expect((await migrateGuest()).skipped).toBe('signed_out');
    expect(calls).toHaveLength(0);
  });

  it('flushOutbox também migra o que sobrou do convidado antes do resto', async () => {
    guest();
    await enqueueLessonCompletion(lesson());
    signedIn();
    await enqueueLessonCompletion(lesson({ lessonId: 'u1-l2' }));
    const calls = mockFetch(serverOk());
    await flushOutbox();
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/guest/migrate', '/api/v1/lesson/complete']);
  });
});

describe('startSync', () => {
  const flushes = (calls: Call[]) => calls.length;

  it('envia na abertura, em online, ao voltar para a aba e ao entrar na conta', async () => {
    signedIn();
    const calls = mockFetch(serverOk());
    const settle = () => new Promise((r) => setTimeout(r, 30));

    await enqueueLessonCompletion(lesson());
    const stop = startSync();
    await settle();
    expect(flushes(calls)).toBe(1); // abertura do app

    await enqueueLessonCompletion(lesson());
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(flushes(calls)).toBe(2);

    await enqueueLessonCompletion(lesson());
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(flushes(calls)).toBe(3);

    guest();
    await enqueueLessonCompletion(lesson());
    signedIn();
    auth.listeners.forEach((l) => l('signedIn')); // conta criada / login / volta do Google
    await settle();
    expect(calls.at(-1)?.url).toBe('/api/v1/guest/migrate');

    stop();
    await enqueueLessonCompletion(lesson());
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(calls.at(-1)?.url).toBe('/api/v1/guest/migrate'); // nada novo depois de parar
    expect(auth.listeners).toHaveLength(0);
  });

  it('aba escondida não dispara envio', async () => {
    signedIn();
    const stop = startSync();
    await new Promise((r) => setTimeout(r, 30));
    const calls = mockFetch(serverOk());
    await enqueueLessonCompletion(lesson());
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(0);
    stop();
  });
});

describe('telemetria do painel de administração', () => {
  it('a conclusão leva os erros por tipo de exercício quando houver', async () => {
    signedIn();
    const calls = mockFetch(serverOk());
    await enqueueLessonCompletion(lesson({ exerciseStats: { watch_choose_word: { attempted: 3, wrong: 1 } } }));
    await enqueueLessonCompletion(lesson({ lessonId: 'u1-l2', exerciseStats: {} }));
    await flushOutbox();
    expect((calls[0].body as { exerciseStats?: unknown }).exerciseStats).toEqual({ watch_choose_word: { attempted: 3, wrong: 1 } });
    expect(calls[1].body).not.toHaveProperty('exerciseStats'); // vazio não vai
  });

  it('a conclusão leva o desempenho da câmera da lição quando houver', async () => {
    signedIn();
    const calls = mockFetch(serverOk());
    const cameraStats = { 'letra-K': { successes: 1, skips: 1, attempts: 3, wrong: { H: 2 } } };
    await enqueueLessonCompletion(lesson({ cameraStats }));
    await enqueueLessonCompletion(lesson({ lessonId: 'u1-l2', cameraStats: {} }));
    await flushOutbox();
    expect((calls[0].body as { cameraStats?: unknown }).cameraStats).toEqual(cameraStats);
    expect(calls[1].body).not.toHaveProperty('cameraStats'); // vazio não vai
  });

  it('sem conta o desempenho da câmera fica na fila e só vai na migração, ao entrar', async () => {
    guest();
    const calls = mockFetch(serverOk());
    const cameraStats = { 'letra-A': { successes: 1, skips: 0, attempts: 1, wrong: {} } };
    await enqueueLessonCompletion(lesson({ cameraStats }));
    expect((await flushOutbox()).skipped).toBe('signed_out');
    expect(calls).toHaveLength(0);
    expect((await pendingEntries())[0].cameraStats).toEqual(cameraStats);

    signedIn();
    await flushOutbox();
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/guest/migrate']);
    const { entries } = calls[0].body as { entries: { cameraStats?: unknown }[] };
    expect(entries[0].cameraStats).toEqual(cameraStats);
  });

  it('offline o desempenho da câmera espera na fila e vai quando a rede volta', async () => {
    signedIn();
    const calls = mockFetch(serverOk());
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const cameraStats = { 'letra-B': { successes: 0, skips: 1, attempts: 0, wrong: { A: 1 } } };
    await enqueueLessonCompletion(lesson({ cameraStats }));
    expect((await flushOutbox()).skipped).toBe('offline');
    expect(calls).toHaveLength(0);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await flushOutbox();
    expect((calls[0].body as { cameraStats?: unknown }).cameraStats).toEqual(cameraStats);
    expect(await pendingEntries()).toHaveLength(0);
  });

  it('saída no meio da lição vai para /v1/lesson/abandon com o token', async () => {
    signedIn();
    const calls = mockFetch(() => reply(200, { recorded: true }));
    const input = { lessonId: 'u1-l2', today: '2026-10-23', exerciseIndex: 3, exerciseCount: 10, exerciseType: 'perform_sign' };
    expect(await reportLessonAbandon(input)).toBe(true);
    expect(calls.map((c) => [c.method, c.url, c.auth])).toEqual([['POST', '/api/v1/lesson/abandon', 'Bearer jwt.id']]);
    expect(calls[0].body).toEqual(input);
    expect(await pendingEntries()).toHaveLength(0); // não entra na fila
  });

  it('convidado, offline ou erro: a saída não é enviada e nada quebra', async () => {
    const input = { lessonId: 'u1-l2', today: '2026-10-23', exerciseIndex: 0, exerciseCount: 10, exerciseType: null };
    guest();
    const calls = mockFetch(() => reply(200));
    expect(await reportLessonAbandon(input)).toBe(false);
    expect(calls).toHaveLength(0);

    signedIn();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await reportLessonAbandon(input)).toBe(false);
    expect(calls).toHaveLength(0);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    configureSync({ fetch: (async () => { throw new Error('rede'); }) as unknown as typeof fetch });
    expect(await reportLessonAbandon(input)).toBe(false);
  });
});

describe('exclusão de conta no servidor', () => {
  it('espera o envio da fila em andamento antes do DELETE /v1/users/me', async () => {
    signedIn();
    await enqueueLessonCompletion(lesson());
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    configureSync({
      fetch: (async (url: string, init: RequestInit) => {
        order.push(`${init.method} ${url}`);
        if (url.endsWith('/v1/lesson/complete')) await gate;
        return reply(200, { duplicate: false });
      }) as unknown as typeof fetch,
    });

    const flushing = flushOutbox();
    await vi.waitFor(() => expect(order).toHaveLength(1));
    const deleting = deleteAccountOnServer();
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['POST /api/v1/lesson/complete']); // ainda esperando a conclusão
    release();
    await flushing;
    expect(await deleting).toBe('deleted');
    expect(order).toEqual(['POST /api/v1/lesson/complete', 'DELETE /api/v1/users/me']);
  });

  it('erro do servidor, sem rede ou sem sessão: não diz que apagou', async () => {
    signedIn();
    configureSync({ fetch: (async () => reply(500)) as unknown as typeof fetch });
    expect(await deleteAccountOnServer()).toBe('error');
    configureSync({ fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    expect(await deleteAccountOnServer()).toBe('offline');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await deleteAccountOnServer()).toBe('offline');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    guest();
    expect(await deleteAccountOnServer()).toBe('error');
  });
});
