import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { openDB } from 'idb';
import { course } from '../lib/course';
import { signsMap } from '../lib/content';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';
import { loadCourseProgress } from '../lib/progress';
import { clearOutbox, pendingEntries } from '../lib/sync';
import { SessionProvider, useSession } from '../hooks/useSession';
import { MAO3D_MOVING, MAO3D_STATIC, maskHandGloss } from '../mao3d/disponivel';
import {
  applyPlacement, buildPlacementPlan, drawPlacementOptions, isReviewLesson, reviewLessonsToSkip, reviewSources,
  isPlacementDone, loadPlacementStatus, nextItemIndex, scorePlacement, undoPlacement, withinNoCameraCap,
  withoutCamera, ITEMS_PER_LESSON, NO_CAMERA_MAX_LESSONS,
  type PlacementAnswer, type PlacementCapabilities, type PlacementItem, type PlacementSign,
} from '../lib/placement';

/** Câmera do jeito que o app tem hoje: MLP das letras paradas, letras com movimento e números. */
const STATIC = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y']);
const MOTION = new Set(['H', 'J', 'K', 'X', 'Ç']);
const HAND = new Set([...MAO3D_STATIC, ...MAO3D_MOVING]);

function caps(over: Partial<PlacementCapabilities> = {}): PlacementCapabilities {
  return {
    camera: true,
    letterMotion: s => MOTION.has(s.gloss),
    staticLetter: s => STATIC.has(s.gloss),
    number: () => false,
    hand3d: s => HAND.has(s.gloss),
    ...over,
  };
}

/** Sorteio repetível (LCG). */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const u1 = course.units[0].lessons;
const u2 = course.units[1].lessons;
/** Lições com sinais novos (as testadas); as revisões não têm itens. */
const u1Taught = u1.filter(l => !isReviewLesson(l));
const u2Taught = u2.filter(l => !isReviewLesson(l));
const signs = signsMap as Record<string, PlacementSign>;
const gloss = (id: string) => signs[id].gloss;

async function newRepo(userId = 'user-p') {
  const db = await openDB(`librax-placement-${Date.now()}-${Math.random()}`, 3, { upgrade: (d, old) => upgradeLibraxDb(d, old) });
  const repo = new IdbRepo(db, userId);
  await repo.saveProfile({ userId, xpTotal: 0, streak: 0, lessonsCompleted: 0, signsLearned: 0, achievements: [] });
  return repo;
}

beforeEach(async () => {
  localStorage.clear();
  await clearOutbox();
});

