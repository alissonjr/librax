import { describe, expect, test } from 'vitest';
import { spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { IMMUTABLE, ML_REVALIDATE } from '../lib/web-headers';
import { LAMBDA_UNRESERVED_MINIMUM, RESERVED_CONCURRENCY_TOTAL } from '../lib/cost-guards';

// scripts/lancar-cloudshell.sh sem AWS: as funções puras pelo `source` e o caminho do --admin com um
// `aws` falso no PATH (responde STS, CloudFormation e Cognito e anota cada chamada).

const RAIZ = path.resolve(__dirname, '../..');
const SCRIPT = path.join(RAIZ, 'infra/scripts/lancar-cloudshell.sh');
const CONTA = '123456789012';

function rodar(args: string[], env: Record<string, string> = {}, script = SCRIPT) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Roda um trecho de bash com as funções do script carregadas. */
function comFuncoes(trecho: string, env: Record<string, string> = {}, script = SCRIPT) {
  return spawnSync('bash', ['-c', `source "${script}"; set +e; ${trecho}`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
}

describe('opções', () => {
  test('--ajuda explica e sai sem tocar em nada', () => {
    const r = rodar(['--ajuda']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--so-publicar');
    expect(r.stdout).toContain('--com-google');
    expect(r.stdout).toContain('--com-email-ses');
    expect(r.stdout).toContain('--sem-email-ses');
  });

  test('--com-email-ses e --sem-email-ses', () => {
    const r = comFuncoes('ler_opcoes --com-email-ses; echo "a=$OPT_EMAIL_SES"; ler_opcoes --sem-email-ses; echo "b=$OPT_EMAIL_SES"');
    expect(r.stdout).toContain('a=true');
    expect(r.stdout).toContain('b=false');
  });

  test('opção desconhecida ou sem valor para antes de começar', () => {
    expect(rodar(['--xpto']).status).toBe(2);
    const semValor = rodar(['--conta']);
    expect(semValor.status).toBe(2);
    expect(semValor.stderr).toContain('precisa de um valor');
    expect(rodar(['--conta', '--so-publicar']).status).toBe(2);
  });
});

describe('funções', () => {
  test('certificado cobre o domínio e um nível de subdomínio pelo curinga', () => {
    const casos: Array<[string, string, boolean]> = [
      ['librax.online', 'librax.online,*.librax.online', true],
      ['app.librax.online', 'librax.online,*.librax.online', true],
      ['auth.librax.online', 'librax.online,app.librax.online,auth.librax.online', true],
      ['librax.online', '*.librax.online', false],
      ['a.b.librax.online', 'librax.online,*.librax.online', false],
      ['app.librax.online', 'librax.online', false],
      ['app.librax.online', 'librax.online,*.outro.online', false],
    ];
    for (const [nome, sans, esperado] of casos) {
      const r = comFuncoes(`DOMINIO=librax.online; certificado_cobre "${nome}" "${sans}"; echo $?`);
      expect(r.stdout.trim(), `${nome} em ${sans}`).toBe(esperado ? '0' : '1');
    }
  });

  test('grava no cdk.context.json sem perder o resto, e lê na ordem do CDK', () => {
    const infra = mkdtempSync(path.join(tmpdir(), 'librax-lancar-'));
    writeFileSync(path.join(infra, 'cdk.json'), JSON.stringify({ context: { 'librax:domainName': 'librax.online' } }));
    writeFileSync(
      path.join(infra, 'cdk.context.json'),
      JSON.stringify({ 'librax:androidCertFingerprints': ['AB:CD'], 'librax:alarmEmail': 'velho@exemplo.com' }),
    );
    const r = comFuncoes(
      `INFRA="${infra}"; CONTEXTO="${infra}/cdk.context.json"; ` +
        `gravar_contexto accountId=012345678901 googleEnabled=false alarmEmail= monthlyBudgetUsd=15 && ` +
        `echo "$(contexto domainName)|$(contexto accountId)|$(contexto googleEnabled)|$(contexto alarmEmail)"`,
    );
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('librax.online|012345678901|false|');
    expect(JSON.parse(readFileSync(path.join(infra, 'cdk.context.json'), 'utf8'))).toEqual({
      'librax:androidCertFingerprints': ['AB:CD'],
      'librax:accountId': '012345678901',
      'librax:googleEnabled': false,
      'librax:monthlyBudgetUsd': '15',
    });
  });

  test('Cache-Control dos arquivos de ML no S3 igual ao do CloudFront', () => {
    const r = comFuncoes('printf "%s|%s" "$CACHE_IMUTAVEL" "$CACHE_REVALIDA"');
    expect(r.stdout).toBe(`${IMMUTABLE}|${ML_REVALIDATE}`);
  });

  test('sem terminal, pergunta sem valor para com erro; com valor válido, segue', () => {
    const falta = comFuncoes('perguntar X "Conta" "" "$RE_CONTA" "12 dígitos"; echo "status $?"');
    expect(falta.stderr).toContain('Conta: valor ausente ou inválido');
    const padrao = comFuncoes('perguntar X "Conta" "123456789012" "$RE_CONTA" "12 dígitos"; echo "X=$X"');
    expect(padrao.stdout).toContain('X=123456789012');
  });
});

/** Cópia mínima do repositório (scripts, cdk.json) e um `aws` falso que anota as chamadas. */
function montarRepositorio(contaDoLogin: string) {
  const base = mkdtempSync(path.join(tmpdir(), 'librax-lancar-repo-'));
  const repo = path.join(base, 'repo');
  mkdirSync(path.join(repo, 'infra/scripts'), { recursive: true });
  mkdirSync(path.join(repo, 'apps/web-poc'), { recursive: true });
  for (const arquivo of ['aws.sh', 'conferir-conta.mjs', 'lancar-cloudshell.sh']) {
    copyFileSync(path.join(RAIZ, 'infra/scripts', arquivo), path.join(repo, 'infra/scripts', arquivo));
    chmodSync(path.join(repo, 'infra/scripts', arquivo), 0o755);
  }
  copyFileSync(path.join(RAIZ, 'infra/cdk.json'), path.join(repo, 'infra/cdk.json'));

  const bin = path.join(base, 'bin');
  const log = path.join(base, 'aws.log');
  const estado = path.join(base, 'estado.json');
  writeFileSync(estado, JSON.stringify({ ssm: {}, segredos: {} }));
  mkdirSync(bin);
  const outputs = [
    ['UserPoolId', 'us-east-1_Teste'],
    ['AppUrl', 'https://app.librax.online'],
  ].map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }));
  writeFileSync(
    path.join(bin, 'aws'),
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const e = process.env;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, profile: e.AWS_PROFILE ?? null,
  container: e.AWS_CONTAINER_CREDENTIALS_FULL_URI ?? null, region: e.AWS_REGION ?? null }) + '\\n');
