import { describe, expect, test } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { LibraxStack } from '../lib/librax-stack';

// Assertions sobre o template sintetizado, sem conta AWS e sem empacotar as Lambdas
// (aws:cdk:bundling-stacks vazio pula o esbuild).

const CERT = 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';

function synth(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
  const stack = new LibraxStack(app, 'LibraxStack', { env: { account: '111111111111', region: 'us-east-1' } });
  return { stack, template: Template.fromStack(stack) };
}

const withDomain = {
  'librax:domainName': 'librax.example',
  'librax:certificateArn': CERT,
};

/** Junta Fn::Join simples em string para comparar valores com tokens. */
function flat(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flat).join('');
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('Fn::Join' in obj) {
      const [sep, parts] = obj['Fn::Join'] as [string, unknown[]];
      return parts.map(flat).join(sep);
    }
    if ('Ref' in obj) return `{${obj.Ref}}`;
    return JSON.stringify(obj);
  }
  return String(value);
}

function headerPolicies(template: Template) {
  return Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy')).map(
    (r) => r.Properties.ResponseHeadersPolicyConfig,
  );
}

function behaviors(template: Template) {
  const [dist] = Object.values(template.findResources('AWS::CloudFront::Distribution'));
  return dist.Properties.DistributionConfig;
}

describe('CloudFront unico na mesma origem', () => {
  test('um CloudFront so, com /, /assets, /content, /ml, /api e /vlibras', () => {
    const { template } = synth(withDomain);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    const config = behaviors(template);
    const paths = config.CacheBehaviors.map((b: { PathPattern: string }) => b.PathPattern);
    expect(paths).toEqual(['/assets/*.wasm', '/assets/*', '/vlibras/*', '/content/*', '/ml/*.wasm', '/ml/*', '/api/*']);
    expect(config.Aliases).toEqual(['librax.example']);
    expect(config.DefaultRootObject).toBe('index.html');
  });

  test('/api/* vai para o estagio `api` da HTTP API, sem cache e com todos os metodos', () => {
    const { template } = synth(withDomain);
    const api = behaviors(template).CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === '/api/*');
    expect(api.AllowedMethods).toContain('POST');
    expect(api.AllowedMethods).toContain('DELETE');
    expect(api.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // CachingDisabled
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', { StageName: 'api', AutoDeploy: true });
  });

  test('rotas do app sem extensao caem no index.html (CloudFront Function)', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp("request.uri = '/index.html'"),
    });
    const def = behaviors(template).DefaultCacheBehavior;
    expect(def.FunctionAssociations[0].EventType).toBe('viewer-request');
  });

  test('sem certificado: sem alias e com aviso; synth continua funcionando', () => {
    const { stack, template } = synth();
    expect(behaviors(template).Aliases).toBeUndefined();
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('librax:certificateArn'));
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('placeholder'));
  });
});

describe('cache e cabecalhos', () => {
  test('index.html e sw.js (comportamento padrao) com no-cache; /assets com immutable', () => {
    const { template } = synth(withDomain);
    const policies = headerPolicies(template);
    const cacheControl = (p: { CustomHeadersConfig?: { Items: { Header: string; Value: string }[] } }) =>
      p.CustomHeadersConfig?.Items.find((h) => h.Header === 'Cache-Control')?.Value;
    const values = policies.map(cacheControl);
    expect(values).toContain('no-cache');
    expect(values).toContain('public, max-age=31536000, immutable');
  });

  test('CSP e Permissions-Policy camera=(self) nas respostas do app', () => {
    const { template } = synth(withDomain);
    const app = headerPolicies(template).find((p) => p.Comment.includes('no-cache') && p.Comment.includes('app'));
    const csp = flat(app.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain('https://auth.librax.example');
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp.length).toBeLessThan(1783); // limite do CloudFront
    const permissions = app.CustomHeadersConfig.Items.find((h: { Header: string }) => h.Header === 'Permissions-Policy');
    expect(permissions.Value).toMatch(/^camera=\(self\)/);
    expect(app.SecurityHeadersConfig.StrictTransportSecurity.AccessControlMaxAgeSec).toBe(31536000);
  });

  test('player do VLibras tem CSP propria (Unity) so em /vlibras/*', () => {
    const { template } = synth(withDomain);
    const vlibras = headerPolicies(template).find((p) => p.Comment.includes('VLibras'));
    expect(flat(vlibras.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy)).toContain('https://vlibras.gov.br');
  });

  test('.wasm sai com Content-Type application/wasm', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp('application/wasm'),
    });
    const wasm = behaviors(template).CacheBehaviors.filter((b: { PathPattern: string }) => b.PathPattern.endsWith('.wasm'));
    expect(wasm).toHaveLength(2);
    for (const b of wasm) expect(b.FunctionAssociations[0].EventType).toBe('viewer-response');
  });

  test('cspReportOnly manda a CSP como Report-Only', () => {
    const { template } = synth({ ...withDomain, 'librax:cspReportOnly': 'true' });
    const app = headerPolicies(template).find((p) => p.Comment.includes('no-cache') && p.Comment.includes('app'));
    expect(app.SecurityHeadersConfig.ContentSecurityPolicy).toBeUndefined();
    expect(app.CustomHeadersConfig.Items.map((h: { Header: string }) => h.Header)).toContain(
      'Content-Security-Policy-Report-Only',
    );
  });
});

