import { describe, expect, test } from 'vitest';
import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { LibraxStack } from '../lib/librax-stack';
import { readConfig } from '../lib/config';
import { inlineScriptHashes, landingRequestFunction, LANDING_INLINE_SCRIPT_HASHES } from '../lib/landing';
// @ts-expect-error módulo .mjs sem tipos
import { enderecos, erroDosHashes, hashesDoHtml } from '../scripts/landing.mjs';

// Landing publica no apex (CloudFront e bucket proprios) e app em app.<dominio>.

const CERT = 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';
const SEM_BUILD = path.join(__dirname, '__sem_build__');
const withDomain = {
  'librax:domainName': 'librax.example',
  'librax:certificateArn': CERT,
  'librax:landingDistDir': SEM_BUILD,
};

function synth(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
  const stack = new LibraxStack(app, 'LibraxStack', { env: { account: '111111111111', region: 'us-east-1' } });
  return { stack, template: Template.fromStack(stack) };
}

function landingDist(template: Template) {
  const [[id, dist]] = Object.entries(template.findResources('AWS::CloudFront::Distribution')).filter(([, d]) =>
    d.Properties.DistributionConfig.Comment.includes('landing'),
  );
  return { id, config: dist.Properties.DistributionConfig };
}

function policy(template: Template, comment: string) {
  return Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'))
    .map((r) => r.Properties.ResponseHeadersPolicyConfig)
    .find((p) => p.Comment === comment);
}

const sha = (s: string) => `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}`;

/** Pasta com um build falso da landing (so os HTML). */
function fakeBuild(rootScript: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'librax-landing-'));
  mkdirSync(path.join(dir, 'en'));
  mkdirSync(path.join(dir, 'es'));
  const page = (inline: string) =>
    `<!doctype html><html><head>${inline}<script type="application/ld+json">{"@type":"WebSite"}</script>` +
    '<script type="module" crossorigin src="/assets/main-abc.js"></script></head><body></body></html>';
  writeFileSync(path.join(dir, 'index.html'), page(`<script>${rootScript}</script>`));
  writeFileSync(path.join(dir, 'en', 'index.html'), page(''));
  writeFileSync(path.join(dir, 'es', 'index.html'), page(''));
  return dir;
}

/** Roda a CloudFront Function da landing como a borda roda. */
function runRequest(code: string, uri: string, host = 'librax.example', querystring: Record<string, unknown> = {}) {
  const handler = new Function(`${code}; return handler;`)() as (event: unknown) => {
    uri?: string;
    statusCode?: number;
    headers?: { location?: { value: string } };
  };
  return handler({ request: { uri, querystring, headers: { host: { value: host } } } });
}

describe('nomes', () => {
  const config = (ctx: Record<string, string>) => readConfig(new cdk.App({ context: ctx }).node);

  test('padrao: landing no dominio, www redireciona e app em app.<dominio>', () => {
    const c = config({ 'librax:domainName': 'librax.com.br' });
    expect(c.appDomainName).toBe('app.librax.com.br');
    expect(c.landing.domainName).toBe('librax.com.br');
    expect(c.landing.redirectDomainNames).toEqual(['www.librax.com.br']);
    expect(c.authDomainName).toBe('auth.librax.com.br');
  });

  test('nomes trocados por contexto; www pode ser desligado', () => {
    const c = config({
      'librax:domainName': 'librax.com.br',
      'librax:appDomainName': 'jogar.librax.com.br',
      'librax:landingDomainName': 'site.librax.com.br',
      'librax:wwwDomainName': 'none',
    });
    expect(c.appDomainName).toBe('jogar.librax.com.br');
    expect(c.landing.domainName).toBe('site.librax.com.br');
    expect(c.landing.redirectDomainNames).toEqual([]);
  });

  test('app e landing com o mesmo nome param o synth', () => {
    expect(() => config({ 'librax:domainName': 'librax.com.br', 'librax:appDomainName': 'librax.com.br' })).toThrow(
      /appDomainName/,
    );
  });

  test('o script de build usa os mesmos padroes', () => {
    expect(enderecos({ 'librax:domainName': 'librax.com.br' })).toEqual({
      appUrl: 'https://app.librax.com.br/',
      siteOrigin: 'https://librax.com.br',
    });
    expect(enderecos({ 'librax:domainName': 'librax.com.br', 'librax:appDomainName': 'jogar.librax.com.br' }).appUrl).toBe(
      'https://jogar.librax.com.br/',
    );
  });
});

