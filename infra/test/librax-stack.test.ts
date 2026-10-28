import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { LibraxStack } from '../lib/librax-stack';
import { IMMUTABLE, ML_REVALIDATE, SPA_REWRITE_FUNCTION } from '../lib/web-headers';
import { appMediapipeVersion } from '../lib/config';

const MEDIAPIPE = appMediapipeVersion() as string;

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

/** Configuracao do CloudFront do app (o outro e o da landing). */
function behaviors(template: Template) {
  const dist = Object.values(template.findResources('AWS::CloudFront::Distribution')).find((d) =>
    d.Properties.DistributionConfig.Comment.startsWith('Librax - app'),
  );
  return dist!.Properties.DistributionConfig;
}

describe('CloudFront do app na mesma origem', () => {
  test('CloudFront do app em app.<dominio>, com /, /assets, /content, /ml, /api, /vlibras e /admin', () => {
    const { template } = synth(withDomain);
    template.resourceCountIs('AWS::CloudFront::Distribution', 2); // app e landing
    const config = behaviors(template);
    const paths = config.CacheBehaviors.map((b: { PathPattern: string }) => b.PathPattern);
    expect(paths).toEqual([
      '/.well-known/assetlinks.json',
      '/assets/*.wasm', '/assets/*', '/vlibras/v*', '/vlibras/sinais/*', '/vlibras/*', '/content/*',
      `/ml/${MEDIAPIPE}/*.wasm`, `/ml/${MEDIAPIPE}/*`, '/ml/*.wasm', '/ml/*', '/api/*',
      '/admin/assets/*', '/admin', '/admin/*',
    ]);
    expect(config.Aliases).toEqual(['app.librax.example']);
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

  test('Politica e Termos abrem pelo link direto: /privacidade e /termos recebem o index.html', () => {
    // Roda o codigo da CloudFront Function como a borda roda (handler(event) devolve o pedido)
    const handler = new Function(`${SPA_REWRITE_FUNCTION}; return handler;`)() as (
      event: { request: { uri: string } },
    ) => { uri: string };
    const rewrite = (uri: string) => handler({ request: { uri } }).uri;
    expect(rewrite('/privacidade')).toBe('/index.html');
    expect(rewrite('/termos')).toBe('/index.html');
    expect(rewrite('/privacidade/')).toBe('/index.html');
    // Arquivos seguem para o bucket como estao
    expect(rewrite('/assets/index-abc123.js')).toBe('/assets/index-abc123.js');
    expect(rewrite('/sw.js')).toBe('/sw.js');
  });

  test('sem certificado: sem alias e com aviso; synth continua funcionando', () => {
    const { stack, template } = synth();
    expect(behaviors(template).Aliases).toBeUndefined();
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('librax:certificateArn'));
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('placeholder'));
  });
});

