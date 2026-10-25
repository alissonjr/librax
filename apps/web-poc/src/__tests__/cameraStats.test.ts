import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { upgradeLibraxDb, type LibraxDB } from '../lib/db';
import { IdbRepo } from '../lib/idbRepo';
import {
  CameraRun,
  LESSON_MAX_WRONG_LABELS,
  addRunToLesson,
  applyRun,
  attemptsOf,
  buildCameraStatsExport,
  clearCameraStats,
  difficultyOf,
  listCameraStats,
  onCameraRun,
  rankByDifficulty,
  recordCameraRun,
  saveCameraRun,
  summarize,
  type CameraRunResult,
  type CameraSignStats,
} from '../lib/cameraStats';

const NOW = new Date('2026-10-25T12:00:00.000Z');

function started(run: CameraRun): CameraRun {
  run.started = true;
  return run;
}

function result(patch: Partial<CameraRunResult> = {}): CameraRunResult {
  return { signId: 'letra-K', label: 'K', kind: 'letter', outcome: 'success', wrongReadings: {}, ...patch };
}

function stats(patch: Partial<CameraSignStats>): CameraSignStats {
  return {
    signId: 'letra-A',
    label: 'A',
    kind: 'letter',
    successes: 0,
    skips: 0,
    attemptsToSuccess: 0,
    wrongReadings: {},
    updatedAt: NOW.toISOString(),
    ...patch,
  };
}

describe('CameraRun (uma vez do sinal na câmera)', () => {
  it('conta cada troca para outra leitura como leitura errada, e a certa fecha em acerto', () => {
    const run = started(new CameraRun('letra-K', 'K', 'letter'));
    for (const r of [null, 'H', 'H', null, 'H', 'P', 'K']) run.observe(r);
    const out = run.finish('success');
    expect(out).toEqual(result({ wrongReadings: { H: 2, P: 1 } }));
    expect(attemptsOf(out!)).toBe(4);
  });

  it('a mesma leitura parada na tela conta uma vez só', () => {
    const run = started(new CameraRun('letra-K', 'K', 'letter'));
    run.observe('H');
    run.observe('H');
    run.observe('H');
    expect(run.finish('skip')?.wrongReadings).toEqual({ H: 1 });
  });

  it('ignora a leitura pedida (letra anterior ainda na mão) e rótulos fora do formato', () => {
    const run = started(new CameraRun('letra-S', 'S', 'letter'));
    run.observe('O', 'O');
    run.observe('texto livre');
    run.observe('A');
    expect(run.finish('skip')?.wrongReadings).toEqual({ A: 1 });
  });

  it('leitura inicial (letra recém-aceita) não vira erro enquanto continua igual', () => {
    const run = started(new CameraRun('letra-S', 'S', 'letter', 'S'));
    run.observe('S');
    expect(run.finish('success')?.wrongReadings).toEqual({});
  });

  it('sem câmera ativa não registra nada (pular por falta de câmera não mede o reconhecimento)', () => {
    const run = new CameraRun('letra-K', 'K', 'letter');
    run.observe('H');
    expect(run.finish('skip')).toBeNull();
  });

  it('fecha uma vez só', () => {
    const run = started(new CameraRun('sinal-MESA', 'MESA', 'sign'));
    expect(run.finish('success')).not.toBeNull();
    expect(run.finish('skip')).toBeNull();
    expect(run.finished).toBe(true);
  });
});

describe('applyRun (acumulado por sinal)', () => {
  it('soma acertos, pulos, tentativas até acertar e leituras erradas', () => {
    let s = applyRun(undefined, result({ wrongReadings: { H: 2 } }), NOW);
    s = applyRun(s, result({ outcome: 'skip', wrongReadings: { H: 1, P: 3 } }), NOW);
    s = applyRun(s, result({ wrongReadings: {} }), NOW);
    expect(s).toEqual({
      signId: 'letra-K',
      label: 'K',
      kind: 'letter',
      successes: 2,
      skips: 1,
      // 3 (H, H, K) + 1 (K); o pulo não entra na média até acertar
      attemptsToSuccess: 4,
      wrongReadings: { H: 3, P: 3 },
      updatedAt: NOW.toISOString(),
    });
  });

  it('não altera o registro anterior', () => {
    const prev = applyRun(undefined, result({ wrongReadings: { H: 1 } }), NOW);
    const copy = structuredClone(prev);
    applyRun(prev, result({ wrongReadings: { H: 5 } }), NOW);
    expect(prev).toEqual(copy);
  });
});

describe('ordem de dificuldade', () => {
  it('nível pela taxa de pulo e pela média de tentativas', () => {
    expect(difficultyOf(0.5, 1)).toBe('hard');
    expect(difficultyOf(0, 3)).toBe('hard');
    expect(difficultyOf(0.25, 1)).toBe('attention');
    expect(difficultyOf(0, 2)).toBe('attention');
    expect(difficultyOf(0.1, 1.5)).toBe('ok');
    expect(difficultyOf(0, null)).toBe('ok');
  });

  it('resumo com as leituras erradas mais comuns primeiro', () => {
    const s = summarize(stats({ successes: 2, skips: 2, attemptsToSuccess: 5, wrongReadings: { H: 1, N: 4, P: 2, X: 1 } }));
    expect(s.runs).toBe(4);
    expect(s.skipRate).toBe(0.5);
    expect(s.avgAttempts).toBe(2.5);
    expect(s.topWrong).toEqual([{ label: 'N', count: 4 }, { label: 'P', count: 2 }, { label: 'H', count: 1 }]);
  });

  it('mais pulos primeiro, depois mais tentativas; sem acerto conta como o pior', () => {
    const ranked = rankByDifficulty([
      stats({ signId: 'letra-A', label: 'A', successes: 4, attemptsToSuccess: 4 }),
      stats({ signId: 'letra-K', label: 'K', successes: 1, skips: 3, attemptsToSuccess: 5 }),
      stats({ signId: 'letra-U', label: 'U', successes: 4, attemptsToSuccess: 12 }),
      stats({ signId: 'letra-R', label: 'R', skips: 3 }),
      stats({ signId: 'letra-B', label: 'B' }),
    ]);
    expect(ranked.map(s => s.label)).toEqual(['R', 'K', 'U', 'A']);
  });
});

