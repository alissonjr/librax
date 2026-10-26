import { describe, expect, test } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { LibraxStack } from '../lib/librax-stack';
import {
  ASSETLINKS_CACHE,
  assetLinks,
  assetLinksFunction,
  normalizeFingerprint,
  validPackageName,
} from '../lib/assetlinks';

// Digital Asset Links do app Android (TWA): /.well-known/assetlinks.json no dominio do app

const UPLOAD = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
const PLAY = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const CERT = 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';

function synth(context: Record<string, unknown> = {}) {
  const app = new cdk.App({
    context: { 'aws:cdk:bundling-stacks': [], 'librax:certificateArn': CERT, ...context },
  });
  const stack = new LibraxStack(app, 'LibraxStack', { env: { account: '111111111111', region: 'us-east-1' } });
  return { stack, template: Template.fromStack(stack) };
}

interface EdgeResponse {
  statusCode: number;
  headers: Record<string, { value: string }>;
  body: { encoding: string; data: string };
}

/** Roda o codigo da CloudFront Function como a borda roda. */
function run(code: string): EdgeResponse {
  const handler = new Function(`${code}; return handler;`)() as (event: unknown) => EdgeResponse;
  return handler({ request: { uri: '/.well-known/assetlinks.json', method: 'GET' } });
}

function appDistribution(template: Template) {
  const dist = Object.values(template.findResources('AWS::CloudFront::Distribution')).find((d) =>
    d.Properties.DistributionConfig.Comment.startsWith('Librax - app'),
  );
  return dist!.Properties.DistributionConfig;
}

/** JSON que a funcao publicada no template devolve. */
function servedJson(template: Template): unknown {
  const fn = Object.values(template.findResources('AWS::CloudFront::Function')).find(
    (f) => f.Properties.FunctionConfig.Comment === 'Digital Asset Links do app Android (TWA)',
  );
  return JSON.parse(run(fn!.Properties.FunctionCode).body.data);
}

describe('impressoes digitais e pacote', () => {
  test('aceita SHA-256 com ou sem dois-pontos, em minusculas, e normaliza', () => {
    expect(normalizeFingerprint(UPLOAD.toLowerCase())).toBe(UPLOAD);
    expect(normalizeFingerprint(UPLOAD.replace(/:/g, ''))).toBe(UPLOAD);
    expect(normalizeFingerprint(` ${UPLOAD} `)).toBe(UPLOAD);
  });

  test('recusa SHA-1 e lixo', () => {
    expect(normalizeFingerprint('DA:39:A3:EE:5E:6B:4B:0D:32:55:BF:EF:95:60:18:90:AF:D8:07:09')).toBeNull();
    expect(normalizeFingerprint('nao-e-hash')).toBeNull();
    expect(normalizeFingerprint('')).toBeNull();
  });

  test('pacote no formato do applicationId', () => {
    expect(validPackageName('br.com.librax.app')).toBe(true);
    expect(validPackageName('librax')).toBe(false);
    expect(validPackageName('br.com.1librax')).toBe(false);
    expect(validPackageName('br.com.librax-app')).toBe(false);
  });
});

describe('conteudo do assetlinks.json', () => {
  test('uma declaracao handle_all_urls com todas as impressoes', () => {
    expect(assetLinks('br.com.librax.app', [UPLOAD, PLAY])).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'br.com.librax.app', sha256_cert_fingerprints: [UPLOAD, PLAY] },
      },
    ]);
  });

  test('sem impressao: lista vazia', () => {
    expect(assetLinks('br.com.librax.app', [])).toEqual([]);
  });

  test('a funcao responde 200 com application/json, cache curto e o JSON exato', () => {
    const statements = assetLinks('br.com.librax.app', [UPLOAD]);
    const res = run(assetLinksFunction(statements));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type'].value).toBe('application/json');
    expect(res.headers['cache-control'].value).toBe(ASSETLINKS_CACHE);
    expect(res.headers['cache-control'].value).toMatch(/max-age=\d{1,4}$/);
    expect(res.body.encoding).toBe('text');
    expect(JSON.parse(res.body.data)).toEqual(statements);
  });

  test('o codigo da funcao cabe no limite do CloudFront (10 KB) mesmo com varias chaves', () => {
    const many = Array.from({ length: 6 }, () => UPLOAD);
    expect(assetLinksFunction(assetLinks('br.com.librax.app', many)).length).toBeLessThan(10 * 1024);
  });
});

describe('assetlinks.json no CloudFront do app', () => {
  test('/.well-known/assetlinks.json responde pela funcao (viewer-request), sem cache na borda', () => {
    const { template } = synth();
    const behavior = appDistribution(template).CacheBehaviors.find(
      (b: { PathPattern: string }) => b.PathPattern === '/.well-known/assetlinks.json',
    );
    expect(behavior.FunctionAssociations).toHaveLength(1);
    expect(behavior.FunctionAssociations[0].EventType).toBe('viewer-request');
    expect(behavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // CachingDisabled
    expect(behavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }),
      FunctionCode: Match.stringLikeRegexp('application/json'),
    });
  });

  test('pacote e impressoes vem do contexto (upload e Play App Signing), normalizados e sem repetir', () => {
    const { template } = synth({
      'librax:androidPackageName': 'br.com.librax.app',
      'librax:androidCertFingerprints': `${UPLOAD}, ${PLAY.toLowerCase()}, ${UPLOAD.replace(/:/g, '')}`,
    });
    expect(servedJson(template)).toEqual(assetLinks('br.com.librax.app', [UPLOAD, PLAY]));
  });

  test('lista em JSON no cdk.context.json tambem vale', () => {
    const { template } = synth({ 'librax:androidCertFingerprints': [UPLOAD, PLAY] });
    expect(servedJson(template)).toEqual(assetLinks('br.com.librax.app', [UPLOAD, PLAY]));
  });

  test('sem impressao: serve [] e avisa no synth', () => {
    const { stack, template } = synth();
    expect(servedJson(template)).toEqual([]);
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('librax:androidCertFingerprints'));
  });

  test('impressao ou pacote invalidos param o synth', () => {
    expect(() => synth({ 'librax:androidCertFingerprints': 'DA:39:A3' })).toThrow(/SHA-256/);
    expect(() => synth({ 'librax:androidPackageName': 'librax' })).toThrow(/androidPackageName/);
  });

  test('cabecalhos do app nao mudam por causa do TWA: camera liberada na propria origem', () => {
    const { template } = synth();
    const policies = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy')).map(
      (r) => r.Properties.ResponseHeadersPolicyConfig,
    );
    const app = policies.find((p) => p.Comment.includes('no-cache') && p.Comment.includes('app'));
    const permissions = app.CustomHeadersConfig.Items.find((h: { Header: string }) => h.Header === 'Permissions-Policy');
    // O TWA e o proprio Chrome abrindo o site: o getUserMedia segue a Permissions-Policy do app
    expect(permissions.Value).toMatch(/^camera=\(self\)/);
    const assetHeaders = policies.find((p) => p.Comment.includes('assetlinks'));
    expect(assetHeaders.SecurityHeadersConfig.ContentTypeOptions.Override).toBe(true);
    expect(assetHeaders.CustomHeadersConfig).toBeUndefined();
  });
});
