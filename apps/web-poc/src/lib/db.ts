import { openDB, type IDBPDatabase } from 'idb';

export type LibraxDB = IDBPDatabase<unknown>;

let _db: LibraxDB | null = null;

export function upgradeLibraxDb(db: IDBPDatabase<unknown>, oldVersion = 0) {
  if (oldVersion < 1) {
    db.createObjectStore('profiles', { keyPath: 'userId' });

    const progress = db.createObjectStore('lesson_progress', {
      keyPath: ['userId', 'lessonId'],
    });
    progress.createIndex('byUser', 'userId');

    const srs = db.createObjectStore('srs_items', {
      keyPath: ['userId', 'signId'],
    });
    srs.createIndex('byUserAndDue', ['userId', 'dueAt']);

    db.createObjectStore('day_xp', { keyPath: ['userId', 'day'] });
  }

  if (oldVersion < 2) {
    // Ligas do antigo modo local/demo. Hoje as ligas ficam no servidor (src/lib/league.ts): os
    // stores seguem só porque fazem parte da versão 2 do banco.
    db.createObjectStore('league_state', { keyPath: 'userId' });
    db.createObjectStore('league_members', { keyPath: ['leagueId', 'userId'] });
  }

  if (oldVersion < 3) {
    // Desempenho da câmera por sinal (src/lib/cameraStats.ts): só contagens, sem imagem.
    db.createObjectStore('camera_stats', { keyPath: 'signId' });
  }
}

export async function getDb(): Promise<LibraxDB> {
  if (_db) return _db;
  _db = await openDB('librax-poc', 3, { upgrade: (db, oldVersion) => upgradeLibraxDb(db, oldVersion) });
  return _db;
}