describe('IndexedDB (store camera_stats)', () => {
  let db: LibraxDB;

  beforeEach(async () => {
    db = await openDB(`librax-cam-${Date.now()}-${Math.random()}`, 3, { upgrade: upgradeLibraxDb });
  });

  it('grava, soma e lista por sinal', async () => {
    await recordCameraRun(result({ wrongReadings: { H: 1 } }), db, NOW);
    await recordCameraRun(result({ outcome: 'skip' }), db, NOW);
    await recordCameraRun(result({ signId: 'sinal-MESA', label: 'MESA', kind: 'sign' }), db, NOW);
    const all = await listCameraStats(db);
    expect(all).toHaveLength(2);
    const k = all.find(s => s.signId === 'letra-K');
    expect(k).toMatchObject({ successes: 1, skips: 1, attemptsToSuccess: 2, wrongReadings: { H: 1 } });
  });

  it('gravações ao mesmo tempo não se perdem', async () => {
    await Promise.all([1, 2, 3, 4, 5].map(() => recordCameraRun(result(), db, NOW)));
    expect((await listCameraStats(db))[0].successes).toBe(5);
  });

  it('apaga só este store', async () => {
    await recordCameraRun(result(), db, NOW);
    await db.put('day_xp', { userId: 'u', day: '2026-10-25', xp: 10 });
    await clearCameraStats(db);
    expect(await listCameraStats(db)).toEqual([]);
    expect(await db.get('day_xp', ['u', '2026-10-25'])).toBeDefined();
  });

  it('"Excluir conta e dados" apaga também o desempenho da câmera', async () => {
    await recordCameraRun(result(), db, NOW);
    await new IdbRepo(db, 'u').clearAllData();
    expect(await listCameraStats(db)).toEqual([]);
  });

  it('migra um banco da versão 2 sem perder o que já existe', async () => {
    const name = `librax-mig-${Date.now()}-${Math.random()}`;
    // Banco como o app criava na versão 2 (sem o store da câmera)
    const v2 = await openDB(name, 2, {
      upgrade(d) {
        d.createObjectStore('profiles', { keyPath: 'userId' });
        d.createObjectStore('day_xp', { keyPath: ['userId', 'day'] });
      },
    });
    await v2.put('day_xp', { userId: 'u', day: '2026-10-24', xp: 5 });
    v2.close();
    const v3 = await openDB(name, 3, { upgrade: (d, old) => upgradeLibraxDb(d, old) });
    expect(v3.objectStoreNames.contains('camera_stats')).toBe(true);
    expect(await v3.get('day_xp', ['u', '2026-10-24'])).toMatchObject({ xp: 5 });
    await recordCameraRun(result(), v3, NOW);
    expect(await listCameraStats(v3)).toHaveLength(1);
  });
});

describe('exportação', () => {
  it('só os números por sinal, com formato e data, sem identificador da pessoa', () => {
    const data = buildCameraStatsExport([stats({ signId: 'letra-K', label: 'K' }), stats({})], NOW);
    expect(Object.keys(data).sort()).toEqual(['exportedAt', 'format', 'signs']);
    expect(data.exportedAt).toBe(NOW.toISOString());
    expect(data.signs.map(s => s.signId)).toEqual(['letra-A', 'letra-K']);
  });
});

describe('diferença da lição (vai com a conclusão)', () => {
  it('soma só as vezes da lição, no formato que o servidor aceita', () => {
    let lesson = addRunToLesson({}, result({ wrongReadings: { H: 2 } }));
    lesson = addRunToLesson(lesson, result({ outcome: 'skip', wrongReadings: { H: 1, V: 1 } }));
    lesson = addRunToLesson(lesson, result({ signId: 'letra-A', label: 'A' }));
    expect(lesson).toEqual({
      'letra-K': { successes: 1, skips: 1, attempts: 3, wrong: { H: 3, V: 1 } },
      'letra-A': { successes: 1, skips: 0, attempts: 1, wrong: {} },
    });
  });

  it('guarda no máximo os rótulos errados mais comuns por sinal', () => {
    const many = Object.fromEntries(Array.from({ length: LESSON_MAX_WRONG_LABELS + 3 }, (_, i) => [`X${i}`, i + 1]));
    const lesson = addRunToLesson({}, result({ wrongReadings: many }));
    const kept = Object.keys(lesson['letra-K'].wrong);
    expect(kept).toHaveLength(LESSON_MAX_WRONG_LABELS);
    expect(kept).not.toContain('X0'); // o menos frequente sai
  });

  it('saveCameraRun avisa quem ouve (a lição aberta) e para de avisar ao sair', () => {
    const heard: CameraRunResult[] = [];
    const stop = onCameraRun((run) => heard.push(run));
    const boom = onCameraRun(() => {
      throw new Error('quem ouve não quebra o exercício');
    });
    saveCameraRun(result());
    saveCameraRun(null);
    stop();
    boom();
    saveCameraRun(result({ outcome: 'skip' }));
    expect(heard).toEqual([result()]);
  });
});
