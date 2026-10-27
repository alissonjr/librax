/**
 * Bootstrap do ambiente local: cria no DynamoDB Local e no moto o que o template da infra
 * descreve, e grava o que o servidor e o Vite precisam. Idempotente: rodar de novo so completa
 * o que falta.
 *
 * 1. Moto: se nao tem o User Pool, repete a gravacao (persistencia); se nem ela tem, comeca do
 *    zero com a semente fixa (o `sub` das contas fica o mesmo a cada `local:reset`).
 * 2. User Pool, clients (com os callbacks locais do contexto), IdP do Google (so metadado: o
 *    login e simulado), grupo `admin`.
 * 3. Tabela com as GSIs e o TTL.
 * 4. state.json, os .env do Vite (modo local) e o certificado da pagina de login.
 *
 * As contas de teste e os dados ficam com seed.mjs.
 */

import './awsGuard.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTableCommand,
  UpdateTimeToLiveCommand,
  DescribeTimeToLiveCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { cognito, motoApi } from './moto.mjs';
import { readPlan } from './template.mjs';
import { PATHS, URLS, REGION, HOST, PORTS, MOTO_RANDOM_SEED } from './config.mjs';

/** Atributos que o id token leva. Sem ReadAttributes o Cognito libera todos; o moto, nenhum. */
const READ_ATTRIBUTES = ['email', 'email_verified', 'given_name', 'name', 'identities'];

const log = (...args) => console.log('[bootstrap]', ...args);

export function loadPlan() {
  const template = JSON.parse(readFileSync(PATHS.template, 'utf8'));
  return readPlan(template, { region: REGION });
}

export function loadState() {
  return JSON.parse(readFileSync(PATHS.state, 'utf8'));
}

// ---------------------------------------------------------------------------
// Moto: persistencia por gravacao
// ---------------------------------------------------------------------------

async function findPool(name) {
  const { UserPools = [] } = await cognito('ListUserPools', { MaxResults: 60 });
  return UserPools.find((p) => p.Name === name) ?? null;
}

async function ensureMotoState(plan) {
  let pool = await findPool(plan.userPool.name);
  if (pool) return pool;

  const recording = await motoApi('recorder/download-recording', { method: 'GET' });
  const hasHistory = recording.status === 200 && recording.text.includes('CreateUserPool');
  if (hasHistory) {
    log('moto sem estado: repetindo a gravacao do volume');
    const replay = await motoApi('recorder/replay-recording');
    if (replay.status !== 200) throw new Error(`replay do moto falhou (HTTP ${replay.status})`);
    pool = await findPool(plan.userPool.name);
    if (pool) return pool;
    log('a gravacao nao recriou o User Pool: comecando do zero');
  }
  await motoApi('recorder/reset-recording');
  // primeiro pedido gravado: o replay volta o gerador ao mesmo ponto
  await motoApi(`seed?a=${MOTO_RANDOM_SEED}`);
  return null;
}

// ---------------------------------------------------------------------------
// Cognito
// ---------------------------------------------------------------------------

async function ensureUserPool(plan, existing) {
  if (existing) return existing.Id;
  const { UserPoolName, ...props } = plan.userPool.props;
  const { UserPool } = await cognito('CreateUserPool', { PoolName: UserPoolName, ...props });
  log(`User Pool ${UserPool.Id} criado`);
  return UserPool.Id;
}

async function ensureClients(plan, userPoolId) {
  const { UserPoolClients = [] } = await cognito('ListUserPoolClients', { UserPoolId: userPoolId, MaxResults: 60 });
  const out = {};
  for (const client of plan.clients) {
    const props = { ...client.props, ReadAttributes: READ_ATTRIBUTES };
    const found = UserPoolClients.find((c) => c.ClientName === client.name);
    let clientId;
    if (found) {
      clientId = found.ClientId;
      const { UserPoolClient: current } = await cognito('DescribeUserPoolClient', { UserPoolId: userPoolId, ClientId: clientId });
      const same = ['CallbackURLs', 'LogoutURLs', 'ExplicitAuthFlows', 'SupportedIdentityProviders'].every(
        (k) => JSON.stringify(current[k] ?? []) === JSON.stringify(props[k] ?? []),
      );
      if (!same) {
        await cognito('UpdateUserPoolClient', { UserPoolId: userPoolId, ClientId: clientId, ...props });
        log(`client ${client.name} atualizado`);
      }
    } else {
      ({ UserPoolClient: { ClientId: clientId } } = await cognito('CreateUserPoolClient', { UserPoolId: userPoolId, ...props }));
      log(`client ${client.name} criado (${clientId})`);
    }
    out[client.logicalId] = { clientId, name: client.name, props };
  }
  return out;
}

async function ensureIdentityProviders(plan, userPoolId) {
  for (const idp of plan.identityProviders) {
    try {
      await cognito('DescribeIdentityProvider', { UserPoolId: userPoolId, ProviderName: idp.ProviderName });
    } catch (err) {
      if (err.type !== 'ResourceNotFoundException') throw err;
      // So o cadastro do provedor: o login do Google e simulado pela pagina local
      await cognito('CreateIdentityProvider', {
        UserPoolId: userPoolId,
        ProviderName: idp.ProviderName,
        ProviderType: idp.ProviderType,
        ProviderDetails: { client_id: 'simulado-local', client_secret: 'simulado-local', authorize_scopes: 'openid email profile' },
        AttributeMapping: idp.AttributeMapping,
      });
      log(`provedor ${idp.ProviderName} cadastrado (simulado)`);
    }
  }
}

