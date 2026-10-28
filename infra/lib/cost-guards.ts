import { createHash } from 'crypto';

/**
 * Travas de custo gratuitas da stack (revisao de seguranca e custo, docs/lancamento.md, "Revisao de
 * seguranca e custo"). O risco do Librax e mais de conta alta e de indisponibilidade do que de
 * invasao: aqui ficam os limites que seguram o gasto quando alguem abusa da API ou dos downloads.
 *
 * Todos os valores mudam por atualizacao no lugar (sem recriar recurso): limites por rota do estagio
 * do API Gateway, concorrencia reservada das Lambdas, teto de vazao da tabela sob demanda e alarmes.
 */

/**
 * Limite global do estagio `api` (todas as rotas juntas, para todos os usuarios). O ritmo continua 50
 * por segundo: as rotas pesadas tem limite proprio abaixo, entao subir o ritmo so aumentaria o teto de
 * um abuso nas rotas leves. A rajada sobe de 100 para 200: cobre o pico curto da hora do lembrete
 * (muita gente abrindo o app junto) sem mudar o teto sustentado.
 */
export const API_STAGE_THROTTLE = { rateLimit: 50, burstLimit: 200 };

/**
 * Limites por rota (ritmo por segundo e rajada), somados para todos os usuarios: o API Gateway HTTP API
 * nao limita por pessoa. Responde 429, que o app trata como "tenta de novo depois" (apps/web-poc,
 * lib/sync.ts). Valores pensados para o lancamento; suba se o alarme de 4xx ou a fila do app crescer.
 * - guest/migrate: ate 200 conclusoes por envio, Lambda de 30 s e 512 MB (a rota mais cara);
 * - lesson/complete e practice/review: as escritas do dia a dia;
 * - squads/join: tentativa de codigo de convite (forca bruta);
 * - criar squad e excluir conta: raras e com varias escritas;
 * - dados de uso anonimos e nota do app: rotas publicas (sem login). O lote de uso vai no fim da licao e
 *   quando o app sai da tela (uns 5 por pessoa por dia; 10 mil pessoas por dia dao menos de 1 por
 *   segundo na media); apagar a copia e mandar a nota sao raros. 429 so adia: o app guarda e tenta
 *   depois.
 */
export const ROUTE_THROTTLES: Record<string, { rateLimit: number; burstLimit: number }> = {
  'POST /v1/guest/migrate': { rateLimit: 1, burstLimit: 5 },
  'POST /v1/lesson/complete': { rateLimit: 20, burstLimit: 40 },
  'POST /v1/practice/review': { rateLimit: 20, burstLimit: 40 },
  'POST /v1/squads/join': { rateLimit: 5, burstLimit: 10 },
  'POST /v1/squads': { rateLimit: 2, burstLimit: 5 },
  'DELETE /v1/users/me': { rateLimit: 1, burstLimit: 5 },
  'POST /v1/telemetry': { rateLimit: 10, burstLimit: 30 },
  'DELETE /v1/telemetry/{id}': { rateLimit: 1, burstLimit: 5 },
  'POST /v1/feedback': { rateLimit: 1, burstLimit: 5 },
};

/**
 * Concorrencia reservada por Lambda da API, so com librax:lambdaReservedConcurrency ligado. Desligado
 * por padrao: conta nova pode ter cota de 10 execucoes simultaneas, e a AWS exige 100 sem reserva, entao
 * qualquer reserva faria o deploy falhar. O script de lancamento confere a cota antes de deixar ligar.
 * Os jobs (agenda) e o gatilho do Cognito ficam sem reserva: um gatilho barrado travaria o cadastro.
 */
export const RESERVED_CONCURRENCY: Record<string, number> = {
  'librax-migrate-guest': 2,
  'librax-complete-lesson': 20,
  'librax-get-daily-queue': 20,
  'librax-review-signs': 20,
  'librax-abandon-lesson': 10,
  'librax-create-squad': 5,
  'librax-join-squad': 5,
  'librax-leave-squad': 5,
  'librax-get-squad': 10,
  'librax-manage-member': 5,
  'librax-list-my-squads': 10,
  'librax-disband-squad': 5,
  'librax-transfer-ownership': 5,
  'librax-regenerate-invite': 5,
  'librax-get-league': 10,
  'librax-league-result-seen': 5,
  'librax-push-subscribe': 5,
  'librax-push-unsubscribe': 5,
  'librax-notification-prefs': 5,
  'librax-delete-account': 2,
  'librax-report-device': 5,
  'librax-get-progress': 5,
  'librax-admin': 5,
  'librax-admin-actions': 1,
  'librax-telemetry': 5,
};

/** Soma das reservas (o script de lancamento confere a cota da conta com este numero). */
export const RESERVED_CONCURRENCY_TOTAL = Object.values(RESERVED_CONCURRENCY).reduce((a, b) => a + b, 0);
/** Execucoes simultaneas que a AWS deixa sempre sem reserva na conta. */
export const LAMBDA_UNRESERVED_MINIMUM = 100;

/**
 * Teto de vazao da tabela sob demanda (unidades por segundo). Acima disso o DynamoDB recusa
 * (throttling) em vez de cobrar, e o alarme librax-dynamodb-throttles avisa. Folga grande para o uso
 * real do lancamento (cada licao concluida grava poucos itens).
 */
export const DYNAMO_MAX_READ_UNITS = 500;
export const DYNAMO_MAX_WRITE_UNITS = 200;

/**
 * Alarme de download do CloudFront do app (GB por hora, librax:appDownloadAlarmGbPerHour). A primeira
 * instalacao baixa de 30 a 45 MB (app, modelos de ML e avatar); 5 GB numa hora sao mais de 100
 * instalacoes novas, acima do esperado no lancamento e cedo o bastante para agir (o CloudFront da 1 TB
 * por mes de graca).
 */
export const APP_DOWNLOAD_ALARM_GB_PER_HOUR = 5;

/**
 * Valor minimo (dolares) de uma anomalia de custo para virar e-mail: 20% do orcamento mensal, nunca
 * menos que 1 dolar.
 */
export function anomalyThresholdUsd(monthlyBudgetUsd: number): number {
  return Math.max(1, Math.round(monthlyBudgetUsd * 0.2 * 100) / 100);
}

/**
 * Nome do AWS Budget. Os avisos (NotificationsWithSubscribers) so mudam com troca do recurso, e o
 * CloudFormation nao troca recurso de nome fixo: o nome leva um resumo dos avisos e do e-mail, entao
 * mudar o e-mail ou um aviso cria o orcamento novo e apaga o velho em vez de travar o deploy.
 */
export function budgetName(notifications: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(notifications)).digest('hex').slice(0, 8);
  return `librax-mensal-${hash}`;
}
