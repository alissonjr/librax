import { describe, expect, test } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
// @ts-expect-error módulo .mjs sem tipos
import { contaFixada, erroDaConta, origemDoLogin } from '../scripts/conferir-conta.mjs';

// Login separado da AWS (scripts/aws.sh) e trava da conta, sem chamar a AWS.

const RAIZ = path.resolve(__dirname, '../..');

/** Ambiente que o aws.sh entrega ao comando (roda `env` através dele). */
function ambienteDoAwsSh(extra: Record<string, string>): Record<string, string> {
  const saida = execFileSync(path.join(RAIZ, 'infra/scripts/aws.sh'), ['env'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...extra },
  });
  return Object.fromEntries(
    saida.trim().split('\n').map((linha) => [linha.slice(0, linha.indexOf('=')), linha.slice(linha.indexOf('=') + 1)]),
  );
}

const TERMINAL_SUJO = {
  AWS_ACCESS_KEY_ID: 'AKIAEXEMPLO',
  AWS_SECRET_ACCESS_KEY: 'segredo',
  AWS_SESSION_TOKEN: 'sessao',
  AWS_PROFILE: 'outra-conta',
  AWS_ENDPOINT_URL_DYNAMODB: 'http://127.0.0.1:5330',
  CDK_DEFAULT_ACCOUNT: '999999999999',
  CDK_DEFAULT_REGION: 'sa-east-1',
};

const CONTEINER = {
  AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://localhost:1338/latest/meta-data/container/security-credentials',
  AWS_CONTAINER_AUTHORIZATION_TOKEN: 'token-do-conteiner',
  AWS_REGION: 'us-east-1',
  AWS_DEFAULT_REGION: 'us-east-1',
};

describe('scripts/aws.sh', () => {
  test('usa a pasta .aws do projeto e descarta credenciais do terminal', () => {
    const env = ambienteDoAwsSh({ ...TERMINAL_SUJO, AWS_REGION: 'sa-east-1' });
    expect(env.AWS_CONFIG_FILE).toBe(path.join(RAIZ, '.aws/config'));
    expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe(path.join(RAIZ, '.aws/credentials'));
    expect(env.AWS_PROFILE).toBe('librax');
    expect(env.LIBRAX_AWS_LOGIN).toBe('perfil');
    for (const nome of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_ENDPOINT_URL_DYNAMODB', 'CDK_DEFAULT_ACCOUNT']) {
      expect(env[nome]).toBeUndefined();
    }
  });

  test('fora do CloudShell descarta também as credenciais de contêiner', () => {
    for (const execucao of [undefined, 'AWS_Lambda_nodejs22.x', 'AWS_ECS_FARGATE', 'cloudshell', 'XCloudShell']) {
      const env = ambienteDoAwsSh({ ...CONTEINER, ...(execucao ? { AWS_EXECUTION_ENV: execucao } : {}) });
      expect(env.AWS_PROFILE).toBe('librax');
      for (const nome of Object.keys(CONTEINER)) expect(env[nome]).toBeUndefined();
    }
  });

  test('no CloudShell mantém o login do contêiner e a região, sem perfil e sem chaves avulsas', () => {
    const env = ambienteDoAwsSh({ ...TERMINAL_SUJO, ...CONTEINER, AWS_EXECUTION_ENV: 'CloudShell' });
    expect(env.LIBRAX_AWS_LOGIN).toBe('cloudshell');
    expect(env.AWS_PROFILE).toBeUndefined();
    expect(env.AWS_CONFIG_FILE).toBe(path.join(RAIZ, '.aws/config'));
    expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe(path.join(RAIZ, '.aws/credentials'));
    for (const [nome, valor] of Object.entries(CONTEINER)) expect(env[nome]).toBe(valor);
    for (const nome of Object.keys(TERMINAL_SUJO)) expect(env[nome]).toBeUndefined();
  });

  test('origem do login para as mensagens da trava', () => {
    expect(origemDoLogin({ AWS_EXECUTION_ENV: 'CloudShell' })).toBe('CloudShell');
    expect(origemDoLogin({ AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' })).toBe('perfil librax');
    expect(origemDoLogin({})).toBe('perfil librax');
  });
});

describe('trava da conta', () => {
  test('lê a conta na ordem do CDK: o cdk.json vale mais que o cdk.context.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'librax-conta-'));
    writeFileSync(path.join(dir, 'cdk.json'), JSON.stringify({ context: { 'librax:domainName': 'librax.online' } }));
    writeFileSync(path.join(dir, 'cdk.context.json'), JSON.stringify({ 'librax:accountId': '222222222222' }));
    expect(contaFixada(dir)).toBe('222222222222');
    writeFileSync(path.join(dir, 'cdk.json'), JSON.stringify({ context: { 'librax:accountId': '111111111111' } }));
    expect(contaFixada(dir)).toBe('111111111111');
    // Vazia no cdk.json esconde a do arquivo local (o CDK também lê assim): a trava recusa
    writeFileSync(path.join(dir, 'cdk.json'), JSON.stringify({ context: { 'librax:accountId': '' } }));
    expect(contaFixada(dir)).toBe('');
    expect(erroDaConta(contaFixada(dir), '222222222222')).toMatch(/Preencha librax:accountId/);
  });

  test('o cdk.json do projeto começa sem conta', () => {
    expect(contaFixada(path.join(RAIZ, 'infra/test/__sem_arquivos__'))).toBe('');
    expect(erroDaConta('', '')).toMatch(/Preencha librax:accountId/);
  });

  test('o cdk.json do projeto não traz as chaves locais, que esconderiam as do cdk.context.json', () => {
    const ctx = JSON.parse(readFileSync(path.join(RAIZ, 'infra/cdk.json'), 'utf8')).context;
    expect(ctx['librax:domainName']).toBe('librax.online');
    for (const chave of [
      'librax:accountId', 'librax:hostedZoneId', 'librax:hostedZoneName', 'librax:certificateArn',
      'librax:alarmEmail', 'librax:budgetEmail', 'librax:monthlyBudgetUsd', 'librax:googleEnabled',
      'librax:emailRemindersEnabled', 'librax:emailFrom', 'librax:androidCertFingerprints',
      'librax:cognitoEmailSes', 'librax:cognitoEmailFrom', 'librax:cognitoEmailFromName', 'librax:cognitoEmailReplyTo',
    ]) {
      expect(ctx, chave).not.toHaveProperty([chave]);
    }
  });

  test('recusa login de outra conta e aceita a conta fixada', () => {
    expect(erroDaConta('123456789012', '999999999999')).toMatch(/999999999999.*123456789012/);
    expect(erroDaConta('123456789012', '123456789012')).toBeNull();
  });
});
