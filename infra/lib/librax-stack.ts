import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

/**
 * Stack principal do Librax (SPEC 02).
 *
 * Recursos criados:
 * - DynamoDB single-table `librax` com GSI1-GSI5
 * - Cognito User Pool + Identity Pool (convidado anonimo + email/Google/Apple)
 * - Lambda functions para cada endpoint (Node 22)
 * - API Gateway HTTP API (autorizador JWT Cognito)
 * - EventBridge Scheduler para fechar liga semanalmente
 * - S3 + CloudFront para conteudo estatico (curriculo JSON + videos de referencia)
 */
export class LibraxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // 1. DynamoDB single-table
    // -----------------------------------------------------------------------

    const table = new dynamodb.Table(this, 'LibraxTable', {
      tableName: 'librax',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,  // free tier + escala automaticamente
      removalPolicy: RemovalPolicy.RETAIN,  // nunca apagar dado de producao via CDK
    });

    // GSI1: SRS devidos (PK=USER#<id>, GSI1SK=DUE#<dueAt>)
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI2: liga do usuario (PK=USER#<id>, SK=LEAGUE#<period>)
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

    // -----------------------------------------------------------------------
    // 2. Cognito User Pool
    // -----------------------------------------------------------------------

    const userPool = new cognito.UserPool(this, 'LibraxUserPool', {
      userPoolName: 'librax-users',
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

    // Google IdP (credenciais via env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
    if (process.env.GOOGLE_CLIENT_ID) {
      new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdP', {
        userPool,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        },
      });
    }

    const userPoolClient = new cognito.UserPoolClient(this, 'LibraxAppClient', {
      userPool,
      authFlows: {
        userSrp: true,
        userPassword: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      },
      generateSecret: false,
    });

    // Identity Pool para acesso anonimo (convidado)
    const identityPool = new cognito.CfnIdentityPool(this, 'LibraxIdentityPool', {
      identityPoolName: 'librax_identity',
      allowUnauthenticatedIdentities: true,  // convidado pode jogar sem conta
      cognitoIdentityProviders: [{
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName,
      }],
    });

    // -----------------------------------------------------------------------
    // 3. S3 + CloudFront para conteudo estatico
    // -----------------------------------------------------------------------

    const contentBucket = new s3.Bucket(this, 'LibraxContentBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const contentDistribution = new cloudfront.Distribution(this, 'LibraxContentCDN', {
      comment: 'Librax - curriculo JSON + videos de referencia',
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(contentBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
    });

    // -----------------------------------------------------------------------
    // 4. Lambda functions
    // -----------------------------------------------------------------------

    const lambdaEnv: Record<string, string> = {
      LIBRAX_TABLE: table.tableName,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const lambdaDefaults: lambda.FunctionProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,  // Graviton: mais barato, mesma perf
      memorySize: 256,
      timeout: Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: lambdaEnv,
      code: lambda.Code.fromAsset('../services/api/src', {
        exclude: ['**/*.test.js', 'adapters/inMemoryRepo.js'],
      }),
      bundling: undefined,
    } as unknown as lambda.FunctionProps;

    const completeLessonFn = new lambda.Function(this, 'CompleteLessonFn', {
      ...lambdaDefaults,
      functionName: 'librax-complete-lesson',
      handler: 'handlers/lesson.completeLessonHandler',
      description: 'Valida score, atualiza XP/streak/SRS/conquistas (SPEC 02)',
    });

    const getDailyQueueFn = new lambda.Function(this, 'GetDailyQueueFn', {
      ...lambdaDefaults,
      functionName: 'librax-get-daily-queue',
      handler: 'handlers/lesson.getDailyQueueHandler',
      description: 'Monta a fila diaria de SRS + conteudo novo (SPEC 03)',
    });

    const createSquadFn = new lambda.Function(this, 'CreateSquadFn', {
      ...lambdaDefaults,
      functionName: 'librax-create-squad',
      handler: 'handlers/squads.createSquadHandler',
    });

    const joinSquadFn = new lambda.Function(this, 'JoinSquadFn', {
      ...lambdaDefaults,
      functionName: 'librax-join-squad',
      handler: 'handlers/squads.joinSquadHandler',
    });

    const leaveSquadFn = new lambda.Function(this, 'LeaveSquadFn', {
      ...lambdaDefaults,
      functionName: 'librax-leave-squad',
      handler: 'handlers/squads.leaveSquadHandler',
    });

    const getSquadFn = new lambda.Function(this, 'GetSquadFn', {
      ...lambdaDefaults,
      functionName: 'librax-get-squad',
      handler: 'handlers/squads.getSquadHandler',
    });

    const manageMemberFn = new lambda.Function(this, 'ManageMemberFn', {
      ...lambdaDefaults,
      functionName: 'librax-manage-member',
      handler: 'handlers/squads.manageMemberHandler',
    });

    const listMySquadsFn = new lambda.Function(this, 'ListMySquadsFn', {
      ...lambdaDefaults,
      functionName: 'librax-list-my-squads',
      handler: 'handlers/squads.listMySquadsHandler',
    });

    const disbandSquadFn = new lambda.Function(this, 'DisbandSquadFn', {
      ...lambdaDefaults,
      functionName: 'librax-disband-squad',
      handler: 'handlers/squads.disbandSquadHandler',
    });

    const transferOwnershipFn = new lambda.Function(this, 'TransferOwnershipFn', {
      ...lambdaDefaults,
      functionName: 'librax-transfer-ownership',
      handler: 'handlers/squads.transferOwnershipHandler',
    });

    const regenerateInviteFn = new lambda.Function(this, 'RegenerateInviteFn', {
      ...lambdaDefaults,
      functionName: 'librax-regenerate-invite',
      handler: 'handlers/squads.regenerateInviteCodeHandler',
    });

    const closeLeagueFn = new lambda.Function(this, 'CloseLeagueFn', {
      ...lambdaDefaults,
      functionName: 'librax-close-league',
      handler: 'handlers/closeLeague.handler',
      timeout: Duration.minutes(5),  // operacao batch pode demorar mais
      description: 'Fecha liga semanal: rankeia, promove/rebaixa (SPEC 02 sec 5.5)',
    });

    // Permissoes DynamoDB (principio do menor privilegio)
    const allLambdas = [
      completeLessonFn, getDailyQueueFn,
      createSquadFn, joinSquadFn, leaveSquadFn, getSquadFn,
      manageMemberFn, listMySquadsFn, disbandSquadFn,
      transferOwnershipFn, regenerateInviteFn,
    ];
    for (const fn of allLambdas) {
      table.grantReadWriteData(fn);
    }
    table.grantReadWriteData(closeLeagueFn);

    // -----------------------------------------------------------------------
    // 5. API Gateway HTTP API + authorizer JWT Cognito
    // -----------------------------------------------------------------------

    const httpApi = new apigatewayv2.HttpApi(this, 'LibraxApi', {
      apiName: 'librax-api',
      description: 'Librax HTTP API - endpoints de usuario',
      corsPreflight: {
        allowOrigins: ['*'],  // refinar em producao para o dominio do app
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: Duration.hours(1),
      },
    });

    const authorizer = new apigatewayv2authorizers.HttpJwtAuthorizer('CognitoAuth', userPool.userPoolProviderUrl, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    const addRoute = (
      method: apigatewayv2.HttpMethod,
      path: string,
      fn: lambda.Function,
    ) =>
      httpApi.addRoutes({
        path,
        methods: [method],
        integration: new apigatewayv2integrations.HttpLambdaIntegration(`${fn.functionName}Int`, fn),
        authorizer,
      });

    const M = apigatewayv2.HttpMethod;

    addRoute(M.POST,   '/v1/lesson/complete',                         completeLessonFn);
    addRoute(M.GET,    '/v1/lesson/queue',                            getDailyQueueFn);
    addRoute(M.POST,   '/v1/squads',                                  createSquadFn);
    addRoute(M.POST,   '/v1/squads/join',                             joinSquadFn);
    addRoute(M.GET,    '/v1/squads/{squadId}',                        getSquadFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/leave',                  leaveSquadFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/transfer',               transferOwnershipFn);
    addRoute(M.DELETE, '/v1/squads/{squadId}',                        disbandSquadFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/members/{userId}/manage', manageMemberFn);
    addRoute(M.POST,   '/v1/squads/{squadId}/invite-code/regenerate', regenerateInviteFn);
    addRoute(M.GET,    '/v1/users/me/squads',                         listMySquadsFn);

    // -----------------------------------------------------------------------
    // 6. EventBridge Scheduler - fechar liga semanal (toda segunda-feira 00:05 UTC)
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // 7. Outputs uteis
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'URL da API Gateway HTTP API',
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
    });
    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: identityPool.ref,
      description: 'Cognito Identity Pool ID (convidado anonimo)',
    });
    new cdk.CfnOutput(this, 'ContentCdnUrl', {
      value: `https://${contentDistribution.distributionDomainName}`,
      description: 'CloudFront URL para curriculo JSON e videos de referencia',
    });
    new cdk.CfnOutput(this, 'ContentBucketName', {
      value: contentBucket.bucketName,
      description: 'Nome do bucket S3 de conteudo',
    });
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'Nome da tabela DynamoDB',
    });
  }
}
