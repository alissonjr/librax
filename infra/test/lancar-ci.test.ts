import { describe, expect, test } from 'vitest';
import { spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

// CI/CD no script de lançamento (--ci no CodeBuild e --configurar-ci no CloudShell) e infra/ci/ci.sh,
// sem AWS: um `aws` e um `npx` falsos no PATH respondem e anotam cada chamada.

const RAIZ = path.resolve(__dirname, '../..');
const CONTA = '123456789012';
const CONEXAO = `arn:aws:codeconnections:us-east-1:${CONTA}:connection/0a1b2c3d-1234-4abc-8def-0123456789ab`;
const TOPICO = `arn:aws:sns:us-east-1:${CONTA}:librax-alarms`;
const CONTEXTO = {
  'librax:accountId': CONTA,
  'librax:hostedZoneId': 'Z0123456789ABCDEFGHIJ',
  'librax:hostedZoneName': 'librax.online',
  'librax:certificateArn': `arn:aws:acm:us-east-1:${CONTA}:certificate/00000000-0000-0000-0000-000000000000`,
  'librax:alarmEmail': 'dona@exemplo.com',
  'librax:googleEnabled': false,
};

type Chamada = { args: string[]; profile: string | null; relativa: string | null; chave: string | null; region: string | null };

function montar() {
  const base = mkdtempSync(path.join(tmpdir(), 'librax-ci-'));
  const repo = path.join(base, 'repo');
  mkdirSync(path.join(repo, 'infra/scripts'), { recursive: true });
  mkdirSync(path.join(repo, 'infra/node_modules'), { recursive: true });
  mkdirSync(path.join(repo, 'apps/web-poc'), { recursive: true });
  for (const arquivo of ['aws.sh', 'conferir-conta.mjs', 'lancar-cloudshell.sh']) {
    copyFileSync(path.join(RAIZ, 'infra/scripts', arquivo), path.join(repo, 'infra/scripts', arquivo));
    chmodSync(path.join(repo, 'infra/scripts', arquivo), 0o755);
  }
  copyFileSync(path.join(RAIZ, 'infra/cdk.json'), path.join(repo, 'infra/cdk.json'));
  // Dependências da infra "em dia" (o --configurar-ci não roda npm ci)
  writeFileSync(path.join(repo, 'infra/package-lock.json'), '{}');
  writeFileSync(path.join(repo, 'infra/node_modules/.package-lock.json'), '{}');

  const bin = path.join(base, 'bin');
  const log = path.join(base, 'aws.log');
  const logNpx = path.join(base, 'npx.log');
  const estadoCi = path.join(base, 'stack-ci-existe');
  mkdirSync(bin);
  const outputs = [
    ['AppUrl', 'https://app.librax.online'],
    ['AlarmTopicArn', TOPICO],
  ].map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }));
  writeFileSync(
    path.join(bin, 'aws'),
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const e = process.env;
const valor = (op) => args[args.indexOf(op) + 1];
const registro = { args, profile: e.AWS_PROFILE ?? null, relativa: e.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ?? null,
  chave: e.AWS_ACCESS_KEY_ID ?? null, region: e.AWS_REGION ?? null };
if (args[1] === 'put-parameter') {
  const v = valor('--value');
  registro.conteudo = v.startsWith('file://') && fs.existsSync(v.slice(7)) ? JSON.parse(fs.readFileSync(v.slice(7), 'utf8')) : null;
}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(registro) + '\\n');
const cmd = args.slice(0, 2).join(' ');
const naoExiste = (nome) => { console.error('An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id ' + nome + ' does not exist'); process.exit(254); };
if (cmd === 'sts get-caller-identity') console.log(JSON.stringify({ Account: ${JSON.stringify(CONTA)} }));
else if (cmd === 'ssm get-parameter') {
  const p = e.LIBRAX_TESTE_PARAM ?? 'ausente';
  if (p === 'ausente') { console.error('An error occurred (ParameterNotFound) when calling the GetParameter operation:'); process.exit(254); }
  console.log(p);
}
else if (cmd === 'ssm put-parameter') {}
else if (cmd === 'cloudformation describe-stacks') {
  const nome = valor('--stack-name');
  const query = valor('--query');
  if (nome === 'LibraxCiStack') {
    if (!fs.existsSync(${JSON.stringify(estadoCi)})) naoExiste(nome);
    if (query.includes('ConexaoGithubArn')) console.log(${JSON.stringify(CONEXAO)});
    else if (query.includes('HistoricoDosBuilds')) console.log('https://console.aws.amazon.com/codesuite/codebuild/projects/librax-lancamento/history');
    else console.log('None');
  } else if (query === 'Stacks[0].StackStatus') {
    const estado = nome === 'CDKToolkit' ? (e.LIBRAX_TESTE_BOOTSTRAP ?? 'UPDATE_COMPLETE') : (e.LIBRAX_TESTE_STACK ?? 'UPDATE_COMPLETE');
    if (estado === 'ausente') naoExiste(nome);
    console.log(estado);
  } else console.log(JSON.stringify(${JSON.stringify(outputs)}));
}
else if (cmd === 'codeconnections get-connection') console.log(e.LIBRAX_TESTE_CONEXAO ?? 'PENDING');
else if (cmd === 'sns list-subscriptions-by-topic') console.log(e.LIBRAX_TESTE_ASSINATURA ?? ${JSON.stringify(`${TOPICO}:1111`)});
else if (cmd === 'lambda get-account-settings') console.log('1000');
else { console.error('aws falso: chamada inesperada ' + args.join(' ')); process.exit(9); }
`,
  );
  writeFileSync(
    path.join(bin, 'npx'),
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logNpx)}, JSON.stringify(args) + '\\n');
if (args.includes('LibraxCiStack')) fs.writeFileSync(${JSON.stringify(estadoCi)}, '');
`,
  );
  chmodSync(path.join(bin, 'aws'), 0o755);
  chmodSync(path.join(bin, 'npx'), 0o755);

  const ler = (arquivo: string) =>
    existsSync(arquivo) ? readFileSync(arquivo, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return {
    repo,
    script: path.join(repo, 'infra/scripts/lancar-cloudshell.sh'),
    contexto: path.join(repo, 'infra/cdk.context.json'),
    PATH: `${bin}:${process.env.PATH}`,
    HOME: mkdtempSync(path.join(tmpdir(), 'librax-ci-home-')),
    chamadas: () => ler(log) as Array<Chamada & { conteudo?: unknown }>,
    npx: () => ler(logNpx) as string[][],
  };
}

