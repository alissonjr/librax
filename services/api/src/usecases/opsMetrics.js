import {
  periodsOf,
  lessonCompletedWrites,
  practiceWrites,
  lessonAbandonWrites,
  newAccountWrites,
  placementWrites,
} from '../domain/opsMetrics.js';

/**
 * Contadores do painel de administracao (domain/opsMetrics.js, docs/painel-admin.md), gravados
 * pelos usecases que ja existem no servidor. Cada evento faz uma leitura do registro de atividade
 * da pessoa e alguns ADD em itens do dia; nada disso roda no app (o modo local do web-poc usa
 * completeLesson e reviewSigns, nao as versoes idempotentes que chamam estes).
 */

async function apply(repo, writes) {
  await Promise.all(writes.map((w) => repo.addOpsCounters(w.key, w.counters, { expiresAt: w.expiresAt })));
}

/**
 * Contador nunca derruba a operacao principal: a licao ja foi aplicada quando ele roda. A falha
 * vai para o log (e o numero do dia fica um pouco abaixo).
 */
export async function quietly(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.warn('[opsMetrics]', label, err?.message ?? err);
  }
}

/** Licao concluida (completeLessonOnce, migracao do convidado e o endpoint legado). */
export async function recordLessonCompleted(repo, { userId, lessonId, today, reviewed = [], exerciseStats = null, cameraStats = null }) {
  const fresh = await repo.markActivity(userId, periodsOf(today));
  await apply(repo, lessonCompletedWrites({ lessonId, today, reviewed, exerciseStats, cameraStats, fresh }));
}

/** Rodada da pratica diaria (reviewSignsOnce). */
export async function recordPractice(repo, { userId, today }) {
  const fresh = await repo.markActivity(userId, periodsOf(today));
  await apply(repo, practiceWrites({ today, fresh }));
}

/** Saida no meio da licao (POST /v1/lesson/abandon). Abrir e praticar ja conta como ativa. */
export async function recordLessonAbandon(repo, { userId, lessonId, today, exerciseType = null }) {
  const fresh = await repo.markActivity(userId, periodsOf(today));
  await apply(repo, lessonAbandonWrites({ lessonId, today, exerciseType, fresh }));
}

/** Marca do teste de nivelamento que mudou o progresso (usecases/placement.js). Nao marca atividade. */
export async function recordPlacement(repo, { lessonId, today, placement }) {
  await apply(repo, placementWrites({ lessonId, today, placement }));
}

/** Conta nova (gatilho PostConfirmation do Cognito), no dia de Brasilia. */
export async function recordNewAccount(repo, { day }) {
  await apply(repo, newAccountWrites({ day }));
}