const cmd = args.slice(0, 2).join(' ');
if (cmd === 'sts get-caller-identity') console.log(JSON.stringify({ Account: ${JSON.stringify(contaDoLogin)} }));
else if (cmd === 'cloudformation describe-stacks') console.log(JSON.stringify(${JSON.stringify(outputs)}));
else if (cmd === 'cognito-idp list-users') console.log('google_111\\tuser-2');
else if (cmd === 'cognito-idp admin-add-user-to-group') {}
else if (cmd === 'sesv2 get-email-identity') {
  // LIBRAX_TESTE_SES: "ausente" ou "<VerifiedForSendingStatus> <VerificationStatus>"
  const ses = e.LIBRAX_TESTE_SES ?? 'ausente';
  if (ses === 'ausente') {
    console.error('An error occurred (NotFoundException) when calling the GetEmailIdentity operation: Email identity does not exist.');
    process.exit(254);
  }
  console.log(ses.split(' ').join('\t'));
}
else if (cmd === 'sesv2 get-account') console.log(e.LIBRAX_TESTE_SES_PRODUCAO ?? 'False');
else if (cmd === 'lambda get-account-settings') console.log(e.LIBRAX_TESTE_COTA ?? '1000');
else if (cmd === 'ce get-anomaly-monitors') {
  // LIBRAX_TESTE_ANOMALIA: "desligado" (Cost Explorer inativo), "nenhum" ou o ARN do monitor
  const m = e.LIBRAX_TESTE_ANOMALIA ?? 'nenhum';
  if (m === 'desligado') {
    console.error('An error occurred (AccessDeniedException) when calling the GetAnomalyMonitors operation: User not enabled for cost explorer access');
    process.exit(254);
  }
  console.log(m === 'nenhum' ? 'None' : m);
}
else if (['ssm get-parameter', 'ssm put-parameter', 'secretsmanager describe-secret', 'secretsmanager create-secret'].includes(cmd)) {
  // SSM e Secrets Manager guardados em estado.json; file:// lido como a CLI faz
  const st = JSON.parse(fs.readFileSync(${JSON.stringify(estado)}, 'utf8'));
  const opt = (n) => args[args.indexOf(n) + 1];
  const valor = (v) => (v.startsWith('file://') ? fs.readFileSync(v.slice(7), 'utf8') : v);
  const nome = opt(cmd.startsWith('ssm') ? '--name' : cmd.endsWith('describe-secret') ? '--secret-id' : '--name');
  const guardado = cmd.startsWith('ssm') ? st.ssm : st.segredos;
  if (cmd.endsWith('get-parameter') || cmd.endsWith('describe-secret')) {
    if (!guardado[nome]) {
      console.error('An error occurred (' + (cmd.startsWith('ssm') ? 'ParameterNotFound' : 'ResourceNotFoundException') + ')');
      process.exit(254);
    }
    console.log(nome);
  } else {
    if (guardado[nome] && !args.includes('--overwrite')) {
      console.error('An error occurred (AlreadyExists)');
      process.exit(254);
    }
    guardado[nome] = cmd.startsWith('ssm')
      ? { tipo: opt('--type'), valor: valor(opt('--value')) }
      : { valor: valor(opt('--secret-string')) };
    fs.writeFileSync(${JSON.stringify(estado)}, JSON.stringify(st));
  }
}
else { console.error('aws falso: chamada inesperada ' + args.join(' ')); process.exit(9); }
`,
  );
  chmodSync(path.join(bin, 'aws'), 0o755);

  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: mkdtempSync(path.join(tmpdir(), 'librax-lancar-home-')),
    AWS_EXECUTION_ENV: 'CloudShell',
    AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://localhost:1338/latest/meta-data/container/security-credentials',
    AWS_CONTAINER_AUTHORIZATION_TOKEN: 'token-do-conteiner',
    AWS_REGION: 'sa-east-1',
    AWS_ACCESS_KEY_ID: 'AKIAOUTRACONTA',
    AWS_SECRET_ACCESS_KEY: 'segredo',
  };
  const chamadas = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; profile: string | null; container: string | null; region: string | null })
      : [];
  const guardado = () =>
    JSON.parse(readFileSync(estado, 'utf8')) as {
      ssm: Record<string, { tipo: string; valor: string }>;
      segredos: Record<string, { valor: string }>;
    };
  const guardar = (g: ReturnType<typeof guardado>) => writeFileSync(estado, JSON.stringify(g));
  return { script: path.join(repo, 'infra/scripts/lancar-cloudshell.sh'), env, chamadas, repo, guardado, guardar };
}

describe('--admin no CloudShell (aws falso)', () => {
  test('confere a conta com o login do contêiner e põe as contas do e-mail no grupo admin', () => {
    const { script, env, chamadas, repo } = montarRepositorio(CONTA);
    const r = rodar(['--conta', CONTA, '--admin', 'dona@exemplo.com'], env, script);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Conta ${CONTA} conferida (CloudShell)`);
    expect(r.stdout).toContain('A sessão está na região sa-east-1');
    expect(r.stdout).not.toContain('dona@exemplo.com'); // e-mail mascarado
    expect(JSON.parse(readFileSync(path.join(repo, 'infra/cdk.context.json'), 'utf8'))).toEqual({ 'librax:accountId': CONTA });

    const todas = chamadas();
    for (const c of todas) {
      expect(c.profile).toBeNull();
      expect(c.container).toBe(env.AWS_CONTAINER_CREDENTIALS_FULL_URI);
      expect(c.region).toBe('us-east-1');
    }
    expect(todas[0].args.slice(0, 2)).toEqual(['sts', 'get-caller-identity']);
    const grupo = todas.filter((c) => c.args[1] === 'admin-add-user-to-group').map((c) => c.args[c.args.indexOf('--username') + 1]);
    expect(grupo).toEqual(['google_111', 'user-2']);
    const busca = todas.find((c) => c.args[1] === 'list-users')!.args;
    expect(busca[busca.indexOf('--filter') + 1]).toBe('email = "dona@exemplo.com"');

    // O /tmp do CloudShell some com a sessão: a cópia na pasta pessoal volta na rodada seguinte
    const copia = path.join(env.HOME, '.librax/cdk.context.json');
    expect(JSON.parse(readFileSync(copia, 'utf8'))).toEqual({ 'librax:accountId': CONTA });
    rmSync(path.join(repo, 'infra/cdk.context.json'));
    const deNovo = rodar(['--admin', 'dona@exemplo.com'], env, script);
    expect(deNovo.status).toBe(0);
    expect(deNovo.stdout).toContain('valores da rodada anterior recuperados');
    expect(deNovo.stdout).toContain(`Conta ${CONTA} conferida (CloudShell)`);
  });

  test('login de outra conta: a trava recusa e nada é escrito na AWS', () => {
    const { script, env, chamadas } = montarRepositorio('999999999999');
    const r = rodar(['--conta', CONTA, '--admin', 'dona@exemplo.com'], env, script);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`O login ativo é da conta 999999999999, mas o Librax só publica na conta ${CONTA}`);
    expect(chamadas().map((c) => c.args.slice(0, 2).join(' '))).toEqual(['sts get-caller-identity']);
  });

  test('repositório na pasta pessoal do CloudShell: para antes de qualquer chamada', () => {
    const { script, env, chamadas, repo } = montarRepositorio(CONTA);
    const r = rodar(['--conta', CONTA, '--admin', 'dona@exemplo.com'], { ...env, HOME: path.dirname(repo) }, script);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Clone em /tmp');
    expect(chamadas()).toEqual([]);
  });
});

