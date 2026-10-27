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
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ce from 'aws-cdk-lib/aws-ce';
import { Annotations, Duration, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { readConfig, PLACEHOLDER_DOMAIN } from './config';
import {
  anomalyThresholdUsd,
  budgetName,
  API_STAGE_THROTTLE,
  DYNAMO_MAX_READ_UNITS,
  DYNAMO_MAX_WRITE_UNITS,
  RESERVED_CONCURRENCY,
  ROUTE_THROTTLES,
} from './cost-guards';
import { assetLinks, assetLinksFunction } from './assetlinks';
import { cognitoUserPoolEmail, COGNITO_USER_VERIFICATION } from './cognito-email';
import {
  adminCsp,
  appCsp,
  vlibrasCsp,
  ADMIN_SPA_REWRITE_FUNCTION,
  IMMUTABLE,
  ML_REVALIDATE,
  NO_CACHE,
  PERMISSIONS_POLICY,
  SPA_REWRITE_FUNCTION,
  WASM_CONTENT_TYPE_FUNCTION,
} from './web-headers';
import {
  landingCsp,
  landingRequestFunction,
  landingScriptHashes,
  LANDING_INLINE_SCRIPT_HASHES,
  LANDING_PERMISSIONS_POLICY,
  LANDING_SHORT_CACHE,
} from './landing';

/**
 * Buckets versionados: cada publicacao (sync --delete) deixa a versao anterior de cada arquivo como
 * "nao atual", e ela seria cobrada para sempre. Apaga as versoes antigas depois de 30 dias (tempo de
 * sobra para desfazer uma publicacao) e os envios em partes que nunca terminaram depois de 7 dias.
 */
const VERSIONED_BUCKET_LIFECYCLE: s3.LifecycleRule[] = [
  {
    id: 'versoes-antigas-30-dias',
    noncurrentVersionExpiration: Duration.days(30),
    abortIncompleteMultipartUploadAfter: Duration.days(7),
  },
];

/** Raiz do backend (services/api): codigo das Lambdas, package-lock e node_modules. */
const API_DIR = path.join(__dirname, '..', '..', 'services', 'api');

/**
 * Stack principal do Librax (SPEC 02; plano mobile web, decisoes 4, 11 e 14, fase W3).
 *
 * Recursos criados:
 * - DynamoDB single-table `librax` com GSI1-GSI6 e TTL
 * - Cognito User Pool com dominio proprio, OAuth code + PKCE, Google (e Apple opcional) e codigos
 *   por e-mail (gatilho Custom Message: HTML em pt-BR, en ou es) pelo envio padrao do Cognito ou,
 *   opcional, pelo SES do dominio, que tambem manda o aviso de acesso num aparelho novo
 * - Lambda functions (Node 22, empacotadas com esbuild) para cada endpoint
 * - API Gateway HTTP API (autorizador JWT Cognito) no estagio `api`
 * - CloudFront do app em app.<dominio>, tudo na mesma origem: `/` app, `/content/*`, `/ml/*`, `/api/*`
 *   e `/.well-known/assetlinks.json` do app Android (TWA, lib/assetlinks.ts)
 * - Landing publica (apps/landing) no dominio raiz, com bucket e CloudFront proprios; www -> apex
 * - EventBridge Scheduler: fechar liga semanal, lembretes (Web Push e e-mail opcional) e o job
 *   diario do painel de administracao (CloudWatch e Cost Explorer)
 * - Painel de administracao em /admin (bucket proprio), so para o grupo `admin` do Cognito
 * - Alarmes do CloudWatch com aviso por e-mail (SNS), AWS Budget mensal (80% e 100% do gasto e 100%
 *   da previsao) e, opcional, alerta de anomalia de custo (Cost Anomaly Detection)
 * - Travas de custo gratuitas (lib/cost-guards.ts): limite por rota da API, teto de vazao da tabela,
 *   concorrencia reservada opcional e alarme de download do CloudFront
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
      // Teto de vazao sob demanda (OnDemandThroughput, muda no lugar): acima disso o DynamoDB recusa em
      // vez de cobrar, e o alarme librax-dynamodb-throttles avisa. Vale para a tabela; os indices so
      // recebem escrita derivada dela e as leituras deles passam pelo limite da API.
      maxReadRequestUnits: DYNAMO_MAX_READ_UNITS,
      maxWriteRequestUnits: DYNAMO_MAX_WRITE_UNITS,
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
      lifecycleRules: VERSIONED_BUCKET_LIFECYCLE,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Chaves com o mesmo prefixo da URL: content/<courseId>/v<N>/... e ml/<versao>/...
    const contentBucket = new s3.Bucket(this, 'LibraxContentBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: VERSIONED_BUCKET_LIFECYCLE,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Painel de administracao (apps/admin-web, dist/ em admin/). Bucket proprio para o
    // `s3 sync --delete` do app nunca apagar o painel (e vice-versa).
    const adminBucket = new s3.Bucket(this, 'LibraxAdminBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: VERSIONED_BUCKET_LIFECYCLE,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Landing publica (apps/landing, dist/). Bucket proprio: o sync de um site nao apaga o outro.
    const landingBucket = new s3.Bucket(this, 'LibraxLandingBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: VERSIONED_BUCKET_LIFECYCLE,
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
      // "Esqueci a senha" so por e-mail. Os codigos (cadastro e nova senha) saem pelo envio padrao do
      // Cognito (50 por dia) ou, com librax:cognitoEmailSes, pelo SES do dominio (lib/cognito-email.ts;
      // docs/spec-02-backend-gestao-engajamento.md, secao 2)
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      email: cognitoUserPoolEmail(config),
      // Texto padrao do codigo em portugues; o gatilho Custom Message (abaixo) manda o e-mail com a
      // identidade do Librax no idioma da pessoa e cai neste texto se falhar
      userVerification: COGNITO_USER_VERIFICATION,
      // Segundo fator opcional e so por aplicativo autenticador (TOTP, gratis; nunca SMS). Quem usa o
      // app nao ve nada disso; o painel exige o fator de quem e admin (handlers/admin.js) e guia a
      // configuracao no primeiro acesso (apps/admin-web). MfaConfiguration e EnabledMfas mudam no lugar.
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      // Nem o CloudFormation nem o console apagam o User Pool (e as contas) por engano
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Dominio do login social. Com certificado: auth.<dominio> (o Cognito exige que o dominio
    // pai ja resolva; os registros A da landing e do app sao criados antes, ver secao 8). Sem
    // certificado: prefixo.
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

    // Grupo do painel de administracao: o id token de quem esta nele leva `cognito:groups`, que
    // a Lambda do painel confere. Dar acesso: docs/painel-admin.md.
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'admin',
      description: 'Painel de administracao (/admin), so leitura',
      precedence: 0,
    });

    // -----------------------------------------------------------------------
    // 4. Lambda functions (esbuild: ESM do services/api vira um arquivo por handler)
    // -----------------------------------------------------------------------

    const lambdaEnv: Record<string, string> = {
      LIBRAX_TABLE: table.tableName,
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Concorrencia reservada (librax:lambdaReservedConcurrency, desligada por padrao): cada Lambda da
    // API tem o seu teto (lib/cost-guards.ts), e um abuso numa rota nao toma a conta inteira. Com a cota
    // da conta em 10 (conta nova) a reserva faz o deploy falhar: o script de lancamento confere antes.
    const reserved = (functionName?: string) =>
      config.lambdaReservedConcurrency && functionName && RESERVED_CONCURRENCY[functionName] !== undefined
        ? { reservedConcurrentExecutions: RESERVED_CONCURRENCY[functionName] }
        : {};

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
        ...reserved(extra.functionName),
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
    const abandonLessonFn = makeFn('AbandonLessonFn', 'lesson.js', 'abandonLessonHandler', {
      functionName: 'librax-abandon-lesson',
      description: 'Saida no meio da licao: so contadores do painel de administracao',
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

    // Exclusao de conta (LGPD): squads, ligas, a particao USER#<id> e por ultimo o usuario no Cognito
    const deleteAccountFn = makeFn('DeleteAccountFn', 'account.js', 'deleteAccountHandler', {
      functionName: 'librax-delete-account',
      description: 'Exclusao de conta (LGPD): dados da pessoa na tabela e o usuario no Cognito',
      timeout: Duration.seconds(30),  // conta grande: varias paginas de SRS e tentativas
      environment: { USER_POOL_ID: userPool.userPoolId },
    });

    // Progresso da conta para o app gravar no aparelho (entrar no comeco do app ou num aparelho novo)
    const getProgressFn = makeFn('GetProgressFn', 'progress.js', 'getProgressHandler', {
      functionName: 'librax-get-progress',
      description: 'Progresso da conta (licoes, revisoes, XP por dia e conquistas) para o app; so le',
    });

    const closeLeagueFn = makeFn('CloseLeagueFn', 'closeLeague.js', 'handler', {
      functionName: 'librax-close-league',
      timeout: Duration.minutes(5),  // operacao batch pode demorar mais
      description: 'Fecha liga semanal (SPEC 02 sec 5.5) e zera o XP semanal das squads (SPEC 04 sec 0.3)',
    });

    const appUrl = `https://${config.appDomainName}`;
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

    // Painel de administracao: uma Lambda para todas as rotas /v1/admin (so leitura)
    const adminFn = makeFn('AdminFn', 'admin.js', 'adminRouter', {
      functionName: 'librax-admin',
      description: 'Painel de administracao (so leitura, grupo admin): operacao, conteudo, contas, squads, custo',
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: { USER_POOL_ID: userPool.userPoolId },
    });
    // Conta nova (gatilho PostConfirmation do Cognito): so soma nos contadores do painel
    const postConfirmationFn = makeFn('PostConfirmationFn', 'postConfirmation.js', 'handler', {
      functionName: 'librax-post-confirmation',
      description: 'Conta nova nos contadores do painel; nunca bloqueia o cadastro',
      timeout: Duration.seconds(5),
    });
    userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);
    // E-mails de codigo (cadastro, reenvio e nova senha) com a identidade do Librax, em HTML e no idioma
    // da pessoa (lib/cognito-email.ts). Gatilho no LambdaConfig: atualizacao do User Pool no lugar.
    const customMessageFn = makeFn('CustomMessageFn', 'customMessage.js', 'handler', {
      functionName: 'librax-custom-message',
      description: 'E-mails de codigo do Cognito com a identidade do Librax, em pt-BR, en ou es',
      timeout: Duration.seconds(5),
      environment: { APP_URL: appUrl },
    });
    userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    // Aparelhos conhecidos da conta e o aviso de acesso novo por e-mail (feito por nos, sem o plano
    // pago do Cognito). O e-mail so sai com o SES ligado para o Cognito (librax:cognitoEmailSes), pelo
    // mesmo remetente dos codigos; desligado, a rota so registra o aparelho.
    const loginAlertFrom = config.cognitoEmail.ses
      ? `${config.cognitoEmail.fromName} <${config.cognitoEmail.from}>`
      : undefined;
    const reportDeviceFn = makeFn('ReportDeviceFn', 'devices.js', 'reportDeviceHandler', {
      functionName: 'librax-report-device',
      description: 'Aparelho da conta (hash, classe do navegador), idioma do app e aviso de acesso novo',
      environment: { APP_URL: appUrl, ...(loginAlertFrom ? { LOGIN_ALERT_FROM: loginAlertFrom } : {}) },
    });

    // Dados de uso anonimos e nota do app: rotas publicas (sem login), uma Lambda para as tres. So
    // escreve nas chaves TEL#<id>, TELAGG e FBLIST (politica abaixo), nunca na conta nem no progresso.
    const telemetryFn = makeFn('TelemetryFn', 'telemetry.js', 'telemetryRouter', {
      functionName: 'librax-telemetry',
      description: 'Uso anonimo e nota do app (rotas publicas): soma na escrita, apaga pelo codigo anonimo',
    });

    // Permissoes DynamoDB (principio do menor privilegio)
    const allLambdas = [
      completeLessonFn, getDailyQueueFn, abandonLessonFn, reviewSignsFn, migrateGuestFn,
      createSquadFn, joinSquadFn, leaveSquadFn, getSquadFn,
      manageMemberFn, listMySquadsFn, disbandSquadFn,
      transferOwnershipFn, regenerateInviteFn,
      getLeagueFn, leagueResultSeenFn,
      subscribePushFn, unsubscribePushFn, notificationPrefsFn,
      deleteAccountFn, reportDeviceFn,
    ];
    for (const fn of allLambdas) {
      table.grantReadWriteData(fn);
    }
    table.grantReadWriteData(closeLeagueFn);
    table.grantReadWriteData(reminderFn);
    table.grantReadData(adminFn);          // o painel so le
    table.grantReadData(getProgressFn);    // o progresso da conta so e lido
    // Rota publica: so os itens do uso anonimo (dynamodb:LeadingKeys), sem Query nem Scan
    telemetryFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
      resources: [table.tableArn],
      conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TEL#*', 'TELAGG', 'FBLIST', 'FBLIST#*'] } },
    }));
    table.grantWriteData(postConfirmationFn);

    // Busca de conta pelo e-mail (ListUsers) e conferencia do segundo fator de quem abre o painel
    // (AdminGetUser: UserMFASettingList), so neste User Pool
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    }));

    // Exclusao de conta: so AdminDeleteUser, so neste User Pool (nenhuma outra acao do Cognito)
    deleteAccountFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminDeleteUser'],
      resources: [userPool.userPoolArn],
    }));

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

    // Aviso de acesso novo: so SendEmail, so a identidade do dominio do remetente dos codigos
    if (config.cognitoEmail.ses) {
      reportDeviceFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [this.formatArn({
          service: 'ses',
          region: config.cognitoEmail.sesRegion,
          resource: 'identity',
          resourceName: config.cognitoEmail.from.split('@')[1],
        })],
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
      // Limite global (lib/cost-guards.ts); as rotas pesadas tem limite proprio, ver addRoute abaixo
      throttle: API_STAGE_THROTTLE,
    });

    // -----------------------------------------------------------------------
    // 6. CloudFront unico na mesma origem (decisao 14)
    // -----------------------------------------------------------------------

    const webOrigin = cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(webBucket);
    const adminOrigin = cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(adminBucket);
    const contentOrigin = cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(contentBucket);
    const apiOrigin = new cloudfrontOrigins.HttpOrigin(
      cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint)),
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const cspValue = appCsp(`https://${authHost}`, `https://cognito-idp.${this.region}.amazonaws.com`);
    const securityHeaders = (
      csp: string,
      frameOption = cloudfront.HeadersFrameOption.SAMEORIGIN,
    ): cloudfront.ResponseSecurityHeadersBehavior => ({
      contentSecurityPolicy: config.cspReportOnly ? undefined : { contentSecurityPolicy: csp, override: true },
      contentTypeOptions: { override: true },
      frameOptions: { frameOption, override: true },
      referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
    });
    const headerPolicy = (
      id: string,
      comment: string,
      opts: {
        csp?: string;
        extra?: Record<string, string>;
        permissions?: string;
        frameOption?: cloudfront.HeadersFrameOption;
      },
    ) => {
      const custom: Record<string, string> = { 'Permissions-Policy': opts.permissions ?? PERMISSIONS_POLICY, ...opts.extra };
      if (config.cspReportOnly && opts.csp) custom['Content-Security-Policy-Report-Only'] = opts.csp;
      return new cloudfront.ResponseHeadersPolicy(this, id, {
        comment,
        securityHeadersBehavior: securityHeaders(opts.csp ?? cspValue, opts.frameOption),
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
    // /assets/* do Vite tem hash no nome; /ml/<versao>/ e versionado (so a pasta do MediaPipe)
    const immutableHeaders = headerPolicy('ImmutableHeaders', 'Librax - arquivos com hash (immutable)', {
      csp: cspValue,
      extra: { 'Cache-Control': IMMUTABLE },
    });
    // Modelos de ML sem versao no caminho: modelo republicado chega ao PWA e ao app Android sem
    // versao nova (o service worker busca por tras e o navegador revalida com o ETag)
    const mlModelHeaders = headerPolicy('MlModelHeaders', 'Librax - modelos de ML sem versao (revalida)', {
      csp: cspValue,
      extra: { 'Cache-Control': ML_REVALIDATE },
    });
    const contentHeaders = headerPolicy('ContentHeaders', 'Librax - conteudo (cache da origem)', { csp: cspValue });
    const vlibrasHeaders = headerPolicy('VlibrasHeaders', 'Librax - player VLibras (Unity)', {
      csp: vlibrasCsp(),
      extra: { 'Cache-Control': NO_CACHE },
    });
    // Painel: CSP propria (sem terceiros), sem moldura e fora dos buscadores
    const adminCspValue = adminCsp(`https://cognito-idp.${this.region}.amazonaws.com`);
    const adminShellHeaders = headerPolicy('AdminShellHeaders', 'Librax - painel admin (no-cache)', {
      csp: adminCspValue,
      extra: { 'Cache-Control': NO_CACHE, 'X-Robots-Tag': 'noindex, nofollow' },
    });
    const adminAssetHeaders = headerPolicy('AdminAssetHeaders', 'Librax - painel admin, arquivos com hash (immutable)', {
      csp: adminCspValue,
      extra: { 'Cache-Control': IMMUTABLE, 'X-Robots-Tag': 'noindex, nofollow' },
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
    const adminRewrite = new cloudfront.Function(this, 'AdminSpaRewrite', {
      comment: 'Rotas do painel sem extensao -> /admin/index.html',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(ADMIN_SPA_REWRITE_FUNCTION),
    });
    const adminShellBehavior: cloudfront.BehaviorOptions = {
      ...staticBehavior(adminOrigin, adminShellHeaders, appShellCache),
      functionAssociations: [{ function: adminRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
    };
    const wasmBehavior = (
      origin: cloudfront.IOrigin,
      headers: cloudfront.IResponseHeadersPolicy = immutableHeaders,
      cachePolicy?: cloudfront.ICachePolicy,
    ): cloudfront.BehaviorOptions => ({
      ...staticBehavior(origin, headers, cachePolicy),
      functionAssociations: [{ function: wasmContentType, eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE }],
    });

    // /ml/: so a pasta da versao do MediaPipe (WASM e modelos fixados pelo SHA-256) e imutavel. O resto
    // (classificador, sinais, letras com movimento, numeros e qualquer pasta nova) revalida com o S3 na
    // borda e no navegador. Versao nova do MediaPipe sem deploy cai na regra que revalida: funciona,
    // so com menos cache.
    const mlBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
    if (config.mediapipeVersion) {
      mlBehaviors[`/ml/${config.mediapipeVersion}/*.wasm`] = wasmBehavior(contentOrigin);
      mlBehaviors[`/ml/${config.mediapipeVersion}/*`] = staticBehavior(contentOrigin, immutableHeaders);
    } else {
      Annotations.of(this).addWarningV2(
        'librax:no-mediapipe-version',
        'Sem a versao do @mediapipe/tasks-vision (apps/web-poc/package.json ou librax:mediapipeVersion): ' +
          'todo o /ml/ revalida a cada pedido, sem cache imutavel.',
      );
    }
    mlBehaviors['/ml/*.wasm'] = wasmBehavior(contentOrigin, mlModelHeaders, appShellCache);
    mlBehaviors['/ml/*'] = staticBehavior(contentOrigin, mlModelHeaders, appShellCache);

    // App Android (TWA, apps/android-twa): o assetlinks.json sai pronto da borda (lib/assetlinks.ts)
    if (config.android.certFingerprints.length === 0) {
      Annotations.of(this).addWarningV2(
        'librax:no-android-fingerprint',
        'Sem librax:androidCertFingerprints: /.well-known/assetlinks.json sai vazio ([]) e o app Android ' +
          'abre com a barra de endereco. Ver docs/android-twa.md.',
      );
    }
    const assetLinksResponse = new cloudfront.Function(this, 'AssetLinks', {
      comment: 'Digital Asset Links do app Android (TWA)',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        assetLinksFunction(assetLinks(config.android.packageName, config.android.certFingerprints)),
      ),
    });
    const assetLinksHeaders = new cloudfront.ResponseHeadersPolicy(this, 'AssetLinksHeaders', {
      comment: 'Librax - assetlinks.json do app Android',
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'LibraxCDN', {
      comment: 'Librax - app, conteudo, ML e API na mesma origem',
      domainNames: certificate ? [config.appDomainName] : undefined,
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
        // Respondido pela CloudFront Function, sem ir ao bucket (o sync --delete do app o apagaria)
        '/.well-known/assetlinks.json': {
          ...staticBehavior(webOrigin, assetLinksHeaders, cloudfront.CachePolicy.CACHING_DISABLED),
          functionAssociations: [{ function: assetLinksResponse, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
        '/assets/*.wasm': wasmBehavior(webOrigin),
        '/assets/*': staticBehavior(webOrigin, immutableHeaders),
        // Player e animações do VLibras (scripts/vlibras-assets.mjs): a versão está na pasta
        '/vlibras/v*': staticBehavior(webOrigin, immutableHeaders),
        '/vlibras/sinais/*': staticBehavior(webOrigin, immutableHeaders),
        '/vlibras/*': staticBehavior(webOrigin, vlibrasHeaders, appShellCache),
        '/content/*': staticBehavior(contentOrigin, contentHeaders),
        ...mlBehaviors,
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: apiHeaders,
          compress: true,
        },
        '/admin/assets/*': staticBehavior(adminOrigin, adminAssetHeaders),
        '/admin': adminShellBehavior,
        '/admin/*': adminShellBehavior,
      },
    });
    const appOrigin = certificate ? appUrl : `https://${distribution.distributionDomainName}`;

    // -----------------------------------------------------------------------
    // 6b. Landing publica no dominio raiz (apex e www)
    // -----------------------------------------------------------------------

    // CloudFront proprio, e nao mais comportamentos no do app: o CloudFront escolhe o
    // comportamento pelo caminho, nunca pelo nome, e os dois sites tem conteudo diferente na raiz.
    // Separados, cada um tem cache, CSP e publicacao proprios e a landing nao mexe no app.
    const landingHashes = landingScriptHashes(config.landing.distDir);
    if (!landingHashes.fromBuild) {
      Annotations.of(this).addWarningV2(
        'librax:no-landing-build',
        `Sem o build da landing em ${config.landing.distDir}: a CSP usa o hash gravado em lib/landing.ts. ` +
          'Antes do deploy, rode npm run landing:build (em infra).',
      );
    } else if (landingHashes.hashes.join(' ') !== [...LANDING_INLINE_SCRIPT_HASHES].sort().join(' ')) {
      Annotations.of(this).addWarningV2(
        'librax:landing-hash-changed',
        'O script inline da landing mudou: o deploy usa o hash do build, mas atualize ' +
          'LANDING_INLINE_SCRIPT_HASHES em lib/landing.ts (npm run landing:hash).',
      );
    }
    const landingCspValue = landingCsp(landingHashes.hashes);
    const landingHtmlHeaders = headerPolicy('LandingHtmlHeaders', 'Librax - landing (cache curto)', {
      csp: landingCspValue,
      permissions: LANDING_PERMISSIONS_POLICY,
      frameOption: cloudfront.HeadersFrameOption.DENY,
      extra: { 'Cache-Control': LANDING_SHORT_CACHE },
    });
    const landingAssetHeaders = headerPolicy('LandingAssetHeaders', 'Librax - landing, arquivos com hash (immutable)', {
      csp: landingCspValue,
      permissions: LANDING_PERMISSIONS_POLICY,
      frameOption: cloudfront.HeadersFrameOption.DENY,
      extra: { 'Cache-Control': IMMUTABLE },
    });
    // Paginas e arquivos sem hash: 5 min na borda (o mesmo do Cache-Control)
    const landingShortCache = new cloudfront.CachePolicy(this, 'LandingShortCache', {
      comment: 'Librax - landing, paginas com cache curto',
      defaultTtl: Duration.minutes(5),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const landingRequest = new cloudfront.Function(this, 'LandingRequest', {
      comment: 'Landing: www -> apex, /app -> app, pasta -> index.html',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        landingRequestFunction(config.landing.domainName, config.landing.redirectDomainNames, appOrigin),
      ),
    });
    // A API do CloudFront recusa várias Functions criadas ao mesmo tempo ("Rate exceeded", visto no
    // primeiro deploy): uma depende da outra, para o CloudFormation criar em sequência
    [spaRewrite, wasmContentType, adminRewrite, assetLinksResponse, landingRequest].reduce((anterior, atual) => {
      atual.node.addDependency(anterior);
      return atual;
    });
    const landingOrigin = cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(landingBucket);

    const landingDistribution = new cloudfront.Distribution(this, 'LibraxLandingCDN', {
      comment: 'Librax - landing publica (apex e www)',
      domainNames: certificate ? [config.landing.domainName, ...config.landing.redirectDomainNames] : undefined,
      certificate,
      minimumProtocolVersion: certificate ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        ...staticBehavior(landingOrigin, landingHtmlHeaders, landingShortCache),
        functionAssociations: [{ function: landingRequest, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/assets/*': staticBehavior(landingOrigin, landingAssetHeaders),
      },
      // Sem ListBucket, caminho que nao existe volta 403 do S3: vira 404 com a pagina inicial
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: '/index.html',
        ttl: Duration.minutes(1),
      })),
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

    // Painel de administracao: app client proprio e autorizador que so aceita o id token dele. O
    // token do app nao abre as rotas /v1/admin, e a Lambda ainda confere o grupo `admin`
    // (cognito:groups) e o autenticador da conta.
    //
    // Login com tela propria (apps/admin-web, lib/auth.ts): e-mail e senha por SRP direto na API do
    // User Pool, com o desafio do autenticador (SOFTWARE_TOKEN_MFA) no mesmo fluxo. Sem login hospedado:
    // sem OAuth, callbacks nem Google neste client (conta do Google nao passa no segundo fator). O access
    // token de login pela API sempre tem o escopo aws.cognito.signin.user.admin, que configura o
    // autenticador da propria conta. Tudo aqui muda no lugar (ExplicitAuthFlows, AllowedOAuth*,
    // CallbackURLs, LogoutURLs, SupportedIdentityProviders e EnableTokenRevocation sao "No interruption").
    // O dominio do Cognito continua: o Google do app usa.
    const adminClient = new cognito.UserPoolClient(this, 'LibraxAdminClient', {
      userPool,
      userPoolClientName: 'librax-admin',
      // userSrp liga ALLOW_USER_SRP_AUTH e ALLOW_REFRESH_TOKEN_AUTH; senha em texto, nunca
      authFlows: { userSrp: true, userPassword: false, custom: false, adminUserPassword: false },
      disableOAuth: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      generateSecret: false,
      preventUserExistenceErrors: true,
      // Sair do painel revoga o refresh token (RevokeToken)
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.hours(12),
    });
    const adminAuthorizer = new apigatewayv2authorizers.HttpJwtAuthorizer('CognitoAdminAuth', userPool.userPoolProviderUrl, {
      jwtAudience: [adminClient.userPoolClientId],
    });

    const routesByKey = new Map<string, apigatewayv2.HttpRoute>();
    const addRoute = (
      method: apigatewayv2.HttpMethod,
      routePath: string,
      fn: lambda.IFunction,
      routeAuthorizer: apigatewayv2.IHttpRouteAuthorizer = authorizer,
    ) => {
      const routes = httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new apigatewayv2integrations.HttpLambdaIntegration(
          `${fn.node.id}${method}${routePath.replace(/[^A-Za-z0-9]/g, '')}Int`,
          fn,
        ),
        authorizer: routeAuthorizer,
      });
      routesByKey.set(`${method} ${routePath}`, routes[0]);
      return routes;
    };

    const M = apigatewayv2.HttpMethod;

    addRoute(M.POST,   '/v1/lesson/complete',                         completeLessonFn);
    addRoute(M.GET,    '/v1/lesson/queue',                            getDailyQueueFn);
    addRoute(M.POST,   '/v1/lesson/abandon',                          abandonLessonFn);
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
    addRoute(M.DELETE, '/v1/users/me',                                deleteAccountFn);
    addRoute(M.POST,   '/v1/users/me/devices',                        reportDeviceFn);
    addRoute(M.GET,    '/v1/users/me/progress',                       getProgressFn);
    addRoute(M.GET,    '/v1/league/current',                          getLeagueFn);
    addRoute(M.POST,   '/v1/league/result-seen',                      leagueResultSeenFn);
    addRoute(M.POST,   '/v1/push/subscriptions',                      subscribePushFn);
    addRoute(M.DELETE, '/v1/push/subscriptions/{subscriptionId}',     unsubscribePushFn);
    addRoute(M.PUT,    '/v1/notifications/preferences',               notificationPrefsFn);

    // Uso anonimo e nota do app: publicas (o convidado nao tem token). O codigo anonimo e o segredo
    // do DELETE; limite baixo por rota em lib/cost-guards.ts.
    const publicRoute = new apigatewayv2.HttpNoneAuthorizer();
    addRoute(M.POST,   '/v1/telemetry',                               telemetryFn, publicRoute);
    addRoute(M.DELETE, '/v1/telemetry/{id}',                          telemetryFn, publicRoute);
    addRoute(M.POST,   '/v1/feedback',                                telemetryFn, publicRoute);

    // Painel de administracao (so leitura): mesma Lambda, autorizador do app client do painel
    for (const routePath of [
      '/v1/admin/me',
      '/v1/admin/overview',
      '/v1/admin/content',
      '/v1/admin/accounts',
      '/v1/admin/accounts/{userId}',
      '/v1/admin/squads',
      '/v1/admin/cost',
      '/v1/admin/usage',
      '/v1/admin/feedback',
    ]) {
      addRoute(M.GET, routePath, adminFn, adminAuthorizer);
    }

    // Limite por rota (RouteSettings do estagio; o HttpStage do CDK so tem o global). O estagio
    // depende das rotas: o API Gateway recusa RouteSettings de rota que ainda nao existe.
    const routeSettings: Record<string, { ThrottlingRateLimit: number; ThrottlingBurstLimit: number }> = {};
    for (const [routeKey, limit] of Object.entries(ROUTE_THROTTLES)) {
      const route = routesByKey.get(routeKey);
      if (!route) throw new Error(`lib/cost-guards.ts: limite para a rota ${routeKey}, que nao existe na API`);
      routeSettings[routeKey] = { ThrottlingRateLimit: limit.rateLimit, ThrottlingBurstLimit: limit.burstLimit };
      apiStage.node.addDependency(route);
    }
    (apiStage.node.defaultChild as apigatewayv2.CfnStage).routeSettings = routeSettings;

    // -----------------------------------------------------------------------
    // 8. DNS (opcional): A/AAAA da landing (apex e www), do app e do dominio do Cognito
    // -----------------------------------------------------------------------

    if (certificate && config.hostedZone) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'LibraxZone', {
        hostedZoneId: config.hostedZone.id,
        zoneName: config.hostedZone.name,
      });
      const appTarget = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution));
      const appA = new route53.ARecord(this, 'AppAlias', { zone, recordName: config.appDomainName, target: appTarget });
      new route53.AaaaRecord(this, 'AppAliasV6', { zone, recordName: config.appDomainName, target: appTarget });
      const landingTarget = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(landingDistribution));
      const landingA = new route53.ARecord(this, 'LandingAlias', { zone, recordName: config.landing.domainName, target: landingTarget });
      new route53.AaaaRecord(this, 'LandingAliasV6', { zone, recordName: config.landing.domainName, target: landingTarget });
      config.landing.redirectDomainNames.forEach((recordName, i) => {
        const id = i === 0 ? 'Www' : `Www${i + 1}`;
        new route53.ARecord(this, `${id}Alias`, { zone, recordName, target: landingTarget });
        new route53.AaaaRecord(this, `${id}AliasV6`, { zone, recordName, target: landingTarget });
      });
      // O Cognito so aceita dominio proprio se o dominio pai ja resolve (auth.<dominio> -> apex)
      userPoolDomain.node.addDependency(appA, landingA);
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

    // Job diario do painel (00:30 em Brasilia): erros do dia que acabou (CloudWatch) e gasto do
    // mes (Cost Explorer, US$ 0,01 por chamada). Sem nova tentativa: cada uma pagaria de novo; o
    // alarme de erros avisa se falhar, e da para refazer o dia a mao ({ "day": "AAAA-MM-DD" }).
    const opsDailyName = 'librax-ops-daily';
    const watchedFns = [...allLambdas, closeLeagueFn, reminderFn, adminFn, postConfirmationFn, customMessageFn, telemetryFn, getProgressFn];
    const opsDailyFn = makeFn('OpsDailyFn', 'opsDaily.js', 'handler', {
      functionName: opsDailyName,
      timeout: Duration.minutes(2),
      description: 'Painel de administracao: erros do dia (CloudWatch) e custo do mes (Cost Explorer)',
      environment: {
        API_ID: httpApi.apiId,
        API_STAGE: apiStage.stageName,
        FUNCTION_NAMES: [...watchedFns.map((fn) => fn.functionName), opsDailyName].join(','),
      },
    });
    table.grantWriteData(opsDailyFn);
    opsDailyFn.addToRolePolicy(new iam.PolicyStatement({
      // as duas APIs so aceitam recurso `*`
      actions: ['cloudwatch:GetMetricData', 'ce:GetCostAndUsage'],
      resources: ['*'],
    }));
    new scheduler.Schedule(this, 'OpsDailySchedule', {
      scheduleName: opsDailyName,
      description: 'Painel de administracao: CloudWatch e Cost Explorer uma vez por dia',
      schedule: scheduler.ScheduleExpression.cron({ minute: '30', hour: '3' }),
      target: new schedulerTargets.LambdaInvoke(opsDailyFn, { retryAttempts: 0 }),
    });

    // -----------------------------------------------------------------------
    // 10. Alarmes (CloudWatch + SNS por e-mail) e AWS Budget
    // -----------------------------------------------------------------------

    // Alarmes agregados, para caber nos 10 alarmes gratis do CloudWatch (10 metricas aqui): erros
    // e throttling de todas as Lambdas da conta, duracao das Lambdas da API pela latencia de
    // integracao do estagio, duracao maxima dos jobs perto do timeout, 5xx da API, throttling
    // do DynamoDB (inclui o teto de vazao) e download do CloudFront do app. O detalhe por funcao
    // fica no painel (job diario).
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'librax-alarms',
      displayName: 'Librax - alertas',
    });
    if (config.alarms.email) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(config.alarms.email));
    } else {
      Annotations.of(this).addWarningV2(
        'librax:no-alarm-email',
        'Sem librax:alarmEmail: os alarmes existem, mas ninguem recebe o aviso por e-mail.',
      );
    }
    const notify = new cloudwatchActions.SnsAction(alarmTopic);
    const FIVE_MIN = Duration.minutes(5);
    const alarm = (id: string, props: cloudwatch.AlarmProps) => {
      const a = new cloudwatch.Alarm(this, id, {
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        ...props,
      });
      a.addAlarmAction(notify);
      a.addOkAction(notify); // avisa tambem quando volta ao normal
      return a;
    };

    alarm('LambdaErrorsAlarm', {
      alarmName: 'librax-lambda-errors',
      alarmDescription: 'Alguma Lambda falhou (excecao nao tratada, timeout ou job com erro). Detalhe por funcao no painel.',
      metric: new cloudwatch.Metric({ namespace: 'AWS/Lambda', metricName: 'Errors', statistic: 'Sum', period: FIVE_MIN }),
      threshold: 1,
      evaluationPeriods: 1,
    });
    alarm('LambdaThrottlesAlarm', {
      alarmName: 'librax-lambda-throttles',
      alarmDescription: 'Lambda recusada por limite de concorrencia da conta.',
      metric: new cloudwatch.Metric({ namespace: 'AWS/Lambda', metricName: 'Throttles', statistic: 'Sum', period: FIVE_MIN }),
      threshold: 1,
      evaluationPeriods: 1,
    });
    alarm('ApiLatencyAlarm', {
      alarmName: 'librax-api-lambda-duration',
      alarmDescription: 'Lambdas da API lentas: p95 da latencia de integracao acima de 5 s em 2 de 3 periodos.',
      metric: apiStage.metricIntegrationLatency({ statistic: 'p95', period: FIVE_MIN }),
      threshold: 5000,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
    });
    alarm('Api5xxAlarm', {
      alarmName: 'librax-api-5xx',
      alarmDescription: 'Respostas 5xx da API (erro interno nas Lambdas ou no API Gateway): 3 ou mais em 5 min.',
      metric: apiStage.metricServerError({ statistic: 'Sum', period: FIVE_MIN }),
      threshold: 3,
      evaluationPeriods: 1,
    });
    const jobs: Array<[string, lambdaNodejs.NodejsFunction, string, Duration]> = [
      ['CloseLeagueDurationAlarm', closeLeagueFn, 'librax-close-league', Duration.minutes(5)],
      ['ReminderDurationAlarm', reminderFn, 'librax-reminders', Duration.minutes(5)],
      ['OpsDailyDurationAlarm', opsDailyFn, opsDailyName, Duration.minutes(2)],
    ];
    for (const [id, fn, name, timeout] of jobs) {
      alarm(id, {
        alarmName: `${name}-duration`,
        alarmDescription: `Job ${name} perto do timeout (duracao maxima acima de 80%).`,
        metric: fn.metricDuration({ statistic: 'Maximum', period: FIVE_MIN }),
        threshold: timeout.toMilliseconds() * 0.8,
        evaluationPeriods: 1,
      });
    }
    alarm('DynamoThrottleAlarm', {
      alarmName: 'librax-dynamodb-throttles',
      alarmDescription: 'Leitura ou escrita recusada na tabela librax (throttling).',
      metric: new cloudwatch.MathExpression({
        expression: 'r + w',
        usingMetrics: {
          r: table.metric('ReadThrottleEvents', { statistic: 'Sum', period: FIVE_MIN }),
          w: table.metric('WriteThrottleEvents', { statistic: 'Sum', period: FIVE_MIN }),
        },
        period: FIVE_MIN,
        label: 'Throttling da tabela',
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });
    // Download do CloudFront do app (metrica padrao do CloudFront, gratis). A primeira instalacao baixa
    // de 30 a 45 MB; o limite (librax:appDownloadAlarmGbPerHour) fica bem acima do uso esperado e avisa
    // cedo de um abuso que gasta transferencia (sem WAF, o CloudFront nao barra sozinho).
    alarm('AppDownloadAlarm', {
      alarmName: 'librax-app-download',
      alarmDescription:
        `CloudFront do app entregou mais de ${config.appDownloadAlarmGbPerHour} GB em 1 hora (instalacao nova: 30 a 45 MB). ` +
        'Confira em CloudFront > Relatorios quem esta baixando.',
      // As metricas do CloudFront ficam em us-east-1 com DistributionId e Region=Global; sem a regiao
      // o alarme nunca recebe dado (o metricBytesDownloaded do CDK so poe o DistributionId)
      metric: new cloudwatch.Metric({
        namespace: 'AWS/CloudFront',
        metricName: 'BytesDownloaded',
        dimensionsMap: { DistributionId: distribution.distributionId, Region: 'Global' },
        statistic: 'Sum',
        period: Duration.hours(1),
      }),
      threshold: config.appDownloadAlarmGbPerHour * 1024 ** 3,
      evaluationPeriods: 1,
    });

    // Orcamento mensal com aviso por e-mail em 80% e 100% do gasto real e em 100% da previsao do mes
    // (valor em librax:monthlyBudgetUsd). Budgets sem acoes nao sao cobrados. A previsao so aparece
    // depois de algumas semanas de uso.
    const budgetEmail = config.budget.email;
    if (budgetEmail) {
      const notificationsWithSubscribers: budgets.CfnBudget.NotificationWithSubscribersProperty[] = [
        ...[80, 100].map((threshold) => ({ type: 'ACTUAL', threshold })),
        { type: 'FORECASTED', threshold: 100 },
      ].map(({ type, threshold }) => ({
        notification: {
          notificationType: type,
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
      }));
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          // Nome com o resumo dos avisos: trocar o e-mail ou um aviso substitui o orcamento sem
          // travar o deploy (lib/cost-guards.ts, budgetName)
          budgetName: budgetName(notificationsWithSubscribers),
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: config.budget.monthlyUsd, unit: 'USD' },
        },
        notificationsWithSubscribers,
      });
    } else {
      Annotations.of(this).addWarningV2(
        'librax:no-budget-email',
        'Sem librax:budgetEmail (ou librax:alarmEmail): o AWS Budget mensal nao e criado.',
      );
    }

    // Alerta de anomalia de custo (Cost Anomaly Detection, gratis), por e-mail num resumo diario.
    // Opcional (librax:costAnomalyAlerts): a API do Cost Explorer so responde depois que ele e ativado
    // na conta, e so cabe um monitor de servicos por conta (a AWS costuma criar um sozinha). O script
    // de lancamento le a conta e escolhe: usar o monitor que ja existe (ARN) ou criar um.
    if (config.costAnomaly.mode !== 'off') {
      if (!budgetEmail) {
        Annotations.of(this).addWarningV2(
          'librax:no-anomaly-email',
          'librax:costAnomalyAlerts ligado, mas sem e-mail (librax:budgetEmail ou librax:alarmEmail): o alerta nao e criado.',
        );
      } else {
        const monitorArn = config.costAnomaly.mode === 'existing'
          ? config.costAnomaly.monitorArn
          : new ce.CfnAnomalyMonitor(this, 'CostAnomalyMonitor', {
              monitorName: 'librax-servicos',
              monitorType: 'DIMENSIONAL',
              monitorDimension: 'SERVICE',
            }).attrMonitorArn;
        new ce.CfnAnomalySubscription(this, 'CostAnomalySubscription', {
          subscriptionName: 'librax-anomalias',
          frequency: 'DAILY',
          monitorArnList: [monitorArn],
          subscribers: [{ type: 'EMAIL', address: budgetEmail }],
          thresholdExpression: JSON.stringify({
            Dimensions: {
              Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
              MatchOptions: ['GREATER_THAN_OR_EQUAL'],
              Values: [String(anomalyThresholdUsd(config.budget.monthlyUsd))],
            },
          }),
        });
      }
    }

    // -----------------------------------------------------------------------
    // 11. Outputs uteis (viram VITE_* no build do app, ver apps/web-poc/.env.example)
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'AppUrl', {
      value: appOrigin,
      description: 'URL do app (CloudFront do app; VITE_APP_URL da landing)',
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
    new cdk.CfnOutput(this, 'AdminUrl', {
      value: `${appOrigin}/admin/`,
      description: 'Painel de administracao (so o grupo admin do Cognito)',
    });
    new cdk.CfnOutput(this, 'AdminClientId', {
      value: adminClient.userPoolClientId,
      description: 'App client do painel (VITE_COGNITO_CLIENT_ID do apps/admin-web)',
    });
    new cdk.CfnOutput(this, 'AdminBucketName', {
      value: adminBucket.bucketName,
      description: 'Bucket do painel (dist/ do apps/admin-web vai para admin/)',
    });
    new cdk.CfnOutput(this, 'LandingUrl', {
      value: certificate ? `https://${config.landing.domainName}` : `https://${landingDistribution.distributionDomainName}`,
      description: 'URL da landing (SITE_ORIGIN do build da landing)',
    });
    new cdk.CfnOutput(this, 'LandingBucketName', {
      value: landingBucket.bucketName,
      description: 'Bucket da landing (dist/ do apps/landing)',
    });
    new cdk.CfnOutput(this, 'LandingDistributionId', {
      value: landingDistribution.distributionId,
      description: 'Para invalidar as paginas da landing depois do upload',
    });
    new cdk.CfnOutput(this, 'LandingDistributionDomain', {
      value: landingDistribution.distributionDomainName,
      description: 'Destino do alias/CNAME do apex e do www',
    });
    new cdk.CfnOutput(this, 'LandingScriptHashes', {
      value: landingHashes.hashes.join(' ') || '(nenhum)',
      description: 'Hashes do script inline na CSP da landing (o landing:publicar confere com o build)',
    });
    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'Topico SNS dos alarmes (confirme a assinatura no e-mail)',
    });
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'Nome da tabela DynamoDB',
    });
  }
}
