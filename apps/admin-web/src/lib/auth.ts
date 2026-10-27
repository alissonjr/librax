/*
 * Login do painel: OAuth 2.0 authorization code com PKCE no domínio do Cognito (o mesmo do app),
 * com o app client próprio do painel. Sem biblioteca: o painel só precisa entrar, guardar o id
 * token e sair.
 *
 * - O id token fica no sessionStorage: some ao fechar a aba e não é lido por outras origens. O access
 *   token fica junto só para configurar o aplicativo autenticador da própria conta (lib/mfa.ts): o
 *   escopo aws.cognito.signin.user.admin deixa ele falar com o Cognito em nome da pessoa.
 * - Expirou (1 hora): o painel manda entrar de novo; o Cognito lembra a sessão e volta direto.
 * - Quem decide o acesso é a API (403 sem o grupo admin). O que o token diz aqui só serve para
 *   mostrar o e-mail na tela.
 */

export interface AuthConfig {
  /** Domínio do Cognito, sem https:// (output AuthDomain do CDK). */
  domain: string;
  /** App client do painel (output AdminClientId). */
  clientId: string;
  /** Origem do painel (location.origin). */
  origin: string;
}

const TOKEN_KEY = 'librax_admin_token';
const PKCE_KEY = 'librax_admin_pkce';
/** Margem para não mandar um token que expira no meio da requisição. */
const EXPIRY_MARGIN_MS = 60 * 1000;
export const CALLBACK_PATH = '/admin/auth/callback';

export function authConfig(): AuthConfig {
  return {
    domain: import.meta.env.VITE_COGNITO_DOMAIN ?? '',
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
    origin: window.location.origin,
  };
}

const redirectUri = (c: AuthConfig) => `${c.origin}${CALLBACK_PATH}`;

/** Escopos do login: o último deixa o access token configurar o autenticador (lib/mfa.ts). */
export const LOGIN_SCOPES = 'openid email profile aws.cognito.signin.user.admin';

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** code_challenge = base64url(SHA-256(verifier)), método S256. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Endereço de login no Cognito; guarda o verifier e o state para a volta. */
export async function loginUrl(c: AuthConfig = authConfig()): Promise<string> {
  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: redirectUri(c),
    scope: LOGIN_SCOPES,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `https://${c.domain}/oauth2/authorize?${params}`;
}

export async function login(): Promise<void> {
  window.location.assign(await loginUrl());
}

export class AuthCallbackError extends Error {}

/**
 * Volta do Cognito (/admin/auth/callback?code=...&state=...): confere o state e troca o code
 * pelo id token.
 */
export async function completeLogin(search: string, c: AuthConfig = authConfig(), fetchFn: typeof fetch = fetch): Promise<void> {
  const params = new URLSearchParams(search);
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; state: string } | null;
  sessionStorage.removeItem(PKCE_KEY);
  if (params.get('error')) throw new AuthCallbackError(params.get('error_description') ?? params.get('error') ?? 'login recusado');
  const code = params.get('code');
  if (!code || !saved || params.get('state') !== saved.state) throw new AuthCallbackError('Volta do login inválida. Entre de novo.');

  const res = await fetchFn(`https://${c.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: c.clientId,
      code,
      redirect_uri: redirectUri(c),
      code_verifier: saved.verifier,
    }).toString(),
  });
  if (!res.ok) throw new AuthCallbackError('O Cognito não aceitou o login. Entre de novo.');
  const { id_token: idToken, access_token: accessToken, expires_in: expiresIn } = (await res.json()) as {
    id_token?: string;
    access_token?: string;
    expires_in?: number;
  };
  if (!idToken) throw new AuthCallbackError('O Cognito não devolveu o token.');
  saveToken(idToken, Date.now() + (expiresIn ?? 3600) * 1000, accessToken);
}

interface SavedTokens {
  idToken: string;
  accessToken?: string;
  expiresAt: number;
}

export function saveToken(idToken: string, expiresAt: number, accessToken?: string): void {
  const saved: SavedTokens = { idToken, expiresAt, ...(accessToken ? { accessToken } : {}) };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(saved));
}

function savedTokens(now: number): SavedTokens | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as SavedTokens | null;
    if (!saved || saved.expiresAt - EXPIRY_MARGIN_MS <= now) return null;
    return saved;
  } catch {
    return null;
  }
}

/** Id token ainda válido, ou null. */
export function currentToken(now = Date.now()): string | null {
  return savedTokens(now)?.idToken ?? null;
}

/** Access token ainda válido (só para configurar o autenticador), ou null. */
export function currentAccessToken(now = Date.now()): string | null {
  return savedTokens(now)?.accessToken ?? null;
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Sai do painel e da sessão do Cognito. */
export function logout(c: AuthConfig = authConfig()): void {
  clearToken();
  const params = new URLSearchParams({ client_id: c.clientId, logout_uri: `${c.origin}/admin/` });
  window.location.assign(`https://${c.domain}/logout?${params}`);
}

/** Claims do id token (só para exibir; a assinatura é conferida pela API). */
export function tokenClaims(idToken: string): Record<string, unknown> {
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      Array.from(atob(payload), (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
