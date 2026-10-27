import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminApp, type Session } from '../App';
import { ApiError, type AdminApi } from '../lib/api';
import { mockApi } from '../dev/mock';
import { qrPath } from '../components/QrCode';
import {
  cognitoEndpoint,
  cognitoMfaSetup,
  groupSecret,
  normalizeCode,
  otpauthUri,
  MfaSetupError,
  type MfaSetupApi,
} from '../lib/mfa';

// Primeiro acesso de admin: a API recusa sem o aplicativo autenticador (403 ADMIN_MFA_REQUIRED) e o
// painel guia a configuração com o Cognito (AssociateSoftwareToken, VerifySoftwareToken,
// SetUserMFAPreference), com o QR code gerado no navegador.

function jwt(claims: Record<string, unknown>) {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.assinatura`;
}
const ID_TOKEN = jwt({
  iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Teste',
  email: 'dona@exemplo.com',
  'cognito:username': 'abc',
});
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function session(over: Partial<Session> = {}): Session {
  return { hasToken: () => true, login: vi.fn(), logout: vi.fn(), completeLogin: vi.fn(async () => {}), clear: vi.fn(), ...over };
}

function renderApp(api: AdminApi, mfa: MfaSetupApi, s = session()) {
  render(
    <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AdminApp api={api} session={s} mfa={mfa} />
    </MemoryRouter>,
  );
  return s;
}

describe('lib/mfa', () => {
  it('endereço do Cognito pelo iss do id token (só cognito-idp.<região>.amazonaws.com)', () => {
    expect(cognitoEndpoint(ID_TOKEN)).toBe('https://cognito-idp.us-east-1.amazonaws.com');
    expect(cognitoEndpoint(jwt({ iss: 'https://evil.example/us-east-1_X' }))).toBeNull();
    expect(cognitoEndpoint('lixo')).toBeNull();
  });

  it('otpauth com emissor e conta, chave em grupos de 4 e código de 6 dígitos', () => {
    const uri = new URL(otpauthUri(SECRET, 'dona@exemplo.com'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Librax admin:dona@exemplo.com');
    expect(uri.searchParams.get('secret')).toBe(SECRET);
    expect(uri.searchParams.get('issuer')).toBe('Librax admin');
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    expect(normalizeCode('12345')).toBeNull();
    expect(normalizeCode('abcdef')).toBeNull();
  });

  it('QR code com margem de 4 módulos e módulos escuros', () => {
    const { size, d } = qrPath(otpauthUri(SECRET, 'dona@exemplo.com'));
    expect(size).toBeGreaterThanOrEqual(21 + 8);
    expect(d).toMatch(/^M4 4h1v1h-1z/); // canto do padrão de localização
  });

  it('configura com o access token: associa, confere o código e liga o TOTP como preferido (nunca SMS)', async () => {
    const calls: Array<{ url: string; target: string; body: Record<string, unknown> }> = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      const target = String((init.headers as Record<string, string>)['X-Amz-Target']).split('.').pop()!;
      calls.push({ url, target, body: JSON.parse(String(init.body)) });
      const out = target === 'AssociateSoftwareToken' ? { SecretCode: SECRET } : target === 'VerifySoftwareToken' ? { Status: 'SUCCESS' } : {};
      return new Response(JSON.stringify(out), { status: 200 });
    });
    const setup = cognitoMfaSetup({ idToken: () => ID_TOKEN, accessToken: () => 'access', fetchFn: fetchFn as unknown as typeof fetch });
    const secret = await setup.start();
    expect(secret.secret).toBe(SECRET);
    expect(secret.uri).toContain('dona%40exemplo.com');
    await setup.verify('123 456');
    expect(calls.map((c) => c.target)).toEqual(['AssociateSoftwareToken', 'VerifySoftwareToken', 'SetUserMFAPreference']);
    for (const c of calls) {
      expect(c.url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
      expect(c.body.AccessToken).toBe('access');
    }
    expect(calls[1].body).toMatchObject({ UserCode: '123456', FriendlyDeviceName: 'Painel Librax' });
    expect(calls[2].body).toEqual({ AccessToken: 'access', SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
    expect(JSON.stringify(calls)).not.toContain('SMS');
  });

  it('código errado: mensagem em português; sessão sem access token: pede para entrar de novo', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ __type: 'CodeMismatchException', message: 'Invalid code' }), { status: 400 }));
    const setup = cognitoMfaSetup({ idToken: () => ID_TOKEN, accessToken: () => 'access', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(setup.verify('000000')).rejects.toThrow(/não confere/);
    await expect(setup.verify('12')).rejects.toThrow(/6 números/);

    const semAcesso = cognitoMfaSetup({ idToken: () => ID_TOKEN, accessToken: () => null, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(semAcesso.start()).rejects.toBeInstanceOf(MfaSetupError);
    await expect(semAcesso.start()).rejects.toThrow(/entre de novo/);
  });
});

describe('primeiro acesso de admin', () => {
  const precisaDeMfa = (liberado: { value: boolean }): AdminApi => ({
    ...mockApi(),
    me: vi.fn(async () => {
      if (!liberado.value) throw new ApiError(403, 'ADMIN_MFA_REQUIRED', 'Configure o aplicativo autenticador');
      return { userId: 'u', email: 'dona@exemplo.com', groups: ['admin'] };
    }),
  });

  it('guia a configuração: QR code, chave, código e abre o painel depois', async () => {
    const liberado = { value: false };
    const setup: MfaSetupApi = {
      start: vi.fn(async () => ({ secret: SECRET, uri: otpauthUri(SECRET, 'dona@exemplo.com') })),
      verify: vi.fn(async () => { liberado.value = true; }),
    };
    renderApp(precisaDeMfa(liberado), setup);
    expect(await screen.findByText('Configure o aplicativo autenticador')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Começar/ }));
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Chave do autenticador')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');

    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('6 números');
    expect(setup.verify).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Código de 6 dígitos'), '123456');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(setup.verify).toHaveBeenCalledWith('123456');
    expect(await screen.findByText('Autenticador ligado')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Abrir o painel/ }));
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });

  it('código recusado: mostra o erro e deixa tentar de novo', async () => {
    const setup: MfaSetupApi = {
      start: vi.fn(async () => ({ secret: SECRET, uri: otpauthUri(SECRET, 'd') })),
      verify: vi.fn(async () => { throw new MfaSetupError('CodeMismatchException', 'O código não confere.'); }),
    };
    renderApp(precisaDeMfa({ value: false }), setup);
    await userEvent.click(await screen.findByRole('button', { name: /Começar/ }));
    await userEvent.type(await screen.findByLabelText('Código de 6 dígitos'), '000000');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O código não confere.');
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeEnabled();
  });

  it('conta do Google no grupo admin: explica que precisa de e-mail e senha', async () => {
    const api = { ...mockApi(), me: () => Promise.reject(new ApiError(403, 'ADMIN_MFA_FEDERATED', 'x')) };
    const s = renderApp(api, { start: vi.fn(), verify: vi.fn() });
    expect(await screen.findByText('Entre com e-mail e senha')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Sair/ }));
    expect(s.logout).toHaveBeenCalled();
  });
});