describe('cache dos arquivos de ML (/ml/)', () => {
  type Behavior = { PathPattern: string; ResponseHeadersPolicyId: { Ref: string }; CachePolicyId: string | { Ref: string }; FunctionAssociations?: unknown[] };

  function mlCache(template: Template) {
    const resources = template.toJSON().Resources as Record<string, { Properties: Record<string, any> }>;
    const byPath = new Map<string, Behavior>(behaviors(template).CacheBehaviors.map((b: Behavior) => [b.PathPattern, b]));
    return (pathPattern: string) => {
      const b = byPath.get(pathPattern);
      if (!b) return undefined;
      const headers = resources[b.ResponseHeadersPolicyId.Ref].Properties.ResponseHeadersPolicyConfig;
      const cache = typeof b.CachePolicyId === 'string' ? null : resources[b.CachePolicyId.Ref].Properties.CachePolicyConfig;
      return {
        cacheControl: headers.CustomHeadersConfig.Items.find((h: { Header: string }) => h.Header === 'Cache-Control')?.Value,
        edgeDefaultTtl: cache ? cache.DefaultTTL : 'CachingOptimized',
        wasm: (b.FunctionAssociations ?? []).length > 0,
      };
    };
  }

  test('a versao do MediaPipe vem do package.json do app e e exata', () => {
    expect(MEDIAPIPE).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('so /ml/<versao>/ e imutavel; as pastas de modelo sem versao revalidam no navegador e na borda', () => {
    const cache = mlCache(synth(withDomain).template);
    expect(cache(`/ml/${MEDIAPIPE}/*.wasm`)).toEqual({ cacheControl: IMMUTABLE, edgeDefaultTtl: 'CachingOptimized', wasm: true });
    expect(cache(`/ml/${MEDIAPIPE}/*`)).toEqual({ cacheControl: IMMUTABLE, edgeDefaultTtl: 'CachingOptimized', wasm: false });
    // /ml/classifier/, /ml/sinais/, /ml/letras-mov/, /ml/numeros/ e qualquer pasta nova caem aqui
    expect(cache('/ml/*.wasm')).toEqual({ cacheControl: ML_REVALIDATE, edgeDefaultTtl: 0, wasm: true });
    expect(cache('/ml/*')).toEqual({ cacheControl: ML_REVALIDATE, edgeDefaultTtl: 0, wasm: false });
    expect(ML_REVALIDATE).toBe('no-cache');
  });

  test('versao por contexto; versao nao exata ou ausente: nada imutavel em /ml/, com aviso', () => {
    const outra = synth({ ...withDomain, 'librax:mediapipeVersion': '2.0.0' }).template;
    expect(mlCache(outra)('/ml/2.0.0/*')?.cacheControl).toBe(IMMUTABLE);
    expect(mlCache(outra)(`/ml/${MEDIAPIPE}/*`)).toBeUndefined();

    const { stack, template } = synth({ ...withDomain, 'librax:mediapipeVersion': '^1.2.3' });
    const paths = behaviors(template).CacheBehaviors.map((b: Behavior) => b.PathPattern).filter((p: string) => p.startsWith('/ml/'));
    expect(paths).toEqual(['/ml/*.wasm', '/ml/*']);
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('mediapipe'));
  });

  test('appMediapipeVersion: sem o app (checkout so da infra), sem versao', () => {
    expect(appMediapipeVersion(path.join(__dirname, '__sem_arquivo__.json'))).toBeUndefined();
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
    // mão em 3D das letras e números: textura do GLB por blob:
    expect(csp).toMatch(/connect-src 'self' blob:/);
    expect(csp).toMatch(/img-src [^;]*blob:/);
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
    const csp = flat(vlibras.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
    expect(csp).toContain("'unsafe-eval'");
    // Player e animacoes servidos pelo proprio app (scripts/vlibras-assets.mjs): nada de host externo
    expect(csp).not.toContain('vlibras.gov.br');
    expect(csp).not.toContain('jsdelivr');
  });

  test('.wasm sai com Content-Type application/wasm', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp('application/wasm'),
    });
    const wasm = behaviors(template).CacheBehaviors.filter((b: { PathPattern: string }) => b.PathPattern.endsWith('.wasm'));
    expect(wasm.map((b: { PathPattern: string }) => b.PathPattern)).toEqual(['/assets/*.wasm', `/ml/${MEDIAPIPE}/*.wasm`, '/ml/*.wasm']);
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
      CallbackURLs: ['https://app.librax.example/auth/callback', 'http://localhost:5173/auth/callback'],
      LogoutURLs: ['https://app.librax.example/'],
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

  describe('e-mails do Cognito (SES opcional)', () => {
    const pool = (template: Template) => {
      const pools = template.findResources('AWS::Cognito::UserPool');
      expect(Object.keys(pools)).toHaveLength(1);
      const [id, recurso] = Object.entries(pools)[0];
      return { id, props: recurso.Properties as Record<string, unknown>, recurso };
    };

    test('desligado (padrao): envio do Cognito, sem EmailConfiguration', () => {
      const { template } = synth(withDomain);
      expect(pool(template).props.EmailConfiguration).toBeUndefined();
      expect(JSON.stringify(template.toJSON())).not.toContain('"DEVELOPER"');
    });

    test('ligado: SES em us-east-1 com o dominio verificado, remetente Librax e sem papel extra', () => {
      const { template } = synth({ ...withDomain, 'librax:cognitoEmailSes': 'true' });
      const cfg = pool(template).props.EmailConfiguration as Record<string, unknown>;
      expect({ ...cfg, SourceArn: flat(cfg.SourceArn) }).toEqual({
        EmailSendingAccount: 'DEVELOPER',
        From: 'Librax <nao-responda@librax.example>',
        SourceArn: 'arn:{AWS::Partition}:ses:us-east-1:111111111111:identity/librax.example',
      });
      // O Cognito usa o papel vinculado ao servico que ele mesmo cria. A unica permissao de SES da stack e
      // a do aviso de acesso novo (librax-report-device), so SendEmail e so na identidade do dominio
      const comSes = Object.entries(template.findResources('AWS::IAM::Policy')).filter(([, r]) => JSON.stringify(r).includes('ses:'));
      expect(comSes.map(([id]) => id)).toEqual([expect.stringMatching(/^ReportDeviceFn/)]);
      const sesStmt = comSes[0][1].Properties.PolicyDocument.Statement.find((st: { Action: unknown }) => JSON.stringify(st.Action).includes('ses:'));
      expect(sesStmt.Action).toBe('ses:SendEmail');
      expect(flat(sesStmt.Resource)).toBe('arn:{AWS::Partition}:ses:us-east-1:111111111111:identity/librax.example');
    });

    test('remetente, nome e resposta por contexto; dominio do remetente e a identidade do SES', () => {
      const { template } = synth({
        ...withDomain,
        'librax:cognitoEmailSes': true,
        'librax:cognitoEmailFrom': 'contas@mail.librax.example',
        'librax:cognitoEmailFromName': 'Equipe Librax',
        'librax:cognitoEmailReplyTo': 'contato@librax.example',
      });
      const cfg = pool(template).props.EmailConfiguration as Record<string, unknown>;
      expect({ ...cfg, SourceArn: flat(cfg.SourceArn) }).toEqual({
        EmailSendingAccount: 'DEVELOPER',
        From: 'Equipe Librax <contas@mail.librax.example>',
        ReplyToEmailAddress: 'contato@librax.example',
        SourceArn: 'arn:{AWS::Partition}:ses:us-east-1:111111111111:identity/mail.librax.example',
      });
    });

    test('remetente invalido para o synth com mensagem clara', () => {
      expect(() => synth({ ...withDomain, 'librax:cognitoEmailSes': 'true', 'librax:cognitoEmailFrom': 'librax' })).toThrow(
        /librax:cognitoEmailFrom precisa ser um e-mail/,
      );
    });

    test('codigo de cadastro e de nova senha em portugues, com o nome do app e o codigo', () => {
      const { props } = pool(synth(withDomain).template);
      const tpl = props.VerificationMessageTemplate as Record<string, string>;
      expect(tpl.DefaultEmailOption).toBe('CONFIRM_WITH_CODE');
      expect(tpl.EmailSubject).toBe('Seu código do Librax');
      expect(tpl.EmailMessage).toContain('Seu código do Librax é {####}.');
      expect(tpl.EmailMessage).toContain('criar uma nova senha');
      expect(props.EmailVerificationSubject).toBe(tpl.EmailSubject);
      expect(props.EmailVerificationMessage).toBe(tpl.EmailMessage);
      // Texto corrido: sem HTML, sem travessao nem meia-risca, sem emoji
      expect(tpl.EmailMessage).not.toMatch(/[<>\u2013\u2014]|\p{Extended_Pictographic}/u);
      expect(tpl.EmailMessage.length).toBeLessThan(300);
    });

    const fn = (template: Template, name: string) =>
      Object.entries(template.findResources('AWS::Lambda::Function')).find(([, r]) => r.Properties.FunctionName === name)!;

    test('gatilho Custom Message: e-mails de codigo com a identidade do Librax, por idioma', () => {
      const { template } = synth(withDomain);
      const { props } = pool(template);
      const [msgId, msgFn] = fn(template, 'librax-custom-message');
      const [postId] = fn(template, 'librax-post-confirmation');
      const [preId] = fn(template, 'librax-pre-signup');
      expect(props.LambdaConfig).toEqual({
        CustomMessage: { 'Fn::GetAtt': [msgId, 'Arn'] },
        PostConfirmation: { 'Fn::GetAtt': [postId, 'Arn'] },
        PreSignUp: { 'Fn::GetAtt': [preId, 'Arn'] },
      });
      expect(msgFn.Properties.Handler).toBe('index.handler');
      expect(msgFn.Properties.Environment.Variables.APP_URL).toBe('https://app.librax.example');
      expect(msgFn.Properties.Timeout).toBe(5);
      template.hasResourceProperties('AWS::Lambda::Permission', {
        FunctionName: { 'Fn::GetAtt': [msgId, 'Arn'] },
        Principal: 'cognito-idp.amazonaws.com',
      });
      // o texto padrao (portugues) continua no User Pool: vale se o gatilho falhar
      expect((props.VerificationMessageTemplate as Record<string, string>).EmailMessage).toContain('{####}');
    });

    test('aviso de acesso novo: rota POST /v1/users/me/devices; e-mail so com o SES ligado, pelo remetente dos codigos', () => {
      const off = synth(withDomain).template;
      const [, offFn] = fn(off, 'librax-report-device');
      expect(offFn.Properties.Environment.Variables.LOGIN_ALERT_FROM).toBeUndefined();
      expect(offFn.Properties.Environment.Variables.APP_URL).toBe('https://app.librax.example');
      expect(JSON.stringify(off.findResources('AWS::IAM::Policy'))).not.toContain('ses:');
      off.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /v1/users/me/devices', AuthorizationType: 'JWT' });

      const on = synth({ ...withDomain, 'librax:cognitoEmailSes': 'true', 'librax:cognitoEmailFromName': 'Equipe Librax' }).template;
      const [, onFn] = fn(on, 'librax-report-device');
      expect(onFn.Properties.Environment.Variables.LOGIN_ALERT_FROM).toBe('Equipe Librax <nao-responda@librax.example>');
    });

    test('atualizacao no lugar: o User Pool e os app clients do main so ganham o gatilho (LambdaConfig, "No interruption")', () => {
      // Recursos do Cognito sintetizados no main, antes dos e-mails (test/fixtures). Nada de Schema novo:
      // o idioma vai no atributo padrao `locale` e no clientMetadata, que nao mudam o User Pool.
      const before = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'cognito-antes-dos-emails.json'), 'utf8'));
      for (const ses of ['false', 'true']) {
        const { template } = synth({ ...withDomain, 'librax:cognitoEmailSes': ses });
        const now = pool(template);
        const [oldId, oldPool] = Object.entries(before[`ses-${ses}`].pool)[0] as [string, { Properties: Record<string, unknown> }];
        expect(now.id).toBe(oldId);
        expect(now.recurso.DeletionPolicy).toBe('Retain');
        expect(now.recurso.UpdateReplacePolicy).toBe('Retain');
        expect(now.props.Schema).toBeUndefined();
        // MFA e protecao contra exclusao vieram depois (revisao de custo e seguranca, teste proprio)
        const {
          LambdaConfig: lc, MfaConfiguration: _mfa, EnabledMfas: _mfas, DeletionProtection: _del, ...rest
        } = now.props as { LambdaConfig: Record<string, unknown> } & Record<string, unknown>;
        const { LambdaConfig: oldLc, ...oldRest } = oldPool.Properties as { LambdaConfig: Record<string, unknown> };
        expect(rest).toEqual(oldRest);
        // CustomMessage (e-mails) e PreSignUp (uma pessoa, uma conta) vieram depois, no mesmo LambdaConfig
        const { CustomMessage, PreSignUp, ...otherTriggers } = lc;
        expect(CustomMessage).toBeDefined();
        expect(PreSignUp).toBeDefined();
        expect(otherTriggers).toEqual(oldLc);
        // app client do app sem mudanca nenhuma (o `locale` ja e gravavel: o client nao restringe
        // atributos); o do painel mudou depois (escopo do autenticador e login proprio, teste em
        // cost-guards.test.ts)
        const doApp = (clients: Record<string, { Properties: Record<string, unknown> }>) =>
          Object.fromEntries(Object.entries(clients).filter(([, c]) => c.Properties.ClientName !== 'librax-admin'));
        const appClients = doApp(template.findResources('AWS::Cognito::UserPoolClient'));
        expect(Object.keys(appClients)).toHaveLength(1);
        expect(appClients).toEqual(doApp(before[`ses-${ses}`].clients));
      }
    });

    test('ligar o SES muda so o envio: mesmo User Pool (mesmo id, sem troca de propriedade imutavel)', () => {
      const desligado = pool(synth(withDomain).template);
      const ligado = pool(synth({ ...withDomain, 'librax:cognitoEmailSes': 'true' }).template);
      expect(ligado.id).toBe(desligado.id);
      expect(ligado.recurso.DeletionPolicy).toBe('Retain');
      const { EmailConfiguration, ...resto } = ligado.props;
      expect(EmailConfiguration).toBeDefined();
      expect(resto).toEqual(desligado.props);
    });
  });

  test('User Pool no plano Lite (custo por MAU mais baixo)', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Cognito::UserPool', { UserPoolTier: 'LITE' });
  });

  test('esqueci a senha: so por e-mail, sem revelar se a conta existe, com o envio padrao do Cognito', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
      // a tela do app usa o mesmo minimo (PASSWORD_MIN em AuthScreen.tsx)
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 8 }) },
      // sem SES: o Cognito manda os codigos pelo envio padrao (limite diario baixo)
      EmailConfiguration: Match.absent(),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH']),
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  test('tentativas de licao expiram pelo TTL do atributo expiresAt', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
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
      CorsConfiguration: Match.objectLike({ AllowOrigins: ['https://app.librax.example', 'http://localhost:5173'] }),
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
      'POST /v1/practice/review',
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

describe('Progresso da conta (entrar no comeco do app ou num aparelho novo)', () => {
  test('GET /v1/users/me/progress no autorizador do app, Lambda propria que so le a tabela', () => {
    const { template } = synth(withDomain);
    const authorizers = template.findResources('AWS::ApiGatewayV2::Authorizer');
    const [appAuthId] = Object.entries(authorizers).find(([, r]) => r.Properties.Name === 'CognitoAuth')!;
    const route = Object.values(template.findResources('AWS::ApiGatewayV2::Route'))
      .map((r) => r.Properties)
      .find((r) => r.RouteKey === 'GET /v1/users/me/progress');
    expect(route.AuthorizationType).toBe('JWT');
    expect(route.AuthorizerId).toEqual({ Ref: appAuthId });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-get-progress',
      Handler: 'index.getProgressHandler',
    });
    const actions = policyActionsOf(template, 'librax-get-progress');
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:Query']));
    for (const write of ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem']) {
      expect(actions).not.toContain(write);
    }
  });
});