describe('Cognito', () => {
  test('dominio proprio do Cognito vem do parametro', () => {
    const { template } = synth({ ...withDomain, 'librax:authDomainName': 'entrar.librax.example' });
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'entrar.librax.example',
      CustomDomainConfig: { CertificateArn: CERT },
    });
  });

  test('sem certificado usa prefixo amazoncognito.com', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'librax-example' });
  });

  test('cliente publico com authorization code (PKCE), SRP e callbacks do web', () => {
    const { template } = synth({ ...withDomain, 'librax:extraCallbackUrls': 'http://localhost:5173/auth/callback' });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH']),
      CallbackURLs: ['https://librax.example/auth/callback', 'http://localhost:5173/auth/callback'],
      LogoutURLs: ['https://librax.example/'],
      SupportedIdentityProviders: ['COGNITO', 'Google'],
    });
  });

  test('Google usa SSM e Secrets Manager por referencia (sem segredo no template)', () => {
    const { template } = synth(withDomain);
    const [google] = Object.values(template.findResources('AWS::Cognito::UserPoolIdentityProvider', {
      Properties: { ProviderName: 'Google' },
    }));
    const details = JSON.stringify(google.Properties.ProviderDetails);
    expect(details).toContain('{{resolve:secretsmanager:librax/google/client-secret');
    expect(details).toMatch(/Ref/); // client id: parametro SSM resolvido no deploy
    const params = template.toJSON().Parameters ?? {};
    expect(Object.values(params).some((p) => (p as { Default?: string }).Default === '/librax/google/client-id')).toBe(true);
  });

  test('Apple desligada por padrao e opcional por contexto', () => {
    synth(withDomain).template.resourcePropertiesCountIs(
      'AWS::Cognito::UserPoolIdentityProvider', { ProviderName: 'SignInWithApple' }, 0,
    );
    const { template } = synth({ ...withDomain, 'librax:appleEnabled': 'true' });
    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', { ProviderName: 'SignInWithApple' });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      SupportedIdentityProviders: ['COGNITO', 'Google', 'SignInWithApple'],
    });
  });

  test('sem Identity Pool: convidado e 100% local e a API so aceita o JWT do User Pool', () => {
    const { template } = synth(withDomain);
    template.resourceCountIs('AWS::Cognito::IdentityPool', 0);
    template.resourceCountIs('AWS::Cognito::IdentityPoolRoleAttachment', 0);
    expect(Object.keys(template.toJSON().Outputs ?? {})).not.toContain('IdentityPoolId');
  });

  test('Google pode ser desligado para um primeiro deploy sem credenciais', () => {
    const { template } = synth({ ...withDomain, 'librax:googleEnabled': 'false' });
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
  });
});

describe('API', () => {
  test('CORS restrito ao dominio do app (nunca *)', () => {
    const { template } = synth({ ...withDomain, 'librax:extraCorsOrigins': 'http://localhost:5173' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowOrigins: ['https://librax.example', 'http://localhost:5173'] }),
    });
  });

  test('rotas novas com autorizador JWT', () => {
    const { template } = synth(withDomain);
    for (const routeKey of [
      'POST /v1/guest/migrate',
      'POST /v1/push/subscriptions',
      'DELETE /v1/push/subscriptions/{subscriptionId}',
      'PUT /v1/notifications/preferences',
      'POST /v1/lesson/complete',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: routeKey, AuthorizationType: 'JWT' });
    }
  });

  test('Lambdas em Node 22 ARM com a tabela no ambiente', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-migrate-guest',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Handler: 'index.migrateGuestHandler',
    });
  });
});

