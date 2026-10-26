#!/usr/bin/env node
// Trava da conta: só deixa seguir se o login ativo for da conta do Librax
// (librax:accountId em infra/cdk.context.json ou infra/cdk.json). Rodar via scripts/aws.sh.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const infraDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Conta fixada no contexto do CDK, na mesma ordem que o CDK lê: o cdk.json vale mais que o
 * cdk.context.json (local). Uma chave presente no cdk.json, mesmo vazia, esconde a do arquivo local,
 * por isso o cdk.json do projeto não traz librax:accountId.
 */
export function contaFixada(dir = infraDir) {
  for (const arquivo of ['cdk.json', 'cdk.context.json']) {
    const caminho = join(dir, arquivo);
    if (!existsSync(caminho)) continue;
    const json = JSON.parse(readFileSync(caminho, 'utf8'));
    const valor = (arquivo === 'cdk.json' ? json.context ?? {} : json)['librax:accountId'];
    if (valor !== undefined && valor !== null) return String(valor).trim();
  }
  return '';
}

/** De onde vem o login: o contêiner do AWS CloudShell ou o perfil librax (IAM Identity Center). */
export function origemDoLogin(env = process.env) {
  return String(env.AWS_EXECUTION_ENV ?? '').startsWith('CloudShell') ? 'CloudShell' : 'perfil librax';
}

/** Devolve a mensagem de erro, ou null quando a conta do login é a fixada. */
export function erroDaConta(fixada, atual) {
  if (!/^\d{12}$/.test(fixada)) {
    return (
      'Preencha librax:accountId (12 dígitos) em infra/cdk.context.json (local) antes de usar a AWS. ' +
      'Se a chave estiver vazia no infra/cdk.json, tire-a de lá: o cdk.json vale mais que o arquivo local.'
    );
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
    const dica =
      origemDoLogin() === 'CloudShell'
        ? 'Sem login válido no CloudShell: feche a aba e abra o CloudShell de novo pelo console.'
        : 'Sem login válido no perfil librax. Rode: npm run aws:entrar (em infra)';
    console.error(`${dica}\n${detalhe}`);
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
  console.log(`Conta ${fixada} conferida (${origemDoLogin()}).`);
}
