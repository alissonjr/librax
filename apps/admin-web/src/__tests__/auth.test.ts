import { describe, it, expect, vi } from 'vitest';
import { completeLogin, currentToken, loginUrl, pkceChallenge, saveToken, tokenClaims, AuthCallbackError } from '../lib/auth';
import { httpApi, ApiError } from '../lib/api';

// Login do painel: authorization code com PKCE no Cognito, app client próprio, id token no
// sessionStorage. Quem decide o acesso é a API.

const config = { domain: 'auth.librax.example', clientId: 'admin-client', origin: 'https://librax.example' };

function jwt(claims: Record<string, unknown>) {
  // JWT de verdade: JSON em UTF-8, base64url
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.assinatura`;
}

describe('PKCE e login', () => {
  it('code_challenge e o SHA-256 em base64url do verifier, sem preenchimento', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r7wW1gFWFOEjXk';
    // sha256 do verifier em base64url (calculado com node:crypto)
    const expected = 'bwWFMyPfdG9qreDhH2lmftFx_dFeLDalzcT1gb_j68g';
    expect(await pkceChallenge(verifier)).toBe(expected);
    expect(expected).not.toMatch(/[=+/]/);
  });

  it('URL de login no Cognito com o client do painel, S256 e volta em /admin/auth/callback', async () => {
    const url = new URL(await loginUrl(config));
    expect(url.origin).toBe('https://auth.librax.example');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('admin-client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://librax.example/admin/auth/callback');
    expect(url.searchParams.get('scope')).toBe('openid email profile aws.cognito.signin.user.admin');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('a volta troca o code pelo id token com o verifier guardado', async () => {
    const url = new URL(await loginUrl(config));
    const state = url.searchParams.get('state')!;
    const token = jwt({ sub: 'u', email: 'dono@exemplo.com' });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id_token: token, expires_in: 3600 }), { status: 200 }));

    await completeLogin(`?code=abc&state=${state}`, config, fetchFn as unknown as typeof fetch);

    const [endpoint, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe('https://auth.librax.example/oauth2/token');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    expect(body.get('client_id')).toBe('admin-client');
    expect(body.get('code_verifier')?.length).toBeGreaterThanOrEqual(43);
    expect(currentToken()).toBe(token);
  });

  it('state diferente (ou volta sem login iniciado) e recusado', async () => {
    await loginUrl(config);
    const fetchFn = vi.fn();
    await expect(completeLogin('?code=abc&state=outro', config, fetchFn as unknown as typeof fetch)).rejects.toBeInstanceOf(AuthCallbackError);
    await expect(completeLogin('?code=abc&state=x', config, fetchFn as unknown as typeof fetch)).rejects.toBeInstanceOf(AuthCallbackError);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(currentToken()).toBeNull();
  });

  it('token vencido (ou quase) nao vale', () => {
    saveToken('t', Date.now() + 30 * 1000);
    expect(currentToken()).toBeNull();
    saveToken('t', Date.now() + 10 * 60 * 1000);
    expect(currentToken()).toBe('t');
  });

  it('le as claims do id token (so para exibir)', () => {
    expect(tokenClaims(jwt({ email: 'joão@exemplo.com', 'cognito:groups': ['admin'] }))).toMatchObject({
      email: 'joão@exemplo.com', 'cognito:groups': ['admin'],
    });
    expect(tokenClaims('lixo')).toEqual({});
  });
});

describe('cliente da API', () => {
  it('manda o id token e monta a rota /v1/admin', async () => {
    const fetchFn = vi.fn(async () => new Response('{"accounts":[]}', { status: 200 }));
    const api = httpApi({ base: '/api', token: () => 'id.token', fetchFn: fetchFn as unknown as typeof fetch });
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
