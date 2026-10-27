import { nowString, passwordSignature, srpStart } from './srp';

/*
 * Login do painel com tela própria, direto na API do User Pool (cognito-idp), sem a página
 * hospedada do Cognito. Mesmo caminho do app (apps/web-poc, e-mail e senha por SRP), com o app
 * client do painel e sem biblioteca: o painel só precisa entrar, renovar o token e sair.
 *
 * - E-mail e senha por USER_SRP_AUTH: a senha não trafega (lib/srp.ts).
 * - Com o aplicativo autenticador ligado, o Cognito responde SOFTWARE_TOKEN_MFA e o painel pede o
 *   código de 6 dígitos. Conta criada com senha temporária responde NEW_PASSWORD_REQUIRED e o painel
 *   pede a senha nova. A `Session` desses desafios fica só na memória da tela.
 * - Tokens: id e access token no sessionStorage (somem ao fechar a aba e não vão para outras
 *   origens), como antes. O access token sai do login pela API com o escopo
 *   aws.cognito.signin.user.admin, que deixa o painel configurar o autenticador da própria conta
 *   (lib/mfa.ts). O refresh token (12 horas) fica só na memória: renova o id token enquanto a aba
 *   está aberta e some ao recarregar. Nada disso vai na URL.
 * - Sair revoga o refresh token no Cognito (RevokeToken) ou, sem ele, encerra as sessões da conta
 *   (GlobalSignOut), e apaga tudo do navegador.
 * - Quem decide o acesso é a API (403 sem o grupo admin ou sem o autenticador). O que o token diz
 *   aqui só serve para mostrar o e-mail na tela.
 */

export interface AuthConfig {
  /** User Pool (output UserPoolId), us-east-1_XXXX: dá a região e o nome do pool usado no SRP. */
  userPoolId: string;
  /** App client do painel (output AdminClientId). */
  clientId: string;
  /** https://cognito-idp.<região>.amazonaws.com, ou o proxy do ambiente local (VITE_COGNITO_ENDPOINT). */
  endpoint: string;
}

type Env = Partial<Record<string, string>>;

export function authConfig(env: Env = import.meta.env as Env): AuthConfig {
  const userPoolId = env.VITE_COGNITO_USER_POOL_ID ?? '';
  const region = /^([a-z]{2}(?:-[a-z]+)+-\d)_\w+$/.exec(userPoolId)?.[1];
  const endpoint = env.VITE_COGNITO_ENDPOINT || (region ? `https://cognito-idp.${region}.amazonaws.com` : '');
  return { userPoolId, clientId: env.VITE_COGNITO_CLIENT_ID ?? '', endpoint: endpoint.replace(/\/+$/, '') };
}

/**
 * "Esqueci a senha": a troca é a do app (mesmo User Pool), em /entrar?esqueci, que já abre na troca. Em produção o app e o painel
 * estão na mesma origem; no ambiente local o app fica em outra porta (VITE_APP_ORIGIN).
 */
export function resetPasswordUrl(env: Env = import.meta.env as Env): string {
  return `${(env.VITE_APP_ORIGIN ?? '').replace(/\/+$/, '')}/entrar?esqueci`;
}

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'NETWORK'
  | 'BAD_CODE'
  | 'CODE_FORMAT'
  | 'SESSION_EXPIRED'
  | 'NOT_CONFIRMED'
  | 'RESET_REQUIRED'
  | 'WEAK_PASSWORD'
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

/** Mensagens da tela. Senha errada e conta inexistente dão a mesma: a tela nunca conta se o e-mail existe. */
export const AUTH_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  TOO_MANY_ATTEMPTS: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
  NETWORK: 'Sem conexão com o login. Confira a internet e tente de novo.',
  BAD_CODE: 'O código não confere. Confira se o relógio do celular está certo e digite o código que aparece agora.',
  CODE_FORMAT: 'Digite os 6 números que aparecem no aplicativo.',
  SESSION_EXPIRED: 'O tempo para concluir o login acabou. Entre com a senha de novo.',
  NOT_CONFIRMED: 'Esta conta ainda não confirmou o e-mail. Confirme pelo app do Librax e volte aqui.',
  RESET_REQUIRED: 'Esta conta precisa de uma senha nova. Use "Esqueci a senha".',
  WEAK_PASSWORD: 'Senha fraca. Use pelo menos 8 caracteres.',
  NOT_CONFIGURED: 'O painel está sem a configuração do login (VITE_COGNITO_USER_POOL_ID e VITE_COGNITO_CLIENT_ID).',
  UNSUPPORTED: 'O login pediu um passo que o painel não conhece. Fale com o dono do projeto.',
  UNKNOWN: 'Não foi possível entrar agora. Tente de novo em instantes.',
};

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, public cognitoType?: string) {
    super(AUTH_MESSAGES[code]);
    this.name = 'AuthError';
  }
}

/** Passo pendente do login. `session` é a do Cognito (vale poucos minutos) e nunca sai da memória. */
export interface Challenge {
  kind: 'totp' | 'newPassword';
  session: string;
  username: string;
}

