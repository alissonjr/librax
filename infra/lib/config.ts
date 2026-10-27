import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { Node } from 'constructs';
import { APP_DOWNLOAD_ALARM_GB_PER_HOUR } from './cost-guards';
import { DEFAULT_ANDROID_PACKAGE, normalizeFingerprint, validPackageName } from './assetlinks';

/**
 * Parametros de contexto do CDK (cdk.json ou `-c chave=valor`).
 *
 * O dominio e `librax.online`, fixado no infra/cdk.json. Sem ele, o padrao do codigo e o
 * placeholder `librax.example` (TLD reservado, RFC 2606), que gera aviso no synth. O cdk.json
 * vale mais que o cdk.context.json (ordem do CDK): conta, zona, certificado e e-mails ficam so no
 * cdk.context.json local. Lancamento: docs/lancamento.md.
 *
 * | chave                          | padrao                          | uso |
 * |--------------------------------|---------------------------------|-----|
 * | librax:accountId               | (vazio)                         | conta AWS do Librax; deploy, diff e bootstrap recusam outra conta |
 * | librax:domainName              | librax.example                  | dominio raiz; os nomes abaixo partem dele |
 * | librax:appDomainName           | app.<domainName>                | dominio do app (CloudFront do app, /api e /admin) |
 * | librax:landingDomainName       | <domainName>                    | dominio da landing (CloudFront proprio) |
 * | librax:wwwDomainName           | www.<landingDomainName>         | redireciona para a landing; `none` desliga |
 * | librax:landingDistDir          | ../apps/landing/dist            | build da landing; o synth tira dele o hash do script inline da CSP |
 * | librax:authDomainName          | auth.<domainName>               | dominio proprio do Cognito |
 * | librax:certificateArn          | (vazio)                         | ACM em us-east-1 cobrindo todos os nomes acima; sem ele, sem dominio proprio |
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
 * | librax:cognitoEmailSes         | false                           | codigos do login (cadastro e nova senha) saem pelo SES, nao pelo envio padrao do Cognito (50 por dia); liga tambem o aviso de acesso num aparelho novo |
 * | librax:cognitoEmailFrom        | nao-responda@<domainName>       | remetente desses codigos; o dominio dele precisa estar verificado no SES (us-east-1) |
 * | librax:cognitoEmailFromName    | Librax                          | nome que aparece como remetente |
 * | librax:cognitoEmailReplyTo     | (vazio)                         | endereco de resposta (opcional) |
 * | librax:cspReportOnly           | false                           | manda a CSP como Report-Only (diagnostico) |
 * | librax:mediapipeVersion        | a do apps/web-poc/package.json  | pasta /ml/<versao>/ com cache imutavel; o resto de /ml/ revalida |
 * | librax:alarmEmail              | (vazio)                         | e-mail que recebe os alarmes (SNS); sem ele o topico fica sem assinatura |
 * | librax:budgetEmail             | = alarmEmail                    | e-mail dos avisos do AWS Budget (80% e 100%) |
 * | librax:monthlyBudgetUsd        | 10                              | valor mensal do AWS Budget, em dolares |
 * | librax:androidPackageName      | br.com.librax.app               | pacote do app Android (TWA) no assetlinks.json |
 * | librax:androidCertFingerprints | (vazio)                         | SHA-256 dos certificados do app Android, separados por virgula (upload e Play App Signing) |
 * | librax:lambdaReservedConcurrency | false                         | reserva concorrencia por Lambda da API (lib/cost-guards.ts); so ligue com a cota da conta em 1000 |
 * | librax:costAnomalyAlerts       | off                             | alerta de anomalia de custo por e-mail: off, create (cria o monitor) ou o ARN de um monitor que ja existe |
 * | librax:appDownloadAlarmGbPerHour | 5                             | alarme de download do CloudFront do app, em GB por hora |
 *
 * Os e-mails nunca ficam no codigo: passe por contexto (`-c librax:alarmEmail=...`) ou no
 * cdk.context.json local, que nao vai para o repositorio.
 */
export interface LibraxConfig {
  domainName: string;
  appDomainName: string;
  landing: { domainName: string; redirectDomainNames: string[]; distDir: string };
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
  /**
   * Envio dos e-mails do Cognito (codigo de cadastro e de nova senha). Desligado, fica o envio padrao
   * do Cognito (remetente no-reply do verificationemail.com, 50 por dia). Ligado, sai pelo SES com o remetente do
   * dominio verificado. Vale para qualquer texto: os campos do User Pool ou um gatilho Custom Message.
   */
  cognitoEmail: { ses: boolean; from: string; fromName: string; replyTo?: string; sesRegion: string };
  cspReportOnly: boolean;
  /**
   * Versao do @mediapipe/tasks-vision do app: so /ml/<versao>/ tem cache imutavel. As pastas de modelo
   * sem versao no caminho (classifier, sinais, letras-mov, numeros...) revalidam a cada pedido.
   */
  mediapipeVersion?: string;
  alarms: { email?: string };
  budget: { email?: string; monthlyUsd: number };
  /** App Android (TWA, apps/android-twa): o que vai no /.well-known/assetlinks.json do app. */
  android: { packageName: string; certFingerprints: string[] };
  /** Concorrencia reservada nas Lambdas da API (lib/cost-guards.ts). Desligada por padrao. */
  lambdaReservedConcurrency: boolean;
  /**
   * Cost Anomaly Detection: `off` (padrao), `create` (a stack cria o monitor de servicos) ou o ARN de um
   * monitor que ja existe na conta (a AWS cria um sozinha quando o Cost Explorer e ativado, e so cabe
   * um monitor de servicos por conta). O script de lancamento escolhe sozinho, so lendo a conta.
   */
  costAnomaly: { mode: 'off' } | { mode: 'create' } | { mode: 'existing'; monitorArn: string };
  appDownloadAlarmGbPerHour: number;
}

