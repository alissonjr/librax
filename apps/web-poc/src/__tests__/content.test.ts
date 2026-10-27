import { describe, it, expect, afterEach } from 'vitest';
import {
  course, drawChoices, getSign, isCameraEvaluable, isLetterMotionEvaluable, isMotionSignEvaluable, maskChoiceCaption, maskGloss, phraseTiles, resolveExercises, signsMap,
  type BundleExercise, type Exercise, type Phrase, type Sign,
} from '../lib/content';
import { RECOGNIZABLE_LETTERS } from '../components/ExerciseCameraSign';
import { setSignModelForTests } from '../recognition/signModel';
import { setLetterMotionModelForTests } from '../recognition/letterMotionModel';
import type { MlpModel } from '../recognition/mlp';
import { evaluateAchievements } from '@domain/achievements.js';
import {
  composeCourse, composeLessonExercises, knownGlossCount, lessonFile, normalizeGloss, numberExercises,
  phraseDistractors, pickPhrase, splitMatchGroups, MATCH_MAX, MAX_EXERCISES, MIN_EXERCISES, PHRASE_FIRST_UNIT_INDEX,
} from '../../../../tools/content/compose.mjs';
import { maskedCaption } from '../components/ExerciseWordChooseVideo';
import { completeLesson } from '@usecases/completeLesson.js';
import { getDailyQueue } from '@usecases/getDailyQueue.js';
import { InMemoryRepo } from '../../../../services/api/src/adapters/inMemoryRepo.js';
import courseRaw from '../assets/content/course.json';
import signsRaw from '../assets/content/signs.json';

const ALL_IDS = Object.keys(signsMap);
const LETTER_IDS = ALL_IDS.filter((id) => signsMap[id].category === 'alfabeto');

// Bundle versionado (um arquivo por licao), como o app le
const FILES = import.meta.glob<{ generated_by: string; lesson_id: string; exercises: BundleExercise[] }>(
  '../assets/content/lessons/*.json',
  { eager: true, import: 'default' },
);
const BUNDLE: Record<string, BundleExercise[]> = Object.fromEntries(
  Object.values(FILES).map((f) => [f.lesson_id, f.exercises]),
);

/** Tipos do catalogo da spec-03 secao 3 (nomes finais). */
const SPEC_TYPES = new Set([
  'sign_intro', 'watch_choose_word', 'word_choose_video', 'match_pairs', 'order_sequence', 'build_phrase',
  'perform_sign', 'fingerspell', 'mirror_practice', 'contrast_pair',
]);

type Composed = { type: string; payload: Record<string, unknown> };

function fakeSign(id: string, gloss: string, category: string, recognition: string): Sign {
  return {
    id,
    gloss,
    category,
    recognition,
    params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null,
    video_caption: '',
  };
}

/** Exercicios de uma licao avulsa no formato do bundle. */
function bundleFor(signIds: string[], map: Record<string, Sign> = signsMap): BundleExercise[] {
  return numberExercises('t-l1', composeLessonExercises({ signIds }, map)) as BundleExercise[];
}

/** Compoe e resolve uma licao avulsa, como o app faria com o arquivo do bundle. */
function lessonFor(signIds: string[], map: Record<string, Sign> = signsMap, pool = ALL_IDS): Exercise[] {
  return resolveExercises(bundleFor(signIds, map), signIds, { signsMap: map, allSignIds: pool });
}

/** Fases da sessao (spec-03 secao 4): apresenta e reconhece, produz, frase no fim. */
const PHASE: Record<string, number> = {
  sign_intro: 1, watch_choose_word: 1, word_choose_video: 1, match_pairs: 1,
  perform_sign: 2, mirror_practice: 2, fingerspell: 2, order_sequence: 2, contrast_pair: 2,
  build_phrase: 3,
};

/** Sinais com exercicio que da nota na licao (o LessonScreen manda para o SRS em `reviewed`). */
function gradedSigns(exercises: Exercise[]): Set<string> {
  const out = new Set<string>();
  for (const e of exercises) {
    if (e.type === 'watch_choose_word' || e.type === 'word_choose_video' || e.type === 'perform_sign') out.add(e.signId);
    if (e.type === 'match_pairs') e.pairSignIds!.forEach((id) => out.add(id));
    if (e.type === 'contrast_pair') e.contrast!.signIds.forEach((id) => out.add(id));
  }
  return out;
}

