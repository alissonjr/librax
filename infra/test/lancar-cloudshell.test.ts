import { describe, expect, test } from 'vitest';
import { spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { IMMUTABLE, ML_REVALIDATE } from '../lib/web-headers';

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
function comFuncoes(trecho: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['-c', `source "${SCRIPT}"; set +e; ${trecho}`], {
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
  return { script: path.join(repo, 'infra/scripts/lancar-cloudshell.sh'), env, chamadas, repo };
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
