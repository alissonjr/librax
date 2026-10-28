import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codeconnections from 'aws-cdk-lib/aws-codeconnections';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { tagProject } from './tags';

/**
 * CI/CD do Librax dentro da AWS (docs/ci-cd.md): um projeto do CodeBuild, sem CodePipeline, que roda
 * quando uma tag de versao (v1.2.3) chega ao GitHub. Ele roda todos os testes e, se todos passarem,
 * publica com o mesmo script do CloudShell (infra/scripts/lancar-cloudshell.sh --ci).
 *
 * Stack separada da LibraxStack e com app CDK proprio (bin/librax-ci.ts): o `cdk deploy --all` do
 * lancamento e o deploy do CI nunca a enxergam, entao o CI nao consegue se alterar. Publicada uma vez
 * pelo dono no CloudShell: `bash infra/scripts/lancar-cloudshell.sh --configurar-ci`.
 *
 * Custo: o CodeBuild tem 100 minutos por mes gratis (general1.small ou arm1.small, sem prazo); a
 * conexao com o GitHub, a regra do EventBridge e o parametro padrao do SSM nao cobram; os logs ficam
 * 2 semanas. Estimativa por versao em docs/ci-cd.md.
 *
 * Contexto (cdk.json, cdk.context.json ou `-c`):
 * | chave                   | padrao           | uso |
 * |-------------------------|------------------|-----|
 * | librax:accountId        | (vazio)          | conta do Librax (a mesma do lancamento) |
 * | librax:ciGithubRepo     | alissonjr/librax | repositorio no GitHub (dono/nome) |
 * | librax:ciCreateProject  | true             | false cria so a conexao (passo 1 do --configurar-ci, antes da aprovacao no console) |
 */

export const CI_STACK_NAME = 'LibraxCiStack';
export const CI_PROJECT_NAME = 'librax-lancamento';
export const CI_CONNECTION_NAME = 'librax-github';
export const CI_LOG_GROUP_NAME = `/aws/codebuild/${CI_PROJECT_NAME}`;
export const CI_BUILDSPEC_PATH = 'infra/ci/buildspec.yml';
export const CI_DEFAULT_REPO = 'alissonjr/librax';
/** So push de tag de versao (v1.2.3). O mesmo padrao esta em infra/ci/ci.sh (o teste confere). */
export const CI_TAG_REF_PATTERN = '^refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$';
/** Um lancamento normal leva de 15 a 25 minutos; a folga cobre uma troca demorada do CloudFront. */
export const CI_TIMEOUT_MINUTES = 60;
/** Contexto do CDK do lancamento, gravado pelo script do CloudShell e lido pelo CI. */
export const CI_CONTEXT_PARAM = '/librax/cdk-context';
const CONNECTION_SID = 'UsarConexaoGithub';
/** Nome fixo do topico de alarmes da LibraxStack (lib/librax-stack.ts); o teste confere. */
export const ALARM_TOPIC_NAME = 'librax-alarms';
/** A stack que o CI publica. Nunca a propria. */
export const DEPLOYED_STACK_NAME = 'LibraxStack';
export const CI_RULE_NAME = 'librax-ci-resultado';

export interface CiConfig {
  owner: string;
  repo: string;
  createProject: boolean;
  qualifier: string;
}

export function readCiConfig(node: Construct['node']): CiConfig {
  const raw = String(node.tryGetContext('librax:ciGithubRepo') ?? '').trim() || CI_DEFAULT_REPO;
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(raw);
  if (!m) throw new Error(`librax:ciGithubRepo precisa ser dono/nome (veio "${raw}")`);
  const create = node.tryGetContext('librax:ciCreateProject');
  return {
    owner: m[1],
    repo: m[2],
    createProject: !(create === false || create === 'false'),
    qualifier: String(node.tryGetContext('@aws-cdk/core:bootstrapQualifier') ?? 'hnb659fds'),
  };
}

