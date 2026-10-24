#!/usr/bin/env node
// Trava da conta: só deixa seguir se o login ativo for da conta do Librax
// (librax:accountId em infra/cdk.context.json ou infra/cdk.json). Rodar via scripts/aws.sh.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const infraDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Conta fixada no contexto do CDK; o cdk.context.json (local) vale mais que o cdk.json. */
export function contaFixada(dir = infraDir) {
  for (const arquivo of ['cdk.context.json', 'cdk.json']) {
    const caminho = join(dir, arquivo);
    if (!existsSync(caminho)) continue;
    const json = JSON.parse(readFileSync(caminho, 'utf8'));
    const valor = String((json.context ?? json)['librax:accountId'] ?? '').trim();
    if (valor) return valor;
  }
  return '';
}

/** Devolve a mensagem de erro, ou null quando a conta do login é a fixada. */
export function erroDaConta(fixada, atual) {
  if (!/^\d{12}$/.test(fixada)) {
    return 'Preencha librax:accountId (12 dígitos) em infra/cdk.json antes de usar a AWS.';
  }
  if (atual !== fixada) {
    return `O login ativo é da conta ${atual || '(desconhecida)'}, mas o Librax só publica na conta ${fixada}.`;
  }
  return null;
}

function contaDoLogin() {
  try {
    const saida = execFileSync('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(saida).Account;
  } catch (err) {
    const detalhe = String(err.stderr ?? err.message).trim();
    console.error(`Sem login válido no perfil librax. Rode: npm run aws:entrar (em infra)\n${detalhe}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const fixada = contaFixada();
  const erro = erroDaConta(fixada, fixada ? contaDoLogin() : '');
  if (erro) {
    console.error(erro);
    process.exit(1);
  }
  console.log(`Conta ${fixada} conferida (perfil librax).`);
}
