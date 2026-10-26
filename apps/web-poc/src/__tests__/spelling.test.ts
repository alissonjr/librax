import { describe, it, expect, afterEach } from 'vitest';
import { course, resolveExercises, signsMap, spellReadersFor, type BundleExercise, type Sign } from '../lib/content';
import {
  composeCourse, composeLessonExercises, spelledNumberProblem, spelledWordProblem, FREE_SPELL_MAX, OWN_FORM_NUMBERS,
  MAX_EXERCISES,
} from '../../../../tools/content/compose.mjs';
import {
  ChallengeClock, SPELL_CHALLENGE_SIZE, SPELL_CHALLENGE_WORDS, availableChallengeWords, formatChallengeTime,
  pickChallengeWords, readBestTime, recordChallengeTime,
} from '../lib/spellChallenge';
import courseRaw from '../assets/content/course.json';
import signsRaw from '../assets/content/signs.json';

const FILES = import.meta.glob<{ lesson_id: string; exercises: BundleExercise[] }>(
  '../assets/content/lessons/*.json',
  { eager: true, import: 'default' },
);
const BUNDLE: Record<string, BundleExercise[]> = Object.fromEntries(
  Object.values(FILES).map((f) => [f.lesson_id, f.exercises]),
);

const lesson = (id: string, signIds: string[], extra = {}) => ({ id, title: id, order: 1, xpReward: 10, signIds, ...extra });
const letters = (s: string) => [...s].map((l) => `letra-${l}`);

/** Letras com perform_sign em todo o alfabeto (U1), como o gerador as conta. */
function producedInU1(): Set<string> {
  const out = new Set<string>();
  for (const l of course.units[0].lessons) {
    for (const e of BUNDLE[l.id]) {
      if (e.type === 'perform_sign') out.add(signsMap[e.payload.sign_id].gloss);
    }
  }
  return out;
}

describe('regra do gerador para palavras soletradas (spelledWordProblem)', () => {
  const taughtAll = new Set(Object.keys(signsMap));

  it('letra com movimento com câmera (J, Ç, H, K, X no perform_sign) entra na palavra', () => {
    const produced = new Set(['J', 'O', 'I', 'A', 'C', 'Ç', 'H', 'K', 'X', 'E', 'L']);
    for (const w of ['JOIA', 'CAÇA', 'HOJE', 'XALE']) {
      expect(spelledWordProblem(w, { produced, taught: taughtAll, signsMap }), w).toBeNull();
    }
  });

  it('Z (com movimento, sem câmera) só como prática livre: já ensinado e no máximo um por palavra', () => {
    const produced = new Set(['A', 'U', 'L', 'E']);
    expect(FREE_SPELL_MAX).toBe(1);
    expect(spelledWordProblem('AZUL', { produced, taught: taughtAll, signsMap })).toBeNull();
    expect(spelledWordProblem('ZAZA', { produced, taught: taughtAll, signsMap })).toMatch(/2 letras sem câmera/);
    // ainda não ensinado: não entra
    expect(spelledWordProblem('AZUL', { produced, taught: new Set(letters('AUL')), signsMap })).toMatch(/sem exercício de câmera até aqui \(Z\)/);
  });

  it('letra parada sem perform_sign (M, N, R, T) continua barrada', () => {
    expect(spelledWordProblem('CAMA', { produced: new Set(['C', 'A']), taught: taughtAll, signsMap })).toMatch(/\(M\)/);
  });

  it('o curso inteiro: J e Ç com câmera passam, Z livre passa e dois Z falham', () => {
    const fake = (spellWords: string[]) => ({
      ...courseRaw,
      units: [{ id: 'u1', title: 'x', description: 'x', lessons: [
        lesson('a', letters('JOIA'), { produce: letters('JOIA') }),
        lesson('a2', letters('ÇCZ'), { produce: letters('ÇC') }),
        lesson('b', letters('JOIA'), { spellWords }),
      ] }],
    });
    expect(() => composeCourse(fake(['JOIA', 'AÇO']), signsRaw)).not.toThrow();
    expect(() => composeCourse(fake(['ZOCA']), signsRaw)).not.toThrow();
    expect(() => composeCourse(fake(['ZIZA']), signsRaw)).toThrow(/Lição b: a palavra ZIZA tem 2 letras sem câmera/);
  });
});

