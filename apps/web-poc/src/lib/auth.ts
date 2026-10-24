const USER_ID_KEY = 'librax_userId';
const DISPLAY_NAME_KEY = 'librax_displayName';

export function getUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = 'usr-' + crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export function getDisplayName(): string | null {
  return localStorage.getItem(DISPLAY_NAME_KEY);
}

export function setDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name.trim());
}

export function isOnboarded(): boolean {
  return !!localStorage.getItem(DISPLAY_NAME_KEY);
}

// ---------------------------------------------------------------------------
// Conta (Cognito via aws-amplify/auth v6): plano mobile web 3.6, fase W3
//
// O convidado continua 100% local (funções acima). A conta é oferecida no fim da primeira
// lição (spec-02 12.1 e 12.2); ao entrar, o sync.ts manda o log do convidado para
// POST /v1/guest/migrate. E-mail e senha usam SRP (a senha não trafega); Google usa
// OAuth por redirect com PKCE, ambos pelo domínio próprio do Cognito.
//
// O Amplify é importado sob demanda: fica num chunk separado e não pesa na primeira carga
// de quem só joga como convidado. Sem as variáveis VITE_COGNITO_*, o login fica desligado.
// ---------------------------------------------------------------------------

export interface AuthConfig {
  userPoolId: string;
  userPoolClientId: string;
  /** Domínio do Cognito sem https:// (ex.: auth.librax.example). */
  oauthDomain: string;
  redirectSignIn: string;
  redirectSignOut: string;
  /**
   * Endpoint do cognito-idp no lugar do da AWS. Só o ambiente local usa (proxy do Cognito
   * simulado, docs/ambiente-local.md); sem ele, o Amplify fala com a AWS como sempre.
   */
  userPoolEndpoint?: string;
}

export interface Session {
  /** Id token do User Pool: vai no Authorization da API (tem email e email_verified). */
  token: string;
  /** sub do Cognito, o userId no servidor. */
  userId: string;
}

export type AuthEvent = 'signedIn' | 'signedOut';

/** Códigos para a tela traduzir (spec-02 12.3: "E-mail já em uso", "Senha muito curta"...). */
export type AuthErrorCode =
  | 'EMAIL_IN_USE'
  | 'WEAK_PASSWORD'
  | 'INVALID_CREDENTIALS'
  | 'NOT_CONFIRMED'
  | 'BAD_CODE'
  | 'NETWORK'
  | 'UNKNOWN';

type Env = Partial<Record<string, string>>;

/** Lê a configuração das variáveis VITE_* (ver .env.example). */
export function readAuthConfig(
  env: Env = import.meta.env as Env,
  origin: string = window.location.origin,
): AuthConfig | null {
  const userPoolId = env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = env.VITE_COGNITO_CLIENT_ID;
  const oauthDomain = env.VITE_COGNITO_DOMAIN;
  if (!userPoolId || !userPoolClientId || !oauthDomain) return null;
  return {
    userPoolId,
    userPoolClientId,
    oauthDomain,
    redirectSignIn: env.VITE_AUTH_REDIRECT_SIGN_IN || `${origin}/auth/callback`,
    redirectSignOut: env.VITE_AUTH_REDIRECT_SIGN_OUT || `${origin}/`,
    ...(env.VITE_COGNITO_ENDPOINT ? { userPoolEndpoint: env.VITE_COGNITO_ENDPOINT } : {}),
  };
}

let configured: Promise<boolean> | null = null;

/**
 * Configura o Amplify uma vez. Chamar na abertura do app, inclusive na rota /auth/callback:
 * o listener de OAuth troca o `code` da volta do Google por tokens (com o code_verifier do
 * PKCE guardado antes do redirect) e emite o evento de login.
 */
