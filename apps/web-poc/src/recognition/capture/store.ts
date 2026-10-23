import { openDB, type IDBPDatabase } from 'idb';
import type { CaptureSample } from './sample';

/**
 * Amostras da coleta guardadas no IndexedDB do próprio aparelho, num banco separado do app
 * (o app não lê nem depende dele). Só saem daqui quando a pessoa exporta.
 */
const DB_NAME = 'librax-coleta';
const STORE = 'samples';

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        const store = d.createObjectStore(STORE, { autoIncrement: true });
        store.createIndex('byLabel', 'label');
      },
    });
  }
  return dbPromise;
}

export async function addSamples(samples: readonly CaptureSample[]): Promise<void> {
  if (samples.length === 0) return;
  const tx = (await db()).transaction(STORE, 'readwrite');
  await Promise.all([...samples.map(s => tx.store.add(s)), tx.done]);
}

export async function allSamples(): Promise<CaptureSample[]> {
  return (await db()).getAll(STORE) as Promise<CaptureSample[]>;
}

export async function countByLabel(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let cursor = await (await db()).transaction(STORE).store.index('byLabel').openKeyCursor();
  while (cursor) {
    const label = String(cursor.key);
    counts[label] = (counts[label] ?? 0) + 1;
    cursor = await cursor.continue();
  }
  return counts;
}

/** Apaga as amostras de uma gravação (botão "desfazer"). */
export async function deleteSession(sessionId: string): Promise<void> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if ((cursor.value as CaptureSample).session_id === sessionId) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function clearSamples(): Promise<void> {
  await (await db()).clear(STORE);
}

/** Só para testes. */
export async function closeCaptureDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
