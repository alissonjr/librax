import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import {
  ALARM_TOPIC_NAME,
  CI_BUILDSPEC_PATH,
  CI_CONNECTION_NAME,
  CI_CONTEXT_PARAM,
  CI_LOG_GROUP_NAME,
  CI_PROJECT_NAME,
  CI_STACK_NAME,
  CI_TAG_REF_PATTERN,
  LibraxCiStack,
} from '../lib/ci-stack';
import { LibraxStack } from '../lib/librax-stack';

// Stack do CI/CD (lib/ci-stack.ts) sintetizada sem conta AWS.

const CONTA = '111111111111';
const RAIZ = path.resolve(__dirname, '../..');

// Mesmas flags do cdk.json (particao literal no ARN, qualificador do bootstrap)
const CDK_JSON = JSON.parse(readFileSync(path.join(RAIZ, 'infra/cdk.json'), 'utf8')).context as Record<string, unknown>;

function synth(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context: { ...CDK_JSON, ...context } });
  const stack = new LibraxCiStack(app, CI_STACK_NAME, { env: { account: CONTA, region: 'us-east-1' } });
  return Template.fromStack(stack);
}

type Statement = { Action: string | string[]; Resource: unknown; Effect: string; Condition?: unknown; Principal?: unknown; Sid?: string };

function statements(template: Template, type: string): Statement[] {
  return Object.values(template.findResources(type)).flatMap(
    (r) => (r.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
  );
}

const lista = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

describe('projeto do CodeBuild', () => {
  test('so push de tag de versao dispara: nada de branch nem pull request', () => {
    const template = synth();
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: CI_PROJECT_NAME,
      Triggers: {
        Webhook: true,
        FilterGroups: [
          [
            { Type: 'EVENT', Pattern: 'PUSH' },
            { Type: 'HEAD_REF', Pattern: '^refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$' },
          ],
        ],
      },
    });
    const re = new RegExp(CI_TAG_REF_PATTERN);
    for (const ref of ['refs/tags/v1.0.0', 'refs/tags/v12.3.45']) expect(re.test(ref), ref).toBe(true);
    for (const ref of ['refs/heads/main', 'refs/tags/v1.0', 'refs/tags/v1.0.0-beta', 'refs/tags/1.0.0', 'refs/heads/v1.0.0']) {
      expect(re.test(ref), ref).toBe(false);
    }
  });

  test('general1.small x86 (free tier), Node 22 na imagem, um build por vez, tempo limite e sem modo privilegiado', () => {
    synth().hasResourceProperties('AWS::CodeBuild::Project', {
      Environment: {
        ComputeType: 'BUILD_GENERAL1_SMALL',
        Type: 'LINUX_CONTAINER',
        Image: 'aws/codebuild/amazonlinux-x86_64-standard:5.0',
        PrivilegedMode: false,
      },
      ConcurrentBuildLimit: 1,
      TimeoutInMinutes: 60,
      Cache: { Type: 'LOCAL', Modes: ['LOCAL_CUSTOM_CACHE'] },
    });
  });

  test('codigo do GitHub pela conexao (GitHub App), sem token guardado, e buildspec do repositorio', () => {
    const template = synth();
    template.hasResourceProperties('AWS::CodeConnections::Connection', {
      ConnectionName: CI_CONNECTION_NAME,
      ProviderType: 'GitHub',
    });
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: {
        Type: 'GITHUB',
        Location: 'https://github.com/alissonjr/librax.git',
        BuildSpec: CI_BUILDSPEC_PATH,
        GitCloneDepth: 1,
        Auth: { Type: 'CODECONNECTIONS', Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('GithubConnection'), 'ConnectionArn'] } },
      },
    });
    template.resourceCountIs('AWS::CodeBuild::SourceCredential', 0);
  });

  test('logs no CloudWatch por 2 semanas', () => {
    synth().hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: CI_LOG_GROUP_NAME, RetentionInDays: 14 });
  });

  test('passo 1 do --configurar-ci (ciCreateProject=false): so a conexao, que fica pendente ate a aprovacao', () => {
    const template = synth({ 'librax:ciCreateProject': 'false' });
    template.resourceCountIs('AWS::CodeConnections::Connection', 1);
    template.resourceCountIs('AWS::CodeBuild::Project', 0);
    template.resourceCountIs('AWS::IAM::Role', 0);
    template.resourceCountIs('AWS::Events::Rule', 0);
    template.resourceCountIs('AWS::SNS::TopicPolicy', 0);
  });

  test('repositorio por contexto', () => {
    synth({ 'librax:ciGithubRepo': 'outra/conta' }).hasResourceProperties('AWS::CodeBuild::Project', {
      Source: { Location: 'https://github.com/outra/conta.git' },
    });
    expect(() => synth({ 'librax:ciGithubRepo': 'sem-barra' })).toThrow(/dono\/nome/);
  });
});