describe('Exclusao de conta (LGPD)', () => {
  test('DELETE /v1/users/me com o autorizador JWT do app, Lambda propria e o User Pool no ambiente', () => {
    const { template } = synth(withDomain);
    const authorizers = template.findResources('AWS::ApiGatewayV2::Authorizer');
    const [appAuthId] = Object.entries(authorizers).find(([, r]) => r.Properties.Name === 'CognitoAuth')!;
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((r) => r.Properties);
    const route = routes.find((r) => r.RouteKey === 'DELETE /v1/users/me');
    expect(route.AuthorizationType).toBe('JWT');
    expect(route.AuthorizerId).toEqual({ Ref: appAuthId });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-delete-account',
      Handler: 'index.deleteAccountHandler',
      Timeout: 30,
      Environment: { Variables: Match.objectLike({ USER_POOL_ID: Match.anyValue(), LIBRAX_TABLE: Match.anyValue() }) },
    });
  });

  test('so a Lambda de exclusao pode AdminDeleteUser, e so no proprio User Pool', () => {
    const { template } = synth(withDomain);
    const actions = policyActionsOf(template, 'librax-delete-account');
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:Query', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem', 'cognito-idp:AdminDeleteUser']));
    // nenhuma outra acao do Cognito
    expect(actions.filter((a) => a.startsWith('cognito-idp:'))).toEqual(['cognito-idp:AdminDeleteUser']);
    const del = statementsOf(template, 'librax-delete-account').find((st) => [st.Action].flat().includes('cognito-idp:AdminDeleteUser'));
    expect(del.Resource).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^LibraxUserPool/), 'Arn'] });

    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    // a exclusao pela propria pessoa e a do painel (pedido pela LGPD); a Lambda de leitura do painel nao
    const withDelete = policies.filter((p) => JSON.stringify(p.Properties.PolicyDocument).includes('cognito-idp:AdminDeleteUser'));
    expect(withDelete).toHaveLength(2);
    expect(policyActionsOf(template, 'librax-admin')).not.toContain('cognito-idp:AdminDeleteUser');
  });

  test('acoes do painel numa Lambda propria: so estas acoes do Cognito, so no proprio User Pool', () => {
    const { template } = synth(withDomain);
    const cognitoActions = policyActionsOf(template, 'librax-admin-actions').filter((a) => a.startsWith('cognito-idp:')).sort();
    expect(cognitoActions).toEqual([
      'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser', 'cognito-idp:AdminGetUser', 'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:AdminRemoveUserFromGroup', 'cognito-idp:AdminUserGlobalSignOut', 'cognito-idp:ListUsers',
    ]);
    const st = statementsOf(template, 'librax-admin-actions').find((s) => [s.Action].flat().includes('cognito-idp:AdminDisableUser'));
    expect(st.Resource).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^LibraxUserPool/), 'Arn'] });
    // a Lambda de leitura do painel continua sem escrever: nem no Cognito nem na tabela
    const leitura = policyActionsOf(template, 'librax-admin');
    for (const a of [
      'cognito-idp:AdminDisableUser', 'cognito-idp:AdminEnableUser', 'cognito-idp:AdminUserGlobalSignOut',
      'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminRemoveUserFromGroup',
    ]) {
      expect(leitura).not.toContain(a);
    }
    expect(leitura.filter((a) => /dynamodb:(Put|Update|Delete|BatchWrite)/.test(a))).toEqual([]);
    // as cinco rotas vao para ela, com o autorizador do painel
    const [actionsId] = Object.entries(template.findResources('AWS::Lambda::Function'))
      .find(([, r]) => r.Properties.FunctionName === 'librax-admin-actions')!;
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route'))
      .map((r) => r.Properties.RouteKey as string)
      .filter((k) => k.startsWith('POST /v1/admin') || k.startsWith('DELETE /v1/admin'))
      .sort();
    expect(routes).toEqual([
      'DELETE /v1/admin/accounts/{userId}',
      'DELETE /v1/admin/accounts/{userId}/admin',
      'POST /v1/admin/accounts/{userId}/admin',
      'POST /v1/admin/accounts/{userId}/disable',
      'POST /v1/admin/accounts/{userId}/enable',
    ]);
    // so a Lambda das acoes poe ou tira alguem de um grupo
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const withGroups = policies.filter((p) => /AdminAddUserToGroup|AdminRemoveUserFromGroup/.test(JSON.stringify(p.Properties.PolicyDocument)));
    expect(withGroups).toHaveLength(1);
    expect(actionsId).toMatch(/^AdminActionsFn/);
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
  test('com zona do Route 53 cria A/AAAA da landing (apex e www), do app e A do Cognito', () => {
    const { template } = synth({
      ...withDomain,
      'librax:hostedZoneId': 'Z0000000000000000000',
      'librax:hostedZoneName': 'librax.example',
    });
    for (const name of ['librax.example.', 'www.librax.example.', 'app.librax.example.']) {
      template.resourcePropertiesCountIs('AWS::Route53::RecordSet', { Name: name }, 2);
    }
    template.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'auth.librax.example.', Type: 'A' });
    template.resourceCountIs('AWS::Route53::RecordSet', 7);
    // apex e app apontam para CloudFronts diferentes
    const records = Object.values(template.findResources('AWS::Route53::RecordSet')).map((r) => r.Properties);
    const target = (name: string) => JSON.stringify(records.find((r) => r.Name === name && r.Type === 'A').AliasTarget);
    expect(target('librax.example.')).toContain('LibraxLandingCDN');
    expect(target('www.librax.example.')).toContain('LibraxLandingCDN');
    expect(target('app.librax.example.')).not.toContain('LibraxLandingCDN');
    // o dominio do Cognito espera o apex resolver
    const [domainId, domain] = Object.entries(template.findResources('AWS::Cognito::UserPoolDomain'))[0];
    expect(domainId).toBeDefined();
    expect(JSON.stringify(domain.DependsOn)).toMatch(/LandingAlias/);
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

  test('o mesmo job semanal zera as squads (SPEC 04 0.3), com acesso a tabela', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-close-league',
      Description: Match.stringLikeRegexp('squads'),
      Environment: { Variables: Match.objectLike({ LIBRAX_TABLE: Match.anyValue() }) },
    });
    template.resourceCountIs('AWS::Scheduler::Schedule', 3); // fechamento semanal, lembretes e job do painel
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

