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
    // Ligas semanais no modo local/demo (src/lib/leagueLocal.ts): liga atual do usuario e
    // XP do periodo por membro (mesmo par PK/SK do DynamoDB: LEAGUE#<id> / USER#<id>).
    db.createObjectStore('league_state', { keyPath: 'userId' });
    db.createObjectStore('league_members', { keyPath: ['leagueId', 'userId'] });
  }
}

export async function getDb(): Promise<LibraxDB> {
  if (_db) return _db;
  _db = await openDB('librax-poc', 2, { upgrade: (db, oldVersion) => upgradeLibraxDb(db, oldVersion) });
  return _db;
}
