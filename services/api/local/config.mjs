/**
 * Configuracao do ambiente local (docs/ambiente-local.md): portas, pastas e contas de teste.
 *
 * Tudo em 127.0.0.1. As portas 5300 e 5310 sao do dono (dev do app e do painel) e 4566, 5401 a
 * 5462 e 55432 sao de outros projetos: o ambiente local usa a faixa 5320 a 5333.
 */

import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const HOST = '127.0.0.1';
export const REGION = 'us-east-1';
/** Conta ficticia: o template e sintetizado com ela, e nenhum ARN sai da maquina. */
export const ACCOUNT_ID = '000000000000';

export const PORTS = {
  app: 5320,
  admin: 5321,
  dynamodb: 5330,
  moto: 5331,
  /** API local (/api/v1/...) e o proxy do cognito-idp (POST / com X-Amz-Target). */
  api: 5332,
  /** Pagina que imita o Hosted UI do Cognito (HTTPS: o Amplify monta https:// fixo). */
  login: 5333,
};

export const URLS = {
  app: `http://${HOST}:${PORTS.app}`,
  admin: `http://${HOST}:${PORTS.admin}`,
  dynamodb: `http://${HOST}:${PORTS.dynamodb}`,
  moto: `http://${HOST}:${PORTS.moto}`,
  api: `http://${HOST}:${PORTS.api}`,
  login: `https://${HOST}:${PORTS.login}`,
};

export const API_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REPO_ROOT = resolve(API_DIR, '..', '..');
export const INFRA_DIR = join(REPO_ROOT, 'infra');
export const LOCAL_INFRA_DIR = join(INFRA_DIR, 'local');
/** Tudo que o bootstrap gera fica aqui (ignorado no git e apagado pelo `local:reset`). */
export const DATA_DIR = join(LOCAL_INFRA_DIR, '.data');

export const PATHS = {
  compose: join(LOCAL_INFRA_DIR, 'docker-compose.yml'),
  synth: join(LOCAL_INFRA_DIR, 'synth.ts'),
  template: join(DATA_DIR, 'template.json'),
  cdkOut: join(DATA_DIR, 'cdk.out'),
  /** Ids criados no moto e o plano tirado do template (rotas, autorizadores, jobs). */
  state: join(DATA_DIR, 'state.json'),
  /** Sal e verificador SRP de cada conta (o moto nao confere a senha no SRP). */
  srp: join(DATA_DIR, 'srp.json'),
  tlsKey: join(DATA_DIR, 'tls', 'key.pem'),
  tlsCert: join(DATA_DIR, 'tls', 'cert.pem'),
  /** envDir do Vite no modo local (`npm run dev:local`). */
  envApp: join(DATA_DIR, 'env', 'app'),
  envAdmin: join(DATA_DIR, 'env', 'admin'),
  appTokensCss: join(REPO_ROOT, 'apps', 'web-poc', 'src', 'styles', 'tokens.css'),
  appPublic: join(REPO_ROOT, 'apps', 'web-poc', 'public'),
};

/** Nome do projeto no docker compose (containers e volumes `librax-local_*`). */
export const COMPOSE_PROJECT = 'librax-local';

/**
 * Enderecos locais que entram na stack pelo contexto que ela ja aceita (infra/lib/config.ts):
 * callbacks e logouts do app e as origens de CORS da API. O painel entra pela API do User Pool
 * (SRP pelo proxy), sem callback.
 */
export const SYNTH_CONTEXT = {
  'librax:extraCallbackUrls': `${URLS.app}/auth/callback`,
  'librax:extraLogoutUrls': `${URLS.app}/`,
  'librax:extraCorsOrigins': `${URLS.app},${URLS.admin}`,
};

/** Semente do gerador do moto: com ela, o `sub` das contas e o mesmo a cada `local:reset`. */
export const MOTO_RANDOM_SEED = 4242;

/**
 * Contas de teste (senhas so de desenvolvimento, documentadas em docs/ambiente-local.md).
 * `role: 'aluno'` e `role: 'admin'` sao as do dia a dia; as outras so dao vida as ligas, as
 * squads e aos numeros do painel.
 */
export const ACCOUNTS = [
  { key: 'aluno', role: 'aluno', email: 'aluno@librax.example', password: 'aluno-local-123', name: 'Ana', admin: false },
  { key: 'admin', role: 'admin', email: 'admin@librax.example', password: 'admin-local-123', name: 'Duda', admin: true },
  { key: 'bia', email: 'bia@librax.example', password: 'figurante-local-123', name: 'Bia', admin: false },
  { key: 'caio', email: 'caio@librax.example', password: 'figurante-local-123', name: 'Caio', admin: false },
  { key: 'davi', email: 'davi@librax.example', password: 'figurante-local-123', name: 'Davi', admin: false },
  { key: 'eva', email: 'eva@librax.example', password: 'figurante-local-123', name: 'Eva', admin: false },
  { key: 'fabi', email: 'fabi@librax.example', password: 'figurante-local-123', name: 'Fabi', admin: false },
];