export type SignInResult = { kind: 'done' } | Challenge;

/** Sessão do painel: o que as telas usam (lib/auth.ts em produção; um falso nos testes e no modo de exemplo). */
export interface AdminAuth {
  /** Tem id token válido ou como renovar. */
  hasSession(): boolean;
  signIn(email: string, password: string): Promise<SignInResult>;
  confirmTotp(challenge: Challenge, code: string): Promise<SignInResult>;
  completeNewPassword(challenge: Challenge, password: string): Promise<SignInResult>;
  /** Revoga no Cognito e apaga do navegador. Nunca falha: sem rede, só apaga. */
  signOut(): Promise<void>;
  /** Apaga do navegador sem falar com o Cognito (token recusado pela API). */
  clear(): void;
}

export interface CognitoAuth extends AdminAuth {
  /** Id token válido (renova se preciso), ou null. Sem rede para renovar: AuthError NETWORK. */
  idToken(): Promise<string | null>;
  /** Access token válido (só para configurar o autenticador), ou null. */
  accessToken(): Promise<string | null>;
}

interface SavedTokens {
  idToken: string;
  accessToken: string;
  expiresAt: number;
}

interface AuthenticationResult {
  IdToken?: string;
  AccessToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

interface CognitoResponse {
  AuthenticationResult?: AuthenticationResult;
  ChallengeName?: string;
  ChallengeParameters?: Record<string, string>;
  Session?: string;
}

const TOKEN_KEY = 'librax_admin_token';
/** Margem para não mandar um token que expira no meio da requisição. */
const EXPIRY_MARGIN_MS = 60 * 1000;
const RATE_LIMITED = new Set(['TooManyRequestsException', 'LimitExceededException', 'TooManyFailedAttemptsException']);

/** Em que passo o erro aconteceu: o mesmo NotAuthorizedException quer dizer coisas diferentes. */
type Step = 'password' | 'challenge' | 'other';

function errorFor(type: string, message: string, step: Step): AuthError {
  if (RATE_LIMITED.has(type)) return new AuthError('TOO_MANY_ATTEMPTS', type);
  switch (type) {
    case 'NotAuthorizedException':
      // "Password attempts exceeded": o Cognito trava a conta por alguns minutos
      if (/attempts exceeded/i.test(message)) return new AuthError('TOO_MANY_ATTEMPTS', type);
      // No código ou na senha nova: a Session do desafio venceu ou já foi usada
      return new AuthError(step === 'challenge' ? 'SESSION_EXPIRED' : 'INVALID_CREDENTIALS', type);
    case 'UserNotFoundException':
      return new AuthError('INVALID_CREDENTIALS', type);
    case 'UserNotConfirmedException':
      return new AuthError('NOT_CONFIRMED', type);
    case 'PasswordResetRequiredException':
      return new AuthError('RESET_REQUIRED', type);
    case 'CodeMismatchException':
    case 'ExpiredCodeException':
      return new AuthError('BAD_CODE', type);
    case 'InvalidPasswordException':
      return new AuthError('WEAK_PASSWORD', type);
    default:
      return new AuthError('UNKNOWN', type);
  }
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

export function cognitoAuth({
  config = authConfig(),
  fetchFn = (...args: Parameters<typeof fetch>) => fetch(...args),
  storage = sessionStorage,
  now = () => Date.now(),
}: { config?: AuthConfig; fetchFn?: typeof fetch; storage?: Storage; now?: () => number } = {}): CognitoAuth {
  // Só na memória desta aba (ver o comentário do arquivo)
  let refreshToken: string | null = null;
  let refreshing: Promise<SavedTokens | null> | null = null;

  async function call(target: string, body: Record<string, unknown>, step: Step = 'other'): Promise<CognitoResponse> {
    if (!config.endpoint || !config.clientId || !config.userPoolId) throw new AuthError('NOT_CONFIGURED');
    let res: Response;
    try {
      res = await fetchFn(`${config.endpoint}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new AuthError('NETWORK');
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // "com.amazonaws...#NotAuthorizedException" no corpo, ou "NotAuthorizedException:http://..." no cabeçalho
      const raw = String(data.__type ?? res.headers.get('x-amzn-ErrorType') ?? `HTTP_${res.status}`);
      const type = (raw.split('#').pop() ?? '').split(':')[0];
      throw errorFor(type, String(data.message ?? data.Message ?? ''), step);
    }
    return data as CognitoResponse;
  }

  function read(): SavedTokens | null {
    try {
      const saved = JSON.parse(storage.getItem(TOKEN_KEY) ?? 'null') as SavedTokens | null;
      return saved && saved.expiresAt - EXPIRY_MARGIN_MS > now() ? saved : null;
    } catch {
      return null;
    }
  }

  function save(result: AuthenticationResult): SavedTokens {
    if (!result.IdToken || !result.AccessToken) throw new AuthError('UNKNOWN');
    const saved: SavedTokens = {
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      expiresAt: now() + (result.ExpiresIn ?? 3600) * 1000,
    };
    storage.setItem(TOKEN_KEY, JSON.stringify(saved));
    if (result.RefreshToken) refreshToken = result.RefreshToken;
    return saved;
  }

  function clear() {
    refreshToken = null;
    refreshing = null;
    storage.removeItem(TOKEN_KEY);
  }

  function next(res: CognitoResponse, username: string): SignInResult {
    if (res.AuthenticationResult) {
      save(res.AuthenticationResult);
      return { kind: 'done' };
    }
    const session = res.Session;
    if (session && res.ChallengeName === 'SOFTWARE_TOKEN_MFA') return { kind: 'totp', session, username };
    if (session && res.ChallengeName === 'NEW_PASSWORD_REQUIRED') return { kind: 'newPassword', session, username };
    // MFA_SETUP, SMS_MFA, SELECT_MFA_TYPE...: o User Pool não usa (MFA opcional, só TOTP)
    throw new AuthError('UNSUPPORTED', res.ChallengeName);
  }

  async function renew(): Promise<SavedTokens | null> {
    const token = refreshToken;
    if (!token) return null;
    try {
      const res = await call('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: config.clientId,
        AuthParameters: { REFRESH_TOKEN: token },
      });
      if (!res.AuthenticationResult) throw new AuthError('UNKNOWN');
      return save(res.AuthenticationResult);
    } catch (err) {
      // Sem rede: guarda o refresh token para a próxima tentativa. Recusado (revogado, vencido): sai
      if (err instanceof AuthError && err.code === 'NETWORK') throw err;
      clear();
      return null;
    }
  }

  async function tokens(): Promise<SavedTokens | null> {
    const saved = read();
    if (saved) return saved;
    if (!refreshToken) {
      storage.removeItem(TOKEN_KEY);
      return null;
    }
    // Várias telas pedindo ao mesmo tempo: uma renovação só
    refreshing ??= renew().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    hasSession: () => read() !== null || refreshToken !== null,

    async signIn(email, password) {
      clear();
      const client = srpStart();
      const init = await call(
        'InitiateAuth',
        { AuthFlow: 'USER_SRP_AUTH', ClientId: config.clientId, AuthParameters: { USERNAME: email.trim(), SRP_A: client.A } },
        'password',
      );
      const p = init.ChallengeParameters ?? {};
      if (init.ChallengeName !== 'PASSWORD_VERIFIER' || !p.SRP_B || !p.SALT || !p.SECRET_BLOCK || !p.USER_ID_FOR_SRP) {
        throw new AuthError('UNSUPPORTED', init.ChallengeName);
      }
      const timestamp = nowString(new Date(now()));
      const signature = await passwordSignature({
        userPoolId: config.userPoolId,
        userId: p.USER_ID_FOR_SRP,
        password,
        client,
        B: p.SRP_B,
        salt: p.SALT,
        secretBlock: p.SECRET_BLOCK,
        timestamp,
      });
      const username = p.USERNAME ?? p.USER_ID_FOR_SRP;
      const res = await call(
        'RespondToAuthChallenge',
        {
          ChallengeName: 'PASSWORD_VERIFIER',
          ClientId: config.clientId,
          ...(init.Session ? { Session: init.Session } : {}),
          ChallengeResponses: {
            USERNAME: username,
            PASSWORD_CLAIM_SECRET_BLOCK: p.SECRET_BLOCK,
            TIMESTAMP: timestamp,
            PASSWORD_CLAIM_SIGNATURE: signature,
          },
        },
        'password',
      );
      return next(res, username);
    },

    async confirmTotp(challenge, raw) {
      const code = raw.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) throw new AuthError('CODE_FORMAT');
      const res = await call(
        'RespondToAuthChallenge',
        {
          ChallengeName: 'SOFTWARE_TOKEN_MFA',
          ClientId: config.clientId,
          Session: challenge.session,
          ChallengeResponses: { USERNAME: challenge.username, SOFTWARE_TOKEN_MFA_CODE: code },
        },
        'challenge',
      );
      return next(res, challenge.username);
    },

    async completeNewPassword(challenge, password) {
      const res = await call(
        'RespondToAuthChallenge',
        {
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          ClientId: config.clientId,
          Session: challenge.session,
          ChallengeResponses: { USERNAME: challenge.username, NEW_PASSWORD: password },
        },
        'challenge',
      );
      return next(res, challenge.username);
    },

    async signOut() {
      const token = refreshToken;
      const access = read()?.accessToken;
      clear();
      try {
        if (token) await call('RevokeToken', { Token: token, ClientId: config.clientId });
        else if (access) await call('GlobalSignOut', { AccessToken: access });
      } catch {
        // Sem rede ou já vencido: os tokens já saíram do navegador e vencem sozinhos (1 hora)
      }
    },

    clear,

    idToken: async () => (await tokens())?.idToken ?? null,
    accessToken: async () => (await tokens())?.accessToken ?? null,
  };
}

let shared: CognitoAuth | null = null;

/** Sessão única do painel (main.tsx, cliente da API e configuração do autenticador). */
export function sharedAuth(): CognitoAuth {
  return (shared ??= cognitoAuth());
}
