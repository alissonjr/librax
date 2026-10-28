import { describe, expect, test } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LibraxStack } from '../lib/librax-stack';
import { LibraxCiStack } from '../lib/ci-stack';
import { PROJECT_TAG } from '../lib/tags';

// Etiqueta project=librax em todo recurso que a AWS deixa etiquetar (lib/tags.ts).

type Recurso = { Type: string; Properties?: Record<string, unknown> };

const CONTEXTO = {
  'librax:accountId': '111111111111',
  'librax:domainName': 'librax.online',
  'librax:hostedZoneId': 'Z0123456789ABC',
  'librax:certificateArn': 'arn:aws:acm:us-east-1:111111111111:certificate/abc',
  'librax:alarmEmail': 'alarmes@exemplo.com',
  'librax:costAnomalyAlerts': 'create',
};

/** Tipos que a AWS não deixa etiquetar (ou que ficam de fora de propósito, lib/tags.ts). */
const SEM_ETIQUETA = new Set([
  'AWS::ApiGatewayV2::Authorizer', 'AWS::ApiGatewayV2::Integration', 'AWS::ApiGatewayV2::Route',
  'AWS::CloudFront::CachePolicy', 'AWS::CloudFront::OriginAccessControl', 'AWS::CloudFront::ResponseHeadersPolicy',
  'AWS::Cognito::UserPoolClient', 'AWS::Cognito::UserPoolDomain', 'AWS::Cognito::UserPoolGroup',
  'AWS::Cognito::UserPoolIdentityProvider', 'AWS::IAM::Policy', 'AWS::Lambda::Permission', 'AWS::S3::BucketPolicy',
  'AWS::SNS::Subscription', 'AWS::SNS::TopicPolicy', 'AWS::Scheduler::Schedule', 'AWS::Route53::RecordSet',
  'AWS::Events::Rule', 'AWS::CodeBuild::Webhook', 'AWS::Lambda::Url', 'AWS::Logs::SubscriptionFilter',
  'AWS::CE::AnomalyMonitor', 'AWS::CE::AnomalySubscription', 'AWS::CDK::Metadata',
]);

function temEtiqueta(r: Recurso): boolean {
  const p = r.Properties ?? {};
  const tags = p.Tags ?? p.UserPoolTags ?? p.ResourceTags;
  if (Array.isArray(tags)) return tags.some((t) => (t.Key ?? t.key) === PROJECT_TAG.key && (t.Value ?? t.value) === PROJECT_TAG.value);
  if (tags && typeof tags === 'object') return (tags as Record<string, string>)[PROJECT_TAG.key] === PROJECT_TAG.value;
  return false;
}

function conferir(template: Template) {
  const recursos = Object.entries(template.toJSON().Resources as Record<string, Recurso>);
  const faltando = recursos.filter(([, r]) => !SEM_ETIQUETA.has(r.Type) && !temEtiqueta(r)).map(([id, r]) => `${id} (${r.Type})`);
  expect(faltando).toEqual([]);
  // os de fora de propósito ficam mesmo sem
  for (const [, r] of recursos) if (r.Type.startsWith('AWS::CE::')) expect(temEtiqueta(r)).toBe(false);
  return recursos;
}

describe('etiqueta project=librax', () => {
  test('LibraxStack: todo recurso etiquetável tem a etiqueta, e a stack não (sem propagação)', () => {
    const app = new cdk.App({ context: CONTEXTO });
    const stack = new LibraxStack(app, 'LibraxStack', { env: { account: '111111111111', region: 'us-east-1' } });
    const recursos = conferir(Template.fromStack(stack));
    const tipos = new Set(recursos.filter(([, r]) => temEtiqueta(r)).map(([, r]) => r.Type));
    for (const t of ['AWS::Lambda::Function', 'AWS::DynamoDB::Table', 'AWS::S3::Bucket', 'AWS::CloudFront::Distribution',
      'AWS::Cognito::UserPool', 'AWS::ApiGatewayV2::Api', 'AWS::SNS::Topic', 'AWS::CloudWatch::Alarm', 'AWS::IAM::Role',
      'AWS::Budgets::Budget']) {
      expect(tipos, t).toContain(t);
    }
    expect(recursos.some(([, r]) => r.Type === 'AWS::CE::AnomalyMonitor')).toBe(true);
    expect(stack.tags.tagValues()).toEqual({});
  });

  test('LibraxCiStack: a conexão com o GitHub e o projeto do CodeBuild também', () => {
    const app = new cdk.App({ context: CONTEXTO });
    const stack = new LibraxCiStack(app, 'LibraxCiStack', { env: { account: '111111111111', region: 'us-east-1' } });
    const recursos = conferir(Template.fromStack(stack));
    const tipos = new Set(recursos.filter(([, r]) => temEtiqueta(r)).map(([, r]) => r.Type));
    expect(tipos).toContain('AWS::CodeConnections::Connection');
    expect(tipos).toContain('AWS::CodeBuild::Project');
    expect(stack.tags.tagValues()).toEqual({});
  });
});