describe('Web Push, lembretes e e-mail', () => {
  test('tabela com GSI6 (lembretes) e TTL', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'GSI6' })]),
    });
  });

  test('Lambda de lembrete com VAPID vindo do SSM e disparo de hora em hora', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-reminders',
      Environment: {
        Variables: Match.objectLike({
          VAPID_PUBLIC_KEY_PARAM: '/librax/vapid/public-key',
          VAPID_PRIVATE_KEY_PARAM: '/librax/vapid/private-key',
          EMAIL_REMINDERS_ENABLED: 'false',
        }),
      },
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'librax-reminders-hourly',
      ScheduleExpression: 'cron(0 * * * ? *)',
    });
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('parameter/librax/vapid/private-key');
    expect(policies).not.toContain('ses:SendEmail');
  });

  test('e-mail SES so com opt-in de infraestrutura ligado', () => {
    const { template } = synth({ ...withDomain, 'librax:emailRemindersEnabled': 'true' });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-reminders',
      Environment: {
        Variables: Match.objectLike({ EMAIL_REMINDERS_ENABLED: 'true', EMAIL_FROM: 'lembretes@librax.example' }),
      },
    });
    expect(JSON.stringify(template.findResources('AWS::IAM::Policy'))).toContain('ses:SendEmail');
  });
});

describe('DNS opcional', () => {
  test('com zona do Route 53 cria A/AAAA do app e A do Cognito', () => {
    const { template } = synth({
      ...withDomain,
      'librax:hostedZoneId': 'Z0000000000000000000',
      'librax:hostedZoneName': 'librax.example',
    });
    template.resourcePropertiesCountIs('AWS::Route53::RecordSet', { Name: 'librax.example.' }, 2);
    template.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'auth.librax.example.', Type: 'A' });
  });
});

describe('Ligas semanais', () => {
  test('agenda de segunda 00:05 UTC chama a Lambda de fechamento sem leagueId no evento', () => {
    const { template } = synth(withDomain);
    const [fnId] = Object.keys(template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'librax-close-league' },
    }));
    expect(fnId).toBeDefined();
    const [schedule] = Object.values(template.findResources('AWS::Scheduler::Schedule', {
      Properties: { Name: 'librax-close-league-weekly' },
    }));
    expect(schedule.Properties.ScheduleExpression).toBe('cron(5 0 ? * MON *)');
    expect(schedule.Properties.ScheduleExpressionTimezone).toBe('UTC');
    expect(schedule.Properties.Target.Arn).toEqual({ 'Fn::GetAtt': [fnId, 'Arn'] });
    expect(schedule.Properties.Target.Input).toBeUndefined();
  });

  test('rotas de leitura da liga e de resultado visto, com JWT e Lambda propria', () => {
    const { template } = synth(withDomain);
    for (const [routeKey, functionName, handler] of [
      ['GET /v1/league/current', 'librax-get-league', 'index.getCurrentLeagueHandler'],
      ['POST /v1/league/result-seen', 'librax-league-result-seen', 'index.markLeagueResultSeenHandler'],
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: routeKey, AuthorizationType: 'JWT' });
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        Handler: handler,
        Runtime: 'nodejs22.x',
        Environment: { Variables: Match.objectLike({ LIBRAX_TABLE: Match.anyValue() }) },
      });
    }
  });

  test('as Lambdas da liga podem ler e escrever na tabela', () => {
    const { template } = synth(withDomain);
    const fns = template.findResources('AWS::Lambda::Function');
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    for (const name of ['librax-get-league', 'librax-league-result-seen']) {
      const [, fn] = Object.entries(fns).find(([, r]) => r.Properties.FunctionName === name)!;
      const roleRef = fn.Properties.Role['Fn::GetAtt'][0];
      const policy = policies.find((p) => p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleRef));
      const actions = policy!.Properties.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) => s.Action);
      expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query']));
    }
  });

  test('fechamento usa o GSI2 existente (sem indice novo): GSI1 a GSI6', () => {
    const { template } = synth(withDomain);
    const [table] = Object.values(template.findResources('AWS::DynamoDB::Table'));
    const names = table.Properties.GlobalSecondaryIndexes.map((g: { IndexName: string }) => g.IndexName);
    expect(names).toEqual(['GSI1', 'GSI2', 'GSI3', 'GSI4', 'GSI5', 'GSI6']);
    const gsi2 = table.Properties.GlobalSecondaryIndexes.find((g: { IndexName: string }) => g.IndexName === 'GSI2');
    expect(gsi2.KeySchema).toEqual([
      { AttributeName: 'GSI2PK', KeyType: 'HASH' },
      { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
    ]);
    expect(gsi2.Projection).toEqual({ ProjectionType: 'ALL' });
  });
});