export class LibraxCiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    tagProject(this);
    const config = readCiConfig(this.node);

    // Conexao com o GitHub pelo app "AWS Connector for GitHub". O CloudFormation cria PENDENTE; o dono
    // aprova uma vez no console (docs/ci-cd.md). Sem custo.
    const connection = new codeconnections.CfnConnection(this, 'GithubConnection', {
      connectionName: CI_CONNECTION_NAME,
      providerType: 'GitHub',
    });

    new cdk.CfnOutput(this, 'ConexaoGithubArn', {
      value: connection.attrConnectionArn,
      description: 'Conexao com o GitHub (aprovar uma vez no console: docs/ci-cd.md)',
    });
    new cdk.CfnOutput(this, 'ConexoesNoConsole', {
      value: `https://console.aws.amazon.com/codesuite/settings/connections?region=${this.region}`,
      description: 'Onde aprovar a conexao pendente',
    });

    // Passo 1 do --configurar-ci: so a conexao. O webhook do projeto so pode ser criado com ela ja
    // aprovada (DISPONIVEL), entao o projeto entra no segundo deploy.
    if (!config.createProject) return;

    const logGroup = new logs.LogGroup(this, 'BuildLogs', {
      logGroupName: CI_LOG_GROUP_NAME,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // O CodeBuild confere, ao criar o projeto, se o papel ja pode usar a conexao ("User is not authorized to
    // access connection", visto no primeiro --configurar-ci): essa permissao vai dentro do proprio papel,
    // que o projeto ja espera. A politica com as demais nao pode vir antes: ela cita o proprio projeto.
    const statements = ciPolicyStatements(this, config.qualifier, connection.attrConnectionArn);
    const role = new iam.Role(this, 'BuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
      description: 'CodeBuild do Librax: testa e publica a LibraxStack e os sites (docs/ci-cd.md)',
      inlinePolicies: {
        ConexaoGithub: new iam.PolicyDocument({ statements: statements.filter((st) => st.sid === CONNECTION_SID) }),
      },
    });
    for (const statement of statements.filter((st) => st.sid !== CONNECTION_SID)) {
      role.addToPolicy(statement);
    }

    const project = new codebuild.Project(this, 'Project', {
      projectName: CI_PROJECT_NAME,
      description: 'Librax: testes e lancamento a cada tag de versao (v1.2.3). docs/ci-cd.md',
      role,
      source: codebuild.Source.gitHub({
        owner: config.owner,
        repo: config.repo,
        cloneDepth: 1,
        reportBuildStatus: false,
        webhook: true,
        webhookFilters: [codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andHeadRefIs(CI_TAG_REF_PATTERN)],
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(CI_BUILDSPEC_PATH),
      environment: {
        // x86 como o CloudShell; general1.small (2 vCPU, 4 GiB) esta no free tier de 100 minutos
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2023_5,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      timeout: Duration.minutes(CI_TIMEOUT_MINUTES),
      queuedTimeout: Duration.minutes(30),
      // Um build por vez: uma segunda tag durante um build nao roda (o CodeBuild recusa); ver docs/ci-cd.md
      concurrentBuildLimit: 1,
      // Cache local (gratis, no proprio host, quando a AWS reaproveita a maquina): npm e downloads do app
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
      logging: { cloudWatch: { logGroup } },
    });
    // Credencial do repositorio pela conexao (GitHub App), so neste projeto, sem token guardado
    (project.node.defaultChild as codebuild.CfnProject).addPropertyOverride('Source.Auth', {
      Type: 'CODECONNECTIONS',
      Resource: connection.attrConnectionArn,
    });

    // Aviso por e-mail no topico de alarmes da LibraxStack (a assinatura ja confirmada no lancamento).
    // O ARN sai do nome fixo do topico: sem export entre stacks, nada trava deploys futuros da LibraxStack.
    const topicArn = this.formatArn({ service: 'sns', resource: ALARM_TOPIC_NAME });
    const topic = sns.Topic.fromTopicArn(this, 'AlarmTopic', topicArn);
    const rule = new events.Rule(this, 'BuildResultRule', {
      ruleName: CI_RULE_NAME,
      description: 'Resultado do CI/CD do Librax (sucesso, falha ou parado) no topico de alarmes',
      eventPattern: {
        source: ['aws.codebuild'],
        detailType: ['CodeBuild Build State Change'],
        detail: {
          'build-status': ['SUCCEEDED', 'FAILED', 'STOPPED'],
          'project-name': [CI_PROJECT_NAME],
        },
      },
    });
    const status = events.EventField.fromPath('$.detail.build-status');
    const versao = events.EventField.fromPath('$.detail.additional-information.source-version');
    const logsLink = events.EventField.fromPath('$.detail.additional-information.logs.deep-link');
    rule.addTarget(
      new eventsTargets.SnsTopic(topic, {
        message: events.RuleTargetInput.fromText(
          `Librax CI/CD: ${status} na versao ${versao} (SUCCEEDED = publicado; FAILED ou STOPPED = veja o log ` +
            `e docs/ci-cd.md). Log: ${logsLink}`,
        ),
      }),
    );

    // O EventBridge so publica no SNS com permissao na politica do topico. A LibraxStack nao define
    // politica no topico (vale a padrao da AWS), entao esta e a unica: repete a padrao (dono da conta,
    // usada pelos alarmes do CloudWatch) e libera so esta regra. O teste da LibraxStack confere que ela
    // continua sem politica propria no topico. Apagar esta stack volta o topico para a padrao.
    new sns.CfnTopicPolicy(this, 'AlarmTopicPolicy', {
      topics: [topicArn],
      policyDocument: alarmTopicPolicy(this, topicArn, rule.ruleArn),
    });

    new cdk.CfnOutput(this, 'Projeto', {
      value: project.projectName,
      description: 'Projeto do CodeBuild (CodeBuild > Projetos de build)',
    });
    new cdk.CfnOutput(this, 'HistoricoDosBuilds', {
      value: `https://console.aws.amazon.com/codesuite/codebuild/projects/${CI_PROJECT_NAME}/history?region=${this.region}`,
      description: 'Builds e logs do CI/CD',
    });
  }
}

/**
 * Permissoes do papel do CodeBuild: o minimo que o script de lancamento usa numa rodada completa (ver
 * docs/ci-cd.md, "Permissoes do CI"). O deploy da stack passa pelos papeis do bootstrap do CDK, como no
 * CloudShell; o resto sao as chamadas diretas do script. Nada de Cost Explorer (cobra por chamada): o CI
 * reaproveita a escolha gravada no contexto.
 */
export function ciPolicyStatements(stack: Stack, qualifier: string, connectionArn: string): iam.PolicyStatement[] {
  const { account, region } = stack;
  const arn = (service: string, resource: string, opts: { region?: string; account?: string } = {}) =>
    `arn:${stack.partition}:${service}:${opts.region ?? region}:${opts.account ?? account}:${resource}`;
  const cdkRole = (name: string) => `arn:${stack.partition}:iam::${account}:role/cdk-${qualifier}-${name}-${account}-${region}`;

  return [
    // cdk deploy: papeis do bootstrap (deploy, upload dos assets e leitura de contexto)
    new iam.PolicyStatement({
      sid: 'PapeisDoBootstrapDoCdk',
      actions: ['sts:AssumeRole', 'sts:TagSession'],
      resources: [cdkRole('deploy-role'), cdkRole('file-publishing-role'), cdkRole('lookup-role')],
    }),
    // Estado e outputs da LibraxStack e do CDKToolkit (o script espera a stack e le os outputs)
    new iam.PolicyStatement({
      sid: 'LerStacks',
      actions: ['cloudformation:DescribeStacks'],
      resources: [
        arn('cloudformation', `stack/${DEPLOYED_STACK_NAME}/*`),
        arn('cloudformation', 'stack/CDKToolkit/*'),
      ],
    }),
    // Contexto do lancamento (SecureString) e os parametros que o script le (VAPID publica, Google)
    new iam.PolicyStatement({
      sid: 'LerParametros',
      actions: ['ssm:GetParameter'],
      resources: [
        arn('ssm', `parameter${CI_CONTEXT_PARAM}`),
        arn('ssm', 'parameter/librax/vapid/public-key'),
        arn('ssm', 'parameter/librax/google/client-id'),
      ],
    }),
    new iam.PolicyStatement({
      sid: 'DecifrarContextoPeloSsm',
      actions: ['kms:Decrypt'],
      resources: [arn('kms', 'key/*')],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${region}.amazonaws.com` } },
    }),
    // Conferencias do script, so leitura e sem custo
    new iam.PolicyStatement({
      sid: 'ConferirSegredoDoGoogle',
      actions: ['secretsmanager:DescribeSecret'],
      resources: [arn('secretsmanager', 'secret:librax/google/client-secret-*')],
    }),
    new iam.PolicyStatement({
      sid: 'ConferirZona',
      actions: ['route53:GetHostedZone'],
      resources: [`arn:${stack.partition}:route53:::hostedzone/*`],
    }),
    new iam.PolicyStatement({
      sid: 'ConferirCertificado',
      actions: ['acm:DescribeCertificate'],
      resources: [arn('acm', 'certificate/*')],
    }),
    new iam.PolicyStatement({
      sid: 'ConferirSes',
      actions: ['ses:GetEmailIdentity'],
      resources: [arn('ses', 'identity/*')],
    }),
    new iam.PolicyStatement({
      sid: 'ConferirContaSesELambda',
      // GetAccount (SES) e GetAccountSettings (Lambda) nao aceitam recurso
      actions: ['ses:GetAccount', 'lambda:GetAccountSettings'],
      resources: ['*'],
    }),
    // Upload do app, dos modelos de ML, do painel e da landing: so os buckets da LibraxStack (o
    // CloudFormation da nome com o prefixo da stack em minusculas)
    new iam.PolicyStatement({
      sid: 'ListarBucketsDaStack',
      actions: ['s3:ListBucket'],
      resources: [`arn:${stack.partition}:s3:::${DEPLOYED_STACK_NAME.toLowerCase()}-*`],
    }),
    new iam.PolicyStatement({
      sid: 'EnviarParaBucketsDaStack',
      actions: ['s3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
      resources: [`arn:${stack.partition}:s3:::${DEPLOYED_STACK_NAME.toLowerCase()}-*/*`],
    }),
    // Invalidacao das paginas da landing (scripts/landing.mjs)
    new iam.PolicyStatement({
      sid: 'InvalidarCloudFront',
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:${stack.partition}:cloudfront::${account}:distribution/*`],
    }),
    // Clone do repositorio pela conexao (GitHub App)
    new iam.PolicyStatement({
      sid: CONNECTION_SID,
      actions: ['codeconnections:GetConnectionToken', 'codeconnections:GetConnection', 'codeconnections:UseConnection'],
      resources: [connectionArn],
    }),
  ];
}

/** Politica do topico de alarmes: a padrao da AWS (dono da conta) mais a regra do CI. */
export function alarmTopicPolicy(stack: Stack, topicArn: string, ruleArn: string): iam.PolicyDocument {
  return new iam.PolicyDocument({
    statements: [
      new iam.PolicyStatement({
        sid: '__default_statement_ID',
        principals: [new iam.AnyPrincipal()],
        actions: [
          'SNS:GetTopicAttributes',
          'SNS:SetTopicAttributes',
          'SNS:AddPermission',
          'SNS:RemovePermission',
          'SNS:DeleteTopic',
          'SNS:Subscribe',
          'SNS:ListSubscriptionsByTopic',
          'SNS:Publish',
        ],
        resources: [topicArn],
        conditions: { StringEquals: { 'AWS:SourceOwner': stack.account } },
      }),
      new iam.PolicyStatement({
        sid: 'LibraxCiResultado',
        principals: [new iam.ServicePrincipal('events.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [topicArn],
        conditions: { ArnEquals: { 'aws:SourceArn': ruleArn } },
      }),
    ],
  });
}
