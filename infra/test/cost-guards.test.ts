import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { LibraxStack } from '../lib/librax-stack';
import {
  anomalyThresholdUsd,
  API_STAGE_THROTTLE,
  DYNAMO_MAX_READ_UNITS,
  DYNAMO_MAX_WRITE_UNITS,
  RESERVED_CONCURRENCY,
  RESERVED_CONCURRENCY_TOTAL,
  ROUTE_THROTTLES,
} from '../lib/cost-guards';
import { appCsp } from '../lib/web-headers';

// Travas de custo e o segundo fator do painel (revisao de seguranca e custo). Tudo sem conta AWS: so o
// template sintetizado, comparado com o que a main sintetizava antes (test/fixtures).

const CERT = 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';
const base = {
  'librax:domainName': 'librax.example',
  'librax:certificateArn': CERT,
  'librax:alarmEmail': 'alertas@exemplo.com',
};
const MONITOR = 'arn:aws:ce::111111111111:anomalymonitor/0a1b2c3d-1234-4abc-8def-0123456789ab';

function synth(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...base, ...context } });
  const stack = new LibraxStack(app, 'LibraxStack', { env: { account: '111111111111', region: 'us-east-1' } });
  return { stack, template: Template.fromStack(stack) };
}

type Resource = { Type: string; Properties: Record<string, any>; DependsOn?: string[]; DeletionPolicy?: string };
const resources = (template: Template) => template.toJSON().Resources as Record<string, Resource>;
const ofType = (template: Template, type: string) =>
  Object.entries(resources(template)).filter(([, r]) => r.Type === type);

/** Recursos da main antes desta revisao (mesmo contexto), para provar a atualizacao no lugar. */
const before = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'antes-da-revisao-de-custo.json'), 'utf8'),
) as Record<'pool' | 'clients' | 'table' | 'stage' | 'buckets', Record<string, Resource>>;

/** Propriedades que mudaram de um recurso (mesmo logical id) entre a main e agora. */
function changedProps(old: Resource, now: Resource): string[] {
  const keys = new Set([...Object.keys(old.Properties), ...Object.keys(now.Properties)]);
  return [...keys].filter((k) => JSON.stringify(old.Properties[k]) !== JSON.stringify(now.Properties[k])).sort();
}

describe('atualizacao no lugar (mesmo logical id, so propriedades "No interruption" no CloudFormation)', () => {
  const { template } = synth();
  const now = resources(template);

  test('User Pool: so MfaConfiguration, EnabledMfas, DeletionProtection, o gatilho e a etiqueta mudam', () => {
    const [[id, old]] = Object.entries(before.pool);
    expect(now[id]?.Type).toBe('AWS::Cognito::UserPool');
    expect(ofType(template, 'AWS::Cognito::UserPool')).toHaveLength(1);
    // Todas "Update requires: No interruption" em AWS::Cognito::UserPool (LambdaConfig: o gatilho
    // PreSignUp, uma pessoa, uma conta; UserPoolTags: a etiqueta do projeto, lib/tags.ts)
    expect(changedProps(old, now[id])).toEqual(['DeletionProtection', 'EnabledMfas', 'LambdaConfig', 'MfaConfiguration', 'UserPoolTags']);
    expect(now[id].DeletionPolicy).toBe('Retain');
  });

  test('app clients: o do app igual; o do painel troca o login hospedado pelo SRP, no lugar', () => {
    // Propriedades de AWS::Cognito::UserPoolClient com "Update requires: No interruption". So
    // GenerateSecret e UserPoolId trocam o client (e o AdminClientId do build do painel).
    const NO_INTERRUPTION = new Set([
      'AllowedOAuthFlows', 'AllowedOAuthFlowsUserPoolClient', 'AllowedOAuthScopes', 'CallbackURLs', 'EnableTokenRevocation',
      'ExplicitAuthFlows', 'LogoutURLs', 'SupportedIdentityProviders',
    ]);
    for (const [id, old] of Object.entries(before.clients)) {
      expect(now[id]?.Type, id).toBe('AWS::Cognito::UserPoolClient');
      const changed = changedProps(old, now[id]);
      if (old.Properties.ClientName === 'librax-admin') {
        // Login com tela propria (apps/admin-web): SRP + refresh pela API do User Pool, sem OAuth,
        // callbacks nem Google, e com a revogacao do refresh token ao sair
        expect(changed).toEqual([
          'AllowedOAuthFlows', 'AllowedOAuthFlowsUserPoolClient', 'AllowedOAuthScopes', 'CallbackURLs', 'EnableTokenRevocation',
          'ExplicitAuthFlows', 'LogoutURLs', 'SupportedIdentityProviders',
        ]);
        expect(changed.every((k) => NO_INTERRUPTION.has(k))).toBe(true);
        const p = now[id].Properties;
        expect(p.ExplicitAuthFlows).toEqual(['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']);
        expect(p.AllowedOAuthFlowsUserPoolClient).toBe(false);
        expect(p.AllowedOAuthFlows ?? p.AllowedOAuthScopes ?? p.CallbackURLs ?? p.LogoutURLs).toBeUndefined();
        expect(p.SupportedIdentityProviders).toEqual(['COGNITO']);
        expect(p.EnableTokenRevocation).toBe(true);
        // o que troca o client continua igual, e os prazos dos tokens tambem
        for (const k of ['ClientName', 'GenerateSecret', 'UserPoolId', 'AccessTokenValidity', 'IdTokenValidity', 'RefreshTokenValidity', 'PreventUserExistenceErrors']) {
          expect(p[k], k).toEqual(old.Properties[k]);
        }
      } else {
        expect(changed).toEqual([]);
      }
    }
  });

  test('tabela: so OnDemandThroughput e a etiqueta mudam', () => {
    const [[id, old]] = Object.entries(before.table);
    expect(changedProps(old, now[id])).toEqual(['OnDemandThroughput', 'Tags']);
    expect(now[id].DeletionPolicy).toBe('Retain');
  });

  test('estagio da API: so os limites e a etiqueta mudam', () => {
    const [[id, old]] = Object.entries(before.stage);
    expect(changedProps(old, now[id])).toEqual(['DefaultRouteSettings', 'RouteSettings', 'Tags']);
  });

  test('buckets: so a regra de ciclo de vida e a etiqueta mudam', () => {
    for (const [id, old] of Object.entries(before.buckets)) {
      expect(changedProps(old, now[id])).toEqual(['LifecycleConfiguration', 'Tags']);
    }
  });
});