describe('--com-email-ses (códigos do login pelo SES)', () => {
  test('grava librax:cognitoEmailSes: a opção vale, sem ela fica o que estava, no começo desligado', () => {
    const infra = mkdtempSync(path.join(tmpdir(), 'librax-lancar-ses-'));
    writeFileSync(path.join(infra, 'cdk.json'), JSON.stringify({ context: { 'librax:domainName': 'librax.online' } }));
    const contexto = path.join(infra, 'cdk.context.json');
    const cert = `arn:aws:acm:us-east-1:${CONTA}:certificate/00000000-0000-0000-0000-000000000000`;
    const ler = (opcoes: string) =>
      comFuncoes(
        `INFRA="${infra}"; CONTEXTO="${contexto}"; DOMINIO=librax.online; CONTA=${CONTA}; ` +
          `ler_opcoes --zona Z0123456789ABCDEFGHIJ --certificado ${cert} --email-alarmes a@exemplo.com ${opcoes}; ` +
          'ler_contexto_do_lancamento; echo "EMAIL_SES=$EMAIL_SES"',
      );
    const valor = () => JSON.parse(readFileSync(contexto, 'utf8'))['librax:cognitoEmailSes'];

    let r = ler('');
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('EMAIL_SES=false');
    expect(r.stdout).toContain('envio padrão do Cognito (até 50 e-mails por dia)');
    expect(valor()).toBe(false);

    r = ler('--com-email-ses');
    expect(r.stdout).toContain('EMAIL_SES=true');
    expect(r.stdout).toContain('pelo SES, de nao-responda@librax.online');
    expect(valor()).toBe(true);

    expect(ler('').stdout).toContain('EMAIL_SES=true'); // segunda rodada sem a opção: mantém
    expect(ler('--sem-email-ses').stdout).toContain('EMAIL_SES=false');
    expect(valor()).toBe(false);
  });

  function conferir(ses: string, producao: string, contexto?: Record<string, string>) {
    const { script, env, chamadas, repo } = montarRepositorio(CONTA);
    if (contexto) writeFileSync(path.join(repo, 'infra/cdk.context.json'), JSON.stringify(contexto));
    const r = comFuncoes(
      'DOMINIO=librax.online; conferir_ses_do_login; echo "status=$?"',
      { ...env, LIBRAX_TESTE_SES: ses, LIBRAX_TESTE_SES_PRODUCAO: producao },
      script,
    );
    return { r, chamadas: chamadas() };
  }

  test('domínio verificado e conta liberada: segue sem aviso, só com leituras no SES de us-east-1', () => {
    const { r, chamadas } = conferir('True SUCCESS', 'True');
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('librax.online verificado no SES: os códigos do login saem de nao-responda@librax.online');
    expect(r.stdout).toContain('SES fora do sandbox');
    expect(r.stdout).not.toContain('ATENÇÃO');
    expect(chamadas.map((c) => c.args.slice(0, 2).join(' '))).toEqual(['sesv2 get-email-identity', 'sesv2 get-account']);
    const identidade = chamadas[0].args;
    expect(identidade[identidade.indexOf('--email-identity') + 1]).toBe('librax.online');
    expect(identidade[identidade.indexOf('--region') + 1]).toBe('us-east-1');
  });

  test('ainda no sandbox: avisa em português com o caminho no console e segue', () => {
    const { r } = conferir('True SUCCESS', 'False');
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('ATENÇÃO: A conta ainda está no sandbox do SES em us-east-1');
    expect(r.stdout).toContain('quem criar conta agora não recebe o código');
    expect(r.stdout).toContain('Amazon SES > Painel da conta (Account dashboard) > Solicitar acesso de produção');
    expect(r.stdout).toContain('--sem-email-ses');
  });

  test('domínio sem identidade no SES ou ainda pendente: para com o que fazer', () => {
    const ausente = conferir('ausente', 'True').r;
    expect(ausente.status).toBe(1);
    expect(ausente.stderr).toContain('librax.online não está cadastrado no SES em us-east-1');
    expect(ausente.stderr).toContain('Easy DKIM');
    expect(ausente.stdout).not.toContain('status=');

    const pendente = conferir('False PENDING', 'True').r;
    expect(pendente.status).toBe(1);
    expect(pendente.stderr).toContain('librax.online ainda não está verificado no SES (situação: PENDING)');
    expect(pendente.stderr).toContain('--sem-email-ses');
  });

  test('remetente por contexto: confere o domínio dele', () => {
    const { r, chamadas } = conferir('True SUCCESS', 'True', { 'librax:cognitoEmailFrom': 'contas@mail.librax.online' });
    expect(r.stdout).toContain('os códigos do login saem de contas@mail.librax.online');
    const identidade = chamadas[0].args;
    expect(identidade[identidade.indexOf('--email-identity') + 1]).toBe('mail.librax.online');
  });
});