describe('CloudFront e bucket da landing', () => {
  test('CloudFront proprio no apex e no www, separado do app', () => {
    const { template } = synth(withDomain);
    const { config } = landingDist(template);
    expect(config.Aliases).toEqual(['librax.example', 'www.librax.example']);
    expect(config.DefaultRootObject).toBe('index.html');
    expect(config.ViewerCertificate.AcmCertificateArn).toBe(CERT);
    expect(config.CacheBehaviors.map((b: { PathPattern: string }) => b.PathPattern)).toEqual(['/assets/*']);
    // nenhum caminho da landing no CloudFront do app
    const app = Object.values(template.findResources('AWS::CloudFront::Distribution'))
      .map((d) => d.Properties.DistributionConfig)
      .find((d) => d.Comment.startsWith('Librax - app'));
    expect(app.Aliases).toEqual(['app.librax.example']);
    expect(app.Origins.map((o: { Id: string }) => o.Id).join()).not.toMatch(/Landing/);
  });

  test('bucket privado lido so pelo CloudFront da landing (OAC)', () => {
    const { template } = synth(withDomain);
    const [bucketId, bucket] = Object.entries(template.findResources('AWS::S3::Bucket')).find(([id]) =>
      id.startsWith('LibraxLandingBucket'),
    )!;
    expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.DeletionPolicy).toBe('Retain');
    const { id: distId, config } = landingDist(template);
    expect(config.Origins).toHaveLength(1);
    expect(config.Origins[0].OriginAccessControlId).toBeDefined();
    expect(config.Origins[0].S3OriginConfig.OriginAccessIdentity).toBe('');

    const [bucketPolicy] = Object.values(template.findResources('AWS::S3::BucketPolicy')).filter(
      (p) => p.Properties.Bucket.Ref === bucketId,
    );
    const read = bucketPolicy.Properties.PolicyDocument.Statement.find(
      (st: { Action: string | string[] }) => [st.Action].flat().includes('s3:GetObject'),
    );
    expect(read.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(JSON.stringify(read.Condition)).toContain(distId);
    // HTTPS obrigatorio no bucket
    expect(JSON.stringify(bucketPolicy.Properties.PolicyDocument)).toContain('aws:SecureTransport');
  });

  test('paginas com cache curto, /assets/* imutavel e caminho inexistente vira 404', () => {
    const { template } = synth(withDomain);
    const { config } = landingDist(template);
    const html = policy(template, 'Librax - landing (cache curto)');
    const assets = policy(template, 'Librax - landing, arquivos com hash (immutable)');
    const cacheControl = (p: { CustomHeadersConfig: { Items: { Header: string; Value: string }[] } }) =>
      p.CustomHeadersConfig.Items.find((h) => h.Header === 'Cache-Control')?.Value;
    expect(cacheControl(html)).toBe('public, max-age=300');
    expect(cacheControl(assets)).toBe('public, max-age=31536000, immutable');

    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({ Name: Match.anyValue(), DefaultTTL: 300, MinTTL: 0 }),
    });
    const [shortCacheId] = Object.entries(template.findResources('AWS::CloudFront::CachePolicy')).find(
      ([, r]) => r.Properties.CachePolicyConfig.DefaultTTL === 300,
    )!;
    expect(config.DefaultCacheBehavior.CachePolicyId).toEqual({ Ref: shortCacheId });
    expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    const assetBehavior = config.CacheBehaviors[0];
    expect(assetBehavior.CachePolicyId).toBe('658327ea-f89d-4fab-a63d-7e88639e58f6'); // CachingOptimized
    expect(config.CustomErrorResponses).toEqual([
      { ErrorCode: 403, ResponseCode: 404, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 60 },
      { ErrorCode: 404, ResponseCode: 404, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 60 },
    ]);
  });

  test('sem certificado: landing sem alias e no *.cloudfront.net', () => {
    const { template } = synth({ 'librax:landingDistDir': SEM_BUILD });
    expect(landingDist(template).config.Aliases).toBeUndefined();
    const outputs = template.toJSON().Outputs;
    expect(JSON.stringify(outputs.LandingUrl.Value)).toContain('LibraxLandingCDN');
  });

  test('outputs para o build e a publicacao', () => {
    const { template } = synth(withDomain);
    const outputs = template.toJSON().Outputs;
    for (const key of ['LandingUrl', 'LandingBucketName', 'LandingDistributionId', 'LandingDistributionDomain', 'LandingScriptHashes']) {
      expect(outputs[key]).toBeDefined();
    }
    expect(outputs.LandingUrl.Value).toBe('https://librax.example');
    expect(outputs.AppUrl.Value).toBe('https://app.librax.example');
  });
});