describe('API Gateway: limite global e por rota', () => {
  test('global 50/s com rajada 200 e as rotas pesadas com limite proprio', () => {
    const { template } = synth();
    const [[stageId, stage]] = ofType(template, 'AWS::ApiGatewayV2::Stage');
    expect(stage.Properties.DefaultRouteSettings).toEqual({
      ThrottlingRateLimit: API_STAGE_THROTTLE.rateLimit,
      ThrottlingBurstLimit: API_STAGE_THROTTLE.burstLimit,
    });
    expect(stage.Properties.RouteSettings['POST /v1/guest/migrate']).toEqual({ ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 });
    expect(Object.keys(stage.Properties.RouteSettings).sort()).toEqual(Object.keys(ROUTE_THROTTLES).sort());
    // cada rota com limite existe e o estagio so e criado depois dela (o API Gateway recusa rota inexistente)
    const routes = ofType(template, 'AWS::ApiGatewayV2::Route');
    for (const routeKey of Object.keys(ROUTE_THROTTLES)) {
      const route = routes.find(([, r]) => r.Properties.RouteKey === routeKey);
      expect(route, routeKey).toBeDefined();
      expect(stage.DependsOn).toContain(route![0]);
      const limit = stage.Properties.RouteSettings[routeKey];
      expect(limit.ThrottlingRateLimit).toBeLessThanOrEqual(API_STAGE_THROTTLE.rateLimit);
    }
    expect(stageId).toBeTruthy();
  });
});

describe('Lambda: concorrencia reservada opcional', () => {
  const reservas = (template: Template) =>
    Object.fromEntries(
      ofType(template, 'AWS::Lambda::Function')
        .filter(([, r]) => r.Properties.ReservedConcurrentExecutions !== undefined)
        .map(([, r]) => [r.Properties.FunctionName, r.Properties.ReservedConcurrentExecutions]),
    );

  test('desligada por padrao (conta nova pode ter cota 10 e o deploy falharia)', () => {
    expect(reservas(synth().template)).toEqual({});
  });

  test('ligada: cada Lambda da API com o seu teto; gatilhos do Cognito e jobs sem reserva', () => {
    const { template } = synth({ 'librax:lambdaReservedConcurrency': 'true' });
    const r = reservas(template);
    expect(r).toEqual(RESERVED_CONCURRENCY);
    expect(r['librax-migrate-guest']).toBe(2);
    for (const name of ['librax-post-confirmation', 'librax-custom-message', 'librax-pre-signup', 'librax-close-league', 'librax-reminders', 'librax-ops-daily']) {
      expect(r[name]).toBeUndefined();
    }
    // toda Lambda com reserva existe na stack (nome errado no mapa nao passa calado)
    const names = ofType(template, 'AWS::Lambda::Function').map(([, f]) => f.Properties.FunctionName);
    for (const name of Object.keys(RESERVED_CONCURRENCY)) expect(names).toContain(name);
    expect(RESERVED_CONCURRENCY_TOTAL).toBe(Object.values(r).reduce((a, b) => a + b, 0));
  });
});