describe('sorteio dos itens', () => {
  it('2 sinais por lição do alfabeto ainda não concluída, sem repetir, nas lições certas', () => {
    for (let seed = 1; seed < 30; seed++) {
      const plan = buildPlacementPlan({ completed: new Set(), includeNumbers: false, caps: caps(), signs, rng: seeded(seed) });
      expect(plan).toHaveLength(u1Taught.length * ITEMS_PER_LESSON);
      for (const lesson of u1Taught) {
        const items = plan.filter(it => it.lessonId === lesson.id);
        expect(items).toHaveLength(2);
        expect(new Set(items.map(it => it.signId)).size).toBe(2);
        items.forEach(it => expect(lesson.signIds).toContain(it.signId));
      }
    }
  });

  it('cada lição com letra com movimento que a câmera avalia testa uma delas, por último na lição', () => {
    for (let seed = 1; seed < 30; seed++) {
      const plan = buildPlacementPlan({ completed: new Set(), includeNumbers: false, caps: caps(), signs, rng: seeded(seed) });
      const motion = (id: string) => plan.filter(it => it.lessonId === id && it.kind === 'camera-motion').map(it => gloss(it.signId));
      expect(motion('u1-l2').some(g => g === 'H' || g === 'J')).toBe(true);
      expect(motion('u1-l3')).toContain('K');
      expect(motion('u1-l5')).toContain('X');
      expect(motion('u1-l6')).toContain('Ç');
      expect(motion('u1-l1')).toEqual([]);
      for (const lesson of u1Taught) {
        const kinds = plan.filter(it => it.lessonId === lesson.id).map(it => it.kind);
        if (kinds.includes('camera-motion') && kinds[0] !== kinds[1]) expect(kinds[1]).toBe('camera-motion');
      }
    }
  });

  it('a lição do Ç sempre testa o Ç (o sinal novo dela), não só as letras de revisão', () => {
    for (let seed = 1; seed < 20; seed++) {
      const plan = buildPlacementPlan({ completed: new Set(), includeNumbers: false, caps: caps(), signs, rng: seeded(seed) });
      expect(plan.filter(it => it.lessonId === 'u1-l6').map(it => gloss(it.signId))).toContain('Ç');
    }
  });

  it('com a câmera, prefere os sinais que ela avalia; Z (sem câmera) só entra se faltar', () => {
    for (let seed = 1; seed < 30; seed++) {
      const plan = buildPlacementPlan({ completed: new Set(), includeNumbers: false, caps: caps(), signs, rng: seeded(seed) });
      expect(plan.every(it => it.kind !== 'choice')).toBe(true);
    }
  });

  it('lições já concluídas ficam de fora', () => {
    const plan = buildPlacementPlan({ completed: new Set(['u1-l1', 'u1-l2']), includeNumbers: false, caps: caps(), signs, rng: seeded() });
    expect(new Set(plan.map(it => it.lessonId))).toEqual(new Set(u1Taught.slice(2).map(l => l.id)));
  });

  it('números só quando pedidos; sem câmera nos números, a mão em 3D (nada de 5 ou 10, que não têm mão)', () => {
    expect(buildPlacementPlan({ completed: new Set(), includeNumbers: false, caps: caps(), signs }).some(it => it.lessonId.startsWith('u2'))).toBe(false);
    for (let seed = 1; seed < 30; seed++) {
      const plan = buildPlacementPlan({ completed: new Set(), includeNumbers: true, caps: caps(), signs, rng: seeded(seed) });
      const nums = plan.filter(it => it.lessonId.startsWith('u2'));
      expect(nums).toHaveLength(u2Taught.length * 2);
      nums.forEach(it => {
        expect(it.kind).toBe('choice');
        expect(['5', '10']).not.toContain(gloss(it.signId));
      });
    }
  });

  it('com o modelo dos números, os números vão para a câmera', () => {
    const plan = buildPlacementPlan({
      completed: new Set(), includeNumbers: true, caps: caps({ number: s => ['0', '1', '2', '3', '6', '7', '8', '9'].includes(s.gloss) }), signs, rng: seeded(),
    });
    expect(plan.filter(it => it.lessonId.startsWith('u2')).every(it => it.kind === 'camera-number')).toBe(true);
  });

  it('sem câmera: só reconhecer, e só as primeiras lições (as que podem ser puladas assim)', () => {
    const plan = buildPlacementPlan({ completed: new Set(), includeNumbers: true, caps: caps({ camera: false }), signs, rng: seeded() });
    expect(new Set(plan.map(it => it.lessonId))).toEqual(new Set(u1.slice(0, NO_CAMERA_MAX_LESSONS).map(l => l.id)));
    expect(plan.every(it => it.kind === 'choice')).toBe(true);
  });
});

