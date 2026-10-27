import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LibraxStack } from '../lib/librax-stack';
import { RESERVED_CONCURRENCY, ROUTE_THROTTLES } from '../lib/cost-guards';

// Dados de uso anonimos e nota do app (services/api/src/handlers/telemetry.js): rotas publicas com
// limite baixo, Lambda presa as chaves do uso anonimo e a tabela e o estagio mudando so no lugar.

const CERT = 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';

function synth(context: Record<string, unknown> = {}) {
  const app = new cdk.App({
    context: {
      'aws:cdk:bundling-stacks': [],
      'librax:domainName': 'librax.example',
      'librax:certificateArn': CERT,
      'librax:alarmEmail': 'alertas@exemplo.com',
      ...context,
    },
  });
  const stack = new LibraxStack(app, 'LibraxStack', { env: { account: '111111111111', region: 'us-east-1' } });
  return Template.fromStack(stack);
}

type Resource = { Type: string; Properties: Record<string, any>; DependsOn?: string[] };
const resources = (t: Template) => t.toJSON().Resources as Record<string, Resource>;
const ofType = (t: Template, type: string) => Object.entries(resources(t)).filter(([, r]) => r.Type === type);

const PUBLIC = ['POST /v1/telemetry', 'DELETE /v1/telemetry/{id}', 'POST /v1/feedback'];

describe('uso anonimo e nota do app', () => {
  const template = synth();

  test('tres rotas publicas (sem autorizador) na mesma Lambda librax-telemetry', () => {
    const routes = ofType(template, 'AWS::ApiGatewayV2::Route').map(([, r]) => r.Properties);
    const [fnId] = ofType(template, 'AWS::Lambda::Function').find(([, f]) => f.Properties.FunctionName === 'librax-telemetry')!;
    for (const routeKey of PUBLIC) {
      const route = routes.find((r) => r.RouteKey === routeKey);
      expect(route, routeKey).toBeDefined();
      expect(route!.AuthorizationType).toBe('NONE');
      expect(route!.AuthorizerId).toBeUndefined();
      const integrationId = route!.Target['Fn::Join'][1][1].Ref;
      const integration = resources(template)[integrationId];
      expect(JSON.stringify(integration.Properties.IntegrationUri)).toContain(fnId);
    }
    // nenhuma outra rota ficou publica
    const open = routes.filter((r) => r.AuthorizationType === 'NONE').map((r) => r.RouteKey).sort();
    expect(open).toEqual([...PUBLIC].sort());
  });

  test('limite baixo por rota no estagio, abaixo do global', () => {
    const [, stage] = ofType(template, 'AWS::ApiGatewayV2::Stage')[0];
    for (const routeKey of PUBLIC) {
      expect(stage.Properties.RouteSettings[routeKey]).toEqual({
        ThrottlingRateLimit: ROUTE_THROTTLES[routeKey].rateLimit,
        ThrottlingBurstLimit: ROUTE_THROTTLES[routeKey].burstLimit,
      });
    }
    expect(ROUTE_THROTTLES['POST /v1/telemetry'].rateLimit).toBeLessThanOrEqual(10);
    expect(ROUTE_THROTTLES['DELETE /v1/telemetry/{id}'].rateLimit).toBe(1);
    expect(ROUTE_THROTTLES['POST /v1/feedback'].rateLimit).toBe(1);
  });

  test('a Lambda so le e grava as chaves TEL#, TELAGG e FBLIST (sem Query nem Scan, sem acesso total a tabela)', () => {
    const [, fn] = ofType(template, 'AWS::Lambda::Function').find(([, f]) => f.Properties.FunctionName === 'librax-telemetry')!;
    const roleId = fn.Properties.Role['Fn::GetAtt'][0];
    const statements = ofType(template, 'AWS::IAM::Policy')
      .filter(([, p]) => p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleId))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    const dynamo = statements.filter((s: { Action: string | string[] }) => [s.Action].flat().some((a) => a.startsWith('dynamodb:')));
    expect(dynamo).toHaveLength(1);
    expect([dynamo[0].Action].flat().sort()).toEqual(['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']);
    expect(dynamo[0].Condition).toEqual({
      'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TEL#*', 'TELAGG', 'FBLIST', 'FBLIST#*'] },
    });
    expect(fn.Properties.Environment.Variables.USER_POOL_ID).toBeUndefined();
  });

  test('a tabela reusa o TTL que ja existia (expiresAt) e o job diario acompanha os erros da Lambda nova', () => {
    const [, table] = ofType(template, 'AWS::DynamoDB::Table')[0];
    expect(table.Properties.TimeToLiveSpecification).toEqual({ AttributeName: 'expiresAt', Enabled: true });
    const before = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'antes-da-revisao-de-custo.json'), 'utf8'));
    const [[, old]] = Object.entries(before.table) as [string, Resource][];
    expect(table.Properties.TimeToLiveSpecification).toEqual(old.Properties.TimeToLiveSpecification);
    expect(table.Properties.GlobalSecondaryIndexes).toEqual(old.Properties.GlobalSecondaryIndexes);
    const fns = ofType(template, 'AWS::Lambda::Function');
    const [, ops] = fns.find(([, f]) => f.Properties.FunctionName === 'librax-ops-daily')!;
    const [telemetryId] = fns.find(([, f]) => f.Properties.FunctionName === 'librax-telemetry')!;
    expect(JSON.stringify(ops.Properties.Environment.Variables.FUNCTION_NAMES)).toContain(`{"Ref":"${telemetryId}"}`);
  });

  test('concorrencia reservada opcional, como as outras Lambdas da API', () => {
    expect(RESERVED_CONCURRENCY['librax-telemetry']).toBe(5);
    const withReserve = synth({ 'librax:lambdaReservedConcurrency': 'true' });
    const [, fn] = ofType(withReserve, 'AWS::Lambda::Function').find(([, f]) => f.Properties.FunctionName === 'librax-telemetry')!;
    expect(fn.Properties.ReservedConcurrentExecutions).toBe(5);
  });
});