describe('composicao da licao (bundle)', () => {
  const signIds = ['letra-A', 'letra-B', 'letra-C'];
  const items = bundleFor(signIds);
  const count = (t: string, list: { type: string }[] = items) => list.filter((e) => e.type === t).length;

  it('segue o schema { id, lesson_id, type, order, payload } com order 1, 2, 3...', () => {
    items.forEach((e, i) => {
      expect(Object.keys(e).sort()).toEqual(['id', 'lesson_id', 'order', 'payload', 'type']);
      expect(e.lesson_id).toBe('t-l1');
      expect(e.order).toBe(i + 1);
      expect(SPEC_TYPES.has(e.type), e.type).toBe(true);
    });
    expect(new Set(items.map((e) => e.id)).size).toBe(items.length);
  });

  it('apresenta cada sinal novo, reconhece cada um uma vez e produz 2', () => {
    expect(items.map((e) => e.type)).toEqual([
      'sign_intro', 'watch_choose_word', 'sign_intro', 'word_choose_video', 'sign_intro', 'watch_choose_word',
      'perform_sign', 'perform_sign',
    ]);
    expect(count('mirror_practice')).toBe(0);
    expect(count('match_pairs')).toBe(0);
  });

  it('perform_sign leva o payload da spec (recognition, limiar, tentativas e video de dica)', () => {
    const p = items.find((e) => e.type === 'perform_sign')!.payload;
    expect(p).toEqual({ sign_id: 'letra-A', recognition: 'static', min_confidence: null, max_attempts: null, hint_video_url: null });
  });

  it('o bundle nao fixa distratores: watch_choose_word so traz o sinal e a resposta', () => {
    items.forEach((e) => {
      if (e.type !== 'watch_choose_word') return;
      expect(e.payload).toEqual({ sign_id: e.payload.sign_id, correct: signsMap[e.payload.sign_id].gloss });
    });
  });

  it('word_choose_video traz a palavra e 4 demonstracoes distintas com a certa, de sinais da licao primeiro', () => {
    const lesson = ['letra-A', 'letra-B', 'letra-C', 'letra-D', 'letra-E'];
    const wcv = bundleFor(lesson).filter((e) => e.type === 'word_choose_video');
    expect(wcv.length).toBeGreaterThan(0);
    wcv.forEach((e) => {
      if (e.type !== 'word_choose_video') return;
      const { word, video_options, correct_sign_id } = e.payload;
      expect(word).toBe(signsMap[correct_sign_id].gloss);
      expect(video_options).toHaveLength(4);
      expect(new Set(video_options).size).toBe(4);
      expect(video_options).toContain(correct_sign_id);
      video_options.forEach((id) => expect(lesson).toContain(id));
    });
  });

  it('licao pequena completa com distratores da mesma categoria', () => {
    const wcv = items.find((e) => e.type === 'word_choose_video');
    if (wcv?.type !== 'word_choose_video') throw new Error('sem word_choose_video');
    expect(wcv.payload.video_options).toHaveLength(4);
    wcv.payload.video_options.forEach((id) => expect(signsMap[id].category).toBe('alfabeto'));
  });

  it('sinal de revisao (ja apresentado antes) nao ganha sign_intro, so o exercicio receptivo', () => {
    const lesson = { signIds: ['letra-A', 'letra-B', 'letra-C', 'letra-D'] };
    const out: Composed[] = composeLessonExercises(lesson, signsMap, { seenSigns: new Set(['letra-A', 'letra-B']) });
    const intros = out.filter((e) => e.type === 'sign_intro').map((e) => e.payload.sign_id);
    expect(intros).toEqual(['letra-C', 'letra-D']);
    const receptive = out.filter((e) => e.type === 'watch_choose_word' || e.type === 'word_choose_video');
    expect(receptive).toHaveLength(4);
  });

  it('6 sinais com frase: os 4 ultimos dividem um match_pairs e a licao fica em 12', () => {
    const six = ['letra-A', 'letra-B', 'letra-C', 'letra-D', 'letra-E', 'letra-F'];
    const phrase = { glosses: ['A', 'B'], pt: 'frase', source: { name: 'x', url: 'https://x.org' } };
    const out: Composed[] = composeLessonExercises({ signIds: six }, signsMap, { phrase, unitPhrases: [phrase] });
    expect(out).toHaveLength(MAX_EXERCISES);
    expect(count('sign_intro', out)).toBe(6);
    const pairs = out.find((e) => e.type === 'match_pairs')!.payload.pairs as { sign_id: string }[];
    expect(pairs.map((p) => p.sign_id)).toEqual(six.slice(2));
    // os sign_intro do grupo vem antes do match_pairs
    const matchIdx = out.findIndex((e) => e.type === 'match_pairs');
    six.slice(2).forEach((id) => {
      expect(out.findIndex((e) => e.type === 'sign_intro' && e.payload.sign_id === id)).toBeLessThan(matchIdx);
    });
    expect(count('perform_sign', out)).toBe(2);
    expect(out[out.length - 1].type).toBe('build_phrase');
  });

  it('licao curta completa com uma rodada de watch_choose_word ate 7', () => {
    const out: Composed[] = composeLessonExercises({ signIds: ['letra-A'] }, signsMap);
    expect(out).toHaveLength(MIN_EXERCISES);
    expect(out.map((e) => e.type).slice(0, 3)).toEqual(['sign_intro', 'watch_choose_word', 'perform_sign']);
  });

  it('licao que nao cabe em 12 falha ao gerar o bundle (pede para dividir)', () => {
    const many = 'ABCDEFGHI'.split('').map((l) => `letra-${l}`);
    expect(() => composeLessonExercises({ id: 'x', signIds: many }, signsMap)).toThrow(/Divida a lição/);
  });

  it('nomes da U4 viram fingerspell com as letras, no lugar da producao com perform_sign', () => {
    const out: Composed[] = composeLessonExercises(
      { signIds: ['letra-B', 'letra-I', 'letra-A', 'letra-L'], spellWords: ['BIA', 'LIA'] },
      signsMap,
      { seenSigns: new Set(['letra-B', 'letra-I', 'letra-A', 'letra-L']) },
    );
    expect(count('perform_sign', out)).toBe(0);
    expect(out.filter((e) => e.type === 'fingerspell').map((e) => e.payload)).toEqual([
      { word: 'BIA', letters: ['B', 'I', 'A'], per_letter_confidence: null },
      { word: 'LIA', letters: ['L', 'I', 'A'], per_letter_confidence: null },
    ]);
  });

  it('licao com produce: perform_sign de cada sinal listado e a palavra de revisao no fim', () => {
    const five = ['letra-K', 'letra-L', 'letra-M', 'letra-N', 'letra-O'];
    const out: Composed[] = composeLessonExercises(
      { signIds: five, produce: ['letra-K', 'letra-L', 'letra-O'], spellWords: ['BOLO'] },
      signsMap,
    );
    expect(out).toHaveLength(MAX_EXERCISES);
    expect(out.filter((e) => e.type === 'perform_sign').map((e) => e.payload.sign_id)).toEqual(['letra-K', 'letra-L', 'letra-O']);
    expect(out[out.length - 1]).toEqual({ type: 'fingerspell', payload: { word: 'BOLO', letters: ['B', 'O', 'L', 'O'], per_letter_confidence: null } });
    // para caber em 12, os 3 ultimos dividem o match_pairs
    expect((out.find((e) => e.type === 'match_pairs')!.payload.pairs as { sign_id: string }[]).map((p) => p.sign_id)).toEqual(five.slice(2));
  });

  it('licao com produce agrupa ate 6 sinais, divididos em dois match_pairs de 3 (a licao passa de 12)', () => {
    const six = ['letra-U', 'letra-V', 'letra-W', 'letra-X', 'letra-Y', 'letra-Z'];
    const out: Composed[] = composeLessonExercises(
      { signIds: six, produce: ['letra-U', 'letra-V', 'letra-W', 'letra-Y'], spellWords: ['YAGO'] },
      signsMap,
    );
    // 12 com um match_pairs so; o segundo grupo soma um exercicio
    expect(out).toHaveLength(MAX_EXERCISES + 1);
    const matches = out.filter((e) => e.type === 'match_pairs').map((e) => (e.payload.pairs as { sign_id: string }[]).map((p) => p.sign_id));
    expect(matches).toEqual([six.slice(0, 3), six.slice(3)]);
    // cada match_pairs vem logo depois dos sign_intro dos seus sinais
    expect(out.slice(0, 8).map((e) => e.type)).toEqual([
      'sign_intro', 'sign_intro', 'sign_intro', 'match_pairs', 'sign_intro', 'sign_intro', 'sign_intro', 'match_pairs',
    ]);
    // sem a lista de producao o agrupamento continua ate 4
    const words = ['UVA', 'VIVA', 'OVO', 'YAGO'];
    expect(() => composeLessonExercises({ id: 'x', signIds: six, spellWords: words }, signsMap)).toThrow(/Divida a lição/);
    // produce vazio: 5 agrupados viram 3 + 2
    const five: Composed[] = composeLessonExercises({ id: 'x', signIds: six, spellWords: words, produce: [] }, signsMap);
    expect(five.filter((e) => e.type === 'match_pairs').map((e) => (e.payload.pairs as unknown[]).length)).toEqual([3, 2]);
    expect(five).toHaveLength(MAX_EXERCISES + 1);
  });

  it('splitMatchGroups divide em grupos equilibrados de ate 4', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
    const sizes = (n: number) => splitMatchGroups(ids(n)).map((g: string[]) => g.length);
    expect(sizes(0)).toEqual([]);
    expect(sizes(3)).toEqual([3]);
    expect(sizes(4)).toEqual([4]);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(6)).toEqual([3, 3]);
    expect(sizes(9)).toEqual([3, 3, 3]);
    expect(splitMatchGroups(ids(6)).flat()).toEqual(ids(6));
    expect(MATCH_MAX).toBe(4);
  });

  it('produce com sinal fora da licao falha', () => {
    expect(() => composeLessonExercises({ id: 'x', signIds: ['letra-A', 'letra-B'], produce: ['letra-C'] }, signsMap))
      .toThrow(/fora da lição/);
  });

  it('"soletre seu nome" vira fingerspell com own_name e a palavra de reserva', () => {
    const out: Composed[] = composeLessonExercises(
      { signIds: ['letra-L', 'letra-I', 'letra-D', 'letra-A'], spellWords: ['LIA'], spellOwnName: 'LIDIA' },
      signsMap,
      { seenSigns: new Set(['letra-L', 'letra-I', 'letra-D', 'letra-A']) },
    );
    expect(out.filter((e) => e.type === 'fingerspell').map((e) => e.payload)).toEqual([
      { word: 'LIA', letters: ['L', 'I', 'A'], per_letter_confidence: null },
      { word: 'LIDIA', letters: ['L', 'I', 'D', 'I', 'A'], per_letter_confidence: null, own_name: true },
    ]);
    expect(out.filter((e) => e.type === 'perform_sign')).toHaveLength(0);
  });

  it('o curso falha ao gerar se uma palavra soletrada usa letra sem camera ate a licao', () => {
    const lesson = (id: string, signIds: string[], extra = {}) => ({ id, title: id, order: 1, xpReward: 10, signIds, ...extra });
    const fake = (spellWords: string[]) => ({
      ...courseRaw,
      units: [{ id: 'u1', title: 'x', description: 'x', lessons: [
        lesson('a', ['letra-A', 'letra-B', 'letra-C', 'letra-M'], { produce: ['letra-A', 'letra-B', 'letra-C'] }),
        lesson('b', ['letra-A', 'letra-B', 'letra-C', 'letra-M'], { spellWords }),
      ] }],
    });
    expect(() => composeCourse(fake(['CABA']), signsRaw)).not.toThrow();
    expect(() => composeCourse(fake(['CAMA']), signsRaw)).toThrow(/CAMA usa letra sem exercício de câmera até aqui \(M\)/);
  });

  it('palavra soletrada com letra com movimento que teve camera (Ç) passa; as regras finas ficam em spelling.test.ts', () => {
    const lesson = (id: string, signIds: string[], extra = {}) => ({ id, title: id, order: 1, xpReward: 10, signIds, ...extra });
    const fake = (spellWords: string[]) => ({
      ...courseRaw,
      units: [{ id: 'u1', title: 'x', description: 'x', lessons: [
        lesson('a', ['letra-A', 'letra-C', 'letra-Ç', 'letra-O'], { produce: ['letra-A', 'letra-C', 'letra-Ç', 'letra-O'] }),
        lesson('b', ['letra-A', 'letra-C', 'letra-O'], { spellWords }),
      ] }],
    });
    expect(() => composeCourse(fake(['OCA', 'AÇO']), signsRaw)).not.toThrow();
  });
});