describe('papel do CodeBuild (menor privilegio)', () => {
  test('sem AdministratorAccess, sem acao curinga e sem IAM', () => {
    const template = synth();
    const roles = Object.values(template.findResources('AWS::IAM::Role'));
    expect(roles).toHaveLength(1);
    expect(JSON.stringify(roles[0].Properties.ManagedPolicyArns ?? [])).not.toContain('AdministratorAccess');
    const inline = (roles[0].Properties.Policies as Array<{ PolicyDocument: { Statement: Statement[] } }>).flatMap(
      (p) => p.PolicyDocument.Statement,
    );
    const acoes = [...statements(template, 'AWS::IAM::Policy'), ...inline].flatMap((s) => lista(s.Action));
    for (const acao of acoes) {
      expect(acao, acao).not.toMatch(/\*$/);
      expect(acao, acao).not.toMatch(/^iam:/);
      expect(acao, acao).not.toMatch(/^ce:/); // Cost Explorer cobra por chamada
    }
  });

  test('assume so os papeis do bootstrap do CDK (deploy, upload de assets e leitura)', () => {
    const assume = statements(synth(), 'AWS::IAM::Policy').filter((s) => lista(s.Action).includes('sts:AssumeRole'));
    expect(assume).toHaveLength(1);
    expect(assume[0].Resource).toEqual([
      `arn:aws:iam::${CONTA}:role/cdk-hnb659fds-deploy-role-${CONTA}-us-east-1`,
      `arn:aws:iam::${CONTA}:role/cdk-hnb659fds-file-publishing-role-${CONTA}-us-east-1`,
      `arn:aws:iam::${CONTA}:role/cdk-hnb659fds-lookup-role-${CONTA}-us-east-1`,
    ]);
  });

  test('escrita so nos buckets da LibraxStack; contexto do SSM so leitura', () => {
    const todas = statements(synth(), 'AWS::IAM::Policy');
    const s3 = todas.filter((s) => lista(s.Action).some((a) => a.startsWith('s3:')));
    expect(s3.map((s) => s.Resource)).toEqual(['arn:aws:s3:::libraxstack-*', 'arn:aws:s3:::libraxstack-*/*']);
    const ssm = todas.filter((s) => lista(s.Action).some((a) => a.startsWith('ssm:')));
    expect(ssm.flatMap((s) => lista(s.Action))).toEqual(['ssm:GetParameter']);
    expect(JSON.stringify(ssm)).toContain(`parameter${CI_CONTEXT_PARAM}`);
    const resto = todas.flatMap((s) => lista(s.Action));
    expect(resto).not.toContain('ssm:PutParameter');
    expect(resto).not.toContain('cloudformation:CreateStack');
    expect(resto).not.toContain('cloudformation:UpdateStack');
  });

  test('conexao com o GitHub: permissao dentro do proprio papel, pronta antes do projeto', () => {
    // Primeiro --configurar-ci real: o CodeBuild recusou criar o projeto ("User is not authorized to access
    // connection") porque a politica com a conexao ainda nao estava no papel
    const template = synth();
    const [role] = Object.values(template.findResources('AWS::IAM::Role'));
    const inline = (role.Properties.Policies as Array<{ PolicyDocument: { Statement: Statement[] } }>).flatMap(
      (p) => p.PolicyDocument.Statement,
    );
    const conexao = inline.find((st) => lista(st.Action).includes('codeconnections:GetConnectionToken'));
    expect(conexao).toBeDefined();
    expect(lista(conexao!.Action)).toEqual(
      expect.arrayContaining(['codeconnections:GetConnection', 'codeconnections:UseConnection']),
    );
    // o projeto cita o papel, entao o CloudFormation so cria o projeto com o papel (e esta permissao) pronto
    const [project] = Object.values(template.findResources('AWS::CodeBuild::Project'));
    expect(JSON.stringify(project.Properties.ServiceRole)).toContain(Object.keys(template.findResources('AWS::IAM::Role'))[0]);
  });

  test('confianca so do CodeBuild da propria conta', () => {
    synth().hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Principal: { Service: 'codebuild.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': CONTA } },
          },
        ],
      },
    });
  });
});

