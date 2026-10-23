import { useSyncExternalStore } from 'react';
import { configureAuth, getSession, onAuthEvent, readAuthConfig, type AuthErrorCode } from './auth';
import { startSync } from './sync';

/**
 * Estado da conta para as telas (spec-02 12.2 a 12.4 e 12.8), por cima de auth.ts e sync.ts.
 *
 * - `unavailable`: sem as variáveis VITE_COGNITO_* (ambiente local). O app segue 100% como
 *   convidado; as telas de conta mostram "Login indisponível neste ambiente".
 * - `checking`: o Amplify ainda está carregando ou conferindo a sessão guardada.
 * - `guest`: login disponível, sem conta conectada.
 * - `signedIn`: com conta; `email` vem do id token.
 *
 * O progresso continua local (IdbRepo) em todos os casos; com conta, a fila de sync.ts leva as
 * conclusões ao servidor, e a do convidado vai pelo POST /v1/guest/migrate ao entrar.
 */
export type AccountStatus = 'unavailable' | 'checking' | 'guest' | 'signedIn';

export interface AccountState {
  status: AccountStatus;
  email: string | null;
}

/**
 * Parâmetros da URL na carga da página, antes de o Amplify limpar o ?code= da volta do Google.
 * A tela /auth/callback usa para saber se há login a concluir ou se o Google devolveu erro.
 */
const launchParams = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

export function oauthReturn(): { hasCode: boolean; error: string | null } {
  return { hasCode: launchParams.has('code'), error: launchParams.get('error') };
}

const listeners = new Set<() => void>();
let state: AccountState = { status: readAuthConfig() ? 'checking' : 'unavailable', email: null };
let started = false;

function setState(next: AccountState): void {
  if (next.status === state.status && next.email === state.email) return;
  state = next;
  listeners.forEach((fn) => fn());
}

/** Login configurado neste ambiente (variáveis VITE_COGNITO_* presentes). */
export function authAvailable(): boolean {
  return readAuthConfig() !== null;
}

/** Chave de i18n da mensagem de cada erro de auth.ts (spec-02 12.3: mensagem inline). */
export function authErrorKey(code: AuthErrorCode): string {
  const keys: Record<AuthErrorCode, string> = {
    EMAIL_IN_USE: 'account.errors.emailInUse',
    WEAK_PASSWORD: 'account.errors.weakPassword',
    INVALID_CREDENTIALS: 'account.errors.invalidCredentials',
    NOT_CONFIRMED: 'account.errors.notConfirmed',
    BAD_CODE: 'account.errors.badCode',
    NETWORK: 'account.errors.network',
    UNKNOWN: 'account.errors.unknown',
  };
  return keys[code];
}

/**
 * Convite para criar conta no fim da lição (spec-02 12.2): só para convidado (inclusive sem
 * Cognito, quando o convite só avisa que o login está indisponível). "Continuar sem conta" faz
 * o convite voltar no fim da próxima lição, no máximo uma vez por dia.
 */
export function shouldOfferAccount(status: AccountStatus, dismissedDate: string | null, today: string): boolean {
  if (status !== 'guest' && status !== 'unavailable') return false;
  return dismissedDate !== today;
}

/** E-mail do payload do id token (JWT), sem validar: só para mostrar na tela. */
export function emailFromIdToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

/** Relê a sessão (depois de entrar, sair ou voltar do Google). */
export async function refreshAccount(): Promise<AccountState> {
  if (!authAvailable()) {
    setState({ status: 'unavailable', email: null });
    return state;
  }
  const session = await getSession();
  setState(session
    ? { status: 'signedIn', email: emailFromIdToken(session.token) }
    : { status: 'guest', email: null });
  return state;
}

/**
 * Abertura do app: configura o Amplify (inclusive para concluir a volta do Google em
 * /auth/callback), liga a fila de sincronização e passa a ouvir entrada e saída da conta.
 * Roda uma vez só (o StrictMode do React chama o boot duas vezes em desenvolvimento).
 * Sem Cognito não carrega o Amplify: a fila só guarda as conclusões até existir conta.
 */
export function startAccount(): void {
  if (started) return;
  started = true;
  if (!authAvailable()) return;
  configureAuth()
    .then(() => refreshAccount())
    .catch(() => setState({ status: 'guest', email: null }));
  startSync();
  onAuthEvent(() => {
    void refreshAccount();
  }).catch(() => {});
}

export function getAccount(): AccountState {
  return state;
}

export function subscribeAccount(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Estado da conta, atualizado ao entrar e sair. */
export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccount, getAccount);
}

/** Testes: volta ao estado inicial. */
export function __resetAccountForTests(next?: AccountState): void {
  started = false;
  state = next ?? { status: readAuthConfig() ? 'checking' : 'unavailable', email: null };
  listeners.forEach((fn) => fn());
}