describe('Painel de administracao', () => {
  test('grupos admin e owner (dono do painel) no User Pool', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'admin' });
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'owner' });
  });

  test('app client proprio do painel: login pela API do User Pool (SRP), sem login hospedado', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'librax-admin',
      GenerateSecret: false,
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      AllowedOAuthFlowsUserPoolClient: false,
      AllowedOAuthFlows: Match.absent(),
      CallbackURLs: Match.absent(),
      LogoutURLs: Match.absent(),
      SupportedIdentityProviders: ['COGNITO'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      RefreshTokenValidity: 720,
    });
  });

  test('rotas /v1/admin com o autorizador do painel (o token do app nao serve)', () => {
    const { template } = synth(withDomain);
    const authorizers = template.findResources('AWS::ApiGatewayV2::Authorizer');
    const adminAuth = Object.entries(authorizers).find(([, r]) => r.Properties.Name === 'CognitoAdminAuth')!;
    const appAuth = Object.entries(authorizers).find(([, r]) => r.Properties.Name === 'CognitoAuth')!;
    expect(adminAuth).toBeDefined();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const [adminClientId] = Object.entries(clients).find(([, r]) => r.Properties.ClientName === 'librax-admin')!;
    expect(adminAuth[1].Properties.JwtConfiguration.Audience).toEqual([{ Ref: adminClientId }]);

    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((r) => r.Properties);
    const admin = routes.filter((r) => r.RouteKey.startsWith('GET /v1/admin/'));
    expect(admin.map((r) => r.RouteKey).sort()).toEqual([
      'GET /v1/admin/accounts', 'GET /v1/admin/accounts/{userId}', 'GET /v1/admin/content', 'GET /v1/admin/cost',
      'GET /v1/admin/feedback', 'GET /v1/admin/me', 'GET /v1/admin/overview', 'GET /v1/admin/squads', 'GET /v1/admin/usage',
    ]);
    for (const r of admin) {
      expect(r.AuthorizationType).toBe('JWT');
      expect(r.AuthorizerId).toEqual({ Ref: adminAuth[0] });
    }
    // as rotas do app continuam no autorizador do app
    const lesson = routes.find((r) => r.RouteKey === 'POST /v1/lesson/complete');
    expect(lesson.AuthorizerId).toEqual({ Ref: appAuth[0] });
  });

  test('Lambda do painel so le a tabela e so lista usuarios do proprio User Pool', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-admin',
      Handler: 'index.adminRouter',
      Environment: { Variables: Match.objectLike({ USER_POOL_ID: Match.anyValue(), LIBRAX_TABLE: Match.anyValue() }) },
    });
    const actions = policyActionsOf(template, 'librax-admin');
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:Query', 'cognito-idp:ListUsers']));
    for (const write of ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem']) {
      expect(actions).not.toContain(write);
    }
    const listUsers = statementsOf(template, 'librax-admin').find((st) => [st.Action].flat().includes('cognito-idp:ListUsers'));
    expect(JSON.stringify(listUsers.Resource)).toContain('LibraxUserPool');
  });

  test('uma pessoa, uma conta: gatilho PreSignUp so lista e liga contas, sem outra acao do Cognito', () => {
    const { template } = synth();
    const [preId, preFn] = Object.entries(template.findResources('AWS::Lambda::Function'))
      .find(([, r]) => r.Properties.FunctionName === 'librax-pre-signup')!;
    expect(preFn.Properties.Timeout).toBe(5);
    template.hasResourceProperties('AWS::Lambda::Permission', {
      FunctionName: { 'Fn::GetAtt': [preId, 'Arn'] },
      Principal: 'cognito-idp.amazonaws.com',
    });
    const roleId = preFn.Properties.Role['Fn::GetAtt'][0];
    const statements = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((p) => p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleId))
      .flatMap((p) => p.Properties.PolicyDocument.Statement);
    const cognito = statements.filter((st: { Action: string | string[] }) => [st.Action].flat().some((a) => a.startsWith('cognito-idp:')));
    expect(cognito).toHaveLength(1);
    expect([cognito[0].Action].flat().sort()).toEqual(['cognito-idp:AdminLinkProviderForUser', 'cognito-idp:ListUsers']);
    expect(JSON.stringify(cognito[0].Resource)).toContain(':userpool/*');
  });

  test('conta nova: gatilho PostConfirmation conta no painel', () => {
    const { template } = synth(withDomain);
    const [fnId] = Object.keys(template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'librax-post-confirmation' },
    }));
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PostConfirmation: { 'Fn::GetAtt': [fnId, 'Arn'] } },
    });
  });

  test('saida da licao: POST /v1/lesson/abandon com o JWT do app', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /v1/lesson/abandon', AuthorizationType: 'JWT' });
    template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'librax-abandon-lesson', Handler: 'index.abandonLessonHandler' });
  });

  test('job diario do painel: 03:30 UTC, sem nova tentativa, com CloudWatch e Cost Explorer', () => {
    const { template } = synth(withDomain);
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'librax-ops-daily',
      ScheduleExpression: 'cron(30 3 * * ? *)',
      Target: Match.objectLike({ RetryPolicy: Match.objectLike({ MaximumRetryAttempts: 0 }) }),
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'librax-ops-daily',
      Environment: { Variables: Match.objectLike({ API_ID: Match.anyValue(), API_STAGE: 'api', FUNCTION_NAMES: Match.anyValue() }) },
    });
    expect(policyActionsOf(template, 'librax-ops-daily')).toEqual(
      expect.arrayContaining(['cloudwatch:GetMetricData', 'ce:GetCostAndUsage', 'dynamodb:UpdateItem']),
    );
  });

  test('/admin no mesmo CloudFront, bucket proprio, CSP sem terceiros e sem moldura', () => {
    const { template } = synth(withDomain);
    const config = behaviors(template);
    const admin = config.CacheBehaviors.filter((b: { PathPattern: string }) => b.PathPattern.startsWith('/admin'));
    expect(admin).toHaveLength(3);
    const shell = admin.find((b: { PathPattern: string }) => b.PathPattern === '/admin/*');
    expect(shell.FunctionAssociations[0].EventType).toBe('viewer-request');
    // origem do painel diferente da do app (o sync --delete de um nao apaga o outro)
    expect(shell.TargetOriginId).not.toBe(config.DefaultCacheBehavior.TargetOriginId);
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp("request.uri = '/admin/index.html'"),
    });
    const policy = headerPolicies(template).find((p) => p.Comment === 'Librax - painel admin (no-cache)');
    const csp = flat(policy.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    // login pela API do User Pool: o dominio do login hospedado nao entra
    expect(csp).toContain('https://cognito-idp.us-east-1.amazonaws.com');
    expect(csp).not.toContain('https://auth.librax.example');
    expect(csp).not.toContain('jsdelivr');
    const robots = policy.CustomHeadersConfig.Items.find((h: { Header: string }) => h.Header === 'X-Robots-Tag');
    expect(robots.Value).toContain('noindex');
  });
});

