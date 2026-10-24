import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readPlan, resolveValue, issuerFor } from '../local/template.mjs';

// Ambiente local (docs/ambiente-local.md): o plano sai do template sintetizado da infra, sem lista
// de rotas escrita a mao. Template minimo com o formato que o CDK gera.

const fn = (name, handler, env = {}) => ({
  Type: 'AWS::Lambda::Function',
  Properties: { FunctionName: name, Handler: `index.${handler}`, Environment: { Variables: { LIBRAX_TABLE: { Ref: 'Table' }, ...env } } },
});
const route = (id, routeKey, integration, authorizer) => ({
  [id]: {
    Type: 'AWS::ApiGatewayV2::Route',
    Properties: {
      RouteKey: routeKey,
      AuthorizationType: 'JWT',
      AuthorizerId: { Ref: authorizer },
      Target: { 'Fn::Join': ['', ['integrations/', { Ref: integration }]] },
    },
  },
});
const integration = (id, fnId) => ({
  [id]: { Type: 'AWS::ApiGatewayV2::Integration', Properties: { IntegrationUri: { 'Fn::GetAtt': [fnId, 'Arn'] }, PayloadFormatVersion: '2.0' } },
});
const authorizer = (id, client) => ({
  [id]: {
    Type: 'AWS::ApiGatewayV2::Authorizer',
    Properties: {
      AuthorizerType: 'JWT',
      Name: id,
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: { Audience: [{ Ref: client }], Issuer: { 'Fn::GetAtt': ['Pool', 'ProviderURL'] } },
    },
  },
});

const template = {
  Resources: {
    Table: {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: 'librax',
        KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }],
        BillingMode: 'PAY_PER_REQUEST',
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      },
    },
    Pool: {
      Type: 'AWS::Cognito::UserPool',
      Properties: { UserPoolName: 'librax-users', UserPoolTier: 'LITE', LambdaConfig: { PostConfirmation: { 'Fn::GetAtt': ['PostFn', 'Arn'] } } },
    },
    AppClient: {
      Type: 'AWS::Cognito::UserPoolClient',
      Properties: {
        UserPoolId: { Ref: 'Pool' },
        CallbackURLs: ['https://librax.example/auth/callback', { 'Fn::Join': ['', ['https://', { 'Fn::GetAtt': ['Cdn', 'DomainName'] }, '/auth/callback']] }, 'http://127.0.0.1:5320/auth/callback'],
        LogoutURLs: ['https://librax.example/'],
      },
    },
    AdminClient: { Type: 'AWS::Cognito::UserPoolClient', Properties: { UserPoolId: { Ref: 'Pool' }, ClientName: 'librax-admin' } },
    Group: { Type: 'AWS::Cognito::UserPoolGroup', Properties: { UserPoolId: { Ref: 'Pool' }, GroupName: 'admin', Precedence: 0 } },
    Api: { Type: 'AWS::ApiGatewayV2::Api', Properties: { Name: 'librax-api', CorsConfiguration: { AllowOrigins: ['http://127.0.0.1:5320'] } } },
    Stage: { Type: 'AWS::ApiGatewayV2::Stage', Properties: { StageName: 'api' } },
    ...authorizer('AppAuth', 'AppClient'),
    ...authorizer('AdminAuth', 'AdminClient'),
    LessonFn: fn('librax-complete-lesson', 'completeLessonHandler'),
    AdminFn: fn('librax-admin', 'adminRouter', { USER_POOL_ID: { Ref: 'Pool' } }),
    PostFn: fn('librax-post-confirmation', 'handler'),
    CloseFn: fn('librax-close-league', 'handler', { NAMES: { 'Fn::Join': [',', [{ Ref: 'LessonFn' }, { Ref: 'AdminFn' }]] } }),
    ...integration('LessonInt', 'LessonFn'),
    ...integration('AdminInt', 'AdminFn'),
    ...route('R1', 'POST /v1/lesson/complete', 'LessonInt', 'AppAuth'),
    ...route('R2', 'GET /v1/admin/me', 'AdminInt', 'AdminAuth'),
    Sched: {
      Type: 'AWS::Scheduler::Schedule',
      Properties: { Name: 'librax-close-league-weekly', ScheduleExpression: 'cron(5 0 ? * MON *)', Target: { Arn: { 'Fn::GetAtt': ['CloseFn', 'Arn'] } } },
    },
  },
};

