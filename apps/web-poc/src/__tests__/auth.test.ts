import { describe, it, expect, vi, beforeEach } from 'vitest';

// Amplify mockado: nada sai para o Cognito. Cada teste olha so o que o módulo pede ao Amplify.
const amplify = vi.hoisted(() => ({
  configure: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  signIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  fetchAuthSession: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('aws-amplify', () => ({ Amplify: { configure: amplify.configure } }));
vi.mock('aws-amplify/auth/enable-oauth-listener', () => ({}));
vi.mock('aws-amplify/utils', () => ({ Hub: { listen: amplify.listen } }));
vi.mock('aws-amplify/auth', () => ({
  signUp: amplify.signUp,
  confirmSignUp: amplify.confirmSignUp,
  signIn: amplify.signIn,
  signInWithRedirect: amplify.signInWithRedirect,
  signOut: amplify.signOut,
  fetchAuthSession: amplify.fetchAuthSession,
}));

import {
  readAuthConfig,
  configureAuth,
  signUpWithEmail,
  confirmEmailCode,
  signInWithEmail,
  signInWithGoogle,
  signOutAccount,
  getSession,
  onAuthEvent,
  authErrorCode,
  getUserId,
  __resetAuthForTests,
} from '../lib/auth';

const env = {
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_Exemplo',
  VITE_COGNITO_CLIENT_ID: 'cliente123',
  VITE_COGNITO_DOMAIN: 'auth.librax.example',
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetAuthForTests();
});

describe('configuração por VITE_*', () => {
  it('sem as variáveis o login fica desligado (app segue como convidado)', async () => {
    expect(readAuthConfig({}, 'https://librax.example')).toBeNull();
    expect(await configureAuth(null)).toBe(false);
    expect(amplify.configure).not.toHaveBeenCalled();
  });

  it('monta callbacks a partir da origem quando não informados', () => {
    expect(readAuthConfig(env, 'https://librax.example')).toEqual({
      userPoolId: 'us-east-1_Exemplo',
      userPoolClientId: 'cliente123',
      oauthDomain: 'auth.librax.example',
      redirectSignIn: 'https://librax.example/auth/callback',
      redirectSignOut: 'https://librax.example/',
    });
    const custom = readAuthConfig(
      { ...env, VITE_AUTH_REDIRECT_SIGN_IN: 'http://localhost:5173/auth/callback', VITE_AUTH_REDIRECT_SIGN_OUT: 'http://localhost:5173/' },
      'https://librax.example',
    );
    expect(custom?.redirectSignIn).toBe('http://localhost:5173/auth/callback');
  });

  it('configura o Amplify uma vez, com OAuth code (PKCE) e e-mail como login', async () => {
    const config = readAuthConfig(env, 'https://librax.example');
    expect(await configureAuth(config)).toBe(true);
    await configureAuth(config);

    expect(amplify.configure).toHaveBeenCalledTimes(1);
    const cognito = amplify.configure.mock.calls[0][0].Auth.Cognito;
    expect(cognito.userPoolId).toBe('us-east-1_Exemplo');
    expect(cognito.loginWith.email).toBe(true);
    expect(cognito.loginWith.oauth).toEqual({
      domain: 'auth.librax.example',
      scopes: ['openid', 'email', 'profile'],
      redirectSignIn: ['https://librax.example/auth/callback'],
      redirectSignOut: ['https://librax.example/'],
      responseType: 'code',
    });
    // sem VITE_COGNITO_ENDPOINT o Amplify fala com o cognito-idp da AWS
    expect(cognito).not.toHaveProperty('userPoolEndpoint');
  });

  it('ambiente local: VITE_COGNITO_ENDPOINT manda o cognito-idp para o proxy local', async () => {
    const config = readAuthConfig({ ...env, VITE_COGNITO_ENDPOINT: 'http://127.0.0.1:5332' }, 'http://127.0.0.1:5320');
    expect(config?.userPoolEndpoint).toBe('http://127.0.0.1:5332');
    await configureAuth(config);
    expect(amplify.configure.mock.calls[0][0].Auth.Cognito.userPoolEndpoint).toBe('http://127.0.0.1:5332');
  });
});

describe('e-mail e senha (SRP)', () => {
  beforeEach(async () => {
    await configureAuth(readAuthConfig(env, 'https://librax.example'));
  });

  it('cadastro pede confirmação do código enviado por e-mail', async () => {
    amplify.signUp.mockResolvedValue({ isSignUpComplete: false, nextStep: { signUpStep: 'CONFIRM_SIGN_UP' } });
    const r = await signUpWithEmail('ana@exemplo.com', 'segredo123', 'Ana');
    expect(r).toEqual({ needsConfirmation: true });
    expect(amplify.signUp).toHaveBeenCalledWith({
      username: 'ana@exemplo.com',
      password: 'segredo123',
      options: { userAttributes: { email: 'ana@exemplo.com', given_name: 'Ana' } },
    });
  });

  it('confirma o código', async () => {
    amplify.confirmSignUp.mockResolvedValue({ isSignUpComplete: true });
    expect(await confirmEmailCode('ana@exemplo.com', '123456')).toBe(true);
    expect(amplify.confirmSignUp).toHaveBeenCalledWith({ username: 'ana@exemplo.com', confirmationCode: '123456' });
  });

  it('entra com USER_SRP_AUTH (a senha não trafega)', async () => {
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    expect(await signInWithEmail('ana@exemplo.com', 'segredo123')).toEqual({ done: true, nextStep: 'DONE' });
    expect(amplify.signIn).toHaveBeenCalledWith({
      username: 'ana@exemplo.com',
      password: 'segredo123',
      options: { authFlowType: 'USER_SRP_AUTH' },
    });
  });

  it('traduz erros do Cognito para códigos da tela (spec-02 12.3)', () => {
    const err = (name: string) => Object.assign(new Error(name), { name });
    expect(authErrorCode(err('UsernameExistsException'))).toBe('EMAIL_IN_USE');
    expect(authErrorCode(err('InvalidPasswordException'))).toBe('WEAK_PASSWORD');
    expect(authErrorCode(err('NotAuthorizedException'))).toBe('INVALID_CREDENTIALS');
    expect(authErrorCode(err('UserNotConfirmedException'))).toBe('NOT_CONFIRMED');
    expect(authErrorCode(err('CodeMismatchException'))).toBe('BAD_CODE');
    expect(authErrorCode(err('NetworkError'))).toBe('NETWORK');
    expect(authErrorCode(new Error('x'))).toBe('UNKNOWN');
  });
});

describe('Google por redirect', () => {
  it('usa signInWithRedirect (PKCE fica com o Amplify)', async () => {
    await configureAuth(readAuthConfig(env, 'https://librax.example'));
    await signInWithGoogle();
    expect(amplify.signInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' });
  });

  it('sem configuração, falha com mensagem clara', async () => {
    await expect(signInWithGoogle()).rejects.toThrow(/AUTH_NOT_CONFIGURED/);
  });
});

describe('sessão', () => {
  beforeEach(async () => {
    await configureAuth(readAuthConfig(env, 'https://librax.example'));
  });

  it('devolve id token e sub quando há sessão', async () => {
    amplify.fetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'jwt.id.token', payload: { sub: 'sub-123' } } },
    });
    expect(await getSession()).toEqual({ token: 'jwt.id.token', userId: 'sub-123' });
  });

  it('convidado ou erro de rede: sem sessão', async () => {
    amplify.fetchAuthSession.mockResolvedValue({ tokens: undefined });
    expect(await getSession()).toBeNull();
    amplify.fetchAuthSession.mockRejectedValue(new Error('offline'));
    expect(await getSession()).toBeNull();
  });

  it('sem configuração nem chama o Amplify', async () => {
    __resetAuthForTests();
    expect(await getSession()).toBeNull();
    expect(amplify.fetchAuthSession).not.toHaveBeenCalled();
  });

  it('sair encerra a sessão no Cognito', async () => {
    await signOutAccount();
    expect(amplify.signOut).toHaveBeenCalled();
  });

  it('avisa entrada e saída da conta (inclusive volta do Google)', async () => {
    const stop = vi.fn();
    amplify.listen.mockReturnValue(stop);
    const seen: string[] = [];
    const unsubscribe = await onAuthEvent((e) => seen.push(e));

    const handler = amplify.listen.mock.calls[0][1];
    handler({ payload: { event: 'signedIn' } });
    handler({ payload: { event: 'signInWithRedirect' } });
    handler({ payload: { event: 'tokenRefresh' } });
    handler({ payload: { event: 'signedOut' } });

    expect(amplify.listen.mock.calls[0][0]).toBe('auth');
    expect(seen).toEqual(['signedIn', 'signedIn', 'signedOut']);
    unsubscribe();
    expect(stop).toHaveBeenCalled();
  });
});

describe('convidado local (inalterado)', () => {
  it('getUserId continua gerando e guardando o id local', () => {
    localStorage.clear();
    const id = getUserId();
    expect(id).toMatch(/^usr-/);
    expect(getUserId()).toBe(id);
  });
});
