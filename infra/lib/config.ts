import { Node } from 'constructs';

/**
 * Parametros de contexto do CDK (cdk.json ou `-c chave=valor`).
 *
 * O dominio ainda nao foi escolhido: o padrao `librax.example` e um placeholder (TLD
 * reservado, RFC 2606) que permite `cdk synth` sem conta AWS. Antes do primeiro deploy,
 * ver "Antes do primeiro deploy" em services/api/README.md.
 *
 * | chave                          | padrao                          | uso |
 * |--------------------------------|---------------------------------|-----|
 * | librax:domainName              | librax.example                  | dominio do app (CloudFront) |
 * | librax:authDomainName          | auth.<domainName>               | dominio proprio do Cognito |
 * | librax:certificateArn          | (vazio)                         | ACM em us-east-1 cobrindo os dois dominios; sem ele, sem dominio proprio |
 * | librax:cognitoDomainPrefix     | librax-example                  | prefixo amazoncognito.com usado so sem certificado |
 * | librax:hostedZoneId/Name       | (vazio)                         | Route 53: cria os registros A/AAAA se informado |
 * | librax:extraCallbackUrls       | (vazio)                         | callbacks extras separados por virgula (ex.: dev local) |
 * | librax:extraLogoutUrls         | (vazio)                         | logouts extras separados por virgula |
 * | librax:extraCorsOrigins        | (vazio)                         | origens extras de CORS da API (ex.: http://localhost:5173) |
 * | librax:googleEnabled           | true                            | Google como IdP |
 * | librax:googleClientIdParam     | /librax/google/client-id        | SSM (String) com o client id |
 * | librax:googleClientSecretName  | librax/google/client-secret     | Secrets Manager com o client secret |
 * | librax:appleEnabled            | false                           | Apple como IdP (opcional) |
 * | librax:apple*                  | /librax/apple/...               | SSM e Secrets Manager do Sign in with Apple |
 * | librax:vapidPublicKeyParam     | /librax/vapid/public-key        | SSM (String) |
 * | librax:vapidPrivateKeyParam    | /librax/vapid/private-key       | SSM (SecureString) |
 * | librax:vapidSubject            | mailto:contato@<domainName>     | contato VAPID |
 * | librax:emailRemindersEnabled   | false                           | liga o lembrete por e-mail (SES) |
 * | librax:emailFrom               | lembretes@<domainName>          | remetente verificado no SES |
 * | librax:cspReportOnly           | false                           | manda a CSP como Report-Only (diagnostico) |
 * | librax:extraAdminCallbackUrls  | (vazio)                         | callbacks extras do painel (ex.: http://localhost:5310/admin/auth/callback) |
 * | librax:extraAdminLogoutUrls    | (vazio)                         | logouts extras do painel |
 * | librax:alarmEmail              | (vazio)                         | e-mail que recebe os alarmes (SNS); sem ele o topico fica sem assinatura |
 * | librax:budgetEmail             | = alarmEmail                    | e-mail dos avisos do AWS Budget (80% e 100%) |
 * | librax:monthlyBudgetUsd        | 10                              | valor mensal do AWS Budget, em dolares |
 *
 * Os e-mails nunca ficam no codigo: passe por contexto (`-c librax:alarmEmail=...`) ou no
 * cdk.context.json local, que nao vai para o repositorio.
 */
export interface LibraxConfig {
  domainName: string;
  authDomainName: string;
  certificateArn?: string;
  cognitoDomainPrefix: string;
  hostedZone?: { id: string; name: string };
  extraCallbackUrls: string[];
  extraLogoutUrls: string[];
  extraCorsOrigins: string[];
  google: { enabled: boolean; clientIdParam: string; clientSecretName: string };
  apple: {
    enabled: boolean;
    servicesIdParam: string;
    teamIdParam: string;
    keyIdParam: string;
    privateKeySecretName: string;
  };
  vapid: { publicKeyParam: string; privateKeyParam: string; subject: string };
  email: { enabled: boolean; from: string };
  cspReportOnly: boolean;
  extraAdminCallbackUrls: string[];
  extraAdminLogoutUrls: string[];
  alarms: { email?: string };
  budget: { email?: string; monthlyUsd: number };
}

export const PLACEHOLDER_DOMAIN = 'librax.example';

export function readConfig(node: Node): LibraxConfig {
  const str = (key: string, fallback = ''): string => {
    const v = node.tryGetContext(`librax:${key}`);
    return v === undefined || v === null || v === '' ? fallback : String(v);
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const v = node.tryGetContext(`librax:${key}`);
    if (v === undefined || v === null || v === '') return fallback;
    return v === true || v === 'true';
  };
  const list = (key: string): string[] =>
    str(key)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const domainName = str('domainName', PLACEHOLDER_DOMAIN);
  const hostedZoneId = str('hostedZoneId');
  const hostedZoneName = str('hostedZoneName');

  return {
    domainName,
    authDomainName: str('authDomainName', `auth.${domainName}`),
    certificateArn: str('certificateArn') || undefined,
    cognitoDomainPrefix: str('cognitoDomainPrefix', 'librax-example'),
    hostedZone: hostedZoneId && hostedZoneName ? { id: hostedZoneId, name: hostedZoneName } : undefined,
    extraCallbackUrls: list('extraCallbackUrls'),
    extraLogoutUrls: list('extraLogoutUrls'),
    extraCorsOrigins: list('extraCorsOrigins'),
    google: {
      enabled: bool('googleEnabled', true),
      clientIdParam: str('googleClientIdParam', '/librax/google/client-id'),
      clientSecretName: str('googleClientSecretName', 'librax/google/client-secret'),
    },
    apple: {
      enabled: bool('appleEnabled', false),
      servicesIdParam: str('appleServicesIdParam', '/librax/apple/services-id'),
      teamIdParam: str('appleTeamIdParam', '/librax/apple/team-id'),
      keyIdParam: str('appleKeyIdParam', '/librax/apple/key-id'),
      privateKeySecretName: str('applePrivateKeySecretName', 'librax/apple/private-key'),
    },
    vapid: {
      publicKeyParam: str('vapidPublicKeyParam', '/librax/vapid/public-key'),
      privateKeyParam: str('vapidPrivateKeyParam', '/librax/vapid/private-key'),
      subject: str('vapidSubject', `mailto:contato@${domainName}`),
    },
    email: {
      enabled: bool('emailRemindersEnabled', false),
      from: str('emailFrom', `lembretes@${domainName}`),
    },
    cspReportOnly: bool('cspReportOnly', false),
    extraAdminCallbackUrls: list('extraAdminCallbackUrls'),
    extraAdminLogoutUrls: list('extraAdminLogoutUrls'),
    alarms: { email: str('alarmEmail') || undefined },
    budget: {
      email: str('budgetEmail') || str('alarmEmail') || undefined,
      monthlyUsd: positiveNumber(str('monthlyBudgetUsd', '10'), 'monthlyBudgetUsd'),
    },
  };
}

function positiveNumber(raw: string, key: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`librax:${key} deve ser um numero maior que zero (veio "${raw}")`);
  return n;
}