describe('DynamoDB: teto de vazao sob demanda', () => {
  test('500 leituras e 200 escritas por segundo, coberto pelo alarme de throttling', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      OnDemandThroughput: { MaxReadRequestUnits: DYNAMO_MAX_READ_UNITS, MaxWriteRequestUnits: DYNAMO_MAX_WRITE_UNITS },
    });
    const [, alarm] = ofType(template, 'AWS::CloudWatch::Alarm').find(([, a]) => a.Properties.AlarmName === 'librax-dynamodb-throttles')!;
    const metrics = alarm.Properties.Metrics.filter((m: { MetricStat?: unknown }) => m.MetricStat)
      .map((m: { MetricStat: { Metric: { MetricName: string; Dimensions: { Name: string }[] } } }) => m.MetricStat.Metric);
    // so a dimensao TableName: conta o throttling da tabela inteira, inclusive o do teto sob demanda
    for (const m of metrics) expect(m.Dimensions.map((d) => d.Name)).toEqual(['TableName']);
  });
});

describe('S3: versoes antigas expiram', () => {
  test('os 4 buckets versionados apagam versao nao atual em 30 dias e envio incompleto em 7', () => {
    const { template } = synth();
    const buckets = ofType(template, 'AWS::S3::Bucket');
    expect(buckets).toHaveLength(4);
    for (const [, b] of buckets) {
      expect(b.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' });
      expect(b.Properties.LifecycleConfiguration.Rules).toEqual([
        {
          Id: 'versoes-antigas-30-dias',
          Status: 'Enabled',
          NoncurrentVersionExpiration: { NoncurrentDays: 30 },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ]);
    }
  });
});

describe('CloudFront: alarme de download do app', () => {
  test('BytesDownloaded do CloudFront do app, por hora, no topico de alarmes', () => {
    const { template } = synth();
    const [, alarm] = ofType(template, 'AWS::CloudWatch::Alarm').find(([, a]) => a.Properties.AlarmName === 'librax-app-download')!;
    const appDist = ofType(template, 'AWS::CloudFront::Distribution')
      .find(([, d]) => d.Properties.DistributionConfig.Comment.startsWith('Librax - app'))!;
    expect(alarm.Properties).toMatchObject({
      Namespace: 'AWS/CloudFront',
      MetricName: 'BytesDownloaded',
      Statistic: 'Sum',
      Period: 3600,
      Threshold: 5 * 1024 ** 3,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
    expect(alarm.Properties.Dimensions).toEqual(expect.arrayContaining([
      { Name: 'DistributionId', Value: { Ref: appDist[0] } },
      { Name: 'Region', Value: 'Global' },
    ]));
    const [topicId] = ofType(template, 'AWS::SNS::Topic')[0];
    expect(alarm.Properties.AlarmActions).toEqual([{ Ref: topicId }]);
  });

  test('limite por contexto', () => {
    const { template } = synth({ 'librax:appDownloadAlarmGbPerHour': '12' });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: 'librax-app-download', Threshold: 12 * 1024 ** 3 });
    expect(() => synth({ 'librax:appDownloadAlarmGbPerHour': 'muito' })).toThrow(/appDownloadAlarmGbPerHour/);
  });
});

describe('custo: orcamento com previsao e anomalia', () => {
  test('nome do orcamento muda quando o e-mail ou os avisos mudam (troca sem travar o deploy)', () => {
    const name = (email: string) => {
      const [, b] = ofType(synth({ 'librax:alarmEmail': email }).template, 'AWS::Budgets::Budget')[0];
      return b.Properties.Budget.BudgetName as string;
    };
    expect(name('a@exemplo.com')).toMatch(/^librax-mensal-[0-9a-f]{8}$/);
    expect(name('a@exemplo.com')).toBe(name('a@exemplo.com'));
    expect(name('a@exemplo.com')).not.toBe(name('b@exemplo.com'));
  });

  test('anomalia desligada por padrao', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::CE::AnomalyMonitor', 0);
    template.resourceCountIs('AWS::CE::AnomalySubscription', 0);
  });

  test('create: monitor de servicos e resumo diario por e-mail acima de 20% do orcamento', () => {
    const { template } = synth({ 'librax:costAnomalyAlerts': 'create', 'librax:monthlyBudgetUsd': '10' });
    const [[monitorId]] = ofType(template, 'AWS::CE::AnomalyMonitor');
    template.hasResourceProperties('AWS::CE::AnomalyMonitor', { MonitorType: 'DIMENSIONAL', MonitorDimension: 'SERVICE' });
    const [, sub] = ofType(template, 'AWS::CE::AnomalySubscription')[0];
    expect(sub.Properties).toMatchObject({
      Frequency: 'DAILY',
      MonitorArnList: [{ 'Fn::GetAtt': [monitorId, 'MonitorArn'] }],
      Subscribers: [{ Type: 'EMAIL', Address: 'alertas@exemplo.com' }],
    });
    expect(JSON.parse(sub.Properties.ThresholdExpression)).toEqual({
      Dimensions: { Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE', MatchOptions: ['GREATER_THAN_OR_EQUAL'], Values: ['2'] },
    });
    expect(anomalyThresholdUsd(1)).toBe(1);
  });

  test('ARN de um monitor que ja existe: so a assinatura, sem monitor novo', () => {
    const { template } = synth({ 'librax:costAnomalyAlerts': MONITOR });
    template.resourceCountIs('AWS::CE::AnomalyMonitor', 0);
    template.hasResourceProperties('AWS::CE::AnomalySubscription', { MonitorArnList: [MONITOR] });
  });

  test('valor invalido para o synth; sem e-mail, sem alerta e com aviso', () => {
    expect(() => synth({ 'librax:costAnomalyAlerts': 'sim' })).toThrow(/costAnomalyAlerts/);
    const app = new cdk.App({
      context: { 'aws:cdk:bundling-stacks': [], 'librax:domainName': 'librax.example', 'librax:costAnomalyAlerts': 'create' },
    });
    const stack = new LibraxStack(app, 'LibraxStack', { env: { account: '111111111111', region: 'us-east-1' } });
    Template.fromStack(stack).resourceCountIs('AWS::CE::AnomalySubscription', 0);
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('costAnomalyAlerts'));
  });
});

describe('Cognito: segundo fator e protecao', () => {
  test('MFA opcional so por aplicativo autenticador (nunca SMS) e User Pool protegido contra exclusao', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      DeletionProtection: 'ACTIVE',
      SmsConfiguration: Match.absent(),
    });
  });

  test('a Lambda do painel le o fator da conta (AdminGetUser) so no proprio User Pool', () => {
    const { template } = synth();
    const [, fn] = ofType(template, 'AWS::Lambda::Function').find(([, f]) => f.Properties.FunctionName === 'librax-admin')!;
    const roleId = fn.Properties.Role['Fn::GetAtt'][0];
    const statements = ofType(template, 'AWS::IAM::Policy')
      .filter(([, p]) => p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleId))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    const st = statements.find((s: { Action: string | string[] }) => [s.Action].flat().includes('cognito-idp:AdminGetUser'));
    expect(JSON.stringify(st.Resource)).toContain('LibraxUserPool');
    // nenhuma outra Lambda le o usuario, fora a das acoes do painel (mesmo envelope com o segundo fator)
    const [, actionsFn] = ofType(template, 'AWS::Lambda::Function').find(([, f]) => f.Properties.FunctionName === 'librax-admin-actions')!;
    const actionsRoleId = actionsFn.Properties.Role['Fn::GetAtt'][0];
    const others = ofType(template, 'AWS::IAM::Policy')
      .filter(([, p]) => !p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleId || r.Ref === actionsRoleId))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement)
      .flatMap((s: { Action: string | string[] }) => [s.Action].flat());
    expect(others).not.toContain('cognito-idp:AdminGetUser');
  });
});

describe('CSP do app sem CDN de terceiros', () => {
  test('MediaPipe vem de /ml/: sem jsDelivr e sem storage.googleapis.com', () => {
    const csp = appCsp('https://auth.librax.example', 'https://cognito-idp.us-east-1.amazonaws.com');
    expect(csp).not.toContain('jsdelivr');
    expect(csp).not.toContain('googleapis');
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval';/);
    // os videos de referencia continuam (dicionarios publicos)
    expect(csp).toContain('https://dicionario.ines.gov.br');
  });
});
