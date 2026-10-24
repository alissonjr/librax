/**
 * As Lambdas do ambiente local, montadas com as fabricas dos handlers (make*Handlers) sobre o
 * DynamoRepo apontado para o DynamoDB Local, o catalogo empacotado e o Cognito do moto.
 *
 * - Rotas HTTP: pelo nome exportado que o template guarda no Handler (`index.<nome>`).
 * - Gatilho e jobs (PostConfirmation, Scheduler): pelo nome da funcao no template.
 * - CloudWatch, Cost Explorer e Web Push usam os falsos de fakes.mjs.
 *
 * `now` pode ser trocado por chamada (a semente gera dias passados com os mesmos usecases).
 */

import './awsGuard.mjs';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoRepo, makeDynamoClient } from '../src/adapters/dynamoRepo.js';
import { CognitoDirectory } from '../src/adapters/cognitoDirectory.js';
import catalog from '../src/content/catalog.js';
import { makeLessonHandlers } from '../src/handlers/lesson.js';
import { makePracticeHandlers } from '../src/handlers/practice.js';
import { makeGuestHandlers } from '../src/handlers/guest.js';
import { makeSquadHandlers } from '../src/handlers/squads.js';
import { makeLeagueHandlers } from '../src/handlers/league.js';
import { makePushHandlers } from '../src/handlers/push.js';
import { makeAdminHandlers } from '../src/handlers/admin.js';
import { makePostConfirmationHandler } from '../src/handlers/postConfirmation.js';
import { makeCloseLeagueHandler } from '../src/handlers/closeLeague.js';
import { makeOpsDailyHandler } from '../src/handlers/opsDaily.js';
import { sendReminders } from '../src/usecases/sendReminders.js';
import { FakeCloudWatchMetrics, FakeCostExplorerCosts, FakeWebPush } from './fakes.mjs';
import { URLS, REGION } from './config.mjs';

/**
 * @param {object} plan   readPlan(template)
 * @param {object} state  ids criados pelo bootstrap (userPoolId...)
 */
export function makeLocalFunctions({ plan, state, log = console.log }) {
  const tableName = plan.table.TableName;
  // o DynamoRepo le LIBRAX_TABLE ao importar; o template diz o nome, o padrao e o mesmo
  if ((process.env.LIBRAX_TABLE ?? 'librax') !== tableName) {
    throw new Error(`LIBRAX_TABLE (${process.env.LIBRAX_TABLE}) diferente da tabela do template (${tableName})`);
  }
  const repo = new DynamoRepo(makeDynamoClient({ endpoint: URLS.dynamodb, region: REGION }));
  const directory = new CognitoDirectory(
    new CognitoIdentityProviderClient({ endpoint: URLS.moto, region: REGION }),
    state.userPoolId,
  );
  const cloud = new FakeCloudWatchMetrics({ log });
  const costs = new FakeCostExplorerCosts({ log });
  const push = new FakeWebPush({ log });

  /** Handlers HTTP pelo nome exportado (o mesmo do `index.<nome>` no template). */
  function httpHandlers(now = () => new Date()) {
    const groups = [
      makeLessonHandlers({ repo, catalog, now }),
      makePracticeHandlers({ repo, catalog, now }),
      makeGuestHandlers({ repo, catalog, now }),
      makeSquadHandlers({ repo, now }),
      makeLeagueHandlers({ repo, now }),
      makePushHandlers({ repo, now }),
      (({ adminRouter }) => ({ adminRouter }))(makeAdminHandlers({ repo, directory, now, log })),
    ];
    const out = {};
    for (const group of groups) {
      for (const [name, fn] of Object.entries(group)) {
        if (typeof fn !== 'function') continue;
        if (out[name]) throw new Error(`handler ${name} exportado por duas fabricas`);
        out[name] = fn;
      }
    }
    return out;
  }

  const opsEnv = plan.functions['librax-ops-daily']?.environment ?? {};

  /** Funcoes chamadas por nome (gatilho do Cognito e jobs do Scheduler). */
  function namedFunctions(now = () => new Date()) {
    return {
      'librax-post-confirmation': makePostConfirmationHandler({ repo, now }).handler,
      'librax-close-league': makeCloseLeagueHandler({ repo, now }).handler,
      'librax-ops-daily': makeOpsDailyHandler({
        repo,
        cloud,
        costs,
        now,
        config: {
          apiId: opsEnv.API_ID,
          stage: opsEnv.API_STAGE ?? 'api',
          functionNames: String(opsEnv.FUNCTION_NAMES ?? '').split(',').filter(Boolean),
          tableName,
        },
      }).handler,
      // handlers/reminders.js nao tem fabrica (le o VAPID do SSM ao rodar): o mesmo usecase,
      // com o Web Push falso e sem e-mail (librax:emailRemindersEnabled e false na infra)
      'librax-reminders': async () => {
        const report = await sendReminders(repo, {
          now: now(),
          push,
          mail: null,
          log: (msg, data) => log('[reminders]', msg, data ?? ''),
        });
        log('[reminders]', JSON.stringify(report));
        return report;
      },
    };
  }

  const http = httpHandlers();
  const named = namedFunctions();

  // Toda rota do template precisa de handler local, e todo job precisa de funcao local
  const missing = [
    ...plan.api.routes.filter((r) => !http[r.handler]).map((r) => `${r.routeKey} (${r.handler})`),
    ...plan.schedules.filter((s) => !named[s.functionName]).map((s) => `job ${s.name} (${s.functionName})`),
    ...(plan.userPool.postConfirmation && !named[plan.userPool.postConfirmation]
      ? [`gatilho PostConfirmation (${plan.userPool.postConfirmation})`]
      : []),
  ];
  if (missing.length) throw new Error(`sem implementacao local para: ${missing.join(', ')}`);

  return {
    repo,
    catalog,
    directory,
    push,
    http,
    named,
    httpHandlers,
    namedFunctions,
    /** Invoca uma funcao pelo nome do template (gatilho ou job). */
    invoke(functionName, event, now) {
      const fn = (now ? namedFunctions(now) : named)[functionName];
      if (!fn) throw new Error(`funcao local inexistente: ${functionName}`);
      return fn(event);
    },
  };
}