export const PLACEHOLDER_DOMAIN = 'librax.example';
export const COGNITO_SES_REGION = 'us-east-1';

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
  const appDomainName = str('appDomainName', `app.${domainName}`);
  const landingDomainName = str('landingDomainName', domainName);
  const www = str('wwwDomainName', `www.${landingDomainName}`);
  // Dois CloudFront nao podem ter o mesmo nome
  if (appDomainName === landingDomainName) {
    throw new Error(`librax:appDomainName e librax:landingDomainName precisam ser diferentes (os dois vieram "${appDomainName}")`);
  }

  return {
    domainName,
    appDomainName,
    landing: {
      domainName: landingDomainName,
      redirectDomainNames: www === 'none' ? [] : [www],
      distDir: path.resolve(str('landingDistDir', path.join(__dirname, '..', '..', 'apps', 'landing', 'dist'))),
    },
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
    cognitoEmail: {
      ses: bool('cognitoEmailSes', false),
      from: emailAddress(str('cognitoEmailFrom', `nao-responda@${domainName}`), 'cognitoEmailFrom'),
      fromName: str('cognitoEmailFromName', 'Librax'),
      replyTo: str('cognitoEmailReplyTo') ? emailAddress(str('cognitoEmailReplyTo'), 'cognitoEmailReplyTo') : undefined,
      // A identidade do SES fica na mesma regiao da stack (us-east-1)
      sesRegion: COGNITO_SES_REGION,
    },
    cspReportOnly: bool('cspReportOnly', false),
    mediapipeVersion: semver(str('mediapipeVersion') || appMediapipeVersion()),
    alarms: { email: str('alarmEmail') || undefined },
    budget: {
      email: str('budgetEmail') || str('alarmEmail') || undefined,
      monthlyUsd: positiveNumber(str('monthlyBudgetUsd', '10'), 'monthlyBudgetUsd'),
    },
    android: {
      packageName: androidPackage(str('androidPackageName', DEFAULT_ANDROID_PACKAGE)),
      certFingerprints: [...new Set(list('androidCertFingerprints').map(fingerprint))],
    },
    lambdaReservedConcurrency: bool('lambdaReservedConcurrency', false),
    costAnomaly: costAnomaly(str('costAnomalyAlerts', 'off')),
    appDownloadAlarmGbPerHour: positiveNumber(str('appDownloadAlarmGbPerHour', String(APP_DOWNLOAD_ALARM_GB_PER_HOUR)), 'appDownloadAlarmGbPerHour'),
  };
}

const ANOMALY_MONITOR_ARN = /^arn:aws:ce::\d{12}:anomalymonitor\/[0-9a-f-]{36}$/;

function costAnomaly(raw: string): LibraxConfig['costAnomaly'] {
  if (raw === 'off' || raw === 'false') return { mode: 'off' };
  if (raw === 'create' || raw === 'true') return { mode: 'create' };
  if (ANOMALY_MONITOR_ARN.test(raw)) return { mode: 'existing', monitorArn: raw };
  throw new Error(
    `librax:costAnomalyAlerts deve ser off, create ou o ARN de um monitor (arn:aws:ce::<conta>:anomalymonitor/<id>); veio "${raw}"`,
  );
}

function androidPackage(name: string): string {
  if (!validPackageName(name)) throw new Error(`librax:androidPackageName invalido (veio "${name}"); exemplo: br.com.librax.app`);
  return name;
}

function fingerprint(raw: string): string {
  const value = normalizeFingerprint(raw);
  if (!value) {
    throw new Error(
      `librax:androidCertFingerprints: "${raw}" nao e um SHA-256 (32 bytes, como AB:CD:...); ` +
        'use o SHA-256 do keytool ou do Play Console, nao o SHA-1',
    );
  }
  return value;
}

function emailAddress(raw: string, key: string): string {
  if (!/^[^@\s"]+@[^@\s"]+\.[^@\s"]+$/.test(raw)) throw new Error(`librax:${key} precisa ser um e-mail (veio "${raw}")`);
  return raw;
}

function positiveNumber(raw: string, key: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`librax:${key} deve ser um numero maior que zero (veio "${raw}")`);
  return n;
}

/** Versao fixada do @mediapipe/tasks-vision no app (a mesma pasta que o scripts/ml-assets.mjs gera). */
export function appMediapipeVersion(
  pkgPath = path.join(__dirname, '..', '..', 'apps', 'web-poc', 'package.json'),
): string | undefined {
  if (!existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.dependencies?.['@mediapipe/tasks-vision'];
}

/** So versao exata (1.2.3) vira pasta imutavel; `^1.2.3` ou vazio, nenhuma. */
function semver(raw: string | undefined): string | undefined {
  return raw && /^\d+\.\d+\.\d+$/.test(raw) ? raw : undefined;
}
