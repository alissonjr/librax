#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LibraxStack } from '../lib/librax-stack';

const app = new cdk.App();

new LibraxStack(app, 'LibraxStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Librax - app de aprendizado de Libras (DynamoDB + Lambda + API GW + Cognito + S3 + CloudFront)',
});