async function ensureGroups(plan, userPoolId) {
  for (const group of plan.groups) {
    try {
      await cognito('GetGroup', { UserPoolId: userPoolId, GroupName: group.GroupName });
    } catch (err) {
      if (err.type !== 'ResourceNotFoundException') throw err;
      await cognito('CreateGroup', { UserPoolId: userPoolId, ...group });
      log(`grupo ${group.GroupName} criado`);
    }
  }
}

// ---------------------------------------------------------------------------
// DynamoDB
// ---------------------------------------------------------------------------

async function ensureTable(plan) {
  const db = new DynamoDBClient({ endpoint: URLS.dynamodb, region: REGION });
  const { TableName, KeySchema, AttributeDefinitions, GlobalSecondaryIndexes, BillingMode, ttlAttribute } = plan.table;
  let current = null;
  try {
    ({ Table: current } = await db.send(new DescribeTableCommand({ TableName })));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException) && err.name !== 'ResourceNotFoundException') throw err;
  }
  if (!current) {
    await db.send(new CreateTableCommand({ TableName, KeySchema, AttributeDefinitions, GlobalSecondaryIndexes, BillingMode }));
    log(`tabela ${TableName} criada com ${GlobalSecondaryIndexes.length} GSIs`);
  } else {
    const have = new Set((current.GlobalSecondaryIndexes ?? []).map((g) => g.IndexName));
    for (const gsi of GlobalSecondaryIndexes.filter((g) => !have.has(g.IndexName))) {
      const attrs = new Set(gsi.KeySchema.map((k) => k.AttributeName));
      await db.send(new UpdateTableCommand({
        TableName,
        AttributeDefinitions: AttributeDefinitions.filter((a) => attrs.has(a.AttributeName)),
        GlobalSecondaryIndexUpdates: [{ Create: gsi }],
      }));
      log(`GSI ${gsi.IndexName} criada`);
    }
  }
  if (ttlAttribute) {
    const { TimeToLiveDescription } = await db.send(new DescribeTimeToLiveCommand({ TableName }));
    if (TimeToLiveDescription?.TimeToLiveStatus !== 'ENABLED') {
      await db.send(new UpdateTimeToLiveCommand({
        TableName,
        TimeToLiveSpecification: { AttributeName: ttlAttribute, Enabled: true },
      }));
    }
  }
}

// ---------------------------------------------------------------------------
// Arquivos para o servidor e o Vite
// ---------------------------------------------------------------------------

/** Client usado pelos autorizadores das rotas que casam com `match`. */
function clientFor(plan, clients, match) {
  const ids = new Set(
    plan.api.routes.filter((r) => match(r.path) && r.authorizer).flatMap((r) => plan.api.authorizers[r.authorizer].audience),
  );
  if (ids.size !== 1) throw new Error(`esperado um client para as rotas, achei ${ids.size}`);
  return clients[[...ids][0]].clientId;
}

function writeEnv(dir, values, header) {
  mkdirSync(dir, { recursive: true });
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(dir, '.env'), `${header}\n${lines.join('\n')}\n`);
}

function ensureTls() {
  if (existsSync(PATHS.tlsKey) && existsSync(PATHS.tlsCert)) return;
  mkdirSync(dirname(PATHS.tlsKey), { recursive: true });
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
    '-keyout', PATHS.tlsKey, '-out', PATHS.tlsCert,
    '-subj', '/CN=Librax local',
    '-addext', `subjectAltName=IP:${HOST},DNS:localhost`,
  ], { stdio: 'ignore' });
  log('certificado autoassinado da pagina de login criado');
}

export async function bootstrap() {
  const plan = loadPlan();
  const existing = await ensureMotoState(plan);
  const userPoolId = await ensureUserPool(plan, existing);
  await ensureIdentityProviders(plan, userPoolId);
  const clients = await ensureClients(plan, userPoolId);
  await ensureGroups(plan, userPoolId);
  await ensureTable(plan);
  ensureTls();

  const appClientId = clientFor(plan, clients, (p) => !p.startsWith('/v1/admin'));
  const adminClientId = clientFor(plan, clients, (p) => p.startsWith('/v1/admin'));
  const state = { region: REGION, userPoolId, appClientId, adminClientId, clients };
  mkdirSync(dirname(PATHS.state), { recursive: true });
  writeFileSync(PATHS.state, JSON.stringify(state, null, 2));

  const loginHost = `${HOST}:${PORTS.login}`;
  const header = '# GERADO por services/api/local/bootstrap.mjs (npm run local:up). Nao edite: rode de novo.';
  writeEnv(PATHS.envApp, {
    VITE_COGNITO_USER_POOL_ID: userPoolId,
    VITE_COGNITO_CLIENT_ID: appClientId,
    VITE_COGNITO_DOMAIN: loginHost,
    VITE_COGNITO_ENDPOINT: URLS.api,
    VITE_AUTH_REDIRECT_SIGN_IN: `${URLS.app}/auth/callback`,
    VITE_AUTH_REDIRECT_SIGN_OUT: `${URLS.app}/`,
    VITE_API_BASE: '/api',
    VITE_VAPID_PUBLIC_KEY: '',
  }, header);
  // Painel: login proprio por SRP no proxy do cognito-idp; "Esqueci a senha" abre o app local
  writeEnv(PATHS.envAdmin, {
    VITE_COGNITO_USER_POOL_ID: userPoolId,
    VITE_COGNITO_CLIENT_ID: adminClientId,
    VITE_COGNITO_ENDPOINT: URLS.api,
    VITE_APP_ORIGIN: URLS.app,
    VITE_API_BASE: '/api',
  }, header);
  log(`pronto: pool ${userPoolId}, app ${appClientId}, painel ${adminClientId}`);
  return { plan, state };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((err) => {
    console.error('[bootstrap] falhou:', err.message);
    process.exit(1);
  });
}
