/**
 * Comandos do ambiente local (docs/ambiente-local.md):
 *
 *   npm run local:up      sobe os containers, sintetiza o template, faz o bootstrap e a semente
 *   npm run local         (server.mjs) API, proxy do Cognito e pagina de login
 *   npm run local:down    para os containers sem apagar os dados
 *   npm run local:reset   para e apaga os dados (volumes, verificadores SRP e ids)
 *   npm run local:jobs    roda os jobs agendados agora: `-- close-league`, `-- ops-daily`,
 *                         `-- reminders` (sem nome, todos); `-- ops-daily --event '{"day":"2026-10-22"}'`
 *   npm run local:status  containers, memoria e o que o template trouxe
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, DATA_DIR, INFRA_DIR, SYNTH_CONTEXT, COMPOSE_PROJECT, API_DIR } from './config.mjs';

const say = (...a) => console.log('[local]', ...a);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} saiu com ${res.status}`);
}

const compose = (...args) => run('docker', ['compose', '-f', PATHS.compose, ...args]);

function newestMtime(paths) {
  let newest = 0;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) newest = Math.max(newest, newestMtime(readdirSync(p).map((f) => join(p, f))));
    else newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
}

/** Sintetiza o template so quando a infra (ou o contexto local) mudou. */
function synth() {
  const sources = [join(INFRA_DIR, 'lib'), join(INFRA_DIR, 'cdk.json'), PATHS.synth, join(API_DIR, 'local', 'config.mjs')];
  if (existsSync(PATHS.template) && statSync(PATHS.template).mtimeMs > newestMtime(sources)) {
    say('template da infra em dia');
    return;
  }
  if (!existsSync(join(INFRA_DIR, 'node_modules', 'aws-cdk-lib'))) {
    throw new Error('infra sem dependencias: rode `npm ci` em infra/');
  }
  say('sintetizando a stack (sem CLI do CDK, sem AWS)...');
  mkdirSync(DATA_DIR, { recursive: true });
  run('npx', ['--no-install', 'ts-node', '--transpile-only', PATHS.synth, PATHS.template, PATHS.cdkOut], {
    cwd: INFRA_DIR,
    env: { ...process.env, LIBRAX_LOCAL_CONTEXT: JSON.stringify(SYNTH_CONTEXT), CDK_DISABLE_VERSION_CHECK: '1' },
  });
  rmSync(PATHS.cdkOut, { recursive: true, force: true });
}

async function up() {
  say('subindo DynamoDB Local e moto...');
  compose('up', '-d', '--wait');
  synth();
  const { bootstrap } = await import('./bootstrap.mjs');
  const { plan, state } = await bootstrap();
  const { seed } = await import('./seed.mjs');
  await seed({ plan, state });
  say(`pronto. Agora:
  cd services/api && npm run local          (API, Cognito local e pagina de login)
  cd apps/web-poc && npm run dev:local      (app em http://127.0.0.1:5320/)
  cd apps/admin-web && npm run dev:local    (painel em http://127.0.0.1:5321/admin/)
Contas e portas: docs/ambiente-local.md`);
}

function down() {
  compose('down');
  say('containers parados; os dados ficaram nos volumes (npm run local:up volta de onde parou)');
}

function reset() {
  compose('down', '-v');
  for (const p of [PATHS.state, PATHS.srp, join(DATA_DIR, 'env')]) rmSync(p, { recursive: true, force: true });
  say('dados apagados (volumes, verificadores SRP, ids e .env do Vite). O certificado e o template ficaram.');
}

function parseJobArgs(args) {
  const names = [];
  let event = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--event') event = JSON.parse(args[(i += 1)] ?? '{}');
    else names.push(args[i]);
  }
  return { names, event };
}

async function jobs(args) {
  const { loadPlan, loadState } = await import('./bootstrap.mjs');
  const { makeLocalFunctions } = await import('./functions.mjs');
  const plan = loadPlan();
  const functions = makeLocalFunctions({ plan, state: loadState() });
  const { names, event } = parseJobArgs(args);
  const wanted = plan.schedules.filter(
    (s) => names.length === 0 || names.some((n) => [s.name, s.functionName, s.functionName.replace(/^librax-/, '')].includes(n)),
  );
  if (wanted.length === 0) {
    throw new Error(`job desconhecido. Do template: ${plan.schedules.map((s) => s.functionName.replace(/^librax-/, '')).join(', ')}`);
  }
  for (const s of wanted) {
    say(`job ${s.name} (${s.expression} ${s.timezone}) -> ${s.functionName}`);
    const report = await functions.invoke(s.functionName, event);
    say('resultado:', JSON.stringify(report));
  }
}

function status() {
  run('docker', ['ps', '--filter', `label=com.docker.compose.project=${COMPOSE_PROJECT}`, '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}']);
  run('docker', ['stats', '--no-stream', '--format', 'table {{.Name}}\t{{.MemUsage}}', `${COMPOSE_PROJECT}-dynamodb-1`, `${COMPOSE_PROJECT}-moto-1`]);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { up, down, reset, jobs: () => jobs(rest), status };

if (!commands[command]) {
  console.error('uso: node local/cli.mjs up | down | reset | jobs [nome] [--event JSON] | status');
  process.exit(2);
}
Promise.resolve(commands[command]()).catch((err) => {
  console.error(`[local] ${err.message}`);
  process.exit(1);
});
