import { describe, it, expect } from 'vitest';
import {
  cameraRecognizerFor, course, resolveExercises, signsMap, type BundleExercise, type Sign,
} from '../lib/content';
import {
  composeCourse, composeLessonExercises, lessonContrastPairs, numberExercises, MAX_EXERCISES, MIN_EXERCISES,
} from '../../../../tools/content/compose.mjs';
import courseRaw from '../assets/content/course.json';
import signsRaw from '../assets/content/signs.json';

type Item = { type: string; payload: Record<string, unknown> };

const FILES = import.meta.glob<{ lesson_id: string; exercises: BundleExercise[] }>(
  '../assets/content/lessons/*.json',
  { eager: true, import: 'default' },
);
const BUNDLE: Record<string, BundleExercise[]> = Object.fromEntries(
  Object.values(FILES).map((f) => [f.lesson_id, f.exercises]),
);
const lessons = course.units.flatMap((u) => u.lessons);

/** Pares de todas as lições, como estão no bundle. */
function bundlePairs() {
  return Object.entries(BUNDLE).flatMap(([lessonId, items]) =>
    items.filter((e) => e.type === 'contrast_pair').map((e) => ({ lessonId, payload: e.payload as { sign_ids: string[]; camera_sign_ids: string[]; contexts?: Record<string, string> } })),
  );
}

const none = () => false;

describe('contrast_pair: composição (tools/content/compose.mjs)', () => {
  const lesson = {
    id: 't-l1',
    signIds: ['letra-F', 'letra-T', 'letra-U', 'letra-V'],
    produce: [],
    contrastPairs: [{ signs: ['letra-F', 'letra-T'] }, { signs: ['letra-U', 'letra-V'] }],
  };

  it('cada par vira um contrast_pair depois dos receptivos, com a câmera só nos sinais já produzidos antes', () => {
    const seenSigns = new Set(lesson.signIds);
    const items = composeLessonExercises(lesson, signsMap, { seenSigns, producedSigns: new Set(['letra-F', 'letra-U', 'letra-V']) }) as Item[];
    const pairs = items.filter((e) => e.type === 'contrast_pair');
    expect(pairs.map((e) => e.payload)).toEqual([
      { sign_ids: ['letra-F', 'letra-T'], camera_sign_ids: ['letra-F'] },
      { sign_ids: ['letra-U', 'letra-V'], camera_sign_ids: ['letra-U', 'letra-V'] },
    ]);
    // Todo sinal continua com o seu receptivo; a rodada extra completa até 7 antes dos pares
    expect(items.slice(-2).map((e) => e.type)).toEqual(['contrast_pair', 'contrast_pair']);
    expect(items.filter((e) => e.type === 'watch_choose_word' || e.type === 'word_choose_video').length).toBe(5);
    expect(items.length).toBe(MIN_EXERCISES);
  });

  it('o sinal que a própria lição já pede na câmera (produce) não volta na câmera do par', () => {
    const items = composeLessonExercises({ ...lesson, produce: ['letra-F'] }, signsMap, {
      seenSigns: new Set(lesson.signIds), producedSigns: new Set(['letra-F', 'letra-T']),
    }) as Item[];
    expect(items.find((e) => e.type === 'contrast_pair')!.payload.camera_sign_ids).toEqual(['letra-T']);
  });

  it('o par conta no limite de 12: com muitos sinais, o agrupamento (match_pairs) abre espaço', () => {
    const big = {
      id: 't-l2',
      signIds: ['letra-A', 'letra-B', 'letra-D', 'letra-E', 'letra-F', 'letra-T'],
      contrastPairs: [{ signs: ['letra-F', 'letra-T'] }],
    };
    const items = composeLessonExercises(big, signsMap) as Item[];
    expect(items.length).toBeLessThanOrEqual(MAX_EXERCISES);
    expect(items.some((e) => e.type === 'match_pairs')).toBe(true);
    expect(items.filter((e) => e.type === 'contrast_pair')).toHaveLength(1);
  });

  it('par da mesma mão leva o contexto de cada sinal e um não é distrator do outro no "Qual é o sinal de"', () => {
    const same = {
      id: 't-l3',
      signIds: ['numero-0', 'letra-O', 'numero-8', 'letra-S'],
      produce: [],
      contrastPairs: [{ signs: ['numero-0', 'letra-O'], contexts: { 'numero-0': '10', 'letra-O': 'BOLO' } }],
    };
    const items = composeLessonExercises(same, signsMap, { seenSigns: new Set(same.signIds) }) as Item[];
    expect(items.find((e) => e.type === 'contrast_pair')!.payload.contexts).toEqual({ 'numero-0': '10', 'letra-O': 'BOLO' });
    const wcv = items.filter((e) => e.type === 'word_choose_video');
    const forO = wcv.find((e) => e.payload.correct_sign_id === 'letra-O');
    expect(forO).toBeDefined();
    expect(forO!.payload.video_options).not.toContain('numero-0');
  });

  it('par inválido ou com sinal ainda não ensinado falha ao gerar', () => {
    expect(() => lessonContrastPairs({ id: 'x', contrastPairs: [{ signs: ['letra-F', 'letra-F'] }] }, signsMap)).toThrow(/inválido/);
    expect(() => lessonContrastPairs({ id: 'x', contrastPairs: [{ signs: ['letra-F'] }] }, signsMap)).toThrow(/inválido/);
    expect(() => lessonContrastPairs({ id: 'x', contrastPairs: [{ signs: ['letra-O', 'numero-0'], contexts: { 'letra-O': 'BOLO' } }] }, signsMap))
      .toThrow(/contexto/);
    const early = structuredClone(courseRaw) as typeof courseRaw & { units: { lessons: Record<string, unknown>[] }[] };
    early.units[0].lessons[0].contrastPairs = [{ signs: ['letra-A', 'letra-T'] }];
    expect(() => composeCourse(early, signsRaw)).toThrow(/ainda não ensinado \(letra-T\)/);
  });
});

