import { describe, it, expect, vi } from 'vitest';
import { makeVerifier, newSecretBlock, nowString as serverNowString, startChallenge, verifyClaim } from '../../../../services/api/local/srp.mjs';
import { AuthError, authConfig, cognitoAuth, resetPasswordUrl, tokenClaims, type AuthConfig } from '../lib/auth';
import { nowString, passwordSignature, poolNameOf, srpStart } from '../lib/srp';
import { httpApi, ApiError } from '../lib/api';

// Login do painel direto na API do User Pool: SRP (a senha não trafega), código do autenticador,
// senha nova, renovação e saída. O Cognito aqui é um falso que confere o SRP com o mesmo código do
// proxy do ambiente local (services/api/local/srp.mjs), o que confere o login do app (Amplify).

const POOL = 'us-east-1_TestePool';
const CLIENT = 'admin-client';
const config: AuthConfig = { userPoolId: POOL, clientId: CLIENT, endpoint: 'https://cognito-idp.us-east-1.amazonaws.com' };

function jwt(claims: Record<string, unknown>) {
  // JWT de verdade: JSON em UTF-8, base64url
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.assinatura`;
}

interface FakeUser {
  sub: string;
  email: string;
  password: string;
  mfa?: boolean;
  temporary?: boolean;
}

type Call = { target: string; body: Record<string, any> };

/** Cognito de mentira: confere o SRP de verdade, o código 123456 e a Session de cada desafio. */
function fakeCognito(users: FakeUser[], over: Partial<Record<string, (body: Record<string, any>) => Response | Promise<Response>>> = {}) {
  const calls: Call[] = [];
  /** Como o Cognito responde ao REFRESH_TOKEN_AUTH: normal, revogado ou sem rede. */
  const control = { refresh: 'ok' as 'ok' | 'revoked' | 'offline' };
  const verifiers = new Map(users.map((u) => [u.sub, makeVerifier({ userPoolId: POOL, userId: u.sub, password: u.password })]));
  const pendingSrp = new Map<string, { user: FakeUser; state: { A: string; b: string; B: string } }>();
  const sessions = new Map<string, { user: FakeUser; challenge: string }>();
  let issued = 0;
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const fail = (type: string, message = '') => new Response(JSON.stringify({ __type: type, message }), { status: 400 });
  const tokens = (user: FakeUser, refresh = true) => {
    issued += 1;
    return {
      AuthenticationResult: {
        IdToken: jwt({ sub: user.sub, email: user.email, 'cognito:groups': ['admin'], n: issued }),
        AccessToken: `access-${issued}`,
        ...(refresh ? { RefreshToken: `refresh-${user.sub}` } : {}),
        ExpiresIn: 3600,
      },
    };
  };
  const newSession = (user: FakeUser, challenge: string) => {
    const id = `sessao-${sessions.size + 1}`;
    sessions.set(id, { user, challenge });
    return id;
  };

  const handlers: Record<string, (body: Record<string, any>) => Response | Promise<Response>> = {
    InitiateAuth(body) {
      if (body.ClientId !== CLIENT) return fail('ResourceNotFoundException');
      if (body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        if (control.refresh === 'offline') throw new TypeError('Failed to fetch');
        if (control.refresh === 'revoked') return fail('NotAuthorizedException', 'Refresh Token has been revoked');
        const user = users.find((u) => `refresh-${u.sub}` === body.AuthParameters.REFRESH_TOKEN);
        return user ? ok(tokens(user, false)) : fail('NotAuthorizedException', 'Refresh Token has been revoked');
      }
      const user = users.find((u) => u.email === body.AuthParameters.USERNAME);
      // PreventUserExistenceErrors: conta inexistente responde como senha errada
      if (!user) return fail('NotAuthorizedException', 'Incorrect username or password.');
      const v = verifiers.get(user.sub)!;
      const { B, state } = startChallenge({ verifier: v.verifier, A: body.AuthParameters.SRP_A });
      const secretBlock = newSecretBlock();
      pendingSrp.set(secretBlock, { user, state });
      return ok({
        ChallengeName: 'PASSWORD_VERIFIER',
        ChallengeParameters: { SALT: v.salt, SRP_B: B, SECRET_BLOCK: secretBlock, USER_ID_FOR_SRP: user.sub, USERNAME: user.sub },
      });
    },
    RespondToAuthChallenge(body) {
      const answers = body.ChallengeResponses;
      if (body.ChallengeName === 'PASSWORD_VERIFIER') {
        const pending = pendingSrp.get(answers.PASSWORD_CLAIM_SECRET_BLOCK);
        if (!pending || answers.USERNAME !== pending.user.sub) return fail('NotAuthorizedException', 'Incorrect username or password.');
        const valid = verifyClaim({
          userPoolId: POOL,
          userId: pending.user.sub,
          verifier: verifiers.get(pending.user.sub)!.verifier,
          state: pending.state,
          secretBlock: answers.PASSWORD_CLAIM_SECRET_BLOCK,
          timestamp: answers.TIMESTAMP,
          claimSignature: answers.PASSWORD_CLAIM_SIGNATURE,
        });
        if (!valid) return fail('NotAuthorizedException', 'Incorrect username or password.');
        if (pending.user.temporary) return ok({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: newSession(pending.user, 'NEW_PASSWORD_REQUIRED'), ChallengeParameters: {} });
        if (pending.user.mfa) return ok({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: newSession(pending.user, 'SOFTWARE_TOKEN_MFA'), ChallengeParameters: {} });
        return ok(tokens(pending.user));
      }
      const s = sessions.get(body.Session);
      if (!s || s.challenge !== body.ChallengeName || answers.USERNAME !== s.user.sub) {
        return fail('NotAuthorizedException', 'Invalid session for the user, session is expired.');
      }
      if (body.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        if (answers.SOFTWARE_TOKEN_MFA_CODE !== '123456') return fail('CodeMismatchException', 'Invalid code received for user');
        sessions.delete(body.Session);
        return ok(tokens(s.user));
      }
      if (body.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        if (String(answers.NEW_PASSWORD).length < 8) return fail('InvalidPasswordException', 'Password did not conform with policy');
        sessions.delete(body.Session);
        s.user.temporary = false;
        return s.user.mfa ? ok({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: newSession(s.user, 'SOFTWARE_TOKEN_MFA') }) : ok(tokens(s.user));
      }
      return fail('InvalidParameterException');
    },
    RevokeToken: () => ok({}),
    GlobalSignOut: () => ok({}),
    ...over,
  };

  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-amz-json-1.1');
    const target = headers['X-Amz-Target'].replace('AWSCognitoIdentityProviderService.', '');
    const body = JSON.parse(String(init.body));
    calls.push({ target, body });
    const handler = handlers[target];
    return handler ? handler(body) : fail('UnknownOperationException');
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, control };
}

const ANA: FakeUser = { sub: 'sub-ana', email: 'ana@exemplo.com', password: 'senha-certa-123' };

function setup(users: FakeUser[] = [ANA], over?: Parameters<typeof fakeCognito>[1]) {
  const fake = fakeCognito(users.map((u) => ({ ...u })), over);
  const clock = { now: 1_800_000_000_000 };
  const auth = cognitoAuth({ config, fetchFn: fake.fetchFn, now: () => clock.now });
  return { ...fake, auth, clock };
}

describe('SRP (lib/srp)', () => {
  it('a assinatura do navegador passa na conferência do servidor; senha errada não', async () => {
    const userId = 'sub-ana';
    const { salt, verifier } = makeVerifier({ userPoolId: POOL, userId, password: 'senha-certa-123' });
    for (const [password, expected] of [['senha-certa-123', true], ['senha-errada', false]] as const) {
      const client = srpStart();
      const { B, state } = startChallenge({ verifier, A: client.A });
      const secretBlock = newSecretBlock();
      const timestamp = nowString();
      const claimSignature = await passwordSignature({ userPoolId: POOL, userId, password, client, B, salt, secretBlock, timestamp });
      expect(verifyClaim({ userPoolId: POOL, userId, verifier, state, secretBlock, timestamp, claimSignature })).toBe(expected);
    }
  });

  it('data no formato do Cognito (dia sem zero) e nome do pool depois do "_"', () => {
    const d = new Date(Date.UTC(2026, 9, 3, 7, 5, 9));
    expect(nowString(d)).toBe('Sat Oct 3 07:05:09 UTC 2026');
    expect(nowString(d)).toBe(serverNowString(d));
    expect(poolNameOf(POOL)).toBe('TestePool');
  });

  it('A nunca é zero e o segredo vem do gerador aleatório do navegador', () => {
    const random = vi.fn((n: number) => new Uint8Array(n).fill(7));
    const { a, A } = srpStart(random);
    expect(random).toHaveBeenCalledWith(128);
    expect(a).toBe('07'.repeat(128).replace(/^0/, ''));
    expect(BigInt(`0x${A}`)).toBeGreaterThan(0n);
  });
});

describe('configuração', () => {
  it('endereço do cognito-idp pela região do User Pool; o ambiente local troca pelo proxy', () => {
    expect(authConfig({ VITE_COGNITO_USER_POOL_ID: 'sa-east-1_Abc', VITE_COGNITO_CLIENT_ID: 'c' })).toEqual({
      userPoolId: 'sa-east-1_Abc', clientId: 'c', endpoint: 'https://cognito-idp.sa-east-1.amazonaws.com',
    });
    expect(authConfig({ VITE_COGNITO_USER_POOL_ID: POOL, VITE_COGNITO_ENDPOINT: 'http://127.0.0.1:5332/' }).endpoint).toBe('http://127.0.0.1:5332');
    expect(authConfig({ VITE_COGNITO_USER_POOL_ID: 'lixo' }).endpoint).toBe('');
  });

  it('sem configuração: erro claro e nenhuma chamada', async () => {
    const fetchFn = vi.fn();
    const auth = cognitoAuth({ config: authConfig({}), fetchFn: fetchFn as unknown as typeof fetch });
    await expect(auth.signIn('ana@exemplo.com', 'x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('"Esqueci a senha" abre o /entrar do app (mesma origem em produção)', () => {
    expect(resetPasswordUrl({})).toBe('/entrar');
    expect(resetPasswordUrl({ VITE_APP_ORIGIN: 'http://127.0.0.1:5320/' })).toBe('http://127.0.0.1:5320/entrar');
  });
});

describe('entrar', () => {
  it('conta sem autenticador: SRP e tokens; a senha não vai em nenhuma chamada', async () => {
    const { auth, calls } = setup();
    expect(auth.hasSession()).toBe(false);
    expect(await auth.signIn(' ana@exemplo.com ', ANA.password)).toEqual({ kind: 'done' });
    expect(calls.map((c) => c.target)).toEqual(['InitiateAuth', 'RespondToAuthChallenge']);
    expect(calls[0].body).toMatchObject({ AuthFlow: 'USER_SRP_AUTH', ClientId: CLIENT, AuthParameters: { USERNAME: 'ana@exemplo.com' } });
    expect(calls[1].body.ChallengeResponses.USERNAME).toBe('sub-ana');
    expect(JSON.stringify(calls)).not.toContain(ANA.password);
    expect(auth.hasSession()).toBe(true);
    const id = await auth.idToken();
    expect(tokenClaims(id!)).toMatchObject({ email: 'ana@exemplo.com', 'cognito:groups': ['admin'] });
    expect(await auth.accessToken()).toMatch(/^access-/);
  });

  it('refresh token só na memória: nada dele no sessionStorage nem no localStorage', async () => {
    const { auth } = setup();
    await auth.signIn(ANA.email, ANA.password);
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).toContain('access-');
    expect(stored).not.toContain('refresh-');
  });

  it('senha errada e conta inexistente: a mesma mensagem, sem dizer se o e-mail existe', async () => {
    const { auth } = setup();
    const errada = await auth.signIn(ANA.email, 'outra-senha').catch((e: AuthError) => e);
    const ninguem = await auth.signIn('ninguem@exemplo.com', 'qualquer').catch((e: AuthError) => e);
    expect(errada).toBeInstanceOf(AuthError);
    expect((errada as AuthError).code).toBe('INVALID_CREDENTIALS');
    expect((ninguem as AuthError).message).toBe((errada as AuthError).message);
    expect((errada as AuthError).message).toBe('E-mail ou senha incorretos.');
    expect(auth.hasSession()).toBe(false);
  });

  it('muitas tentativas: trava de senha do Cognito e limite de pedidos', async () => {
    const travada = setup([ANA], { InitiateAuth: () => new Response(JSON.stringify({ __type: 'NotAuthorizedException', message: 'Password attempts exceeded' }), { status: 400 }) });
    await expect(travada.auth.signIn(ANA.email, ANA.password)).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
    const limite = setup([ANA], { InitiateAuth: () => new Response('{}', { status: 400, headers: { 'x-amzn-ErrorType': 'TooManyRequestsException:http://internal' } }) });
    await expect(limite.auth.signIn(ANA.email, ANA.password)).rejects.toThrow(/Muitas tentativas/);
  });

  it('sem rede: mensagem de conexão', async () => {
    const auth = cognitoAuth({ config, fetchFn: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    await expect(auth.signIn(ANA.email, ANA.password)).rejects.toMatchObject({ code: 'NETWORK', message: expect.stringMatching(/Sem conexão/) });
  });

  it('conta com autenticador: pede o código, código errado deixa tentar de novo com a mesma sessão', async () => {
    const { auth, calls } = setup([{ ...ANA, mfa: true }]);
    const step = await auth.signIn(ANA.email, ANA.password);
    expect(step).toMatchObject({ kind: 'totp', username: 'sub-ana' });
    expect(auth.hasSession()).toBe(false);
    if (step.kind !== 'totp') throw new Error('esperava o código');

    await expect(auth.confirmTotp(step, '12')).rejects.toMatchObject({ code: 'CODE_FORMAT' });
    expect(calls).toHaveLength(2);

    await expect(auth.confirmTotp(step, '000000')).rejects.toMatchObject({ code: 'BAD_CODE' });
    expect(await auth.confirmTotp(step, '123 456')).toEqual({ kind: 'done' });
    const last = calls[calls.length - 1].body;
    expect(last).toMatchObject({
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      ClientId: CLIENT,
      Session: step.session,
      ChallengeResponses: { USERNAME: 'sub-ana', SOFTWARE_TOKEN_MFA_CODE: '123456' },
    });
    expect(auth.hasSession()).toBe(true);
  });

  it('sessão do código vencida ou já usada: SESSION_EXPIRED (a tela volta para a senha)', async () => {
    const { auth } = setup([{ ...ANA, mfa: true }]);
    const step = await auth.signIn(ANA.email, ANA.password);
    if (step.kind !== 'totp') throw new Error('esperava o código');
    await auth.confirmTotp(step, '123456');
    await expect(auth.confirmTotp(step, '123456')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('senha temporária: pede a senha nova, recusa a fraca e entra com a boa', async () => {
    const { auth, calls } = setup([{ ...ANA, temporary: true }]);
    const step = await auth.signIn(ANA.email, ANA.password);
    expect(step.kind).toBe('newPassword');
    if (step.kind !== 'newPassword') throw new Error('esperava a senha nova');
    await expect(auth.completeNewPassword(step, 'curta')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
    expect(await auth.completeNewPassword(step, 'senha-nova-123')).toEqual({ kind: 'done' });
    expect(calls[calls.length - 1].body).toMatchObject({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ChallengeResponses: { USERNAME: 'sub-ana', NEW_PASSWORD: 'senha-nova-123' },
    });
  });

  it('passo que o painel não conhece: erro claro', async () => {
    const { auth } = setup([ANA], {
      RespondToAuthChallenge: () => new Response(JSON.stringify({ ChallengeName: 'MFA_SETUP', Session: 's' }), { status: 200 }),
    });
    await expect(auth.signIn(ANA.email, ANA.password)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('renovar e sair', () => {
  it('id token vencido: renova com o refresh token, uma vez só para várias chamadas juntas', async () => {
    const { auth, calls, clock } = setup();
    await auth.signIn(ANA.email, ANA.password);
    const first = await auth.idToken();
    clock.now += 59 * 60 * 1000; // dentro da margem de 1 minuto
    const [a, b] = await Promise.all([auth.idToken(), auth.idToken()]);
    expect(a).toBe(b);
    expect(a).not.toBe(first);
    const refreshes = calls.filter((c) => c.body.AuthFlow === 'REFRESH_TOKEN_AUTH');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].body).toEqual({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: CLIENT, AuthParameters: { REFRESH_TOKEN: 'refresh-sub-ana' } });
  });

  it('sem rede na renovação: AuthError NETWORK e a sessão fica para tentar de novo', async () => {
    const { auth, clock, control } = setup();
    await auth.signIn(ANA.email, ANA.password);
    clock.now += 2 * 60 * 60 * 1000;
    control.refresh = 'offline';
    await expect(auth.idToken()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(auth.hasSession()).toBe(true);
    control.refresh = 'ok';
    expect(await auth.idToken()).toMatch(/\./);
  });

  it('refresh recusado (revogado ou vencido): sai da conta', async () => {
    const { auth, clock, control } = setup();
    await auth.signIn(ANA.email, ANA.password);
    clock.now += 2 * 60 * 60 * 1000;
    control.refresh = 'revoked';
    expect(await auth.idToken()).toBeNull();
    expect(auth.hasSession()).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('depois de recarregar a aba: vale o id token guardado até vencer, sem refresh token', async () => {
    const { auth, clock } = setup();
    await auth.signIn(ANA.email, ANA.password);
    const reloaded = cognitoAuth({ config, fetchFn: vi.fn() as unknown as typeof fetch, now: () => clock.now });
    expect(reloaded.hasSession()).toBe(true);
    expect(await reloaded.idToken()).toBe(await auth.idToken());
    clock.now += 2 * 60 * 60 * 1000;
    expect(reloaded.hasSession()).toBe(false);
    expect(await reloaded.idToken()).toBeNull();
  });

  it('sair: revoga o refresh token no Cognito e apaga tudo do navegador', async () => {
    const { auth, calls } = setup();
    await auth.signIn(ANA.email, ANA.password);
    await auth.signOut();
    expect(calls[calls.length - 1]).toEqual({ target: 'RevokeToken', body: { Token: 'refresh-sub-ana', ClientId: CLIENT } });
    expect(auth.hasSession()).toBe(false);
    expect(sessionStorage.length).toBe(0);
    expect(await auth.idToken()).toBeNull();
  });

  it('sair depois de recarregar (sem refresh token na memória): encerra as sessões com o access token', async () => {
    const { auth } = setup();
    await auth.signIn(ANA.email, ANA.password);
    const reloaded = setup();
    expect(reloaded.auth.hasSession()).toBe(true);
    await reloaded.auth.signOut();
    expect(reloaded.calls).toEqual([{ target: 'GlobalSignOut', body: { AccessToken: expect.stringMatching(/^access-/) } }]);
    expect(sessionStorage.length).toBe(0);
  });

  it('sair sem rede não trava: apaga do navegador mesmo assim', async () => {
    const { auth } = setup([ANA], { RevokeToken: () => { throw new TypeError('offline'); } });
    await auth.signIn(ANA.email, ANA.password);
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(auth.hasSession()).toBe(false);
  });

  it('le as claims do id token (só para exibir)', () => {
    expect(tokenClaims(jwt({ email: 'joão@exemplo.com', 'cognito:groups': ['admin'] }))).toMatchObject({
      email: 'joão@exemplo.com', 'cognito:groups': ['admin'],
    });
    expect(tokenClaims('lixo')).toEqual({});
  });
});

describe('cliente da API', () => {
  it('manda o id token (também vindo de uma renovação) e monta a rota /v1/admin', async () => {
    const fetchFn = vi.fn(async () => new Response('{"accounts":[]}', { status: 200 }));
    const api = httpApi({ base: '/api', token: async () => 'id.token', fetchFn: fetchFn as unknown as typeof fetch });
    await api.searchAccounts('ana@');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/accounts?q=ana%40');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer id.token');
  });

  it('403 da API vira ApiError com o codigo', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":{"code":"ADMIN_ONLY","message":"Acesso restrito"}}', { status: 403 }));
    const api = httpApi({ token: () => 't', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(api.me()).rejects.toMatchObject({ status: 403, code: 'ADMIN_ONLY' });
  });

  it('sem token nao chama a rede', async () => {
    const fetchFn = vi.fn();
    const api = httpApi({ token: () => null, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(api.overview()).rejects.toBeInstanceOf(ApiError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