test('rotas do template: handler exportado, Lambda e autorizador de cada uma', () => {
  const plan = readPlan(template, { region: 'us-east-1' });
  assert.equal(plan.api.stage, 'api');
  assert.deepEqual(
    plan.api.routes.map((r) => [r.routeKey, r.handler, r.functionName, r.authorizer]),
    [
      ['POST /v1/lesson/complete', 'completeLessonHandler', 'librax-complete-lesson', 'AppAuth'],
      ['GET /v1/admin/me', 'adminRouter', 'librax-admin', 'AdminAuth'],
    ],
  );
  // o painel so aceita o client do painel: a audiencia guarda o logical id ate o bootstrap
  assert.deepEqual(plan.api.authorizers.AdminAuth.audience, ['AdminClient']);
  assert.deepEqual(plan.api.authorizers.AppAuth.audience, ['AppClient']);
});

test('Cognito: gatilho PostConfirmation, clients so com URLs literais e nome para o moto', () => {
  const plan = readPlan(template, { region: 'us-east-1' });
  assert.equal(plan.userPool.postConfirmation, 'librax-post-confirmation');
  assert.equal(plan.userPool.props.LambdaConfig, undefined);
  assert.equal(plan.userPool.props.UserPoolTier, undefined);
  const app = plan.clients.find((c) => c.logicalId === 'AppClient');
  assert.equal(app.name, 'AppClient');
  assert.deepEqual(app.props.CallbackURLs, ['https://librax.example/auth/callback', 'http://127.0.0.1:5320/auth/callback']);
  assert.equal(plan.clients.find((c) => c.logicalId === 'AdminClient').name, 'librax-admin');
  assert.deepEqual(plan.groups, [{ GroupName: 'admin', Precedence: 0 }]);
});

test('tabela, variaveis das Lambdas e jobs do Scheduler', () => {
  const plan = readPlan(template, { region: 'us-east-1' });
  assert.equal(plan.table.TableName, 'librax');
  assert.equal(plan.table.ttlAttribute, 'expiresAt');
  assert.deepEqual(plan.functions['librax-close-league'].environment, { LIBRAX_TABLE: 'librax', NAMES: 'librax-complete-lesson,librax-admin' });
  assert.deepEqual(plan.functions['librax-admin'].environment.USER_POOL_ID, { userPool: true });
  assert.deepEqual(plan.schedules, [{ name: 'librax-close-league-weekly', expression: 'cron(5 0 ? * MON *)', timezone: 'UTC', functionName: 'librax-close-league' }]);
});

test('template sem integracao 2.0 ou com autorizador fora do User Pool e recusado', () => {
  const bad = structuredClone(template);
  bad.Resources.LessonInt.Properties.PayloadFormatVersion = '1.0';
  assert.throws(() => readPlan(bad, { region: 'us-east-1' }), /payload 2.0/);
  const other = structuredClone(template);
  other.Resources.AppAuth.Properties.JwtConfiguration.Issuer = 'https://outro.example';
  assert.throws(() => readPlan(other, { region: 'us-east-1' }), /emissor/);
});

test('resolveValue e o emissor dos tokens', () => {
  assert.equal(resolveValue({ 'Fn::Join': ['-', ['a', { Ref: 'X' }]] }, { refs: { X: 'b' } }), 'a-b');
  assert.equal(resolveValue({ 'Fn::GetAtt': ['Cdn', 'DomainName'] }), null);
  assert.equal(issuerFor('us-east-1', 'us-east-1_abc'), 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc');
});
