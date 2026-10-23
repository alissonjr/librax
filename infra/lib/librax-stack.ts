import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Annotations, Duration, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { readConfig, PLACEHOLDER_DOMAIN } from './config';
import {
  appCsp,
  vlibrasCsp,
  IMMUTABLE,
  NO_CACHE,
  PERMISSIONS_POLICY,
  SPA_REWRITE_FUNCTION,
  WASM_CONTENT_TYPE_FUNCTION,
} from './web-headers';

/** Raiz do backend (services/api): codigo das Lambdas, package-lock e node_modules. */
const API_DIR = path.join(__dirname, '..', '..', 'services', 'api');

/**
 * Stack principal do Librax (SPEC 02; plano mobile web, decisoes 4, 11 e 14, fase W3).
 *
 * Recursos criados:
 * - DynamoDB single-table `librax` com GSI1-GSI6 e TTL
 * - Cognito User Pool com dominio proprio, OAuth code + PKCE, Google (e Apple opcional)
 * - Lambda functions (Node 22, empacotadas com esbuild) para cada endpoint
 * - API Gateway HTTP API (autorizador JWT Cognito) no estagio `api`
 * - CloudFront unico na mesma origem: `/` app, `/content/*`, `/ml/*`, `/api/*`
 * - EventBridge Scheduler: fechar liga semanal e lembretes (Web Push e e-mail opcional)
 *
 * Parametros de contexto: ver lib/config.ts. O dominio padrao (librax.example) e placeholder.
 */