describe('aviso do resultado no topico de alarmes', () => {
  const TOPICO = `arn:aws:sns:us-east-1:${CONTA}:${ALARM_TOPIC_NAME}`;

  test('regra do EventBridge: sucesso, falha e parado deste projeto, para o topico de alarmes da LibraxStack', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.codebuild'],
        'detail-type': ['CodeBuild Build State Change'],
        detail: { 'build-status': ['SUCCEEDED', 'FAILED', 'STOPPED'], 'project-name': [CI_PROJECT_NAME] },
      },
      Targets: [
        Match.objectLike({
          Arn: TOPICO,
          InputTransformer: Match.objectLike({ InputTemplate: Match.stringLikeRegexp('Librax CI/CD') }),
        }),
      ],
    });
    // Sem export nem referencia a outra stack: nada trava deploys futuros da LibraxStack
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  test('politica do topico: a padrao da conta (alarmes do CloudWatch) mais so esta regra no EventBridge', () => {
    const template = synth();
    template.hasResourceProperties('AWS::SNS::TopicPolicy', { Topics: [TOPICO] });
    const [padrao, regra] = statements(template, 'AWS::SNS::TopicPolicy');
    expect(padrao.Principal).toEqual({ AWS: '*' });
    expect(padrao.Condition).toEqual({ StringEquals: { 'AWS:SourceOwner': CONTA } });
    expect(lista(padrao.Action)).toContain('SNS:Publish');
    expect(regra.Principal).toEqual({ Service: 'events.amazonaws.com' });
    expect(regra.Action).toBe('sns:Publish');
    const origem = (regra.Condition as { ArnEquals: { 'aws:SourceArn': { 'Fn::GetAtt': [string, string] } } }).ArnEquals['aws:SourceArn'];
    expect(origem['Fn::GetAtt'][0]).toMatch(/^BuildResultRule/);
    expect(origem['Fn::GetAtt'][1]).toBe('Arn');
  });

  test('a LibraxStack tem o topico com este nome e nao define politica nele (a do CI seria trocada)', () => {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
    const libraxStack = new LibraxStack(app, 'LibraxStack', { env: { account: CONTA, region: 'us-east-1' } });
    const template = Template.fromStack(libraxStack);
    template.hasResourceProperties('AWS::SNS::Topic', { TopicName: ALARM_TOPIC_NAME });
    // Se a LibraxStack ganhar uma politica no topico, junte a liberacao do EventBridge nela e tire a da
    // LibraxCiStack (as duas brigariam pela mesma politica)
    template.resourceCountIs('AWS::SNS::TopicPolicy', 0);
  });
});

describe('nomes iguais no CDK, no script e no buildspec', () => {
  const script = readFileSync(path.join(RAIZ, 'infra/scripts/lancar-cloudshell.sh'), 'utf8');
  const ci = readFileSync(path.join(RAIZ, 'infra/ci/ci.sh'), 'utf8');

  test('script de lancamento', () => {
    expect(script).toContain(`PARAM_CONTEXTO=${CI_CONTEXT_PARAM}\n`);
    expect(script).toContain(`STACK_CI=${CI_STACK_NAME}\n`);
    expect(script).toContain(`PROJETO_CI=${CI_PROJECT_NAME}\n`);
    expect(script).toContain(`CONEXAO_CI=${CI_CONNECTION_NAME}\n`);
  });

  test('padrao da tag do webhook igual ao do ci.sh', () => {
    const re = /^RE_VERSAO='(.+)'$/m.exec(ci)![1];
    expect(`^refs/tags/${re.slice(1)}`).toBe(CI_TAG_REF_PATTERN);
  });

  test('o buildspec existe no caminho do projeto e chama o lancamento com --ci depois dos testes', () => {
    const buildspec = readFileSync(path.join(RAIZ, CI_BUILDSPEC_PATH), 'utf8');
    const fases = buildspec.slice(buildspec.indexOf('\nphases:'));
    const testes = fases.indexOf('- bash infra/ci/ci.sh testar');
    const deploy = fases.indexOf('- bash infra/scripts/lancar-cloudshell.sh --ci');
    expect(fases.indexOf('- bash infra/ci/ci.sh conferir-tag')).toBeGreaterThan(0);
    expect(testes).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(testes);
    expect(buildspec).toMatch(/nodejs: 22/);
  });

  test('o app CDK do lancamento (bin/librax.ts) nao enxerga a stack do CI', () => {
    const bin = readFileSync(path.join(RAIZ, 'infra/bin/librax.ts'), 'utf8');
    expect(bin).not.toMatch(/ci-stack|LibraxCiStack/);
  });
});
