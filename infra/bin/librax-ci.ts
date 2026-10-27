#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CI_STACK_NAME, LibraxCiStack } from '../lib/ci-stack';

// App CDK so do CI/CD (docs/ci-cd.md), separado do bin/librax.ts: o `cdk deploy --all` do lancamento e o
// deploy feito pelo proprio CI nunca enxergam esta stack. Publicada pelo dono, uma vez, com
// `bash infra/scripts/lancar-cloudshell.sh --configurar-ci`.
const app = new cdk.App();

// Com a conta fixada, o proprio CDK recusa publicar se o login for de outra conta
const accountId = String(app.node.tryGetContext('librax:accountId') ?? '').trim();

new LibraxCiStack(app, CI_STACK_NAME, {
  env: {
    account: accountId || process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Librax - CI/CD (CodeBuild a cada tag de versao, aviso no topico de alarmes)',
});