describe('contrast_pair: no curso', () => {
  it('pares curados nas revisões: fim do alfabeto (U1 L7 e L8) e letras e números depois da U2 (U2 L3)', () => {
    const byLesson = (id: string) => bundlePairs().filter((p) => p.lessonId === id).map((p) => p.payload.sign_ids.map((s) => signsMap[s].gloss).join('/'));
    expect(byLesson('u1-l7')).toEqual(['F/T', 'U/V', 'M/N']);
    expect(byLesson('u1-l8')).toEqual(['C/Ç', 'K/H', 'P/K']);
    expect(byLesson('u2-l3')).toEqual(['0/O', 'S/8']);
    const total = bundlePairs().length;
    expect(total).toBeGreaterThanOrEqual(6);
    expect(total).toBeLessThanOrEqual(10);
  });

  it('só pares com a descrição conferida no INES e na VLibras (nada "A CONFERIR")', () => {
    for (const { lessonId, payload } of bundlePairs()) {
      for (const id of payload.sign_ids) {
        const notes = signsMap[id].notes ?? '';
        expect(notes, `${lessonId}: ${id}`).toMatch(/Conferid[oa]/);
        expect(notes, `${lessonId}: ${id}`).not.toMatch(/A CONFERIR/);
      }
    }
  });

  it('a câmera do par só pede o que já teve perform_sign antes (as letras fracas no modelo ficam sem)', () => {
    const cam = (lessonId: string, a: string) =>
      bundlePairs().find((p) => p.lessonId === lessonId && p.payload.sign_ids[0] === a)!.payload.camera_sign_ids;
    expect(cam('u1-l7', 'letra-F')).toEqual(['letra-F']);
    expect(cam('u1-l7', 'letra-M')).toEqual([]);
    expect(cam('u1-l8', 'letra-C')).toEqual(['letra-C', 'letra-Ç']);
    expect(cam('u2-l3', 'numero-0')).toEqual(['numero-0', 'letra-O']);
  });

  it('as lições com pares seguem o limite de 7 a 12 e cada sinal do par tem exercício com nota', () => {
    for (const l of lessons.filter((x) => BUNDLE[x.id].some((e) => e.type === 'contrast_pair'))) {
      expect(BUNDLE[l.id].length, l.id).toBeGreaterThanOrEqual(MIN_EXERCISES);
      expect(BUNDLE[l.id].length, l.id).toBeLessThanOrEqual(MAX_EXERCISES);
      const ex = resolveExercises(BUNDLE[l.id], l.signIds);
      const pairs = ex.filter((e) => e.type === 'contrast_pair');
      pairs.forEach((e) => e.contrast!.signIds.forEach((id) => expect(l.signIds, l.id).toContain(id)));
    }
  });
});

