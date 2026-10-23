import { openDB, type IDBPDatabase } from 'idb';

export type LibraxDB = IDBPDatabase<unknown>;

let _db: LibraxDB | null = null;

export function upgradeLibraxDb(db: IDBPDatabase<unknown>) {
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

export async function getDb(): Promise<LibraxDB> {
  if (_db) return _db;
  _db = await openDB('librax-poc', 1, { upgrade: upgradeLibraxDb });
  return _db;
}