describe('número dígito a dígito no gerador (spellNumbers)', () => {
  const produced = new Set(['0', '1', '2', '3', '6', '7', '8', '9']);

  it('aceita os números da U13 feitos com os dígitos em sequência', () => {
    for (const n of ['10', '12', '20', '30', '60', '80', '90']) {
      expect(spelledNumberProblem(n, { produced, signsMap }), n).toBeNull();
    }
  });

  it('recusa os de forma própria (11, 40, 50, 100), os fora do curso e dígito sem câmera', () => {
    expect([...OWN_FORM_NUMBERS].sort()).toEqual(['100', '11', '40', '50']);
    for (const n of OWN_FORM_NUMBERS) expect(spelledNumberProblem(n, { produced, signsMap }), n).toMatch(/forma própria/);
    expect(spelledNumberProblem('25', { produced, signsMap })).toMatch(/não é um número do curso/);
    expect(spelledNumberProblem('7', { produced, signsMap })).toMatch(/não é um número do curso/);
    expect(spelledNumberProblem('14', { produced, signsMap })).toMatch(/dígito sem exercício de câmera até aqui \(4\)/);
  });

  it('vira fingerspell com numbers depois dos perform_sign, sem tirar a produção da lição', () => {
    const out = composeLessonExercises(
      { id: 'x', signIds: ['numero-16', 'numero-17', 'numero-18', 'numero-19', 'numero-20'], spellNumbers: ['20'] }, signsMap,
    ) as { type: string; payload: Record<string, unknown> }[];
    expect(out.filter((e) => e.type === 'perform_sign')).toHaveLength(2);
    expect(out.find((e) => e.type === 'fingerspell')?.payload).toEqual({ word: '20', letters: ['2', '0'], per_letter_confidence: null, numbers: true });
    expect(out.length).toBeLessThanOrEqual(MAX_EXERCISES);
  });

  it('o bundle tem "faça 20", "faça 30" e "faça 80" na U13, uma por lição, no limite de 12', () => {
    const found = Object.entries(BUNDLE).flatMap(([id, items]) =>
      items.flatMap((e) => (e.type === 'fingerspell' && e.payload.numbers ? [[id, e.payload.word]] : [])));
    expect(found).toEqual([['u13-l2', '20'], ['u13-l3', '30'], ['u13-l4', '80']]);
    for (const [id] of found) expect(BUNDLE[id].length, id).toBeLessThanOrEqual(MAX_EXERCISES);
  });
});

describe('leitor de cada letra no app (spellReadersFor e resolveExercises)', () => {
  const still = (s: Sign | undefined) => !!s && s.category === 'alfabeto' && s.recognition === 'static';
  const motion = (s: Sign | undefined) => ['H', 'J', 'K', 'X', 'Ç'].includes(s?.gloss ?? '');

  it('letras com movimento vão para o modelo delas, as paradas para o classificador e o Z fica livre', () => {
    expect(spellReadersFor([...'HOJE'], false, { canEvaluate: still, canEvaluateLetterMotion: motion }))
      .toEqual(['letras-mov', 'letras', 'letras-mov', 'letras']);
    expect(spellReadersFor([...'AZUL'], false, { canEvaluate: still, canEvaluateLetterMotion: motion }))
      .toEqual(['letras', 'livre', 'letras', 'letras']);
    // sem o modelo das letras com movimento, J e Ç ficam livres; H e K voltam para o das paradas
    expect(spellReadersFor([...'CAJU'], false, { canEvaluate: still, canEvaluateLetterMotion: () => false }))
      .toEqual(['letras', 'letras', 'livre', 'letras']);
    expect(spellReadersFor([...'KIWI'], false, { canEvaluate: still, canEvaluateLetterMotion: () => false }))
      .toEqual(['letras', 'letras', 'letras', 'letras']);
  });

  it('letra parada sem câmera, ou nenhuma letra avaliada, não serve (vira order_sequence)', () => {
    expect(spellReadersFor([...'CAMA'], false, { canEvaluate: (s) => s?.gloss !== 'M', canEvaluateLetterMotion: () => false })).toBeNull();
    expect(spellReadersFor(['Z'], false, { canEvaluate: () => false, canEvaluateLetterMotion: () => false })).toBeNull();
  });

  it('números: modelo dos números nos dígitos de camera_numbers, livre nos outros', () => {
    const cam = (s: Sign | undefined) => ['0', '2', '3', '8', '9'].includes(s?.gloss ?? '');
    expect(spellReadersFor(['2', '0'], true, { canEvaluateNumber: cam })).toEqual(['numeros', 'numeros']);
    expect(spellReadersFor(['6', '0'], true, { canEvaluateNumber: cam })).toEqual(['livre', 'numeros']);
    expect(spellReadersFor(['6', '7'], true, { canEvaluateNumber: cam })).toBeNull();
    const [ex] = resolveExercises(BUNDLE['u13-l2'].filter((e) => e.type === 'fingerspell'), ['numero-20'], { canEvaluateNumber: cam });
    expect(ex).toMatchObject({ type: 'fingerspell', word: '20', letters: ['2', '0'], spellNumbers: true, signId: 'numero-2', spellReaders: ['numeros', 'numeros'] });
    // sem o modelo dos números: order_sequence com os dígitos
    const [off] = resolveExercises(BUNDLE['u13-l2'].filter((e) => e.type === 'fingerspell'), ['numero-20'], { canEvaluateNumber: () => false });
    expect(off).toMatchObject({ type: 'order_sequence', word: '20', steps: ['2', '0'], spellNumbers: true });
  });

  describe('"soletre seu nome" (U4 L4) com J, Z ou Ç', () => {
    const items = BUNDLE['u4-l4'];
    const ids = course.lessonsMap['u4-l4'].signIds;
    afterEach(() => localStorage.clear());

    it('o nome com Ç ou J fica com o nome (não cai mais na reserva LIDIA)', () => {
      for (const [name, word, readers] of [
        ['Graça', 'GRAÇA', ['letras', 'letras', 'letras', 'letras-mov', 'letras']],
        ['Júlia Souza', 'JULIA', ['letras-mov', 'letras', 'letras', 'letras', 'letras']],
        ['Zé', 'ZE', ['livre', 'letras']],
      ] as const) {
        const ex = resolveExercises(items, ids, { canEvaluate: still, canEvaluateLetterMotion: motion, displayName: name });
        const own = ex.find((e) => e.ownName);
        expect(own, name).toMatchObject({ type: 'fingerspell', word, spellReaders: readers });
      }
    });
  });
});