describe('cabecalhos e CSP da landing', () => {
  test('CSP sem unsafe-inline no script, sem moldura e com os cabecalhos de seguranca', () => {
    const { template } = synth(withDomain);
    for (const comment of ['Librax - landing (cache curto)', 'Librax - landing, arquivos com hash (immutable)']) {
      const p = policy(template, comment);
      const csp: string = p.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
      const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))!;
      expect(scriptSrc).not.toContain('unsafe');
      expect(scriptSrc).toContain(`'${LANDING_INLINE_SCRIPT_HASHES[0]}'`);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toMatch(/https?:\/\//); // nenhum host de terceiros
      expect(csp.length).toBeLessThan(1783);
      expect(p.SecurityHeadersConfig.FrameOptions.FrameOption).toBe('DENY');
      expect(p.SecurityHeadersConfig.StrictTransportSecurity.AccessControlMaxAgeSec).toBe(31536000);
      expect(p.SecurityHeadersConfig.ContentTypeOptions.Override).toBe(true);
      expect(p.SecurityHeadersConfig.ReferrerPolicy.ReferrerPolicy).toBe('strict-origin-when-cross-origin');
      const permissions = p.CustomHeadersConfig.Items.find((h: { Header: string }) => h.Header === 'Permissions-Policy');
      expect(permissions.Value).toMatch(/^camera=\(\),/);
    }
  });

  test('com o build, o hash sai do script inline do dist/ (sem aviso)', () => {
    const script = "(function(){location.replace('/en/')})();";
    const { stack, template } = synth({ ...withDomain, 'librax:landingDistDir': fakeBuild(script) });
    const csp: string = policy(template, 'Librax - landing (cache curto)').SecurityHeadersConfig.ContentSecurityPolicy
      .ContentSecurityPolicy;
    expect(csp).toContain(`script-src 'self' '${sha(script)}';`);
    expect(csp).not.toContain(LANDING_INLINE_SCRIPT_HASHES[0]);
    expect(template.toJSON().Outputs.LandingScriptHashes.Value).toBe(sha(script));
    const warnings = Annotations.fromStack(stack).findWarning('*', Match.anyValue()).map((w) => JSON.stringify(w.entry.data));
    expect(warnings.join()).not.toContain('librax:no-landing-build');
    expect(warnings.join()).toContain('librax:landing-hash-changed');
  });

  test('sem o build, usa o hash gravado e avisa no synth', () => {
    const { stack } = synth(withDomain);
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('landing:build'));
  });

  test('cspReportOnly tambem vale para a landing', () => {
    const { template } = synth({ ...withDomain, 'librax:cspReportOnly': 'true' });
    const p = policy(template, 'Librax - landing (cache curto)');
    expect(p.SecurityHeadersConfig.ContentSecurityPolicy).toBeUndefined();
    const report = p.CustomHeadersConfig.Items.find((h: { Header: string }) => h.Header === 'Content-Security-Policy-Report-Only');
    expect(report.Value).toContain(LANDING_INLINE_SCRIPT_HASHES[0]);
  });

  test('conta do hash: so script inline executavel, igual na infra e no script de publicacao', () => {
    const html =
      '<script>a()</script><script type="module">b()</script><script type="application/ld+json">{}</script>' +
      '<script src="/x.js"></script><SCRIPT TYPE="text/javascript">c()</SCRIPT>';
    expect(inlineScriptHashes(html)).toEqual([sha('a()'), sha('b()'), sha('c()')]);
    expect(hashesDoHtml(html)).toEqual(inlineScriptHashes(html));
  });

  test('publicacao recusa build cujo script a CSP publicada nao libera', () => {
    expect(erroDosHashes([sha('a()')], `${sha('a()')} ${sha('b()')}`)).toBeNull();
    expect(erroDosHashes([], '(nenhum)')).toBeNull();
    expect(erroDosHashes([sha('novo()')], sha('a()'))).toMatch(/npm run deploy/);
  });
});