describe('contrast_pair: sorteios e reconhecedor (resolveExercises)', () => {
  const item = (payload: Record<string, unknown>): BundleExercise[] =>
    numberExercises('t-l1', [{ type: 'contrast_pair', payload }]) as BundleExercise[];

  it('uma rodada por sinal, cada uma com as duas mãos em ordem sorteada', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const [ex] = resolveExercises(item({ sign_ids: ['letra-F', 'letra-T'], camera_sign_ids: [] }), ['letra-F', 'letra-T']);
      expect(ex.type).toBe('contrast_pair');
      const { rounds, signIds } = ex.contrast!;
      expect(signIds).toEqual(['letra-F', 'letra-T']);
      expect(rounds.map((r) => r.target).sort()).toEqual(['letra-F', 'letra-T']);
      rounds.forEach((r) => expect([...r.order].sort()).toEqual(['letra-F', 'letra-T']));
      seen.add(rounds.map((r) => `${r.target}:${r.order.join(',')}`).join('|'));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('cada sinal da câmera fica com o seu reconhecedor; sinal que nenhum avalia sai da câmera', () => {
    const [ex] = resolveExercises(
      item({ sign_ids: ['letra-K', 'letra-H'], camera_sign_ids: ['letra-K', 'letra-H'] }),
      ['letra-K', 'letra-H'],
      { canEvaluateLetterMotion: (s) => s?.gloss === 'K', canEvaluate: (s) => s?.gloss === 'H', canEvaluateMotion: none, canEvaluateNumber: none },
    );
    expect(ex.contrast!.camera).toEqual([{ signId: 'letra-K', recognizer: 'letras-mov' }, { signId: 'letra-H', recognizer: 'letras' }]);

    const [zero] = resolveExercises(
      item({ sign_ids: ['numero-0', 'letra-O'], camera_sign_ids: ['numero-0', 'letra-O'], contexts: { 'numero-0': '10', 'letra-O': 'BOLO' } }),
      ['numero-0', 'letra-O'],
      { canEvaluateLetterMotion: none, canEvaluate: none, canEvaluateMotion: none, canEvaluateNumber: (s) => s?.category === 'numeros' },
    );
    expect(zero.contrast!.camera).toEqual([{ signId: 'numero-0', recognizer: 'numeros' }]);
    expect(zero.contrast!.contexts).toEqual({ 'numero-0': '10', 'letra-O': 'BOLO' });

    const [off] = resolveExercises(
      item({ sign_ids: ['letra-F', 'letra-T'], camera_sign_ids: ['letra-F'] }),
      ['letra-F', 'letra-T'],
      { canEvaluate: none, canEvaluateLetterMotion: none, canEvaluateMotion: none, canEvaluateNumber: none },
    );
    expect(off.contrast!.camera).toEqual([]);
  });

  it('cameraRecognizerFor segue a ordem do perform_sign', () => {
    const all = () => true;
    const s = (id: string): Sign => signsMap[id];
    expect(cameraRecognizerFor(s('letra-H'), { canEvaluateLetterMotion: all, canEvaluate: all })).toBe('letras-mov');
    expect(cameraRecognizerFor(s('letra-F'), { canEvaluateLetterMotion: none, canEvaluate: all })).toBe('letras');
    expect(cameraRecognizerFor(s('sinal-OI'), { canEvaluateLetterMotion: none, canEvaluate: none, canEvaluateMotion: all })).toBe('sinais');
    expect(cameraRecognizerFor(s('numero-8'), { canEvaluateLetterMotion: none, canEvaluate: none, canEvaluateMotion: none, canEvaluateNumber: all })).toBe('numeros');
    expect(cameraRecognizerFor(s('letra-T'), { canEvaluateLetterMotion: none, canEvaluate: none, canEvaluateMotion: none, canEvaluateNumber: none })).toBeNull();
  });
});
