import { describe, expect, test } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
// @ts-expect-error módulo .mjs sem tipos
import { contaFixada, erroDaConta } from '../scripts/conferir-conta.mjs';

// Login separado da AWS (scripts/aws.sh) e trava da conta, sem chamar a AWS.

const RAIZ = path.resolve(__dirname, '../..');

describe('scripts/aws.sh', () => {
  test('usa a pasta .aws do projeto e descarta credenciais do terminal', () => {
    const saida = execFileSync(path.join(RAIZ, 'infra/scripts/aws.sh'), ['env'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        AWS_ACCESS_KEY_ID: 'AKIAEXEMPLO',
        AWS_SECRET_ACCESS_KEY: 'segredo',
        AWS_PROFILE: 'outra-conta',
        AWS_REGION: 'sa-east-1',
        AWS_ENDPOINT_URL_DYNAMODB: 'http://127.0.0.1:5330',
        CDK_DEFAULT_ACCOUNT: '999999999999',
      },
    });
    const env = Object.fromEntries(
      saida.trim().split('\n').map((linha) => [linha.slice(0, linha.indexOf('=')), linha.slice(linha.indexOf('=') + 1)]),
    );
    expect(env.AWS_CONFIG_FILE).toBe(path.join(RAIZ, '.aws/config'));
    expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe(path.join(RAIZ, '.aws/credentials'));
    expect(env.AWS_PROFILE).toBe('librax');
    for (const nome of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_ENDPOINT_URL_DYNAMODB', 'CDK_DEFAULT_ACCOUNT']) {
      expect(env[nome]).toBeUndefined();
    }
  });
});

describe('trava da conta', () => {
  test('lê a conta do cdk.context.json antes do cdk.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'librax-conta-'));
    writeFileSync(path.join(dir, 'cdk.json'), JSON.stringify({ context: { 'librax:accountId': '111111111111' } }));
    expect(contaFixada(dir)).toBe('111111111111');
    writeFileSync(path.join(dir, 'cdk.context.json'), JSON.stringify({ 'librax:accountId': '222222222222' }));
    expect(contaFixada(dir)).toBe('222222222222');
  });

  test('o cdk.json do projeto começa sem conta', () => {
    expect(contaFixada(path.join(RAIZ, 'infra/test/__sem_arquivos__'))).toBe('');
    expect(erroDaConta('', '')).toMatch(/Preencha librax:accountId/);
  });

  test('recusa login de outra conta e aceita a conta fixada', () => {
    expect(erroDaConta('123456789012', '999999999999')).toMatch(/999999999999.*123456789012/);
    expect(erroDaConta('123456789012', '123456789012')).toBeNull();
  });
});