function ambienteCloudShell(m: ReturnType<typeof montar>, extra: Record<string, string> = {}) {
  return {
    PATH: m.PATH,
    HOME: m.HOME,
    AWS_EXECUTION_ENV: 'CloudShell',
    AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://localhost:1338/latest/meta-data/container/security-credentials',
    AWS_REGION: 'us-east-1',
    ...extra,
  };
}

function ambienteCodeBuild(m: ReturnType<typeof montar>, extra: Record<string, string> = {}) {
  return {
    PATH: m.PATH,
    HOME: m.HOME,
    CODEBUILD_BUILD_ID: 'librax-lancamento:1234',
    CODEBUILD_BUILD_NUMBER: '7',
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc',
    AWS_REGION: 'us-east-1',
    ...extra,
  };
}

function rodar(script: string, args: string[], env: Record<string, string>) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function comFuncoes(script: string, trecho: string, env: Record<string, string>) {
  return spawnSync('bash', ['-c', `source "${script}"; set +e; ${trecho}`], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('opções do CI', () => {
  test('--ajuda mostra --configurar-ci e --ci', () => {
    const r = rodar(path.join(RAIZ, 'infra/scripts/lancar-cloudshell.sh'), ['--ajuda'], { PATH: process.env.PATH ?? '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--configurar-ci');
    expect(r.stdout).toContain('--ci ');
  });

  test('--ci não combina com --configurar-ci nem com --admin', () => {
    const script = path.join(RAIZ, 'infra/scripts/lancar-cloudshell.sh');
    expect(rodar(script, ['--ci', '--configurar-ci'], { PATH: process.env.PATH ?? '' }).status).toBe(2);
    expect(rodar(script, ['--ci', '--admin', 'a@b.com'], { PATH: process.env.PATH ?? '' }).status).toBe(2);
  });

  test('--ci fora do CodeBuild para antes de qualquer chamada à AWS', () => {
    const m = montar();
    const r = rodar(m.script, ['--ci'], ambienteCloudShell(m));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--ci é o modo do CodeBuild');
    expect(m.chamadas()).toEqual([]);
  });
});

describe('--ci no CodeBuild (aws falso)', () => {
  test('aws.sh usa o papel do projeto (credenciais do contêiner do build) e descarta chaves avulsas', () => {
    const m = montar();
    const r = comFuncoes(m.script, 'aws_l sts get-caller-identity >/dev/null; echo "status=$?"', ambienteCodeBuild(m, { AWS_ACCESS_KEY_ID: 'AKIAOUTRA', AWS_PROFILE: 'outro' }));
    expect(r.stdout).toContain('status=0');
    const [c] = m.chamadas();
    expect(c.relativa).toBe('/v2/credentials/abc');
    expect(c.profile).toBeNull();
    expect(c.chave).toBeNull();
    expect(c.region).toBe('us-east-1');
  });

  test('lê os valores do SSM com decifragem, grava o cdk.context.json e não mostra o conteúdo no log', () => {
    const m = montar();
    const r = comFuncoes(m.script, 'MODO_CI=true; baixar_contexto; echo "status=$?"', ambienteCodeBuild(m, { LIBRAX_TESTE_PARAM: JSON.stringify(CONTEXTO) }));
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('o conteúdo não aparece no log');
    expect(r.stdout).not.toContain('dona@exemplo.com');
    expect(r.stdout).not.toContain('Z0123456789ABCDEFGHIJ');
    expect(JSON.parse(readFileSync(m.contexto, 'utf8'))).toEqual(CONTEXTO);
    const [c] = m.chamadas();
    expect(c.args.slice(0, 2)).toEqual(['ssm', 'get-parameter']);
    expect(c.args).toContain('--with-decryption');
    expect(c.args[c.args.indexOf('--name') + 1]).toBe('/librax/cdk-context');
  });

  test('sem o parâmetro no SSM, ou com JSON inválido: para dizendo o que fazer, sem deixar arquivo', () => {
    const m = montar();
    const ausente = comFuncoes(m.script, 'MODO_CI=true; baixar_contexto; echo "status=$?"', ambienteCodeBuild(m));
    expect(ausente.status).toBe(1);
    expect(ausente.stderr).toContain('Não consegui ler /librax/cdk-context no SSM');
    expect(ausente.stderr).toContain('lançamento completo no CloudShell');
    expect(existsSync(m.contexto)).toBe(false);

    const invalido = comFuncoes(m.script, 'MODO_CI=true; baixar_contexto', ambienteCodeBuild(m, { LIBRAX_TESTE_PARAM: 'nao-e-json' }));
    expect(invalido.status).toBe(1);
    expect(invalido.stderr).toContain('não é um JSON válido');
    expect(invalido.stderr).not.toContain('nao-e-json');
    expect(existsSync(m.contexto)).toBe(false);
  });

  test('valor faltando no contexto: para sem perguntar e sem pedir sugestão à AWS', () => {
    const m = montar();
    const { 'librax:hostedZoneId': _zona, ...semZona } = CONTEXTO;
    writeFileSync(m.contexto, JSON.stringify(semZona));
    const r = comFuncoes(m.script, `MODO_CI=true; DOMINIO=librax.online; CONTA=${CONTA}; ler_contexto_do_lancamento`, ambienteCodeBuild(m));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Id da zona do Route 53: valor ausente ou inválido');
    expect(r.stderr).toContain('Falta no /librax/cdk-context do SSM');
    expect(m.chamadas()).toEqual([]);
  });

  test('anomalia de custo: o CI nunca consulta o Cost Explorer (cobra por chamada) e mantém a escolha gravada', () => {
    const m = montar();
    const travas = (ctx: Record<string, unknown>) => {
      writeFileSync(m.contexto, JSON.stringify(ctx));
      const r = comFuncoes(m.script, 'MODO_CI=true; ALARM_EMAIL=dona@exemplo.com; conferir_travas_de_custo; echo "status=$?"', ambienteCodeBuild(m));
      return { r, valor: JSON.parse(readFileSync(m.contexto, 'utf8'))['librax:costAnomalyAlerts'] };
    };
    const sem = travas(CONTEXTO);
    expect(sem.r.stdout).toContain('status=0');
    expect(sem.r.stdout).toContain('o CI não consulta o Cost Explorer');
    expect(sem.valor).toBe('off');
    expect(travas({ ...CONTEXTO, 'librax:costAnomalyAlerts': 'create' }).valor).toBe('create');
    expect(m.chamadas().map((c) => c.args[0])).not.toContain('ce');
  });

  test('deploy só da LibraxStack, pelo nome, depois da trava da conta; nunca a do CI', () => {
    const m = montar();
    writeFileSync(m.contexto, JSON.stringify(CONTEXTO));
    const r = comFuncoes(m.script, `MODO_CI=true; cd "${m.repo}/infra" && deploy_da_stack; echo "status=$?"`, ambienteCodeBuild(m));
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain(`Conta ${CONTA} conferida (CodeBuild)`);
    expect(m.npx()).toEqual([['cdk', 'deploy', 'LibraxStack', '--require-approval', 'never', '--ci']]);
    expect(m.chamadas().map((c) => c.args.slice(0, 2).join(' '))).toEqual(['sts get-caller-identity']);
  });

  test('no CI o contexto não é regravado no SSM (só o CloudShell escreve)', () => {
    const script = readFileSync(path.join(RAIZ, 'infra/scripts/lancar-cloudshell.sh'), 'utf8');
    expect(script).toContain('[[ "$MODO_CI" == true ]] || sincronizar_contexto');
  });
});

describe('contexto no SSM (CloudShell)', () => {
  test('grava o cdk.context.json como SecureString no nível padrão (grátis), sobrescrevendo', () => {
    const m = montar();
    writeFileSync(m.contexto, JSON.stringify(CONTEXTO));
    const r = comFuncoes(m.script, 'sincronizar_contexto; echo "status=$?"', ambienteCloudShell(m));
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).not.toContain('dona@exemplo.com');
    const [c] = m.chamadas();
    const opcao = (o: string) => c.args[c.args.indexOf(o) + 1];
    expect(c.args.slice(0, 2)).toEqual(['ssm', 'put-parameter']);
    expect(opcao('--name')).toBe('/librax/cdk-context');
    expect(opcao('--type')).toBe('SecureString');
    expect(opcao('--tier')).toBe('Standard');
    expect(c.args).toContain('--overwrite');
    expect(opcao('--value')).toBe(`file://${m.contexto}`);
    expect(c.conteudo).toEqual(CONTEXTO);
  });

  test('contexto maior que o limite do parâmetro padrão: para antes de chamar a AWS', () => {
    const m = montar();
    writeFileSync(m.contexto, JSON.stringify({ ...CONTEXTO, 'librax:extraCorsOrigins': 'x'.repeat(5000) }));
    const r = comFuncoes(m.script, 'sincronizar_contexto', ambienteCloudShell(m));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('aceita até 4096');
    expect(m.chamadas()).toEqual([]);
  });
});

describe('--configurar-ci no CloudShell (aws e npx falsos)', () => {
  test('primeira rodada: grava o contexto, cria a conexão pendente e explica a aprovação; segunda: cria o projeto', () => {
    const m = montar();
    writeFileSync(m.contexto, JSON.stringify(CONTEXTO));

    const primeira = rodar(m.script, ['--configurar-ci'], ambienteCloudShell(m, { LIBRAX_TESTE_CONEXAO: 'PENDING' }));
    expect(primeira.status).toBe(1);
    expect(primeira.stdout).toContain('e-mail dos alarmes confirmado');
    expect(primeira.stdout).toContain('/librax/cdk-context atualizado');
    expect(primeira.stdout).toContain('Atualizar conexão pendente (Update pending connection)');
    expect(primeira.stdout).toContain('Install a new app');
    expect(primeira.stdout).toContain('alissonjr/librax');
    expect(primeira.stderr).toContain('rode de novo: bash infra/scripts/lancar-cloudshell.sh --configurar-ci');
    const deploy = (args: string[]) => args.slice(0, 3).join(' ') === 'cdk deploy LibraxCiStack';
    expect(m.npx().filter(deploy).map((a) => a[a.indexOf('-c') + 1])).toEqual(['librax:ciCreateProject=false']);
    for (const args of m.npx()) expect(args[args.indexOf('--app') + 1]).toBe('npx ts-node --prefer-ts-exts bin/librax-ci.ts');
    expect(m.chamadas().some((c) => c.args[1] === 'put-parameter')).toBe(true);

    const segunda = rodar(m.script, ['--configurar-ci'], ambienteCloudShell(m, { LIBRAX_TESTE_CONEXAO: 'AVAILABLE' }));
    expect(segunda.stderr).toBe('');
    expect(segunda.status).toBe(0);
    expect(segunda.stdout).toContain('conexão librax-github disponível');
    expect(segunda.stdout).toContain('CI/CD pronto');
    expect(segunda.stdout).toContain('git tag v1.2.3 && git push origin v1.2.3');
    // A conexão já existe: não volta ao passo 1 (que apagaria o projeto)
    expect(m.npx().filter(deploy).map((a) => a[a.indexOf('-c') + 1])).toEqual([
      'librax:ciCreateProject=false',
      'librax:ciCreateProject=true',
    ]);
    // Nunca publica a LibraxStack
    expect(m.npx().some((a) => a.includes('LibraxStack'))).toBe(false);
  });

  test('assinatura do e-mail ainda não confirmada: avisa e segue', () => {
    const m = montar();
    writeFileSync(m.contexto, JSON.stringify(CONTEXTO));
    const r = rodar(m.script, ['--configurar-ci'], ambienteCloudShell(m, { LIBRAX_TESTE_CONEXAO: 'AVAILABLE', LIBRAX_TESTE_ASSINATURA: 'PendingConfirmation' }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ainda não foi confirmada');
    expect(r.stdout).toContain('Confirm subscription');
  });

  test('sem a LibraxStack no ar: para antes de criar qualquer coisa', () => {
    const m = montar();
    writeFileSync(m.contexto, JSON.stringify(CONTEXTO));
    const r = rodar(m.script, ['--configurar-ci'], ambienteCloudShell(m, { LIBRAX_TESTE_STACK: 'ausente' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('faça o primeiro lançamento');
    expect(m.npx()).toEqual([]);
    expect(m.chamadas().some((c) => c.args[1] === 'put-parameter')).toBe(false);
  });
});

describe('infra/ci/ci.sh conferir-tag', () => {
  const CI = path.join(RAIZ, 'infra/ci/ci.sh');
  const conferir = (env: Record<string, string>) =>
    spawnSync('bash', [CI, 'conferir-tag'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

  test('push da tag de versão pelo webhook: segue', () => {
    const r = conferir({ CODEBUILD_WEBHOOK_TRIGGER: 'tag/v1.2.3', CODEBUILD_WEBHOOK_EVENT: 'PUSH', CODEBUILD_RESOLVED_SOURCE_VERSION: 'abc123' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Versão v1.2.3 (commit abc123)');
  });

  test('build iniciado no console com a versão da origem igual a uma tag: segue', () => {
    expect(conferir({ CODEBUILD_SOURCE_VERSION: 'v1.2.3' }).status).toBe(0);
    expect(conferir({ CODEBUILD_SOURCE_VERSION: 'refs/tags/v10.0.1' }).status).toBe(0);
  });

  test('branch, commit avulso, tag fora do padrão, pull request ou tag apagada: para', () => {
    const casos: Array<Record<string, string>> = [
      { CODEBUILD_WEBHOOK_TRIGGER: 'branch/main', CODEBUILD_WEBHOOK_EVENT: 'PUSH' },
      { CODEBUILD_SOURCE_VERSION: 'main' },
      { CODEBUILD_SOURCE_VERSION: '4f1c2e9' },
      {},
      { CODEBUILD_WEBHOOK_TRIGGER: 'tag/v1.2', CODEBUILD_WEBHOOK_EVENT: 'PUSH' },
      { CODEBUILD_WEBHOOK_TRIGGER: 'tag/v1.2.3-beta', CODEBUILD_WEBHOOK_EVENT: 'PUSH' },
      { CODEBUILD_WEBHOOK_TRIGGER: 'pr/12', CODEBUILD_WEBHOOK_EVENT: 'PULL_REQUEST_CREATED' },
      { CODEBUILD_WEBHOOK_TRIGGER: 'tag/v1.2.3', CODEBUILD_WEBHOOK_EVENT: 'PUSH', CODEBUILD_RESOLVED_SOURCE_VERSION: '0'.repeat(40) },
    ];
    for (const env of casos) {
      const r = conferir(env);
      expect(r.status, JSON.stringify(env)).toBe(1);
      expect(r.stderr, JSON.stringify(env)).toContain('ERRO:');
    }
  });

  test('roda as suítes com os comandos de cada package.json', () => {
    const ci = readFileSync(CI, 'utf8');
    const pacote = (dir: string) => JSON.parse(readFileSync(path.join(RAIZ, dir, 'package.json'), 'utf8')).scripts;
    expect(pacote('services/api').test).toBe('node --test');
    expect(pacote('apps/web-poc').test).toBe('vitest run');
    expect(pacote('apps/admin-web').test).toBe('vitest run');
    expect(pacote('apps/landing').test).toBe('vitest run');
    expect(pacote('infra').test).toBe('vitest run');
    expect(pacote('apps/web-poc')['content:check']).toBeTruthy();
    for (const trecho of [
      '"$RAIZ/services/api" && npm test',
      '"$RAIZ/apps/landing" && npm test',
      '"$RAIZ/apps/admin-web" && npm test',
      '"$RAIZ/infra" && npm test',
      '"$RAIZ/infra" && npx tsc --noEmit',
      '"$RAIZ/apps/web-poc" && npm run content:check',
      '"$RAIZ/apps/web-poc" && npx tsc -b',
      '"$RAIZ/apps/web-poc" && npm test',
    ]) {
      expect(ci).toContain(trecho);
    }
  });
});