describe('resolveExercises (sorteios da sessao)', () => {
  // A e B estao no reconhecedor; C nao esta. A producao fica com C e A (os 2 primeiros)
  const signIds = ['letra-C', 'letra-A', 'letra-B'];
  const exercises = lessonFor(signIds);

  it('gera um sign_intro para cada sinal', () => {
    const intros = exercises.filter((e) => e.type === 'sign_intro');
    expect(intros.map((e) => e.signId)).toEqual(signIds);
  });

  it('camera avaliada (perform_sign) so para as letras que o reconhecedor avalia', () => {
    const cams = exercises.filter((e) => e.type === 'perform_sign');
    expect(cams.map((e) => e.signId)).toEqual(['letra-A']);
  });

  it('sinal fora do reconhecedor ganha mirror_practice no lugar da camera avaliada', () => {
    const forC = exercises.filter((e) => e.signId === 'letra-C');
    expect(forC.some((e) => e.type === 'perform_sign')).toBe(false);
    expect(forC.filter((e) => e.type === 'mirror_practice')).toHaveLength(1);
  });

  it('aparelho sem camera avaliada: todo perform_sign vira pratica livre', () => {
    const ex = resolveExercises(bundleFor(signIds), signIds, { canEvaluate: () => false });
    expect(ex.filter((e) => e.type === 'perform_sign')).toHaveLength(0);
    expect(ex.filter((e) => e.type === 'mirror_practice').map((e) => e.signId)).toEqual(['letra-C', 'letra-A']);
  });

  it('watch_choose_word: sempre 4 opcoes distintas com a resposta entre elas', () => {
    const watches = exercises.filter((e) => e.type === 'watch_choose_word');
    expect(watches.length).toBeGreaterThan(0);
    watches.forEach((e) => {
      expect(e.choices).toHaveLength(4);
      expect(new Set(e.choices).size).toBe(4);
      expect(e.choices).toContain(signsMap[e.signId].gloss);
    });
  });

  it('word_choose_video: 4 demonstracoes com a certa, em ordem sorteada a cada sessao', () => {
    const items = bundleFor(signIds);
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const wcv = resolveExercises(items, signIds).find((e) => e.type === 'word_choose_video')!;
      expect(wcv.videoOptions).toHaveLength(4);
      expect(wcv.videoOptions).toContain(wcv.signId);
      orders.add(wcv.videoOptions!.join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('distratores de letras sao outras letras, mesmo com o curso inteiro no pool', () => {
    const letterGlosses = new Set(LETTER_IDS.map((id) => signsMap[id].gloss));
    exercises
      .filter((e) => e.type === 'watch_choose_word')
      .forEach((e) => e.choices!.forEach((c) => expect(letterGlosses.has(c)).toBe(true)));
  });

  it('os distratores e a ordem das opcoes sao sorteados a cada sessao', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(drawChoices('letra-A', ALL_IDS).join(','));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('opcoes fixas no payload sao respeitadas (so a ordem e sorteada)', () => {
    const items: BundleExercise[] = [{
      id: 'x-ex01', lesson_id: 'x', type: 'watch_choose_word', order: 1,
      payload: { sign_id: 'letra-A', correct: 'A', options: ['A', 'E', 'S', 'O'] },
    }];
    const [ex] = resolveExercises(items, ['letra-A']);
    expect([...ex.choices!].sort()).toEqual(['A', 'E', 'O', 'S']);
  });

  it('match_pairs leva os sinais do grupo', () => {
    const items: BundleExercise[] = [{
      id: 'x-ex01', lesson_id: 'x', type: 'match_pairs', order: 1,
      payload: { pairs: ['letra-A', 'letra-B', 'letra-C'].map((id) => ({ sign_id: id, gloss: signsMap[id].gloss })) },
    }];
    const [ex] = resolveExercises(items, ['letra-A']);
    expect(ex.pairSignIds).toEqual(['letra-A', 'letra-B', 'letra-C']);
  });

  it('fingerspell usa a camera so quando ela avalia todas as letras; senao vira order_sequence', () => {
    const fs = (word: string): BundleExercise => ({
      id: `x-${word}`, lesson_id: 'x', type: 'fingerspell', order: 1,
      payload: { word, letters: word.split(''), per_letter_confidence: null },
    });
    // B, I e A estao no heuristico; O e S nao
    const [bia] = resolveExercises([fs('BIA')], ['letra-B']);
    expect(bia).toMatchObject({ type: 'fingerspell', word: 'BIA', letters: ['B', 'I', 'A'], perLetterConfidence: null });
    const [osso] = resolveExercises([fs('OSSO')], ['letra-O']);
    expect(osso).toMatchObject({ type: 'order_sequence', word: 'OSSO', steps: ['O', 'S', 'S', 'O'], correctOrder: [0, 1, 2, 3] });
    const [off] = resolveExercises([fs('BIA')], ['letra-B'], { canEvaluate: () => false });
    expect(off.type).toBe('order_sequence');
  });

  describe('"soletre seu nome" (own_name)', () => {
    const own: BundleExercise = {
      id: 'x-own', lesson_id: 'x', type: 'fingerspell', order: 1,
      payload: { word: 'LIDIA', letters: ['L', 'I', 'D', 'I', 'A'], per_letter_confidence: null, own_name: true },
    };
    const all = () => true;
    afterEach(() => localStorage.clear());

    it('troca a palavra pelo primeiro nome do perfil, sem acento', () => {
      const [ex] = resolveExercises([own], ['letra-L'], { canEvaluate: all, displayName: 'Ágata Souza' });
      expect(ex).toMatchObject({ type: 'fingerspell', word: 'AGATA', letters: ['A', 'G', 'A', 'T', 'A'], ownName: true, signId: 'letra-A' });
    });

    it('sem dizer o nome, le o salvo no aparelho pelo onboarding (funciona sem conta e offline)', () => {
      localStorage.setItem('librax_displayName', 'Bruno');
      const [ex] = resolveExercises([own], ['letra-L'], { canEvaluate: all });
      expect(ex).toMatchObject({ word: 'BRUNO', ownName: true });
    });

    it('nome que nao da (longo demais, vazio ou sem letras) fica com a palavra de reserva', () => {
      for (const name of ['Conceição', 'Maximiliano', '', null, '123']) {
        const [ex] = resolveExercises([own], ['letra-L'], { canEvaluate: all, displayName: name });
        expect(ex, String(name)).toMatchObject({ type: 'fingerspell', word: 'LIDIA' });
        expect(ex.ownName, String(name)).toBeUndefined();
      }
    });

    it('sem camera para todas as letras do nome vira order_sequence, ainda com o nome', () => {
      const [ex] = resolveExercises([own], ['letra-L'], { canEvaluate: () => false, displayName: 'Ana' });
      expect(ex).toMatchObject({ type: 'order_sequence', word: 'ANA', steps: ['A', 'N', 'A'], ownName: true });
    });
  });

  it('cada exercicio tem id unico', () => {
    const ids = exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('licoes com sinais que a camera nao avalia', () => {
  const map: Record<string, Sign> = {
    'numero-1': fakeSign('numero-1', '1', 'numeros', 'static'),
    'numero-2': fakeSign('numero-2', '2', 'numeros', 'static'),
    'numero-3': fakeSign('numero-3', '3', 'numeros', 'static'),
    'numero-4': fakeSign('numero-4', '4', 'numeros', 'static'),
    'sinal-OI': fakeSign('sinal-OI', 'OI', 'saudacoes', 'dynamic'),
    'sinal-TCHAU': fakeSign('sinal-TCHAU', 'TCHAU', 'saudacoes', 'dynamic'),
    'letra-A': fakeSign('letra-A', 'A', 'alfabeto', 'static'),
    'letra-J': fakeSign('letra-J', 'J', 'alfabeto', 'dynamic'),
  };
  const ids = Object.keys(map);

  it('sinal dinamico nao gera camera avaliada e ganha mirror_practice', () => {
    const ex = lessonFor(['sinal-OI', 'sinal-TCHAU', 'letra-J'], map, ids);
    expect(ex.filter((e) => e.type === 'perform_sign')).toHaveLength(0);
    expect(ex.filter((e) => e.type === 'mirror_practice')).toHaveLength(2);
  });

  it('o bundle marca o sinal dinamico como recognition dynamic', () => {
    const items: Composed[] = composeLessonExercises({ signIds: ['sinal-OI'] }, map);
    expect(items.find((e) => e.type === 'perform_sign')!.payload.recognition).toBe('dynamic');
  });

  it('producao prefere sinais estaticos (a camera tem mais chance de avaliar)', () => {
    const items: Composed[] = composeLessonExercises({ signIds: ['sinal-OI', 'letra-J', 'letra-A'] }, map);
    expect(items.filter((e) => e.type === 'perform_sign').map((e) => e.payload.sign_id)).toEqual(['letra-A', 'sinal-OI']);
  });

  it('numero estatico tambem fica sem camera avaliada (o reconhecedor so conhece letras)', () => {
    const ex = lessonFor(['numero-1', 'numero-2', 'numero-3'], map, ids);
    expect(ex.filter((e) => e.type === 'perform_sign')).toHaveLength(0);
    expect(ex.filter((e) => e.type === 'mirror_practice')).toHaveLength(2);
  });

  it('mantem os outros exercicios para sinais sem camera', () => {
    const ex = lessonFor(['numero-1', 'numero-2', 'numero-3'], map, ids);
    const count = (t: string) => ex.filter((e) => e.type === t).length;
    expect(count('sign_intro')).toBe(3);
    expect(count('watch_choose_word')).toBe(2);
    expect(count('word_choose_video')).toBe(1);
  });

  it('distratores preferem a mesma categoria', () => {
    const ex = lessonFor(['numero-1'], map, ids);
    ex.filter((e) => e.type === 'watch_choose_word').forEach((e) => {
      expect([...e.choices!].sort()).toEqual(['1', '2', '3', '4']);
    });
  });

  it('completa com outras categorias quando a categoria tem menos de 4 sinais', () => {
    const ex = lessonFor(['sinal-OI'], map, ids);
    ex.filter((e) => e.type === 'watch_choose_word').forEach((e) => {
      expect(e.choices).toHaveLength(4);
      expect(e.choices).toContain('OI');
      expect(e.choices).toContain('TCHAU');
    });
  });
});

describe('sinais com movimento avaliados pelo modelo de sinais (/ml/sinais/)', () => {
  const map: Record<string, Sign> = {
    'sinal-OI': fakeSign('sinal-OI', 'OI', 'saudacoes', 'dynamic'),
    'sinal-TCHAU': fakeSign('sinal-TCHAU', 'TCHAU', 'saudacoes', 'dynamic'),
    'letra-A': fakeSign('letra-A', 'A', 'alfabeto', 'static'),
  };
  const ids = Object.keys(map);
  const fakeModel = (labels: string[]) => ({ labels, normalizationVersion: 2, inputDim: 1120, layers: [] }) as MlpModel;

  afterEach(() => setSignModelForTests(null));

  it('sem modelo publicado nada muda: sinal com movimento continua prática livre', () => {
    const ex = lessonFor(['sinal-OI', 'sinal-TCHAU'], map, ids);
    expect(ex.filter((e) => e.type === 'perform_sign')).toHaveLength(0);
    expect(ex.some((e) => e.recognizer)).toBe(false);
    expect(isMotionSignEvaluable(map['sinal-OI'])).toBe(false);
  });

  it('glosa que o modelo conhece vira perform_sign com o reconhecedor de sinais', () => {
    setSignModelForTests({ model: fakeModel(['OI', '_']) });
    expect(isMotionSignEvaluable(map['sinal-OI'])).toBe(true);
    expect(isMotionSignEvaluable(map['sinal-TCHAU'])).toBe(false);
    expect(isMotionSignEvaluable(undefined)).toBe(false);
    const ex = lessonFor(['sinal-OI', 'sinal-TCHAU'], map, ids);
    const cams = ex.filter((e) => e.type === 'perform_sign');
    expect(cams.map((e) => [e.signId, e.recognizer])).toEqual([['sinal-OI', 'sinais']]);
    expect(ex.filter((e) => e.type === 'mirror_practice').map((e) => e.signId)).toEqual(['sinal-TCHAU']);
  });

  it('com camera_signs: só as glosas da lista viram perform_sign; as outras do modelo seguem prática livre', () => {
    setSignModelForTests({ model: fakeModel(['OI', 'TCHAU', '_']), cameraSigns: ['TCHAU'] });
    expect(isMotionSignEvaluable(map['sinal-OI'])).toBe(false);
    expect(isMotionSignEvaluable(map['sinal-TCHAU'])).toBe(true);
    const ex = lessonFor(['sinal-OI', 'sinal-TCHAU'], map, ids);
    expect(ex.filter((e) => e.type === 'perform_sign').map((e) => e.signId)).toEqual(['sinal-TCHAU']);
    expect(ex.filter((e) => e.type === 'mirror_practice').map((e) => e.signId)).toEqual(['sinal-OI']);
  });

  it('modelo publicado: camera_signs pela soma de 8 divisões dos canais (70% e 8 canais); TRISTE ganha a câmera e HOSPITAL volta para a prática livre', () => {
    type Heldout = Record<string, { certas: number; total: number; canais: number }>;
    const [published] = Object.values(import.meta.glob<{
      labels: string[]; camera_signs: string[]; camera_seeds: number; camera_min_heldout: number;
      camera_min_channels: number; heldout: Heldout;
    }>('../../public/ml/sinais/model.json', { eager: true, import: 'default' }));
    expect(published.camera_seeds).toBe(8);
    for (const g of published.camera_signs) {
      const h = published.heldout[g];
      expect(h.certas / h.total, g).toBeGreaterThanOrEqual(published.camera_min_heldout);
      expect(h.canais, g).toBeGreaterThanOrEqual(published.camera_min_channels);
    }
    setSignModelForTests({ model: fakeModel(published.labels), cameraSigns: published.camera_signs });
    const produced = (lessonId: string) => {
      const ex = resolveExercises(BUNDLE[lessonId], course.lessonsMap[lessonId].signIds, { canEvaluate: () => false });
      return {
        camera: ex.filter((e) => e.type === 'perform_sign').map((e) => e.signId),
        free: ex.filter((e) => e.type === 'mirror_practice').map((e) => e.signId),
      };
    };
    // U7 L1: TRISTE passou (70,1% na soma); FELIZ (94,6%) entra por exceção ao teste do dicionário (SEM_TESTE_DIC)
    const u7l1 = produced('u7-l1');
    expect([...u7l1.camera].sort()).toEqual(['sinal-FELIZ', 'sinal-TRISTE']);
    expect(u7l1.free).toEqual([]);
    // U11 L3: HOSPITAL ficou em 68,8% na soma (tinha passado nas duas divisões da regra antiga)
    expect(produced('u11-l3')).toEqual({ camera: [], free: ['sinal-ESCOLA', 'sinal-HOSPITAL'] });
  });

  it('letra avaliada continua com o classificador das letras, mesmo se o modelo de sinais tiver a glosa', () => {
    setSignModelForTests({ model: fakeModel(['A', 'OI', '_']) });
    const ex = resolveExercises(bundleFor(['letra-A', 'sinal-OI'], map), ['letra-A', 'sinal-OI'], {
      signsMap: map, allSignIds: ids, canEvaluate: (s) => s?.gloss === 'A',
    });
    const cams = ex.filter((e) => e.type === 'perform_sign');
    expect(cams.find((e) => e.signId === 'letra-A')?.recognizer).toBeUndefined();
  });

  it('a opção canEvaluateMotion decide no lugar do modelo', () => {
    const ex = resolveExercises(bundleFor(['sinal-OI'], map), ['sinal-OI'], {
      signsMap: map, allSignIds: ids, canEvaluateMotion: () => true,
    });
    expect(ex.filter((e) => e.type === 'perform_sign').map((e) => e.recognizer)).toEqual(['sinais']);
  });
});

describe('letras com movimento avaliadas pelo modelo das letras com movimento (/ml/letras-mov/)', () => {
  const map: Record<string, Sign> = {
    'letra-H': fakeSign('letra-H', 'H', 'alfabeto', 'static'),
    'letra-J': fakeSign('letra-J', 'J', 'alfabeto', 'dynamic'),
    'letra-A': fakeSign('letra-A', 'A', 'alfabeto', 'static'),
    'sinal-OI': fakeSign('sinal-OI', 'OI', 'saudacoes', 'dynamic'),
  };
  const ids = Object.keys(map);
  const fakeModel = (labels: string[]) => ({ labels, normalizationVersion: 2, inputDim: 552, layers: [] }) as MlpModel;
  const staticAH = (s: Sign | undefined) => s?.gloss === 'A' || s?.gloss === 'H';
  // As lições do alfabeto listam as letras com câmera (produce)
  const produced = (signIds: string[]) =>
    numberExercises('t-l1', composeLessonExercises({ signIds, produce: signIds }, map)) as BundleExercise[];

  afterEach(() => setLetterMotionModelForTests(null));

  it('sem modelo publicado nada muda: H com o modelo das letras paradas, J prática livre', () => {
    expect(isLetterMotionEvaluable(map['letra-H'])).toBe(false);
    const ex = resolveExercises(produced(['letra-H', 'letra-J']), ['letra-H', 'letra-J'], {
      signsMap: map, allSignIds: ids, canEvaluate: staticAH,
    });
    expect(ex.filter((e) => e.type === 'perform_sign').map((e) => [e.signId, e.recognizer])).toEqual([['letra-H', undefined]]);
    expect(ex.filter((e) => e.type === 'mirror_practice').map((e) => e.signId)).toEqual(['letra-J']);
  });

  it('letra que o modelo conhece vira perform_sign com o movimento, antes do modelo das letras paradas', () => {
    setLetterMotionModelForTests({ model: fakeModel(['H', 'J', '_']) });
    expect(isLetterMotionEvaluable(map['letra-H'])).toBe(true);
    expect(isLetterMotionEvaluable(map['letra-A'])).toBe(false);
    // só letras do alfabeto: um sinal com a mesma glosa não entra
    expect(isLetterMotionEvaluable(fakeSign('sinal-H', 'H', 'saudacoes', 'dynamic'))).toBe(false);
    const ex = resolveExercises(produced(['letra-H', 'letra-J', 'letra-A']), ['letra-H', 'letra-J', 'letra-A'], {
      signsMap: map, allSignIds: ids, canEvaluate: staticAH,
    });
    expect(ex.filter((e) => e.type === 'perform_sign').map((e) => [e.signId, e.recognizer]))
      .toEqual([['letra-H', 'letras-mov'], ['letra-J', 'letras-mov'], ['letra-A', undefined]]);
  });

  it('a opção canEvaluateLetterMotion decide no lugar do modelo', () => {
    const ex = resolveExercises(produced(['letra-J']), ['letra-J'], {
      signsMap: map, allSignIds: ids, canEvaluateLetterMotion: (s) => s?.gloss === 'J',
    });
    expect(ex.filter((e) => e.type === 'perform_sign').map((e) => e.recognizer)).toEqual(['letras-mov']);
  });

  it('Ç, X e Z (U1 L6): o modelo publicado tem os três na câmera; o C segue com o modelo das letras paradas', () => {
    const [published] = Object.values(import.meta.glob<{ camera_letters: string[] }>(
      '../../public/ml/letras-mov/model.json', { eager: true, import: 'default' },
    ));
    for (const letter of ['Ç', 'X', 'Z']) expect(published.camera_letters).toContain(letter);
    setLetterMotionModelForTests({ model: fakeModel(published.camera_letters.concat('_')) });
    const lesson = course.lessonsMap['u1-l6'];
    const still = (s: Sign | undefined) => ['C', 'A', 'O', 'I'].includes(s?.gloss ?? '');
    const ex = resolveExercises(BUNDLE['u1-l6'], lesson.signIds, { canEvaluate: still });
    expect(ex.filter((e) => e.type === 'perform_sign').map((e) => [e.signId, e.recognizer]))
      .toEqual([['letra-C', undefined], ['letra-Ç', 'letras-mov'], ['letra-X', 'letras-mov'], ['letra-Z', 'letras-mov']]);
    // CAÇA e JOIA: as letras paradas com o classificador delas, o Ç e o J com o modelo das letras com movimento
    expect(ex.find((e) => e.word === 'CAÇA')).toMatchObject({ type: 'fingerspell', spellReaders: ['letras', 'letras', 'letras-mov', 'letras'] });
    expect(ex.find((e) => e.word === 'JOIA')).toMatchObject({ type: 'fingerspell', spellReaders: ['letras-mov', 'letras', 'letras', 'letras'] });
    // sem o modelo das letras com movimento, o Ç vira prática livre (no perform_sign e dentro da palavra)
    setLetterMotionModelForTests(null);
    const off = resolveExercises(BUNDLE['u1-l6'], lesson.signIds, { canEvaluate: still });
    expect(off.filter((e) => e.signId === 'letra-Ç' && e.type === 'mirror_practice')).toHaveLength(1);
    expect(off.find((e) => e.word === 'CAÇA')).toMatchObject({ type: 'fingerspell', spellReaders: ['letras', 'letras', 'livre', 'letras'] });
  });
});

describe('isCameraEvaluable', () => {
  it('aceita so letras estaticas da lista do reconhecedor', () => {
    for (const id of LETTER_IDS) {
      const s = signsMap[id];
      expect(isCameraEvaluable(s)).toBe(RECOGNIZABLE_LETTERS.has(s.gloss) && s.recognition === 'static');
    }
  });

  it('recusa sinais que nao sao letras', () => {
    ALL_IDS.filter((id) => signsMap[id].category !== 'alfabeto')
      .forEach((id) => expect(isCameraEvaluable(signsMap[id])).toBe(false));
    expect(isCameraEvaluable(undefined)).toBe(false);
  });
});

describe('getSign', () => {
  it('retorna o sinal pelo id', () => {
    const sign = getSign('letra-A');
    expect(sign.gloss).toBe('A');
    expect(sign.category).toBe('alfabeto');
  });

  it('lanca erro para id desconhecido', () => {
    expect(() => getSign('letra-INEXISTENTE')).toThrow('Sinal nao encontrado');
  });
});

describe('signsMap', () => {
  it('contem 27 letras do alfabeto (A a Z e o Ç)', () => {
    expect(LETTER_IDS).toHaveLength(27);
  });

  it('todas as letras de A a Z e o Ç estao presentes', () => {
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÇ'.split('').forEach((letter) => {
      expect(signsMap[`letra-${letter}`]).toBeDefined();
    });
  });

  it('todo sinal esta marcado como rascunho nao validado', () => {
    for (const s of Object.values(signsMap)) {
      expect(s.status, s.id).toBe('rascunho');
      expect(s.validated, s.id).toBe(false);
    }
  });

  it('todo sinal novo (fora da U1) tem fonte, parametros, legenda e video_url null', () => {
    ALL_IDS.filter((id) => signsMap[id].category !== 'alfabeto').forEach((id) => {
      const s = signsMap[id];
      expect(s.source?.name, id).toBeTruthy();
      expect(s.source?.url, id).toMatch(/^https?:\/\//);
      for (const p of ['CM', 'PA', 'MOV', 'OR', 'ENM'] as const) expect(s.params[p], `${id}.${p}`).toBeTruthy();
      expect(s.video_caption, id).toBeTruthy();
      expect(s.video_url, id).toBeNull();
      expect(['static', 'dynamic'], id).toContain(s.recognition);
    });
  });

  it('textos mostrados do sinal estao em portugues com acento (sem "mao", "medio", "espaco"...)', () => {
    // Formas sem acento que ja apareceram no conteudo; em maiusculas e glosa citada, fica de fora
    const semAcento = new Set([
      'mao', 'maos', 'medio', 'minimo', 'espaco', 'rapido', 'tres', 'angulo', 'ate', 'balanca', 'balancando',
      'circulo', 'comeca', 'direcao', 'so', 'traca', 'tras', 'vitoria', 'voce', 'nao',
    ]);
    for (const s of Object.values(signsMap)) {
      const texts = { ...s.params, video_caption: s.video_caption };
      for (const [field, text] of Object.entries(texts)) {
        const wrong = text.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== w.toUpperCase() && semAcento.has(w.toLowerCase()));
        expect(wrong, `${s.id}.${field}`).toEqual([]);
        expect(text, `${s.id}.${field}`).not.toMatch(/[–—]/u);
      }
      // A CM aparece sozinha como descricao no sign_intro: comeca com maiuscula (ou numero, "1) ...")
      expect(s.params.CM, s.id).toMatch(/^[\p{Lu}\p{N}]/u);
      expect(s.video_caption, s.id).toMatch(/^[\p{Lu}\p{N}]/u);
    }
  });

  it('glosas sao unicas (as opcoes de multipla escolha dependem disso)', () => {
    const glosses = Object.values(signsMap).map((s) => s.gloss);
    expect(new Set(glosses).size).toBe(glosses.length);
  });

  it('ids seguem a convencao letra-X, numero-N ou sinal-GLOSA', () => {
    ALL_IDS.forEach((id) => expect(id).toMatch(/^(letra-[A-ZÇ]|numero-\d+|sinal-[A-Z0-9]+(-[A-Z0-9]+)*)$/));
  });
});

describe('bundle versionado', () => {
  const lessons = course.units.flatMap((u) => u.lessons);

  it('toda licao do curso tem arquivo, e nao sobra arquivo de licao que saiu', () => {
    expect(Object.keys(BUNDLE).sort()).toEqual(lessons.map((l) => l.id).sort());
    Object.entries(FILES).forEach(([path, f]) => expect(path.endsWith(`/${f.lesson_id}.json`)).toBe(true));
  });

  it('esta em dia com tools/content/compose.mjs (rode "npm run content" se falhar)', () => {
    const fresh = composeCourse(courseRaw, signsRaw) as Record<string, BundleExercise[]>;
    for (const l of lessons) {
      expect(BUNDLE[l.id], l.id).toEqual(fresh[l.id]);
      expect(Object.values(FILES).find((f) => f.lesson_id === l.id)).toEqual(lessonFile(l.id, fresh[l.id]));
    }
  });

  it('usa so os tipos da spec-03, com lesson_id da propria licao e order sequencial', () => {
    for (const [lessonId, items] of Object.entries(BUNDLE)) {
      items.forEach((e, i) => {
        expect(SPEC_TYPES.has(e.type), `${lessonId}: ${e.type}`).toBe(true);
        expect(e.lesson_id).toBe(lessonId);
        expect(e.order).toBe(i + 1);
      });
    }
    const ids = Object.values(BUNDLE).flat().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo sinal citado no bundle existe', () => {
    for (const items of Object.values(BUNDLE)) {
      items.forEach((e) => {
        const p = e.payload as { sign_id?: string; pairs?: { sign_id: string }[]; sign_ids?: string[] };
        if (p.sign_id) expect(signsMap[p.sign_id], `${e.id}: ${p.sign_id}`).toBeDefined();
        p.pairs?.forEach((pair) => expect(signsMap[pair.sign_id], e.id).toBeDefined());
        p.sign_ids?.forEach((id) => expect(signsMap[id], `${e.id}: ${id}`).toBeDefined());
      });
    }
  });

  it('nenhuma resposta fica exposta: a descricao mostrada antes de responder esconde a glosa', () => {
    const words = (text: string) => text.toUpperCase().split(/[^\p{L}\p{N}]+/u);
    for (const items of Object.values(BUNDLE)) {
      items.forEach((e) => {
        if (e.type === 'watch_choose_word') {
          const sign = signsMap[e.payload.sign_id];
          if (sign.gloss.length < 2) return;
          expect(words(maskGloss(sign.video_caption, sign.gloss)), e.id).not.toContain(sign.gloss.toUpperCase());
        }
        if (e.type === 'word_choose_video') {
          // A descricao de cada opcao nao traz a propria glosa nem a palavra do enunciado
          // e nem a glosa de outra opcao citada nela (ex.: FILHO na descricao de FILHA)
          const options = e.payload.video_options.map((id) => signsMap[id]);
          e.payload.video_options.forEach((id) => {
            const text = maskedCaption(signsMap[id], e.payload.word, options);
            const shown = words(text);
            for (const g of [signsMap[id].gloss, e.payload.word]) {
              if (g.length >= 2 && !g.includes('-')) expect(shown, `${e.id}: ${id}`).not.toContain(g.toUpperCase());
            }
            const cited = text.split(/[^\p{L}\p{N}]+/u);
            options.forEach((o) => {
              if (o.gloss.length >= 2 && !o.gloss.includes('-')) expect(cited, `${e.id}: ${id}`).not.toContain(o.gloss);
            });
          });
        }
        if (e.type === 'match_pairs') {
          const glosses = e.payload.pairs.map((p) => p.gloss);
          e.payload.pairs.forEach((p) => {
            const shown = words(glosses.reduce((t, g) => maskGloss(t, g), signsMap[p.sign_id].video_caption));
            glosses.filter((g) => g.length >= 2 && !g.includes('-')).forEach((g) => expect(shown, e.id).not.toContain(g.toUpperCase()));
          });
        }
      });
    }
  });
});

describe('course', () => {
  const lessons = course.units.flatMap((u) => u.lessons);

  it('tem as 14 unidades do A1 em ordem', () => {
    expect(course.units.map((u) => u.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `u${i + 1}`),
    );
  });

  it('ids de licao sao unicos e estao no lessonsMap', () => {
    const ids = lessons.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(course.lessonsMap[id]).toBeDefined());
  });

  it('toda licao tem de 4 a 6 sinais, todos existentes', () => {
    lessons.forEach((l) => {
      expect(l.signIds.length, l.id).toBeGreaterThanOrEqual(4);
      expect(l.signIds.length, l.id).toBeLessThanOrEqual(6);
      l.signIds.forEach((id) => expect(signsMap[id], `${l.id}: ${id}`).toBeDefined());
    });
  });

  it('signsOrder cobre todos os sinais das licoes, sem repeticao', () => {
    expect(new Set(course.signsOrder).size).toBe(course.signsOrder.length);
    const order = new Set(course.signsOrder);
    lessons.forEach((l) => l.signIds.forEach((id) => expect(order.has(id), id).toBe(true)));
  });

  it('nenhuma licao gera camera avaliada para sinal que a camera nao avalia', () => {
    lessons.forEach((l) =>
      resolveExercises(BUNDLE[l.id], l.signIds)
        .filter((e) => e.type === 'perform_sign')
        .forEach((e) => expect(isCameraEvaluable(signsMap[e.signId]), `${l.id}: ${e.signId}`).toBe(true)),
    );
  });

  it('nenhuma licao gera soletracao com camera para letra que a camera nao avalia', () => {
    lessons.forEach((l) =>
      resolveExercises(BUNDLE[l.id], l.signIds)
        .filter((e) => e.type === 'fingerspell' && !e.spellNumbers)
        .forEach((e) => e.letters!.forEach((letter, i) => {
          // cada letra com o seu leitor: o das paradas só lê o que avalia; a livre é letra com movimento
          const sign = signsMap[`letra-${letter}`];
          const reader = e.spellReaders![i];
          if (reader === 'letras') expect(isCameraEvaluable(sign), `${l.id}: ${letter}`).toBe(true);
          if (reader === 'letras-mov') expect(isLetterMotionEvaluable(sign), `${l.id}: ${letter}`).toBe(true);
          if (reader === 'livre') expect(sign.recognition, `${l.id}: ${letter}`).toBe('dynamic');
        })),
    );
  });

  it('toda licao tem de 7 a 12 exercicios (spec-03 secao 4), com ou sem camera avaliada', () => {
    lessons.forEach((l) => {
      // Excecao: o match_pairs dividido (mais de 4 pares) soma um exercicio por grupo extra
      const matches = BUNDLE[l.id].filter((e) => e.type === 'match_pairs').length;
      const max = MAX_EXERCISES + Math.max(0, matches - 1);
      expect(BUNDLE[l.id].length, l.id).toBeGreaterThanOrEqual(MIN_EXERCISES);
      expect(BUNDLE[l.id].length, l.id).toBeLessThanOrEqual(max);
      for (const canEvaluate of [isCameraEvaluable, () => false]) {
        const n = resolveExercises(BUNDLE[l.id], l.signIds, { canEvaluate }).length;
        expect(n, l.id).toBeGreaterThanOrEqual(MIN_EXERCISES);
        expect(n, l.id).toBeLessThanOrEqual(max);
      }
    });
    expect(MIN_EXERCISES).toBe(7);
    expect(MAX_EXERCISES).toBe(12);
  });

  it('nenhum match_pairs passa de 4 pares (mais que isso passa de duas telas no celular)', () => {
    lessons.forEach((l) =>
      BUNDLE[l.id].filter((e) => e.type === 'match_pairs').forEach((e) => {
        const n = (e.payload as { pairs: unknown[] }).pairs.length;
        expect(n, e.id).toBeGreaterThanOrEqual(2);
        expect(n, e.id).toBeLessThanOrEqual(MATCH_MAX);
      }),
    );
    // a U1 L5 (U a Z) fica com dois match_pairs de 3
    const u1l5 = BUNDLE['u1-l5'].filter((e) => e.type === 'match_pairs').map((e) => (e.payload as { pairs: unknown[] }).pairs.length);
    expect(u1l5).toEqual([3, 3]);
  });

  it('todo sinal novo e apresentado (sign_intro) antes de qualquer outro exercicio com ele', () => {
    const seen = new Set<string>();
    lessons.forEach((l) => {
      const ex = resolveExercises(BUNDLE[l.id], l.signIds);
      const intros = ex.filter((e) => e.type === 'sign_intro').map((e) => e.signId);
      for (const id of l.signIds) {
        if (seen.has(id)) {
          // revisao: ja foi apresentado em licao anterior
          expect(intros, `${l.id}: ${id}`).not.toContain(id);
          continue;
        }
        expect(intros, `${l.id}: ${id}`).toContain(id);
        // (pode aparecer antes como distrator de word_choose_video, mas nao como pergunta)
        const first = ex.findIndex((e) => e.signId === id || e.pairSignIds?.includes(id));
        expect(ex[first].type, `${l.id}: ${id}`).toBe('sign_intro');
      }
      l.signIds.forEach((id) => seen.add(id));
    });
  });

  it('segue a sequencia da spec: apresenta e reconhece, depois produz, e a frase no fim', () => {
    lessons.forEach((l) => {
      const phases = resolveExercises(BUNDLE[l.id], l.signIds).map((e) => PHASE[e.type]);
      expect(phases, l.id).toEqual([...phases].sort((a, b) => a - b));
      expect(phases.filter((p) => p === 2).length, l.id).toBeGreaterThan(0);
    });
  });

  it('todo sinal da licao tem exercicio com nota, que o leva a pratica diaria (SRS)', async () => {
    const content = { lessons: course.lessonsMap, achievementRules: [], signsOrder: course.signsOrder };
    for (const l of lessons) {
      const ex = resolveExercises(BUNDLE[l.id], l.signIds);
      const graded = gradedSigns(ex);
      expect([...graded].sort(), l.id).toEqual(expect.arrayContaining([...l.signIds].sort()));
      // Conclui a licao como o LessonScreen faria e abre a pratica do dia seguinte
      const repo = new InMemoryRepo();
      const reviewed = [...graded].map((signId) => ({ signId, result: { state: 'correct', highConfidence: true } }));
      await completeLesson(repo, content, { userId: 'u', lessonId: l.id, today: '2026-10-01', score: 1, reviewed });
      const queue = (await getDailyQueue(repo, content, { userId: 'u', today: '2026-10-02', size: 8 })) as { signId: string; kind: string }[];
      const review = queue.filter((q) => q.kind === 'review').map((q) => q.signId);
      expect(review.sort(), l.id).toEqual(expect.arrayContaining([...l.signIds].sort()));
    }
  });

  it('licoes so usam tipos de exercicio que o LessonScreen renderiza', () => {
    const rendered = new Set(['sign_intro', 'perform_sign', 'match_pairs', 'watch_choose_word', 'word_choose_video', 'mirror_practice', 'order_sequence', 'build_phrase', 'fingerspell', 'contrast_pair']);
    lessons.forEach((l) => resolveExercises(BUNDLE[l.id], l.signIds).forEach((e) => expect(rendered.has(e.type), `${l.id}: ${e.type}`).toBe(true)));
  });

  it('soletracao so na U1 (revisao) e na licao de nomes da U4, com letras que ja tiveram camera', () => {
    const spell = lessons.filter((l) => BUNDLE[l.id].some((e) => e.type === 'fingerspell'));
    // (U13: números dígito a dígito, "faça 20")
    expect(spell.map((l) => l.id)).toEqual(['u1-l2', 'u1-l3', 'u1-l4', 'u1-l5', 'u1-l6', 'u4-l4', 'u13-l2', 'u13-l3', 'u13-l4']);
    const produced = new Set<string>();
    lessons.forEach((l) => {
      BUNDLE[l.id].forEach((e) => {
        if (e.type === 'perform_sign' && ['alfabeto', 'numeros'].includes(signsMap[e.payload.sign_id].category)) produced.add(signsMap[e.payload.sign_id].gloss);
      });
      BUNDLE[l.id].forEach((e) => {
        if (e.type !== 'fingerspell') return;
        expect(e.payload.letters.join('')).toBe(e.payload.word);
        e.payload.letters.forEach((letter) => expect(produced.has(letter), `${l.id}: ${e.payload.word} ${letter}`).toBe(true));
      });
      if (!spell.includes(l)) return;
      // sem camera avaliada vira order_sequence com as letras na ordem
      resolveExercises(BUNDLE[l.id], l.signIds, { canEvaluate: () => false, displayName: null }).filter((e) => e.word).forEach((e) => {
        expect(e.type).toBe('order_sequence');
        expect(e.steps!.join('')).toBe(e.word);
      });
    });
    // com o heuristico, D, A, V, I, B e L sao avaliadas: os nomes da U4 usam a camera
    resolveExercises(BUNDLE['u4-l4'], course.lessonsMap['u4-l4'].signIds, { displayName: null })
      .filter((e) => e.word)
      .forEach((e) => expect(e.type, e.word).toBe('fingerspell'));
  });

  it('camera nas letras do alfabeto que o modelo le bem, cada uma na licao em que e ensinada', () => {
    const perform = (id: string) => BUNDLE[id].filter((e) => e.type === 'perform_sign').map((e) => signsMap[(e.payload as { sign_id: string }).sign_id].gloss);
    expect(perform('u1-l1')).toEqual(['A', 'B', 'C', 'D', 'E']);
    // J: letra com movimento, avaliada pelo modelo das letras com movimento (sem ele, prática livre)
    expect(perform('u1-l2')).toEqual(['F', 'G', 'H', 'I', 'J']);
    expect(perform('u1-l3')).toEqual(['K', 'L', 'O']);
    expect(perform('u1-l4')).toEqual(['P', 'Q', 'S']);
    expect(perform('u1-l5')).toEqual(['U', 'V', 'W', 'Y']);
    // Ç: depois do Z, com o C de revisão antes (mesma forma, o Ç treme); X e Z: a U1 L5 já tem 4 letras
    // com camera, então eles entram na revisão da U1 L6. Os três são avaliados pelo modelo das letras com
    // movimento (sem ele, prática livre)
    expect(perform('u1-l6')).toEqual(['C', 'Ç', 'X', 'Z']);
    // Fracas no teste fixo (abaixo de 80%) ficam sem camera por enquanto
    const all = course.units[0].lessons.flatMap((l) => perform(l.id));
    for (const letter of ['M', 'N', 'R', 'T']) expect(all).not.toContain(letter);
  });

  it('"soletre seu nome" fica na licao de nomes da U4, depois dos nomes fixos', () => {
    const own = Object.entries(BUNDLE).flatMap(([id, items]) =>
      items.flatMap((e) => (e.type === 'fingerspell' && e.payload.own_name ? [[id, e.payload.word]] : [])));
    expect(own).toEqual([['u4-l4', 'LIDIA']]);
    const words = BUNDLE['u4-l4'].filter((e) => e.type === 'fingerspell').map((e) => (e.payload as { word: string }).word);
    expect(words).toEqual(['DAVI', 'BIA', 'LIA', 'LIDIA']);
  });

  it('frases de exemplo e notas de cultura tem fonte', () => {
    course.units.forEach((u) => {
      (u.phrases ?? []).forEach((p) => {
        expect(p.glosses.length, u.id).toBeGreaterThan(0);
        expect(p.pt, u.id).toBeTruthy();
        expect(p.source?.url, u.id).toMatch(/^https?:\/\//);
      });
      (u.cultureNotes ?? []).forEach((n) => expect(n.source?.url, u.id).toMatch(/^https?:\/\//));
    });
  });

  it('a partir da U3 toda unidade tem de 3 a 5 frases de exemplo', () => {
    course.units.slice(2).forEach((u) => {
      expect(u.phrases?.length ?? 0, u.id).toBeGreaterThanOrEqual(3);
      expect(u.phrases?.length ?? 0, u.id).toBeLessThanOrEqual(5);
    });
  });

  it('regras de conquista usam so tipos que o dominio conhece', () => {
    const state = { streak: 0, signsLearned: 0, lessonsCompleted: 0, alphabetComplete: false };
    expect(() => evaluateAchievements(course.achievementRules, state, [])).not.toThrow();
  });

  it('Alfabeto completo (SINAIS_26) pede as 27 letras da U1, nao 26 sinais quaisquer', async () => {
    // O codigo fica (ja esta no perfil de quem ganhou); a regra e a do alfabeto completo, que o
    // useSession marca ao concluir a ultima licao da U1 (as licoes abrem em ordem)
    expect(course.achievementRules.find((r) => r.code === 'SINAIS_26')).toEqual({ code: 'SINAIS_26', type: 'alphabet_complete' });
    const u1 = course.units[0].lessons;
    const letters = new Set(u1.flatMap((l) => l.signIds).filter((id) => id.startsWith('letra-')));
    expect(letters.size).toBe(27);
    expect([...letters].sort()).toEqual([...LETTER_IDS].sort());

    const content = { lessons: course.lessonsMap, achievementRules: course.achievementRules, signsOrder: course.signsOrder };
    const repo = new InMemoryRepo();
    await repo.seedProfile({ userId: 'u', signsLearned: 26 });
    const done = (lessonId: string, signsLearnedDelta: number, alphabetComplete: boolean) =>
      completeLesson(repo, content, { userId: 'u', lessonId, today: '2026-10-25', score: 1, reviewed: [], signsLearnedDelta, alphabetComplete }) as
        Promise<{ achievementsEarned: string[] }>;
    const u2 = course.units[1].lessons[0];
    expect((await done(u2.id, u2.signIds.length, false)).achievementsEarned).not.toContain('SINAIS_26');
    expect((await done(u1[u1.length - 1].id, 0, true)).achievementsEarned).toContain('SINAIS_26');
  });
});

describe('textos do conteudo', () => {
  it('nao usam travessao nem meia-risca', () => {
    const text = JSON.stringify({ signs: Object.values(signsMap), units: course.units });
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('maskGloss', () => {
  it('esconde a glosa na descricao, inclusive glosa composta e com acento', () => {
    expect(maskGloss('como se descascasse uma banana.', 'BANANA')).toBe('como se descascasse uma ___.');
    expect(maskGloss('na hora do café da manhã', 'CAFÉ-DA-MANHÃ')).toBe('na hora do ___');
    expect(maskGloss('Mão em punho', 'MÃO')).toBe('___ em punho');
  });

  it('nao mexe em pedacos de palavra nem em letras isoladas', () => {
    expect(maskGloss('simples e assim', 'SIM')).toBe('simples e assim');
    expect(maskGloss('a mão fica parada', 'A')).toBe('a mão fica parada');
  });
});

describe('maskChoiceCaption (pistas nas descricoes dos exercicios de escolha)', () => {
  const PAI = 'Segure o queixo com o polegar e o indicador e deslize para baixo (HOMEM); depois encoste o dorso da mão fechada nos lábios, palma para baixo.';

  it('esconde a glosa certa e as glosas das outras opcoes citadas na descricao', () => {
    expect(maskChoiceCaption(PAI, 'PAI', ['PAI', 'HOMEM', 'MÃE', 'FILHO'])).toBe(
      'Segure o queixo com o polegar e o indicador e deslize para baixo (___); depois encoste o dorso da mão fechada nos lábios, palma para baixo.',
    );
    expect(maskChoiceCaption('Sinal composto: CAFÉ (círculo) e depois MANHÃ.', 'CAFÉ-DA-MANHÃ', ['CAFÉ', 'CAFÉ-DA-MANHÃ']))
      .toBe('Sinal composto: ___ (círculo) e depois MANHÃ.');
    expect(maskChoiceCaption('Faça COMER e depois MEIO-DIA.', 'ALMOÇO', ['ALMOÇO', 'MEIO-DIA', 'COMER']))
      .toBe('Faça ___ e depois ___.');
  });

  it('glosa que nao e opcao continua visivel', () => {
    expect(maskChoiceCaption(PAI, 'PAI', ['PAI', 'MÃE', 'TIO', 'FILHO'])).toBe(PAI);
  });

  it('outra opcao escrita como palavra comum nao e escondida (so a citacao do sinal em maiusculas)', () => {
    expect(maskChoiceCaption('Mão em casa, como quem pega algo.', 'ESCOLA', ['ESCOLA', 'CASA', 'COMO', 'QUEM']))
      .toBe('Mão em casa, como quem pega algo.');
  });

  it('nenhuma descricao do curso mostra a glosa de outra opcao citada nela', () => {
    const glosses = [...new Set(Object.values(signsMap).map((s) => s.gloss))].filter((g) => g.length >= 2);
    const words = (text: string) => text.split(/[^\p{L}\p{N}-]+/u);
    for (const sign of Object.values(signsMap)) {
      const cited = glosses.filter((g) => g !== sign.gloss && words(sign.video_caption).includes(g));
      if (cited.length === 0) continue;
      const shown = words(maskChoiceCaption(sign.video_caption, sign.gloss, [sign.gloss, ...cited]));
      cited.forEach((g) => expect(shown, `${sign.id}: ${g}`).not.toContain(g));
    }
  });
});

describe('build_phrase (montar a frase)', () => {
  const src = { name: 'teste', url: 'https://exemplo.org' };
  const phrase = (glosses: string[], pt = 'frase'): Phrase => ({ glosses, pt, source: src });

  it('normaliza glosas: soletrada, pontuacao e hifen viram a mesma forma', () => {
    expect(normalizeGloss('O-I')).toBe('OI');
    expect(normalizeGloss('B-E-M?')).toBe('BEM');
    expect(normalizeGloss('bom-dia')).toBe('BOMDIA');
  });

  it('conta glosa com @ como vista pela forma masculina ou feminina', () => {
    expect(knownGlossCount(phrase(['OBRIGAD@', 'VOCÊ']), new Set(['OBRIGADO']))).toBe(1);
    expect(knownGlossCount(phrase(['SURD@']), new Set(['SURDA']))).toBe(1);
  });

  it('prefere a frase com mais glosas ja vistas', () => {
    const phrases = [phrase(['CASA', 'LONGE']), phrase(['OI', 'TUDO', 'BEM']), phrase(['TCHAU', 'AMANHA'])];
    expect(pickPhrase(phrases, new Set(['OI', 'BEM']))).toBe(1);
  });

  it('no empate, evita repetir a frase de outra licao da unidade', () => {
    const phrases = [phrase(['OI', 'TUDO']), phrase(['TCHAU', 'AMANHA'])];
    expect(pickPhrase(phrases, new Set(), new Set())).toBe(0);
    expect(pickPhrase(phrases, new Set(), new Set([0]))).toBe(1);
  });

  it('varia a frase entre licoes: prefere outra frase com glosa vista a repetir a melhor', () => {
    const phrases = [phrase(['OI', 'TUDO', 'BEM']), phrase(['TCHAU', 'AMANHA', 'CINEMA', 'IR']), phrase(['CASA', 'LONGE'])];
    const seen = new Set(['OI', 'BEM', 'TCHAU']);
    expect(pickPhrase(phrases, seen)).toBe(0);
    expect(pickPhrase(phrases, seen, new Set([0]))).toBe(1);
    // frase sem nenhuma glosa vista so entra se nao houver outra
    expect(pickPhrase(phrases, seen, new Set([0, 1]))).toBe(0);
  });

  it('sem frases retorna -1', () => {
    expect(pickPhrase([], new Set())).toBe(-1);
  });

  it('candidatos a distrator vem da unidade e nunca repetem glosa da frase', () => {
    const target = phrase(['ONDE', 'MORAR', 'VOCÊ?']);
    const unit = [target, phrase(['NOME', 'ME@']), phrase(['VOCÊ', 'MORAR', 'LONGE'])];
    // VOCÊ = VOCÊ? e MORAR ja estao na frase
    expect(phraseDistractors(target, unit)).toEqual(['NOME', 'ME@', 'LONGE']);
  });

  it('monta os blocos com a frase inteira e 2 distratores sorteados em frase curta', () => {
    const target = phrase(['ONDE', 'MORAR', 'VOCÊ?']);
    for (let i = 0; i < 20; i++) {
      const tiles = phraseTiles(target.glosses, ['NOME', 'ME@', 'LONGE']);
      expect(tiles).toHaveLength(5);
      expect(tiles).toEqual(expect.arrayContaining(target.glosses));
      const extras = tiles.filter((t) => !target.glosses.includes(t));
      extras.forEach((d) => expect(['NOME', 'ME@', 'LONGE']).toContain(d));
      expect(new Set(extras).size).toBe(2);
      // nunca comeca ja na ordem certa
      expect(tiles.slice(0, 3)).not.toEqual(target.glosses);
    }
  });

  it('frase longa ganha 1 distrator so', () => {
    const tiles = phraseTiles(['EU', 'NASCER', '18', 'SETEMBRO', '1965'], ['ONDE', 'MORAR']);
    expect(tiles).toHaveLength(6);
  });

  it('o curso tem 1 build_phrase por licao a partir da U3, e nenhum antes', () => {
    course.units.forEach((u, i) => {
      u.lessons.forEach((l) => {
        const exercises = resolveExercises(BUNDLE[l.id], l.signIds);
        const phrases = exercises.filter((e) => e.type === 'build_phrase');
        if (i >= PHRASE_FIRST_UNIT_INDEX && u.phrases?.length) {
          expect(phrases, l.id).toHaveLength(1);
          // a frase vem da propria unidade e e o ultimo exercicio da licao
          expect(u.phrases).toContainEqual(phrases[0].phrase);
          expect(exercises[exercises.length - 1].type, l.id).toBe('build_phrase');
          expect(phrases[0].tiles!.length, l.id).toBeGreaterThan(phrases[0].phrase!.glosses.length);
        } else {
          expect(phrases, l.id).toHaveLength(0);
        }
      });
    });
  });

  it('a frase escolhida tem glosa ja vista ate a licao e nao repete na unidade enquanto houver opcao', () => {
    const seen = new Set<string>();
    course.units.forEach((u, i) => {
      const used = new Set<Phrase>();
      u.lessons.forEach((l) => {
        l.signIds.forEach((id) => seen.add(normalizeGloss(signsMap[id]?.gloss ?? '')));
        const ex = BUNDLE[l.id].find((e) => e.type === 'build_phrase');
        if (!ex || ex.type !== 'build_phrase' || i < PHRASE_FIRST_UNIT_INDEX) return;
        const chosen = u.phrases!.find((p) => p.pt === ex.payload.pt)!;
        const ratio = (p: Phrase) => knownGlossCount(p, seen) / p.glosses.length;
        const fresh = u.phrases!.filter((p) => !used.has(p) && knownGlossCount(p, seen) > 0);
        if (fresh.length) {
          expect(fresh, l.id).toContain(chosen);
          expect(ratio(chosen), l.id).toBe(Math.max(...fresh.map(ratio)));
        }
        used.add(chosen);
      });
    });
  });
});
