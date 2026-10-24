/*
 * Template da stack para o ambiente local (docs/ambiente-local.md).
 *
 * Sintetiza a LibraxStack no proprio processo, como os testes do infra, sem empacotar as
 * Lambdas e sem a CLI do CDK (nada de telemetria nem de chamada a AWS). Os enderecos locais
 * entram pelo contexto que a stack ja aceita (librax:extraCallbackUrls e afins), vindos de
 * LIBRAX_LOCAL_CONTEXT (JSON). O template sai em <arquivo> e e a fonte unica do bootstrap
 * local: tabela, User Pool, clients, grupo, rotas, autorizadores e jobs.
 *
 * Uso (feito pelo services/api, `npm run local:up`):
 *   LIBRAX_LOCAL_CONTEXT='{"librax:extraCallbackUrls": "..."}' \
 *     npx ts-node --transpile-only local/synth.ts <arquivo.json> <pasta cdk.out>
 */
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { LibraxStack } from '../lib/librax-stack';

const [outFile, outdir] = process.argv.slice(2);
if (!outFile || !outdir) {
  console.error('uso: synth.ts <arquivo.json> <pasta cdk.out>');
  process.exit(2);
}

// Mesmos feature flags do cdk.json, que so a CLI le sozinha
const cdkJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8')) as {
  context?: Record<string, unknown>;
};
const local = JSON.parse(process.env.LIBRAX_LOCAL_CONTEXT ?? '{}') as Record<string, unknown>;

const app = new cdk.App({
  outdir,
  context: { ...cdkJson.context, ...local, 'aws:cdk:bundling-stacks': [] },
});
const stack = new LibraxStack(app, 'LibraxStack', {
  env: { account: '000000000000', region: 'us-east-1' },
});
const template = app.synth().getStackByName(stack.stackName).template;
writeFileSync(outFile, JSON.stringify(template, null, 2));
console.log(`template local: ${outFile}`);