describe('travas de custo (aws falso, só leitura)', () => {
  const MONITOR = `arn:aws:ce::${CONTA}:anomalymonitor/0a1b2c3d-1234-4abc-8def-0123456789ab`;

  test('a soma da concorrência reservada no script é a da stack (lib/cost-guards.ts)', () => {
    const r = comFuncoes('printf "%s|%s" "$RESERVA_LAMBDA" "$LAMBDA_SEM_RESERVA"');
    expect(r.stdout).toBe(`${RESERVED_CONCURRENCY_TOTAL}|${LAMBDA_UNRESERVED_MINIMUM}`);
  });

  function travas(opcoes: string, env: Record<string, string>, contexto?: Record<string, unknown>) {
    const repo = montarRepositorio(CONTA);
    if (contexto) writeFileSync(path.join(repo.repo, 'infra/cdk.context.json'), JSON.stringify(contexto));
    const r = comFuncoes(
      `ler_opcoes ${opcoes}; ALARM_EMAIL=alertas@exemplo.com; conferir_travas_de_custo; echo "status=$?"`,
      { ...repo.env, ...env },
      repo.script,
    );
    const arquivo = path.join(repo.repo, 'infra/cdk.context.json');
    const ctx = () => (existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8')) : {});
    return { r, ctx, chamadas: repo.chamadas().map((c) => c.args.slice(0, 2).join(' ')) };
  }

  test('cota 10 (conta nova): recomenda pedir 1000 no Service Quotas e deixa a reserva desligada', () => {
    const { r, ctx, chamadas } = travas('', { LIBRAX_TESTE_COTA: '10' });
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('A cota de execuções simultâneas do Lambda nesta conta é 10');
    expect(r.stdout).toContain('Service Quotas > Serviços da AWS > AWS Lambda > Concurrent executions');
    expect(r.stdout).toContain('--com-concorrencia-reservada');
    expect(ctx()['librax:lambdaReservedConcurrency']).toBe(false);
    // só leituras
    expect(chamadas).toEqual(['lambda get-account-settings', 'ce get-anomaly-monitors']);
  });

  test('reserva pedida com a cota baixa: para antes do deploy', () => {
    const { r, ctx } = travas('--com-concorrencia-reservada', { LIBRAX_TESTE_COTA: '10' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`precisa de pelo menos ${RESERVED_CONCURRENCY_TOTAL + LAMBDA_UNRESERVED_MINIMUM}`);
    expect(ctx()['librax:lambdaReservedConcurrency']).toBeUndefined();
  });

  test('cota 1000: liga a reserva quando pedida e mantém nas rodadas seguintes', () => {
    const { r, ctx } = travas('--com-concorrencia-reservada', { LIBRAX_TESTE_COTA: '1000' });
    expect(r.stdout).toContain('concorrência reservada ligada');
    expect(r.stdout).not.toContain('ATENÇÃO');
    expect(ctx()['librax:lambdaReservedConcurrency']).toBe(true);
    const deNovo = travas('', { LIBRAX_TESTE_COTA: '1000' }, { 'librax:lambdaReservedConcurrency': true });
    expect(deNovo.ctx()['librax:lambdaReservedConcurrency']).toBe(true);
    const sem = travas('', { LIBRAX_TESTE_COTA: '1000' });
    expect(sem.r.stdout).toContain('A cota já permite');
    expect(sem.ctx()['librax:lambdaReservedConcurrency']).toBe(false);
  });

  test('anomalia: usa o monitor de serviços que a conta já tem', () => {
    const { r, ctx } = travas('', { LIBRAX_TESTE_ANOMALIA: MONITOR });
    expect(r.stdout).toContain('usa o monitor de serviços que a conta já tem');
    expect(r.stdout).not.toContain('alertas@exemplo.com'); // e-mail mascarado
    expect(ctx()['librax:costAnomalyAlerts']).toBe(MONITOR);
  });

  test('anomalia: sem monitor, a stack cria; já configurado, nem consulta de novo', () => {
    expect(travas('', { LIBRAX_TESTE_ANOMALIA: 'nenhum' }).ctx()['librax:costAnomalyAlerts']).toBe('create');
    const { r, chamadas } = travas('', {}, { 'librax:costAnomalyAlerts': 'create' });
    expect(r.stdout).toContain('já configurado');
    expect(chamadas).toEqual(['lambda get-account-settings']);
  });

  test('anomalia: Cost Explorer inativo deixa desligado e explica como ativar, sem parar', () => {
    const { r, ctx } = travas('', { LIBRAX_TESTE_ANOMALIA: 'desligado' });
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('O Cost Explorer ainda não está ativo nesta conta');
    expect(ctx()['librax:costAnomalyAlerts']).toBe('off');
  });

  test('--admin explica o aplicativo autenticador do primeiro acesso ao painel', () => {
    const { script, env } = montarRepositorio(CONTA);
    const r = rodar(['--conta', CONTA, '--admin', 'dona@exemplo.com'], env, script);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('O painel exige o segundo fator (aplicativo autenticador)');
    expect(r.stdout).toContain('QR code');
    expect(r.stdout).toContain('Use uma conta de e-mail e senha só para o painel');
  });

  test('--ajuda mostra as opções da concorrência reservada', () => {
    const r = rodar(['--ajuda']);
    expect(r.stdout).toContain('--com-concorrencia-reservada');
    expect(r.stdout).toContain('--sem-concorrencia-reservada');
  });
});

describe('--com-notificacoes (chaves VAPID no SSM, aws falso)', () => {
  const PUBLICA = '/librax/vapid/public-key';
  const PRIVADA = '/librax/vapid/private-key';

  function gerar(antes?: (g: ReturnType<ReturnType<typeof montarRepositorio>['guardado']>) => void) {
    const m = montarRepositorio(CONTA);
    if (antes) {
      const g = m.guardado();
      antes(g);
      m.guardar(g);
    }
    const tmp = mkdtempSync(path.join(tmpdir(), 'librax-lancar-tmp-'));
    const r = comFuncoes('garantir_chaves_push; echo "status=$?"', { ...m.env, TMPDIR: tmp }, m.script);
    return { ...m, r, tmp };
  }

  test('a opção existe, aparece na ajuda e não entra no modo do CodeBuild', () => {
    expect(comFuncoes('ler_opcoes --com-notificacoes; echo "n=$OPT_NOTIFICACOES"').stdout).toContain('n=true');
    expect(rodar(['--ajuda']).stdout).toContain('--com-notificacoes');
    const ci = rodar(['--ci', '--com-notificacoes']);
    expect(ci.status).toBe(2);
    expect(ci.stderr).toContain('--com-notificacoes');
  });

  test('os nomes dos parâmetros são os padrões da stack (lib/config.ts)', () => {
    const config = readFileSync(path.join(RAIZ, 'infra/lib/config.ts'), 'utf8');
    const r = comFuncoes('echo "$PARAM_VAPID_PUBLICA $PARAM_VAPID_PRIVADA $PARAM_GOOGLE_ID $SEGREDO_GOOGLE"');
    for (const nome of r.stdout.trim().split(' ')) expect(config).toContain(`'${nome}'`);
  });

  test('sem chaves: gera um par P-256 válido, privada cifrada, sem mostrar nem deixar arquivo', () => {
    const { r, guardado, tmp, chamadas } = gerar();
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('chaves geradas e guardadas no SSM');
    const { ssm } = guardado();
    expect(ssm[PRIVADA].tipo).toBe('SecureString');
    expect(ssm[PUBLICA].tipo).toBe('String');
    expect(Buffer.from(ssm[PUBLICA].valor, 'base64url')).toHaveLength(65);
    expect(Buffer.from(ssm[PUBLICA].valor, 'base64url')[0]).toBe(4);
    expect(Buffer.from(ssm[PRIVADA].valor, 'base64url')).toHaveLength(32);
    expect(r.stdout).not.toContain(ssm[PRIVADA].valor);
    for (const c of chamadas()) expect(c.args.join(' ')).not.toContain(ssm[PRIVADA].valor);
    expect(readdirSync(tmp)).toEqual([]);
    // A privada vai antes: a pública só existe com o par completo
    const escritas = chamadas().filter((c) => c.args[1] === 'put-parameter').map((c) => c.args[c.args.indexOf('--name') + 1]);
    expect(escritas).toEqual([PRIVADA, PUBLICA]);
  });

  test('chaves já guardadas: ficam as mesmas, só com leituras', () => {
    const { r, chamadas, guardado } = gerar((g) => {
      g.ssm[PUBLICA] = { tipo: 'String', valor: 'pub-antiga' };
      g.ssm[PRIVADA] = { tipo: 'SecureString', valor: 'priv-antiga' };
    });
    expect(r.stdout).toContain('chaves já guardadas no SSM; ficam as mesmas');
    expect(chamadas().every((c) => c.args[1] === 'get-parameter')).toBe(true);
    expect(guardado().ssm[PUBLICA].valor).toBe('pub-antiga');
  });

  test('privada solta (rodada interrompida): gera o par de novo', () => {
    const { r, guardado } = gerar((g) => {
      g.ssm[PRIVADA] = { tipo: 'SecureString', valor: 'priv-solta' };
    });
    expect(r.stdout).toContain('status=0');
    expect(guardado().ssm[PRIVADA].valor).not.toBe('priv-solta');
    expect(guardado().ssm[PUBLICA]).toBeDefined();
  });

  test('pública sem a privada: para e explica, sem trocar nada', () => {
    const { r, chamadas } = gerar((g) => {
      g.ssm[PUBLICA] = { tipo: 'String', valor: 'pub' };
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('falta a privada');
    expect(chamadas().some((c) => c.args[1] === 'put-parameter')).toBe(false);
  });
});

describe('--com-google (cliente OAuth no SSM e no Secrets Manager, aws falso)', () => {
  const ID = '123456789012-abc123def456.apps.googleusercontent.com';
  const SEGREDO = 'GOCSPX-segredo-de-teste';

  function conferir(entrada: string | null, antes?: (g: ReturnType<ReturnType<typeof montarRepositorio>['guardado']>) => void) {
    const m = montarRepositorio(CONTA);
    if (antes) {
      const g = m.guardado();
      antes(g);
      m.guardar(g);
    }
    const tmp = mkdtempSync(path.join(tmpdir(), 'librax-lancar-tmp-'));
    // Com entrada, simula o terminal (tem_terminal) e digita as linhas
    const terminal = entrada === null ? '' : 'tem_terminal() { true; }; ';
    const r = spawnSync('bash', ['-c', `source "${m.script}"; set +e; ${terminal}garantir_cliente_google; echo "status=$?"`], {
      encoding: 'utf8',
      env: { ...m.env, TMPDIR: tmp },
      input: entrada ?? '',
    });
    return { ...m, r, tmp };
  }

  test('sem terminal e sem o cliente: para com o que fazer e não grava nada', () => {
    const { r, chamadas } = conferir(null);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('falta o parâmetro /librax/google/client-id');
    expect(r.stderr).toContain('--com-google (ele pede o id e o segredo)');
    expect(chamadas().some((c) => ['put-parameter', 'create-secret'].includes(c.args[1]))).toBe(false);
  });

  test('no terminal: pede o id (confere o formato) e o segredo, grava sem mostrar o segredo', () => {
    const { r, guardado, chamadas, tmp } = conferir(`id-errado\n${ID}\n\n${SEGREDO}\n`);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('Termina com .apps.googleusercontent.com.');
    expect(r.stdout).toContain('Cole o segredo do cliente');
    expect(r.stdout).not.toContain(SEGREDO);
    const g = guardado();
    expect(g.ssm['/librax/google/client-id']).toEqual({ tipo: 'String', valor: ID });
    expect(g.segredos['librax/google/client-secret']).toEqual({ valor: SEGREDO });
    for (const c of chamadas()) expect(c.args.join(' ')).not.toContain(SEGREDO);
    expect(readdirSync(tmp)).toEqual([]);
  });

  test('já guardado: só confere, sem perguntar', () => {
    const { r, chamadas } = conferir(null, (g) => {
      g.ssm['/librax/google/client-id'] = { tipo: 'String', valor: ID };
      g.segredos['librax/google/client-secret'] = { valor: SEGREDO };
    });
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).toContain('cliente OAuth do Google guardado');
    expect(chamadas().map((c) => c.args.slice(0, 2).join(' '))).toEqual(['ssm get-parameter', 'secretsmanager describe-secret']);
  });

  test('só falta o segredo: pede só ele', () => {
    const { r, guardado } = conferir(`${SEGREDO}\n`, (g) => {
      g.ssm['/librax/google/client-id'] = { tipo: 'String', valor: ID };
    });
    expect(r.stdout).toContain('status=0');
    expect(r.stdout).not.toContain('Client ID guardado');
    expect(guardado().segredos['librax/google/client-secret']).toEqual({ valor: SEGREDO });
  });
});
