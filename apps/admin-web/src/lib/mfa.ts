import { currentAccessToken, currentToken, tokenClaims } from './auth';

/*
 * Primeiro acesso ao painel: configurar o aplicativo autenticador (TOTP) da própria conta.
 *
 * A API do painel recusa admin sem o autenticador (403 ADMIN_MFA_REQUIRED). Aqui o painel fala direto
 * com o Cognito (cognito-idp.<região>.amazonaws.com, já liberado na CSP do painel), com o access token
 * do login, que tem o escopo aws.cognito.signin.user.admin:
 *   1. AssociateSoftwareToken: o Cognito gera a chave secreta da conta;
 *   2. o painel mostra a chave e um QR code feito aqui mesmo (nada sai do navegador);
 *   3. VerifySoftwareToken: confere o primeiro código de 6 dígitos do aplicativo;
 *   4. SetUserMFAPreference: liga o autenticador como fator preferido. Daí em diante o login do
 *      Cognito pede o código.
 * Nunca SMS. O app do Librax não usa nada disso.
 */

export interface MfaSecret {
  /** Chave em base32, como o Cognito devolve. */
  secret: string;
  /** otpauth://totp/... para o QR code. */
  uri: string;
}

export interface MfaSetupApi {
  start(): Promise<MfaSecret>;
  verify(code: string): Promise<void>;
}

export class MfaSetupError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export const MFA_ISSUER = 'Librax admin';
export const MFA_DEVICE_NAME = 'Painel Librax';

/** Origem do Cognito da conta, tirada do `iss` do id token (https://cognito-idp.<região>.amazonaws.com/<pool>). */
export function cognitoEndpoint(idToken: string): string | null {
  const iss = tokenClaims(idToken).iss;
  if (typeof iss !== 'string') return null;
  const m = /^(https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com)\/[\w-]+$/.exec(iss);
  return m ? m[1] : null;
}

/** Endereço que o aplicativo autenticador lê no QR code. */
export function otpauthUri(secret: string, account: string, issuer = MFA_ISSUER): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params}`;
}

/** Chave em grupos de 4, para digitar no aplicativo sem errar. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') ?? '';
}

/** Código do aplicativo: 6 dígitos (espaços ignorados). */
export function normalizeCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

const MESSAGES: Record<string, string> = {
  CodeMismatchException: 'O código não confere. Confira se o relógio do celular está certo e digite o código que aparece agora.',
  EnableSoftwareTokenMFAException: 'O código não confere. Confira se o relógio do celular está certo e digite o código que aparece agora.',
  ExpiredCodeException: 'O código venceu. Digite o código que aparece agora no aplicativo.',
  NotAuthorizedException: 'Esta sessão não pode configurar o autenticador. Saia, entre de novo e repita.',
  TooManyRequestsException: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
  LimitExceededException: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
  SoftwareTokenMFANotFoundException: 'A configuração começou de novo em outro lugar. Leia o QR code novo.',
};

export function cognitoMfaSetup({
  idToken = () => currentToken(),
  accessToken = () => currentAccessToken(),
  fetchFn = (...args: Parameters<typeof fetch>) => fetch(...args),
}: { idToken?: () => string | null; accessToken?: () => string | null; fetchFn?: typeof fetch } = {}): MfaSetupApi {
  function session() {
    const id = idToken();
    const access = accessToken();
    const endpoint = id ? cognitoEndpoint(id) : null;
    if (!id || !access || !endpoint) {
      throw new MfaSetupError('NO_SESSION', 'A sessão não tem o acesso para configurar o autenticador. Saia, entre de novo e repita.');
    }
    return { id, access, endpoint };
  }

  async function call<T>(endpoint: string, target: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetchFn(`${endpoint}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(data.__type ?? `HTTP_${res.status}`).split('#').pop() ?? 'ERRO';
      throw new MfaSetupError(code, MESSAGES[code] ?? 'O Cognito recusou o pedido. Tente de novo em instantes.');
    }
    return data as T;
  }

  return {
    async start() {
      const { id, access, endpoint } = session();
      const { SecretCode: secret } = await call<{ SecretCode?: string }>(endpoint, 'AssociateSoftwareToken', { AccessToken: access });
      if (!secret) throw new MfaSetupError('NO_SECRET', 'O Cognito não devolveu a chave. Tente de novo.');
      const claims = tokenClaims(id);
      const account = String(claims.email ?? claims['cognito:username'] ?? claims.sub ?? 'admin');
      return { secret, uri: otpauthUri(secret, account) };
    },
    async verify(raw) {
      const code = normalizeCode(raw);
      if (!code) throw new MfaSetupError('BAD_CODE', 'Digite os 6 números que aparecem no aplicativo.');
      const { access, endpoint } = session();
      const { Status } = await call<{ Status?: string }>(endpoint, 'VerifySoftwareToken', {
        AccessToken: access,
        UserCode: code,
        FriendlyDeviceName: MFA_DEVICE_NAME,
      });
      if (Status !== 'SUCCESS') throw new MfaSetupError('CodeMismatchException', MESSAGES.CodeMismatchException);
      await call(endpoint, 'SetUserMFAPreference', {
        AccessToken: access,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
      });
    },
  };
}