describe('andamento e nota', () => {
  const plan: PlacementItem[] = [
    { lessonId: 'u1-l1', signId: 'letra-A', kind: 'camera-letter' },
    { lessonId: 'u1-l1', signId: 'letra-B', kind: 'camera-letter' },
    { lessonId: 'u1-l2', signId: 'letra-F', kind: 'camera-letter' },
    { lessonId: 'u1-l2', signId: 'letra-H', kind: 'camera-motion' },
    { lessonId: 'u1-l3', signId: 'letra-L', kind: 'camera-letter' },
    { lessonId: 'u1-l3', signId: 'letra-K', kind: 'camera-motion' },
  ];
  const cam = (correct: boolean): PlacementAnswer => ({ correct, via: 'camera' });
  const pick = (correct: boolean): PlacementAnswer => ({ correct, via: 'choice' });

  it('errar ou pular o primeiro item de uma lição tira o segundo', () => {
    expect(nextItemIndex(plan, { 0: cam(true) }, 1)).toBe(1);
    expect(nextItemIndex(plan, { 0: cam(true), 1: cam(true), 2: cam(false) }, 3)).toBe(4);
    expect(nextItemIndex(plan, { 4: cam(false) }, 5)).toBe(plan.length);
  });

  it('dominada só com todos os itens certos; errada vira "vamos estudar"', () => {
    const res = scorePlacement(['u1-l1', 'u1-l2', 'u1-l3'], plan, {
      0: cam(true), 1: cam(true), 2: cam(true), 3: cam(false), 4: cam(true), 5: cam(true),
    });
    expect(res.map(r => r.outcome)).toEqual(['mastered', 'missed', 'mastered']);
    expect(res[0].passedSigns).toEqual(['letra-A', 'letra-B']);
    expect(res[1].passedSigns).toEqual(['letra-F']);
  });

  it('só reconhecer não pula lição além das primeiras', () => {
    expect(withinNoCameraCap('u1-l2')).toBe(true);
    expect(withinNoCameraCap('u1-l3')).toBe(false);
    const res = scorePlacement(['u1-l1', 'u1-l3'], plan, { 0: pick(true), 1: pick(true), 4: pick(true), 5: pick(true) });
    expect(res.map(r => r.outcome)).toEqual(['mastered', 'needs_camera']);
    // Um acerto pela câmera já sustenta a lição
    expect(scorePlacement(['u1-l3'], plan, { 4: cam(true), 5: pick(true) })[0].outcome).toBe('mastered');
  });

  it('câmera perdida no meio: o resto vira reconhecer e saem as lições que já não podem ser puladas', () => {
    const answers = { 0: cam(true), 1: cam(true), 2: cam(true) };
    const next = withoutCamera(plan, answers, 3);
    expect(next.slice(0, 3)).toEqual(plan.slice(0, 3));
    // u1-l2 está entre as primeiras (fica, como reconhecer); u1-l3 sai inteira
    expect(next.slice(3)).toEqual([{ lessonId: 'u1-l2', signId: 'letra-H', kind: 'choice' }]);
    const res = scorePlacement(['u1-l1', 'u1-l2', 'u1-l3'], next, { ...answers, 3: pick(true) });
    expect(res.map(r => r.outcome)).toEqual(['mastered', 'mastered', 'needs_camera']);
  });

  it('opções do "qual letra é esta?": 4, sem repetir, com a certa e letras da própria lição primeiro', () => {
    for (let seed = 1; seed < 20; seed++) {
      const target = signs['letra-M'];
      const opts = drawPlacementOptions(target, course.lessonsMap['u1-l3'].signIds, signs, seeded(seed));
      expect(opts).toHaveLength(4);
      expect(new Set(opts.map(o => o.gloss)).size).toBe(4);
      expect(opts.map(o => o.id)).toContain('letra-M');
      opts.forEach(o => expect(course.lessonsMap['u1-l3'].signIds).toContain(o.id));
    }
    const num = drawPlacementOptions(signs['numero-3'], course.lessonsMap['u2-l1'].signIds, signs, seeded());
    expect(num.every(o => o.id.startsWith('numero-'))).toBe(true);
  });

  it('o rótulo da mão em 3D no teste não diz a letra', () => {
    expect(maskHandGloss('Mão semiaberta curvada em forma de C', 'C')).toBe('Mão semiaberta curvada em forma de ___');
    expect(maskHandGloss('Mão semiaberta curvada em forma de C (a mesma do C)', 'Ç')).toBe('Mão semiaberta curvada em forma de C (a mesma do C)');
    expect(maskHandGloss('Punho fechado, polegar ao lado', 'A')).toBe('Punho fechado, polegar ao lado');
  });
});