export function configureAuth(config: AuthConfig | null = readAuthConfig()): Promise<boolean> {
  if (!config) return Promise.resolve(false);
  configured ??= (async () => {
    const [{ Amplify }] = await Promise.all([
      import('aws-amplify'),
      import('aws-amplify/auth/enable-oauth-listener'),
    ]);
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: config.userPoolId,
          userPoolClientId: config.userPoolClientId,
          ...(config.userPoolEndpoint ? { userPoolEndpoint: config.userPoolEndpoint } : {}),
          loginWith: {
            email: true,
            oauth: {
              domain: config.oauthDomain,
              scopes: ['openid', 'email', 'profile'],
              redirectSignIn: [config.redirectSignIn],
              redirectSignOut: [config.redirectSignOut],
              responseType: 'code',
            },
          },
        },
      },
    });
    return true;
  })().catch((err) => {
    configured = null;
    throw err;
  });
  return configured;
}

async function amplifyAuth() {
  if (!configured || !(await configured)) throw new Error('AUTH_NOT_CONFIGURED');
  return import('aws-amplify/auth');
}

/** Cria a conta; o Cognito manda um código por e-mail (confirmEmailCode). */
export async function signUpWithEmail(email: string, password: string, name?: string) {
  const { signUp } = await amplifyAuth();
  const r = await signUp({
    username: email,
    password,
    options: { userAttributes: { email, ...(name ? { given_name: name } : {}) } },
  });
  return { needsConfirmation: !r.isSignUpComplete };
}

export async function confirmEmailCode(email: string, code: string): Promise<boolean> {
  const { confirmSignUp } = await amplifyAuth();
  const r = await confirmSignUp({ username: email, confirmationCode: code });
  return r.isSignUpComplete;
}

/** Login por e-mail e senha com SRP. `nextStep` diferente de DONE pede ação da tela. */
export async function signInWithEmail(email: string, password: string) {
  const { signIn } = await amplifyAuth();
  const r = await signIn({ username: email, password, options: { authFlowType: 'USER_SRP_AUTH' } });
  return { done: r.isSignedIn, nextStep: r.nextStep.signInStep };
}

/** Sai para o Google pelo domínio do Cognito; volta em /auth/callback. */
export async function signInWithGoogle(): Promise<void> {
  const { signInWithRedirect } = await amplifyAuth();
  await signInWithRedirect({ provider: 'Google' });
}

export async function signOutAccount(): Promise<void> {
  const { signOut } = await amplifyAuth();
  await signOut();
}

/** Sessão atual ou null (convidado, login desligado, sem rede para renovar o token). */
export async function getSession(): Promise<Session | null> {
  if (!configured) return null;
  try {
    const { fetchAuthSession } = await amplifyAuth();
    const { tokens } = await fetchAuthSession();
    const idToken = tokens?.idToken;
    const sub = idToken?.payload?.sub;
    if (!idToken || typeof sub !== 'string') return null;
    return { token: idToken.toString(), userId: sub };
  } catch {
    return null;
  }
}

/**
 * Avisa entrada (login, cadastro confirmado, volta do Google) e saída da conta.
 * Devolve a função que para de ouvir.
 */
export async function onAuthEvent(cb: (event: AuthEvent) => void): Promise<() => void> {
  const { Hub } = await import('aws-amplify/utils');
  return Hub.listen('auth', ({ payload }) => {
    if (payload.event === 'signedIn' || payload.event === 'signInWithRedirect') cb('signedIn');
    else if (payload.event === 'signedOut') cb('signedOut');
  });
}

export function authErrorCode(err: unknown): AuthErrorCode {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'UsernameExistsException':
    case 'AliasExistsException':
      return 'EMAIL_IN_USE';
    case 'InvalidPasswordException':
      return 'WEAK_PASSWORD';
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'INVALID_CREDENTIALS';
    case 'UserNotConfirmedException':
      return 'NOT_CONFIRMED';
    case 'CodeMismatchException':
    case 'ExpiredCodeException':
      return 'BAD_CODE';
    case 'NetworkError':
      return 'NETWORK';
    default:
      return 'UNKNOWN';
  }
}

export function __resetAuthForTests(): void {
  configured = null;
}
