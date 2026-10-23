/**
 * Singleton do DynamoRepo para reuso entre invocacoes Lambda (container quente).
 * O client DynamoDB e criado uma unica vez fora do handler.
 */

import { makeDynamoClient, DynamoRepo } from '../adapters/dynamoRepo.js';

const client = makeDynamoClient();
export const repo = new DynamoRepo(client);