describe('pular lições (gravação)', () => {
  it('grava como concluída pelo teste, sem XP, sequência, SRS nem conquista, e põe as marcas na fila', async () => {
    const repo = await newRepo();
    const placed = await applyPlacement(repo, 'user-p', [
      { lessonId: 'u1-l1', passedSigns: ['letra-A', 'letra-C'] },
      { lessonId: 'u1-l2', passedSigns: ['letra-F', 'letra-H'] },
    ], '2026-10-26');
    expect(placed).toBe(2);

    expect(await repo.getProgress('user-p', 'u1-l1')).toMatchObject({ status: 'completed', placement: true, placementSigns: ['letra-A', 'letra-C'] });
    const profile = await repo.getProfile('user-p') as Record<string, unknown>;
    expect(profile).toMatchObject({ xpTotal: 0, streak: 0, lessonsCompleted: 0, signsLearned: 0, achievements: [] });
    expect(await repo.hasDayLog('user-p', '2026-10-26')).toBe(false);
    expect(await repo.listSrsItems('user-p')).toEqual([]);
    // Fila de envio: uma marca `skip` por lição pulada, sem nota (o servidor não dá XP por ela)
    const queued = await pendingEntries();
    expect(queued.map(e => [e.lessonId, e.placement, e.today])).toEqual([
      ['u1-l1', 'skip', '2026-10-26'], ['u1-l2', 'skip', '2026-10-26'],
    ]);
    expect(new Set(queued.map(e => e.lessonAttemptId)).size).toBe(2);
    expect(isPlacementDone()).toBe(true);

    // Mapa: as puladas abertas para refazer, sem nota, e a próxima é a primeira não pulada
    const progress = await loadCourseProgress(repo, 'user-p');
    expect(progress.lessonStatuses.get('u1-l1')).toBe('completed');
    expect(progress.lessonStatuses.get('u1-l3')).toBe('available');
    expect(progress.nextLesson).toBe('u1-l3');
    expect([...(progress.placedLessons ?? [])]).toEqual(['u1-l1', 'u1-l2']);
    expect(progress.bestScores.has('u1-l1')).toBe(false);
  });

  it('pular uma lição do meio deixa as anteriores na ordem de sempre', async () => {
    const repo = await newRepo();
    await applyPlacement(repo, 'user-p', [{ lessonId: 'u1-l3', passedSigns: ['letra-K', 'letra-L'] }], '2026-10-26');
    const progress = await loadCourseProgress(repo, 'user-p');
    expect(progress.lessonStatuses.get('u1-l1')).toBe('available');
    expect(progress.lessonStatuses.get('u1-l2')).toBe('locked');
    expect(progress.lessonStatuses.get('u1-l3')).toBe('completed');
  });

  it('lição já concluída de verdade não vira "pulada"', async () => {
    const repo = await newRepo();
    await repo.saveProgress('user-p', 'u1-l1', { status: 'completed', bestScore: 0.9, completedAt: '2026-10-20' });
    expect(await applyPlacement(repo, 'user-p', [{ lessonId: 'u1-l1', passedSigns: ['letra-A'] }], '2026-10-26')).toBe(0);
    expect(await repo.getProgress('user-p', 'u1-l1')).toMatchObject({ bestScore: 0.9 });
    expect((await repo.getProgress('user-p', 'u1-l1') as Record<string, unknown>).placement).toBeUndefined();
    expect(await pendingEntries()).toEqual([]);
  });

  it('desfazer reabre as puladas (não as refeitas) e o convite volta', async () => {
    const repo = await newRepo();
    await applyPlacement(repo, 'user-p', [
      { lessonId: 'u1-l1', passedSigns: [] }, { lessonId: 'u1-l2', passedSigns: [] },
    ], '2026-10-26');
    // u1-l2 refeita: vira conclusão normal
    await repo.saveProgress('user-p', 'u1-l2', { status: 'completed', bestScore: 1, completedAt: '2026-10-26' });
    expect(await loadPlacementStatus(repo, 'user-p')).toEqual({ offer: false, placed: ['u1-l1'] });

    await clearOutbox();
    expect(await undoPlacement(repo, 'user-p', '2026-10-27')).toBe(1);
    expect(await repo.getProgress('user-p', 'u1-l1')).toBeNull();
    // Só a reaberta vai como marca `undo` (a refeita já é conclusão normal no servidor)
    expect((await pendingEntries()).map(e => [e.lessonId, e.placement, e.today])).toEqual([['u1-l1', 'undo', '2026-10-27']]);
    expect(await repo.getProgress('user-p', 'u1-l2')).toMatchObject({ status: 'completed', bestScore: 1 });
    expect(isPlacementDone()).toBe(false);
    expect(await loadPlacementStatus(repo, 'user-p')).toEqual({ offer: true, placed: [] });
  });

  it('o convite some com o alfabeto concluído', async () => {
    const repo = await newRepo();
    for (const l of u1) await repo.saveProgress('user-p', l.id, { status: 'completed', bestScore: 1 });
    expect((await loadPlacementStatus(repo, 'user-p')).offer).toBe(false);
  });
});

