import { randomBytes } from 'node:crypto';
import { opsToday } from '../domain/opsMetrics.js';
import { buildUsage, planTelemetry, telKey, usageRange } from '../domain/telemetry.js';
import { feedbackItem, feedbackListPk, feedbackWrites } from '../domain/feedback.js';

// Dados de uso anonimos e nota do app (domain/telemetry.js, domain/feedback.js). So escrevem em
// TEL#<id>, TELAGG e FBLIST: nada aqui le ou muda conta, progresso ou o caminho do curso.

/** Tentativas da trava otimista do item do codigo (dois lotes ao mesmo tempo do mesmo aparelho). */
const PUT_ATTEMPTS = 3;

export class TelemetryBusyError extends Error {
  constructor() {
    super('TELEMETRY_BUSY');
    this.code = 'TELEMETRY_BUSY';
  }
}

async function applyWrites(repo, writes) {
  await Promise.all(writes.map((w) => repo.addTelemetryCounters(w.key, w.counters, { expiresAt: w.expiresAt })));
}

/**
 * Um lote ja validado (parseTelemetryBatch): grava o item do codigo (com trava otimista) e soma os
 * agregados. Sem eventos validos, nao grava nada.
 * @returns {Promise<{ accepted: number, writes: number }>}
 */
export async function ingestTelemetry(repo, { batch, now }) {
  if (batch.events.length === 0) return { accepted: 0, writes: 0 };
  for (let attempt = 0; attempt < PUT_ATTEMPTS; attempt += 1) {
    const old = await repo.getTelemetryMeta(batch.id);
    const { item, writes } = planTelemetry({ old, batch, now });
    if (await repo.putTelemetryMeta(batch.id, item, { expectedRev: old?.rev ?? null })) {
      try {
        await applyWrites(repo, writes);
      } catch (err) {
        // o item ja foi gravado: um total do dia fica um pouco abaixo, sem falhar o envio
        console.warn('[telemetry] agregados', err?.message ?? err);
      }
      return { accepted: batch.events.length, writes: writes.length + 1 };
    }
  }
  throw new TelemetryBusyError();
}

/** Tira a nota guardada da lista do painel e desconta dos totais. */
async function forgetFeedback(repo, old) {
  await Promise.all([
    repo.deleteFeedbackEntry(feedbackListPk(null), old.listSk),
    repo.deleteFeedbackEntry(feedbackListPk(old.rating), old.listSk),
  ]);
  await applyWrites(repo, feedbackWrites({ rating: old.rating, day: old.day, sign: -1 }));
}

/**
 * Apaga a copia na nuvem de um codigo (DELETE /v1/telemetry/{id}): o item, a nota e as copias da
 * nota na lista. Os totais de uso continuam (somas sem codigo); os da nota sao descontados.
 * Idempotente: codigo que nao existe responde do mesmo jeito.
 */
export async function deleteTelemetry(repo, { id }) {
  const feedback = await repo.getFeedback(id);
  if (feedback?.listSk) await forgetFeedback(repo, feedback);
  await repo.deleteTelemetryItems(id);
  return { deleted: true, feedback: Boolean(feedback) };
}

/**
 * Nota do app (POST /v1/feedback, ja validada por parseFeedback). Uma por codigo: a nova substitui
 * a anterior (lista e totais).
 */
export async function submitFeedback(repo, { value, now, entryId = randomBytes(6).toString('hex') }) {
  const day = opsToday(now);
  const old = await repo.getFeedback(value.id);
  const { item, entry, listSk, expiresAt } = feedbackItem({ value, now, day, entryId });
  await repo.putFeedback(value.id, item);
  await Promise.all([
    repo.putFeedbackEntry(feedbackListPk(null), listSk, entry, expiresAt),
    repo.putFeedbackEntry(feedbackListPk(value.rating), listSk, entry, expiresAt),
  ]);
  if (old?.listSk) {
    try {
      await forgetFeedback(repo, old);
    } catch (err) {
      console.warn('[feedback] nota anterior', err?.message ?? err);
    }
  }
  await applyWrites(repo, feedbackWrites({ rating: value.rating, day }));
  return { replaced: Boolean(old) };
}

/** Tela "Uso" do painel: uma Query na faixa de dias, duas nas semanas e meses e duas leituras por chave. */
export async function usageOverview(repo, { now, labels = {}, days = 30 }) {
  const today = opsToday(now);
  const { readFrom } = usageRange(today, days);
  const [dayItems, weekItems, monthItems, reachItem, feedbackItemAgg] = await Promise.all([
    repo.listTelemetryRange(telKey.day(readFrom), `${telKey.day(today)}#~`),
    repo.listTelemetryLatest('WEEK#', 12),
    repo.listTelemetryLatest('MONTH#', 12),
    repo.getTelemetryAgg(telKey.reach),
    repo.getTelemetryAgg(telKey.feedback),
  ]);
  return buildUsage({ dayItems, weekItems, monthItems, reachItem, feedbackItem: feedbackItemAgg, today, days, labels });
}

/** Lista de notas do painel, da mais nova para a mais velha, opcionalmente so de uma nota. */
export async function feedbackPage(repo, { rating = null, limit = 20, cursor = null }) {
  const page = await repo.listFeedbackEntries(feedbackListPk(rating), { limit, cursor });
  return {
    items: page.entries.map((e) => ({
      at: e.at,
      day: e.day,
      rating: e.rating,
      text: e.text ?? '',
      lessonsCompleted: e.lessonsCompleted ?? null,
      currentLessonId: e.currentLessonId ?? null,
      hasAccount: Boolean(e.hasAccount),
      appVersion: e.appVersion ?? null,
      lang: e.lang ?? null,
      platform: e.platform ?? null,
      installed: e.installed ?? null,
    })),
    cursor: page.cursor,
  };
}