describe('CloudFront Function da landing', () => {
  const code = landingRequestFunction('librax.example', ['www.librax.example'], 'https://app.librax.example');

  test('esta associada ao comportamento padrao no viewer-request', () => {
    const { template } = synth(withDomain);
    const { config } = landingDist(template);
    const [assoc] = config.DefaultCacheBehavior.FunctionAssociations;
    expect(assoc.EventType).toBe('viewer-request');
    const [fnId] = Object.entries(template.findResources('AWS::CloudFront::Function')).find(([, r]) =>
      String(r.Properties.FunctionCode).includes('REDIRECT_HOSTS'),
    )!;
    expect(assoc.FunctionARN).toEqual({ 'Fn::GetAtt': [fnId, 'FunctionARN'] });
  });

  test('pasta de cada idioma recebe o index.html', () => {
    expect(runRequest(code, '/').uri).toBe('/index.html');
    expect(runRequest(code, '/en/').uri).toBe('/en/index.html');
    expect(runRequest(code, '/es/').uri).toBe('/es/index.html');
    expect(runRequest(code, '/assets/main-abc.js').uri).toBe('/assets/main-abc.js');
    expect(runRequest(code, '/favicon.svg').uri).toBe('/favicon.svg');
  });

  test('/en sem barra redireciona para /en/', () => {
    const r = runRequest(code, '/en', 'librax.example', { utm_source: { value: 'x' } });
    expect(r.statusCode).toBe(301);
    expect(r.headers!.location!.value).toBe('/en/?utm_source=x');
  });

  test('www redireciona para o apex mantendo caminho e query', () => {
    const r = runRequest(code, '/es/', 'WWW.librax.example', {
      a: { value: '1', multiValue: [{ value: '1' }, { value: '2' }] },
      b: { value: '' },
    });
    expect(r.statusCode).toBe(301);
    expect(r.headers!.location!.value).toBe('https://librax.example/es/?a=1&a=2&b');
  });

  test('/app e /app/... vao para o app (link padrao da landing)', () => {
    expect(runRequest(code, '/app').headers!.location!.value).toBe('https://app.librax.example/');
    expect(runRequest(code, '/app/').headers!.location!.value).toBe('https://app.librax.example/');
    expect(runRequest(code, '/app/privacidade').headers!.location!.value).toBe('https://app.librax.example/privacidade');
    // /apple-touch-icon.png nao e /app/
    expect(runRequest(code, '/apple-touch-icon.png').uri).toBe('/apple-touch-icon.png');
  });
});