export class LibraxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = readConfig(this.node);
    const certificate = config.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'LibraxCertificate', config.certificateArn)
      : undefined;

    if (config.domainName === PLACEHOLDER_DOMAIN) {
      Annotations.of(this).addWarningV2(
        'librax:placeholder-domain',
        `Dominio placeholder (${PLACEHOLDER_DOMAIN}). Defina -c librax:domainName=... antes do deploy.`,
      );
    }
    if (!certificate) {
      Annotations.of(this).addWarningV2(
        'librax:no-certificate',
        'Sem librax:certificateArn: CloudFront fica no dominio *.cloudfront.net e o Cognito no prefixo amazoncognito.com.',
      );
    }

    // -----------------------------------------------------------------------
    // 1. DynamoDB single-table
    // -----------------------------------------------------------------------

    const table = new dynamodb.Table(this, 'LibraxTable', {
      tableName: 'librax',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,  // free tier + escala automaticamente
      timeToLiveAttribute: 'expiresAt',  // ATTEMPT# (idempotencia) expira em 60 dias
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,  // nunca apagar dado de producao via CDK
    });

    // GSI1: SRS devidos (PK=USER#<id>, GSI1SK=DUE#<dueAt>)
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI2: liga do usuario (PK=USER#<id>, SK=LEAGUE#<period>) e, no mesmo indice, as ligas
    // de uma semana (PK=LEAGUES#<period>, SK=LEAGUE#<leagueId>) para o fechamento semanal e as
    // squads com XP na semana (PK=SQUADS#<period>, SK=SQUAD#<squadId>) para o reset semanal
    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI3: squads do usuario (PK=USER#<id>, SK=SQUAD#<squadId>)
    table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI4: squads publicas ordenadas por xpWeekly (PK=SQUADS_PUBLIC, SK=XP#...)
    table.addGlobalSecondaryIndex({
      indexName: 'GSI4',
      partitionKey: { name: 'GSI4PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'GSI4SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI5: indice de convite (PK=INVITE#<code>, SK=META)
    table.addGlobalSecondaryIndex({
      indexName: 'GSI5',
      partitionKey: { name: 'GSI5PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'GSI5SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI6: lembretes por balde de fuso (PK=NOTIF#H<offset>, SK=USER#<id>); esparso
    table.addGlobalSecondaryIndex({
      indexName: 'GSI6',
      partitionKey: { name: 'GSI6PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'GSI6SK', type: dynamodb.AttributeType.STRING },
    });

    // -----------------------------------------------------------------------
    // 2. S3: app web e conteudo (curriculo, videos, modelos de ML)
    // -----------------------------------------------------------------------

    // Build do apps/web-poc (dist/). Upload: ver services/api/README.md.
    const webBucket = new s3.Bucket(this, 'LibraxWebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Chaves com o mesmo prefixo da URL: content/<courseId>/v<N>/... e ml/<versao>/...
    const contentBucket = new s3.Bucket(this, 'LibraxContentBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // 3. Cognito User Pool (dominio proprio, OAuth code + PKCE, Google, Apple opcional)
    // -----------------------------------------------------------------------

    const userPool = new cognito.UserPool(this, 'LibraxUserPool', {
      userPoolName: 'librax-users',
      // Lite cobre e-mail/senha e Google; acima de 10 mil MAU custa cerca de 1/3 do Essentials
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Dominio do login social. Com certificado: auth.<dominio> (o Cognito exige que o dominio
    // pai ja resolva; o registro A do app e criado antes, ver secao 8). Sem certificado: prefixo.
    const userPoolDomain = certificate
      ? userPool.addDomain('LibraxAuthDomain', {
          customDomain: { domainName: config.authDomainName, certificate },
        })
      : userPool.addDomain('LibraxAuthDomain', {
          cognitoDomain: { domainPrefix: config.cognitoDomainPrefix },
        });
    const authHost = certificate
      ? config.authDomainName
      : `${config.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`;

    const identityProviders: cognito.UserPoolClientIdentityProvider[] = [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ];
    const idpResources: Construct[] = [];

    // Google: client id no SSM e secret no Secrets Manager, resolvidos so no deploy
    // (o template guarda a referencia, nunca o valor).
    if (config.google.enabled) {
      idpResources.push(new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdP', {
        userPool,
        clientId: ssm.StringParameter.valueForStringParameter(this, config.google.clientIdParam),
        clientSecretValue: SecretValue.secretsManager(config.google.clientSecretName),
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        },
      }));
      identityProviders.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }

    // Apple: opcional e desligada (decisao 4: fluxo igual para todos; sem loja, sem obrigacao).
    if (config.apple.enabled) {
      idpResources.push(new cognito.UserPoolIdentityProviderApple(this, 'AppleIdP', {
        userPool,
        clientId: ssm.StringParameter.valueForStringParameter(this, config.apple.servicesIdParam),
        teamId: ssm.StringParameter.valueForStringParameter(this, config.apple.teamIdParam),
        keyId: ssm.StringParameter.valueForStringParameter(this, config.apple.keyIdParam),
        privateKeyValue: SecretValue.secretsManager(config.apple.privateKeySecretName),
        scopes: ['email', 'name'],
        attributeMapping: { email: cognito.ProviderAttribute.APPLE_EMAIL },
      }));
      identityProviders.push(cognito.UserPoolClientIdentityProvider.APPLE);
    }

    // -----------------------------------------------------------------------
    // 4. Lambda functions (esbuild: ESM do services/api vira um arquivo por handler)
    // -----------------------------------------------------------------------

    const lambdaEnv: Record<string, string> = {
      LIBRAX_TABLE: table.tableName,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const makeFn = (
      id: string,
      file: string,
      handler: string,
      extra: Partial<lambdaNodejs.NodejsFunctionProps> = {},
    ) =>
      new lambdaNodejs.NodejsFunction(this, id, {
        entry: path.join(API_DIR, 'src', 'handlers', file),
        handler,
        projectRoot: API_DIR,
        depsLockFilePath: path.join(API_DIR, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,  // Graviton: mais barato, mesma perf
        memorySize: 256,
        timeout: Duration.seconds(10),
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: {
          target: 'node22',
          sourceMap: true,
          minify: true,
          externalModules: ['@aws-sdk/*'],  // ja vem no runtime Node 22
        },
        ...extra,
        environment: { ...lambdaEnv, ...extra.environment },
      });

    const completeLessonFn = makeFn('CompleteLessonFn', 'lesson.js', 'completeLessonHandler', {
      functionName: 'librax-complete-lesson',
      description: 'Valida score, atualiza XP/streak/SRS/conquistas; idempotente por lessonAttemptId',
    });
    const getDailyQueueFn = makeFn('GetDailyQueueFn', 'lesson.js', 'getDailyQueueHandler', {
      functionName: 'librax-get-daily-queue',
      description: 'Monta a fila diaria de SRS + conteudo novo (SPEC 03)',
    });
    const reviewSignsFn = makeFn('ReviewSignsFn', 'practice.js', 'reviewSignsHandler', {
      functionName: 'librax-review-signs',
      description: 'Pratica diaria: grava a resposta no SRS (SM-2), sem XP; idempotente por reviewAttemptId',
    });
    const migrateGuestFn = makeFn('MigrateGuestFn', 'guest.js', 'migrateGuestHandler', {
      functionName: 'librax-migrate-guest',
      description: 'Reexecuta o log local do convidado com completeLesson (plano mobile web 3.6)',
      timeout: Duration.seconds(30),  // ate 200 conclusoes por envio
      memorySize: 512,
    });

    const createSquadFn = makeFn('CreateSquadFn', 'squads.js', 'createSquadHandler', { functionName: 'librax-create-squad' });
    const joinSquadFn = makeFn('JoinSquadFn', 'squads.js', 'joinSquadHandler', { functionName: 'librax-join-squad' });
    const leaveSquadFn = makeFn('LeaveSquadFn', 'squads.js', 'leaveSquadHandler', { functionName: 'librax-leave-squad' });
    const getSquadFn = makeFn('GetSquadFn', 'squads.js', 'getSquadHandler', { functionName: 'librax-get-squad' });
    const manageMemberFn = makeFn('ManageMemberFn', 'squads.js', 'manageMemberHandler', { functionName: 'librax-manage-member' });
    const listMySquadsFn = makeFn('ListMySquadsFn', 'squads.js', 'listMySquadsHandler', { functionName: 'librax-list-my-squads' });
    const disbandSquadFn = makeFn('DisbandSquadFn', 'squads.js', 'disbandSquadHandler', { functionName: 'librax-disband-squad' });
    const transferOwnershipFn = makeFn('TransferOwnershipFn', 'squads.js', 'transferOwnershipHandler', {
      functionName: 'librax-transfer-ownership',
    });
    const regenerateInviteFn = makeFn('RegenerateInviteFn', 'squads.js', 'regenerateInviteCodeHandler', {
      functionName: 'librax-regenerate-invite',
    });

    const getLeagueFn = makeFn('GetLeagueFn', 'league.js', 'getCurrentLeagueHandler', {
      functionName: 'librax-get-league',
      description: 'Liga da semana, ranking, tempo ate o fechamento e resultado nao visto (SPEC 02 12.7)',
    });
    const leagueResultSeenFn = makeFn('LeagueResultSeenFn', 'league.js', 'markLeagueResultSeenHandler', {
      functionName: 'librax-league-result-seen',
      description: 'Marca o LeagueResultSheet da semana como visto',
    });

    const subscribePushFn = makeFn('SubscribePushFn', 'push.js', 'subscribePushHandler', {
      functionName: 'librax-push-subscribe',
      description: 'Guarda inscricao Web Push (USER#<id> / PUSH#<hash>)',
    });
    const unsubscribePushFn = makeFn('UnsubscribePushFn', 'push.js', 'unsubscribePushHandler', {
      functionName: 'librax-push-unsubscribe',
    });
    const notificationPrefsFn = makeFn('NotificationPrefsFn', 'push.js', 'updateNotificationPrefsHandler', {
      functionName: 'librax-notification-prefs',
      description: 'Horario, fuso e opt-in de e-mail dos lembretes',
    });

    const closeLeagueFn = makeFn('CloseLeagueFn', 'closeLeague.js', 'handler', {
      functionName: 'librax-close-league',
      timeout: Duration.minutes(5),  // operacao batch pode demorar mais
      description: 'Fecha liga semanal (SPEC 02 sec 5.5) e zera o XP semanal das squads (SPEC 04 sec 0.3)',
    });

    const appUrl = `https://${config.domainName}`;
    const reminderFn = makeFn('ReminderFn', 'reminders.js', 'handler', {
      functionName: 'librax-reminders',
      timeout: Duration.minutes(5),
      memorySize: 512,
      description: 'Lembretes por Web Push (VAPID) e e-mail opcional (SPEC 05 12.3)',
      environment: {
        VAPID_PUBLIC_KEY_PARAM: config.vapid.publicKeyParam,
        VAPID_PRIVATE_KEY_PARAM: config.vapid.privateKeyParam,
        VAPID_SUBJECT: config.vapid.subject,
        EMAIL_REMINDERS_ENABLED: String(config.email.enabled),
        ...(config.email.enabled ? { EMAIL_FROM: config.email.from } : {}),
        APP_URL: appUrl,
      },
    });

    // Permissoes DynamoDB (principio do menor privilegio)
    const allLambdas = [
      completeLessonFn, getDailyQueueFn, reviewSignsFn, migrateGuestFn,
      createSquadFn, joinSquadFn, leaveSquadFn, getSquadFn,
      manageMemberFn, listMySquadsFn, disbandSquadFn,
      transferOwnershipFn, regenerateInviteFn,
      getLeagueFn, leagueResultSeenFn,
      subscribePushFn, unsubscribePushFn, notificationPrefsFn,
    ];
    for (const fn of allLambdas) {
      table.grantReadWriteData(fn);
    }
    table.grantReadWriteData(closeLeagueFn);
    table.grantReadWriteData(reminderFn);

    // Chaves VAPID: so leitura dos dois parametros; a SecureString usa a chave aws/ssm.
    const ssmArn = (name: string) =>
      this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.replace(/^\//, '') });
    reminderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters', 'ssm:GetParameter'],
      resources: [ssmArn(config.vapid.publicKeyParam), ssmArn(config.vapid.privateKeyParam)],
    }));
    reminderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
    }));

    // E-mail de lembrete (SES, opt-in): so a estrutura. A identidade do dominio e verificada
    // fora do CDK (DNS) e a conta precisa sair do sandbox do SES.
    if (config.email.enabled) {
      const fromDomain = config.email.from.split('@')[1];
      reminderFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [this.formatArn({ service: 'ses', resource: 'identity', resourceName: fromDomain })],
      }));
    }

    // -----------------------------------------------------------------------
    // 5. API Gateway HTTP API + authorizer JWT Cognito
    // -----------------------------------------------------------------------

    // O app chama a API pela mesma origem (/api/*, ver CloudFront), entao CORS so serve para
    // dev local e ferramentas: lista fechada, nunca '*'.
    const httpApi = new apigatewayv2.HttpApi(this, 'LibraxApi', {
      apiName: 'librax-api',
      description: 'Librax HTTP API - endpoints de usuario',
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [appUrl, ...config.extraCorsOrigins],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: Duration.hours(1),
      },
    });

    // Estagio `api`: o CloudFront repassa /api/v1/... e o API Gateway tira o prefixo do estagio.
    const apiStage = new apigatewayv2.HttpStage(this, 'LibraxApiStage', {
      httpApi,
      stageName: 'api',
      autoDeploy: true,
      throttle: { rateLimit: 50, burstLimit: 100 },
    });

    // -----------------------------------------------------------------------
    // 6. CloudFront unico na mesma origem (decisao 14)
    // -----------------------------------------------------------------------

    const webOrigin = cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(webBucket);
    const contentOrigin = cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(contentBucket);
    const apiOrigin = new cloudfrontOrigins.HttpOrigin(
      cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint)),
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const cspValue = appCsp(`https://${authHost}`, `https://cognito-idp.${this.region}.amazonaws.com`);
    const securityHeaders = (csp: string): cloudfront.ResponseSecurityHeadersBehavior => ({
      contentSecurityPolicy: config.cspReportOnly ? undefined : { contentSecurityPolicy: csp, override: true },
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN, override: true },
      referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
    });
    const headerPolicy = (id: string, comment: string, opts: { csp?: string; extra?: Record<string, string> }) => {
      const custom: Record<string, string> = { 'Permissions-Policy': PERMISSIONS_POLICY, ...opts.extra };
      if (config.cspReportOnly && opts.csp) custom['Content-Security-Policy-Report-Only'] = opts.csp;
      return new cloudfront.ResponseHeadersPolicy(this, id, {
        comment,
        securityHeadersBehavior: securityHeaders(opts.csp ?? cspValue),
        customHeadersBehavior: {
          customHeaders: Object.entries(custom).map(([header, value]) => ({ header, value, override: true })),
        },
      });
    };

    // index.html, sw.js, manifest, icones: sempre revalidados (deploy novo aparece na hora)
    const appShellHeaders = headerPolicy('AppShellHeaders', 'Librax - app (no-cache)', {
      csp: cspValue,
      extra: { 'Cache-Control': NO_CACHE },
    });
    // /assets/* do Vite tem hash no nome; /ml/<versao>/ e versionado
    const immutableHeaders = headerPolicy('ImmutableHeaders', 'Librax - arquivos com hash (immutable)', {
      csp: cspValue,
      extra: { 'Cache-Control': IMMUTABLE },
    });
    const contentHeaders = headerPolicy('ContentHeaders', 'Librax - conteudo (cache da origem)', { csp: cspValue });
    const vlibrasHeaders = headerPolicy('VlibrasHeaders', 'Librax - player VLibras (Unity)', {
      csp: vlibrasCsp(),
      extra: { 'Cache-Control': NO_CACHE },
    });
    const apiHeaders = new cloudfront.ResponseHeadersPolicy(this, 'ApiHeaders', {
      comment: 'Librax - API',
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
      },
      customHeadersBehavior: { customHeaders: [{ header: 'Cache-Control', value: 'no-store', override: false }] },
    });

    // TTL 0 por padrao: a borda revalida com o S3; com compressao gzip/brotli
    const appShellCache = new cloudfront.CachePolicy(this, 'AppShellCache', {
      comment: 'Librax - app shell revalidado a cada pedido',
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const staticBehavior = (
      origin: cloudfront.IOrigin,
      responseHeadersPolicy: cloudfront.IResponseHeadersPolicy,
      cachePolicy: cloudfront.ICachePolicy = cloudfront.CachePolicy.CACHING_OPTIMIZED,
    ): cloudfront.BehaviorOptions => ({
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy,
      responseHeadersPolicy,
      compress: true,
    });

    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      comment: 'Rotas do app sem extensao -> /index.html',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(SPA_REWRITE_FUNCTION),
    });
    // .wasm com Content-Type certo mesmo se o upload esquecer (compileStreaming exige)
    const wasmContentType = new cloudfront.Function(this, 'WasmContentType', {
      comment: 'Content-Type application/wasm',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(WASM_CONTENT_TYPE_FUNCTION),
    });
    const wasmBehavior = (origin: cloudfront.IOrigin): cloudfront.BehaviorOptions => ({
      ...staticBehavior(origin, immutableHeaders),
      functionAssociations: [{ function: wasmContentType, eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE }],
    });

    const distribution = new cloudfront.Distribution(this, 'LibraxCDN', {
      comment: 'Librax - app, conteudo, ML e API na mesma origem',
      domainNames: certificate ? [config.domainName] : undefined,
      certificate,
      minimumProtocolVersion: certificate ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,  // inclui borda em Sao Paulo
      defaultRootObject: 'index.html',
      defaultBehavior: {
        ...staticBehavior(webOrigin, appShellHeaders, appShellCache),
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/assets/*.wasm': wasmBehavior(webOrigin),
        '/assets/*': staticBehavior(webOrigin, immutableHeaders),
        '/vlibras/*': staticBehavior(webOrigin, vlibrasHeaders, appShellCache),
        '/content/*': staticBehavior(contentOrigin, contentHeaders),
        '/ml/*.wasm': wasmBehavior(contentOrigin),
        '/ml/*': staticBehavior(contentOrigin, immutableHeaders),
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: apiHeaders,
          compress: true,
        },
      },
    });

    // -----------------------------------------------------------------------
    // 7. App client OAuth (code + PKCE) e rotas da API
    // -----------------------------------------------------------------------

    // Callbacks do web: dominio proprio e, sem certificado, o *.cloudfront.net.
    const origins = [appUrl, ...(certificate ? [] : [`https://${distribution.distributionDomainName}`])];
    const userPoolClient = new cognito.UserPoolClient(this, 'LibraxAppClient', {
      userPool,
      authFlows: {
        userSrp: true,         // e-mail/senha pelo Amplify (SRP)
        userPassword: false,
      },
      oAuth: {
        // Cliente publico (sem secret): o Amplify usa PKCE no authorization code
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [...origins.map((o) => `${o}/auth/callback`), ...config.extraCallbackUrls],
        logoutUrls: [...origins.map((o) => `${o}/`), ...config.extraLogoutUrls],
      },
      supportedIdentityProviders: identityProviders,
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });
    for (const idp of idpResources) userPoolClient.node.addDependency(idp);

    // Sem Identity Pool: o convidado e 100% local (plano mobile web) e entra na API so depois
    // de criar conta, com o id token do User Pool (POST /v1/guest/migrate).

    // O app manda o id token (tem email e email_verified, usados no opt-in de e-mail)
    const authorizer = new apigatewayv2authorizers.HttpJwtAuthorizer('CognitoAuth', userPool.userPoolProviderUrl, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    const addRoute = (
      method: apigatewayv2.HttpMethod,
      routePath: string,
      fn: lambda.IFunction,
    ) =>
      httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new apigatewayv2integrations.HttpLambdaIntegration(
          `${fn.node.id}${method}${routePath.replace(/[^A-Za-z0-9]/g, '')}Int`,
          fn,
        ),
        authorizer,
      });

    const M = apigatewayv2.HttpMethod;

    addRoute(M.POST,   '/v1/lesson/complete',                         completeLessonFn);
    addRoute(M.GET,    '/v1/lesson/queue',                            getDailyQueueFn);
    addRoute(M.POST,   '/v1/practice/review',                         reviewSignsFn);
    addRoute(M.POST,   '/v1/guest/migrate',                           migrateGuestFn);
    addRoute(M.POST,   '/v1/squads',                                  createSquadFn);
    addRoute(M.POST,   '/v1/squads/join',                             joinSquadFn);
    addRoute(M.GET,    '/v1/squads/{squadId}',                        getSquadFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/leave',                  leaveSquadFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/transfer',               transferOwnershipFn);
    addRoute(M.DELETE, '/v1/squads/{squadId}',                        disbandSquadFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/members/{userId}/manage', manageMemberFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/invite-code/regenerate', regenerateInviteFn);
    addRoute(M.GET,    '/v1/users/me/squads',                         listMySquadsFn);
    addRoute(M.GET,    '/v1/league/current',                          getLeagueFn);
    addRoute(M.POST,   '/v1/league/result-seen',                      leagueResultSeenFn);
    addRoute(M.POST,   '/v1/push/subscriptions',                      subscribePushFn);
    addRoute(M.DELETE, '/v1/push/subscriptions/{subscriptionId}',     unsubscribePushFn);
    addRoute(M.PUT,    '/v1/notifications/preferences',               notificationPrefsFn);

    // -----------------------------------------------------------------------
    // 8. DNS (opcional): A/AAAA do app e do dominio do Cognito
    // -----------------------------------------------------------------------

    if (certificate && config.hostedZone) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'LibraxZone', {
        hostedZoneId: config.hostedZone.id,
        zoneName: config.hostedZone.name,
      });
      const appTarget = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution));
      const appA = new route53.ARecord(this, 'AppAlias', { zone, recordName: config.domainName, target: appTarget });
      new route53.AaaaRecord(this, 'AppAliasV6', { zone, recordName: config.domainName, target: appTarget });
      // O Cognito so aceita dominio proprio se o dominio pai ja resolve
      userPoolDomain.node.addDependency(appA);
      new route53.ARecord(this, 'AuthAlias', {
        zone,
        recordName: config.authDomainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.UserPoolDomainTarget(userPoolDomain)),
      });
    }

    // -----------------------------------------------------------------------
    // 9. EventBridge Scheduler
    // -----------------------------------------------------------------------

    // Fechar liga semanal (toda segunda-feira 00:05 UTC). O evento vai vazio: a Lambda fecha
    // todas as ligas da semana que terminou (paginado pelo GSI2) e, no mesmo job (SPEC 04 0.3),
    // zera o XP semanal das squads ativas na semana (GSI2 SQUADS#<semana>) guardando o ranking.
    // As duas partes sao idempotentes, entao as novas tentativas da invocacao assincrona nao
    // promovem ninguem duas vezes nem zeram XP da semana nova.
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    closeLeagueFn.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'CloseLeagueSchedule', {
      name: 'librax-close-league-weekly',
      description: 'Fecha liga semanal toda segunda-feira',
      scheduleExpression: 'cron(5 0 ? * MON *)',
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: closeLeagueFn.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    // Lembretes: de hora em hora, no minuto 0 UTC; a Lambda decide por fuso de cada usuario
    new scheduler.Schedule(this, 'ReminderSchedule', {
      scheduleName: 'librax-reminders-hourly',
      description: 'Lembretes por Web Push/e-mail (SPEC 05 12.3)',
      schedule: scheduler.ScheduleExpression.cron({ minute: '0' }),
      target: new schedulerTargets.LambdaInvoke(reminderFn, { retryAttempts: 0 }),
    });

    // -----------------------------------------------------------------------
    // 10. Outputs uteis (viram VITE_* no build do app, ver apps/web-poc/.env.example)
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'AppUrl', {
      value: certificate ? appUrl : `https://${distribution.distributionDomainName}`,
      description: 'URL do app (CloudFront)',
    });
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `${appUrl}/api`,
      description: 'API pela mesma origem (VITE_API_BASE=/api)',
    });
    new cdk.CfnOutput(this, 'ApiStageUrl', {
      value: apiStage.url,
      description: 'URL direta do estagio da HTTP API (diagnostico)',
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID (VITE_COGNITO_USER_POOL_ID)',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID (VITE_COGNITO_CLIENT_ID)',
    });
    new cdk.CfnOutput(this, 'AuthDomain', {
      value: authHost,
      description: 'Dominio do Cognito (VITE_COGNITO_DOMAIN)',
    });
    new cdk.CfnOutput(this, 'AuthDomainCloudFront', {
      value: userPoolDomain.cloudFrontEndpoint,
      description: 'Destino do CNAME/alias do dominio do Cognito (DNS fora do Route 53)',
    });
    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
      description: 'Destino do alias/CNAME do dominio do app',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'Para invalidar index.html e sw.js depois do upload',
    });
    new cdk.CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
      description: 'Bucket do app web (dist/ do apps/web-poc)',
    });
    new cdk.CfnOutput(this, 'ContentBucketName', {
      value: contentBucket.bucketName,
      description: 'Bucket de conteudo (content/...) e modelos (ml/<versao>/...)',
    });
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'Nome da tabela DynamoDB',
    });
  }
}