describe('Alarmes e orcamento', () => {
  test('alarmes de erros e duracao das Lambdas, 5xx da API e throttling do DynamoDB', () => {
    const { template } = synth({ ...withDomain, 'librax:alarmEmail': 'alertas@exemplo.com' });
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm')).map((r) => r.Properties);
    const names = alarms.map((a) => a.AlarmName).sort();
    expect(names).toEqual([
      'librax-api-5xx', 'librax-api-lambda-duration', 'librax-app-download', 'librax-close-league-duration',
      'librax-dynamodb-throttles', 'librax-lambda-errors', 'librax-lambda-throttles', 'librax-ops-daily-duration',
      'librax-reminders-duration',
    ]);
    const byName = Object.fromEntries(alarms.map((a) => [a.AlarmName, a]));
    expect(byName['librax-lambda-errors']).toMatchObject({ Namespace: 'AWS/Lambda', MetricName: 'Errors', Threshold: 1 });
    expect(byName['librax-api-5xx']).toMatchObject({ Namespace: 'AWS/ApiGateway', MetricName: '5xx' });
    expect(byName['librax-api-lambda-duration']).toMatchObject({ MetricName: 'IntegrationLatency', ExtendedStatistic: 'p95' });
    expect(byName['librax-close-league-duration'].Threshold).toBe(240000); // 80% de 5 min
    const ddb = byName['librax-dynamodb-throttles'].Metrics.map((m: { MetricStat?: { Metric: { MetricName: string } } }) =>
      m.MetricStat?.Metric.MetricName).filter(Boolean);
    expect(ddb.sort()).toEqual(['ReadThrottleEvents', 'WriteThrottleEvents']);
    // cabe nos 10 alarmes gratis do CloudWatch (cada metrica conta)
    const metricCount = alarms.reduce((n, a) => n + (a.Metrics ? a.Metrics.filter((m: { MetricStat?: unknown }) => m.MetricStat).length : 1), 0);
    expect(metricCount).toBeLessThanOrEqual(10);
    // todos avisam o topico SNS, ao disparar e ao voltar ao normal
    const [topicId] = Object.keys(template.findResources('AWS::SNS::Topic'));
    for (const a of alarms) {
      expect(a.AlarmActions).toEqual([{ Ref: topicId }]);
      expect(a.OKActions).toEqual([{ Ref: topicId }]);
    }
  });

  test('e-mail dos alarmes vem do contexto; sem ele, topico sem assinatura e aviso', () => {
    const withEmail = synth({ ...withDomain, 'librax:alarmEmail': 'alertas@exemplo.com' }).template;
    withEmail.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'alertas@exemplo.com' });

    const { stack, template } = synth(withDomain);
    template.resourceCountIs('AWS::SNS::Subscription', 0);
    template.resourceCountIs('AWS::SNS::Topic', 1);
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('librax:alarmEmail'));
    // nenhum e-mail fixo no codigo da infra (so os modelos com o dominio, como contato@${...})
    for (const file of ['librax-stack.ts', 'config.ts', 'cognito-email.ts']) {
      const code = readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
      expect(code).not.toMatch(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });

  test('AWS Budget mensal com aviso em 80% e 100% do gasto, 100% da previsao e valor configuravel', () => {
    const { template } = synth({
      ...withDomain, 'librax:alarmEmail': 'alertas@exemplo.com', 'librax:budgetEmail': 'financeiro@exemplo.com', 'librax:monthlyBudgetUsd': '25',
    });
    const [budget] = Object.values(template.findResources('AWS::Budgets::Budget')).map((r) => r.Properties);
    expect(budget.Budget).toMatchObject({ BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 25, Unit: 'USD' } });
    expect(budget.NotificationsWithSubscribers.map((n: { Notification: { Threshold: number; NotificationType: string } }) =>
      [n.Notification.NotificationType, n.Notification.Threshold])).toEqual([['ACTUAL', 80], ['ACTUAL', 100], ['FORECASTED', 100]]);
    for (const n of budget.NotificationsWithSubscribers) {
      expect(n.Subscribers).toEqual([{ SubscriptionType: 'EMAIL', Address: 'financeiro@exemplo.com' }]);
    }
  });

  test('budget usa o e-mail dos alarmes por padrao, 10 dolares, e nao existe sem e-mail', () => {
    const { template } = synth({ ...withDomain, 'librax:alarmEmail': 'alertas@exemplo.com' });
    const [budget] = Object.values(template.findResources('AWS::Budgets::Budget')).map((r) => r.Properties);
    expect(budget.Budget.BudgetLimit.Amount).toBe(10);
    expect(budget.NotificationsWithSubscribers[0].Subscribers[0].Address).toBe('alertas@exemplo.com');

    const { stack, template: none } = synth(withDomain);
    none.resourceCountIs('AWS::Budgets::Budget', 0);
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('Budget'));
  });

  test('valor de budget invalido para o synth', () => {
    expect(() => synth({ ...withDomain, 'librax:alarmEmail': 'a@exemplo.com', 'librax:monthlyBudgetUsd': 'dez' })).toThrow(/monthlyBudgetUsd/);
  });
});

/** Declaracoes da politica do papel de uma Lambda. */
function statementsOf(template: Template, functionName: string) {
  const fns = template.findResources('AWS::Lambda::Function');
  const [, fn] = Object.entries(fns).find(([, r]) => r.Properties.FunctionName === functionName)!;
  const roleRef = fn.Properties.Role['Fn::GetAtt'][0];
  const policies = Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) => p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleRef));
  return policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
}
function policyActionsOf(template: Template, functionName: string): string[] {
  return statementsOf(template, functionName).flatMap((s: { Action: string | string[] }) => [s.Action].flat());
}