describe('lições de revisão', () => {
  it('as revisões (sem sinal novo) não têm itens no teste', () => {
    expect(u1.filter(isReviewLesson).map(l => l.id)).toEqual(['u1-l7', 'u1-l8']);
    expect(u2.filter(isReviewLesson).map(l => l.id)).toEqual(['u2-l3']);
    expect(isReviewLesson(course.lessonsMap['u1-l6'])).toBe(false); // o Ç é novo
    const plan = buildPlacementPlan({ completed: new Set(), includeNumbers: true, caps: caps(), signs, rng: seeded() });
    expect(plan.some(it => ['u1-l7', 'u1-l8', 'u2-l3'].includes(it.lessonId))).toBe(false);
    expect(reviewSources(course.lessonsMap['u1-l8']).sort()).toEqual(['u1-l1', 'u1-l2', 'u1-l3', 'u1-l4', 'u1-l6']);
  });

  it('só são puladas junto quando todas as lições de origem foram puladas', () => {
    const none = new Set<string>();
    const all = new Set(u1Taught.map(l => l.id));
    expect(reviewLessonsToSkip(false, all, none)).toEqual(['u1-l7', 'u1-l8']);
    // Sem o Ç pulado, a revisão do movimento (C/Ç) fica; a das parecidas (F/T, U/V, M/N) vai junto
    const semCedilha = new Set([...all].filter(id => id !== 'u1-l6'));
    expect(reviewLessonsToSkip(false, semCedilha, none)).toEqual(['u1-l7']);
    // Origem concluída de verdade não basta: quem fez a lição pelo curso faz a revisão
    expect(reviewLessonsToSkip(false, none, all)).toEqual([]);
    // Revisão já concluída fica de fora
    expect(reviewLessonsToSkip(false, all, new Set(['u1-l7']))).toEqual(['u1-l8']);
    // A de números depende de letras e números, e só entra com os números no teste
    const tudo = new Set([...all, ...u2Taught.map(l => l.id)]);
    expect(reviewLessonsToSkip(false, tudo, none)).not.toContain('u2-l3');
    expect(reviewLessonsToSkip(true, tudo, none)).toContain('u2-l3');
    expect(reviewLessonsToSkip(true, all, none)).not.toContain('u2-l3');
  });
});

describe('Alfabeto completo com o teste', () => {
  async function sessionFor(repo: IdbRepo) {
    let session: ReturnType<typeof useSession> | null = null;
    function Probe() {
      session = useSession();
      return null;
    }
    await act(async () => {
      render(<SessionProvider repo={repo} userId="user-p" brokenStreak={0}><Probe /></SessionProvider>);
    });
    return () => session!;
  }

  it('o teste nunca dá a conquista; ela vem ao concluir de verdade a última da U1, como no servidor', async () => {
    const repo = await newRepo();
    const last = u1[u1.length - 1];
    await applyPlacement(repo, 'user-p', u1.slice(0, -1).map(l => ({ lessonId: l.id, passedSigns: l.signIds.slice(0, 2) })), '2026-10-26');
    expect(((await repo.getProfile('user-p')) as Record<string, unknown>).achievements).toEqual([]);

    const session = await sessionFor(repo);
    let after: unknown;
    await act(async () => {
      after = await session().finishLesson({
        lessonId: last.id, score: 1, xpReward: last.xpReward, signsLearnedDelta: 0, isLastLesson: false,
        reviewed: [{ signId: 'letra-Ç', result: { state: 'correct', highConfidence: true } }],
      });
    });
    expect(after).toBe('unit');
    const s = session();
    // Mesma regra do servidor (alphabetLessonId = última lição da U1)
    expect(s.completion?.achievementsEarned).toContain('ALFABETO');
    // XP só da lição feita; a tela da unidade não soma as puladas
    expect(s.completion?.xpAwarded).toBe(last.xpReward);
    expect(s.unitCompletion?.xpGained).toBe(last.xpReward);
    const profile = await repo.getProfile('user-p') as Record<string, unknown>;
    expect(profile.xpTotal).toBe(last.xpReward);
    expect(profile.lessonsCompleted).toBe(1);
    // Fila de envio: as puladas como marcas (sem nota, o servidor não dá XP nem conquista por elas)
    // e só a lição feita como conclusão
    const queued = await pendingEntries();
    expect(queued.filter(e => !e.placement).map(e => e.lessonId)).toEqual([last.id]);
    expect(queued.filter(e => e.placement).map(e => [e.lessonId, e.placement])).toEqual(u1.slice(0, -1).map(l => [l.id, 'skip']));
  });

  it('concluir uma lição do meio da U1 depois de pular as outras não dá a conquista', async () => {
    const repo = await newRepo();
    await applyPlacement(repo, 'user-p', u1.filter(l => l.id !== 'u1-l6').map(l => ({ lessonId: l.id, passedSigns: [] })), '2026-10-26');
    const session = await sessionFor(repo);
    await act(async () => {
      await session().finishLesson({
        lessonId: 'u1-l6', score: 1, xpReward: 10, signsLearnedDelta: 1, isLastLesson: false, reviewed: [],
      });
    });
    expect(session().completion?.achievementsEarned).not.toContain('ALFABETO');
    expect(session().completion?.achievementsEarned).not.toContain('SINAIS_26');
  });
});
