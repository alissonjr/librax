import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import { openDB } from 'idb';

// Amplify fica de fora: sessão, configuração e eventos de login controlados pelo teste
const auth = vi.hoisted(() => ({
  configureAuth: vi.fn(async () => true),
  getSession: vi.fn(async (): Promise<{ token: string; userId: string } | null> => null),
  listeners: [] as Array<(e: string) => void>,
}));
vi.mock('../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth')>()),
  configureAuth: auth.configureAuth,
  getSession: auth.getSession,
  onAuthEvent: async (cb: (e: string) => void) => {
    auth.listeners.push(cb);
    return () => { auth.listeners = auth.listeners.filter(l => l !== cb); };
  },
}));

import {
  __resetAccountForTests, authErrorKey, emailFromIdToken, getAccount, shouldOfferAccount, startAccount,
} from '../lib/account';
import { __resetSyncForTests, clearOutbox, configureSync, pendingEntries } from '../lib/sync';
import { SessionProvider, useSession } from '../hooks/useSession';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';

const b64url = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (payload: Record<string, unknown>) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.assinatura`;

const settle = () => new Promise(r => setTimeout(r, 30));

function cognitoEnv() {
  vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'us-east-1_teste');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'cliente');
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'auth.librax.example');
}

beforeEach(async () => {
  vi.clearAllMocks();
  auth.listeners = [];
  localStorage.clear();
  __resetSyncForTests();
  await clearOutbox();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  __resetAccountForTests();
});

describe('estado da conta', () => {
  it('lê o e-mail do id token (com acento) e ignora token quebrado', () => {
    expect(emailFromIdToken(idToken({ email: 'joão@librax.example', sub: 's' }))).toBe('joão@librax.example');
    expect(emailFromIdToken('nada')).toBeNull();
    expect(emailFromIdToken(idToken({ sub: 's' }))).toBeNull();
  });

  it('cada código de erro de auth.ts tem mensagem', () => {
    expect(authErrorKey('EMAIL_IN_USE')).toBe('account.errors.emailInUse');
    expect(authErrorKey('UNKNOWN')).toBe('account.errors.unknown');
  });

  it('convite do fim da lição: só convidado, no máximo uma vez por dia depois de dispensado', () => {
    expect(shouldOfferAccount('guest', null, '2026-10-23')).toBe(true);
    expect(shouldOfferAccount('unavailable', null, '2026-10-23')).toBe(true);
    expect(shouldOfferAccount('guest', '2026-10-23', '2026-10-23')).toBe(false);
    expect(shouldOfferAccount('guest', '2026-10-22', '2026-10-23')).toBe(true);
    expect(shouldOfferAccount('signedIn', null, '2026-10-23')).toBe(false);
    expect(shouldOfferAccount('checking', null, '2026-10-23')).toBe(false);
  });

  it('sem as VITE_COGNITO_*: indisponível, sem carregar o Amplify nem a fila', async () => {
    __resetAccountForTests();
    expect(getAccount().status).toBe('unavailable');
    startAccount();
    await settle();
    expect(auth.configureAuth).not.toHaveBeenCalled();
    expect(auth.listeners).toHaveLength(0);
  });

  it('com Cognito: configura uma vez, liga a fila e acompanha entrada e saída', async () => {
    cognitoEnv();
    __resetAccountForTests();
    expect(getAccount().status).toBe('checking');
    startAccount();
    startAccount(); // StrictMode chama o boot duas vezes
    await settle();
    expect(auth.configureAuth).toHaveBeenCalledTimes(1);
    expect(getAccount().status).toBe('guest');

    auth.getSession.mockResolvedValue({ token: idToken({ email: 'ana@librax.example' }), userId: 'sub-1' });
    auth.listeners.forEach(l => l('signedIn'));
    await settle();
    expect(getAccount()).toEqual({ status: 'signedIn', email: 'ana@librax.example' });

    auth.getSession.mockResolvedValue(null);
    auth.listeners.forEach(l => l('signedOut'));
    await settle();
    expect(getAccount().status).toBe('guest');
  });
});

describe('fim de lição na fila e migração do convidado', () => {
  it('a lição do convidado entra na fila com lessonAttemptId e vai para /v1/guest/migrate ao entrar', async () => {
    cognitoEnv();
    __resetAccountForTests();
    const calls: { url: string; body: { entries?: { lessonAttemptId: string; lessonId: string }[] } }[] = [];
    configureSync({
      apiBase: '/api',
      fetch: (async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url, body });
        const results = (body.entries ?? []).map((e: { lessonAttemptId: string }) => ({ lessonAttemptId: e.lessonAttemptId, status: 'applied' }));
        return { ok: true, status: 200, json: async () => ({ results }) };
      }) as unknown as typeof fetch,
    });
    startAccount();
    await settle();

    const db = await openDB(`librax-account-${Date.now()}`, 1, { upgrade: upgradeLibraxDb });
    const repo = new IdbRepo(db, 'usr-local');
    await repo.saveProfile({ userId: 'usr-local', xpTotal: 0, streak: 0, achievements: [] });
    let session: ReturnType<typeof useSession> | null = null;
    function Probe() {
      session = useSession();
      return null;
    }
    await act(async () => {
      render(<SessionProvider repo={repo} userId="usr-local" brokenStreak={0}><Probe /></SessionProvider>);
      await settle();
    });

    await act(async () => {
      await session!.finishLesson({
        lessonId: 'u1-l1', score: 0.9, xpReward: 10, signsLearnedDelta: 3, isLastLesson: false,
        reviewed: [{ signId: 'letra-A', result: { state: 'correct', highConfidence: true } }],
      });
      await settle();
    });
    await waitFor(async () => expect(await pendingEntries()).toHaveLength(1));
    const [entry] = await pendingEntries();
    expect(entry.owner).toBeNull();
    expect(entry.lessonAttemptId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(entry.lessonId).toBe('u1-l1');
    expect(calls).toHaveLength(0); // convidado: nada vai ao servidor

    // Entrou na conta: o startSync manda o log do convidado
    auth.getSession.mockResolvedValue({ token: idToken({ email: 'ana@librax.example' }), userId: 'sub-1' });
    await act(async () => {
      auth.listeners.forEach(l => l('signedIn'));
      await settle();
    });
    await waitFor(() => expect(calls.some(c => c.url === '/api/v1/guest/migrate')).toBe(true));
    const migrate = calls.find(c => c.url === '/api/v1/guest/migrate')!;
    expect(migrate.body.entries?.map(e => e.lessonAttemptId)).toEqual([entry.lessonAttemptId]);
    await waitFor(async () => expect(await pendingEntries()).toHaveLength(0));
  });
});