describe('desafio de soletrar (lib/spellChallenge.ts)', () => {
  afterEach(() => localStorage.clear());

  it('toda palavra do desafio passa na regra do gerador com as letras com câmera ao fim da U1', () => {
    const produced = producedInU1();
    const taught = new Set(course.units[0].lessons.flatMap((l) => l.signIds));
    for (const w of SPELL_CHALLENGE_WORDS) {
      expect(spelledWordProblem(w, { produced, taught, signsMap }), w).toBeNull();
    }
    expect(new Set(SPELL_CHALLENGE_WORDS).size).toBe(SPELL_CHALLENGE_WORDS.length);
  });

  it('só oferece palavras com letras já vistas; sorteia 3 diferentes', () => {
    expect(availableChallengeWords(new Set([...'ABCDE']))).toEqual([]);
    const some = availableChallengeWords(new Set([...'CASBOLP']));
    expect(some).toEqual(['CASA', 'BOLO', 'SAPO']);
    const all = availableChallengeWords(new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZÇ']));
    expect(all).toEqual([...SPELL_CHALLENGE_WORDS]);
    let seed = 0.3;
    const picked = pickChallengeWords(all, SPELL_CHALLENGE_SIZE, () => (seed = (seed * 7.1) % 1));
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it('o relógio soma só os trechos em andamento (para entre a palavra feita e o Continuar)', () => {
    const clock = new ChallengeClock();
    clock.start(1000);
    expect(clock.elapsed(4000)).toBe(3000);
    clock.pause(4000);
    expect(clock.running).toBe(false);
    expect(clock.elapsed(60000)).toBe(3000);
    clock.start(60000);
    clock.start(61000); // já correndo: não reinicia
    clock.pause(62000);
    expect(clock.elapsed(99999)).toBe(5000);
  });

  it('formata m:ss e guarda o melhor tempo no aparelho', () => {
    expect(formatChallengeTime(0)).toBe('0:00');
    expect(formatChallengeTime(42_900)).toBe('0:42');
    expect(formatChallengeTime(65_000)).toBe('1:05');
    expect(readBestTime()).toBeNull();
    expect(recordChallengeTime(30_000)).toBe(true);
    expect(readBestTime()).toBe(30_000);
    expect(recordChallengeTime(31_000)).toBe(false);
    expect(readBestTime()).toBe(30_000);
    expect(recordChallengeTime(25_000)).toBe(true);
    expect(readBestTime()).toBe(25_000);
  });
});
