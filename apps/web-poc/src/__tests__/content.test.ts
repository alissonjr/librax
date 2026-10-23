import { describe, it, expect } from 'vitest';
import {
  buildExercises, buildSpellExercises, course, getSign, isCameraEvaluable, maskGloss, signsMap,
  type Sign,
  buildPhraseExercise, knownGlossCount, normalizeGloss, pickPhrase, PHRASE_FIRST_UNIT_INDEX, type Phrase,
} from '../lib/content';
import { RECOGNIZABLE_LETTERS } from '../components/ExerciseCameraSign';
import { evaluateAchievements } from '@domain/achievements.js';

const ALL_IDS = Object.keys(signsMap);
const LETTER_IDS = ALL_IDS.filter((id) => signsMap[id].category === 'alfabeto');

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

describe('buildExercises', () => {
  // A e B estao no reconhecedor; C nao esta
  const signIds = ['letra-A', 'letra-B', 'letra-C'];
  const exercises = buildExercises(signIds, ALL_IDS);

  it('gera um intro para cada sinal', () => {
    const intros = exercises.filter((e) => e.type === 'intro');
    expect(intros).toHaveLength(signIds.length);
    expect(intros.map((e) => e.signId)).toEqual(expect.arrayContaining(signIds));
  });

  it('gera sign_camera so para as letras que o reconhecedor avalia', () => {
    const cams = exercises.filter((e) => e.type === 'sign_camera');
    expect(cams.map((e) => e.signId).sort()).toEqual(['letra-A', 'letra-B']);
  });

  it('sinal fora do reconhecedor ganha mirror_practice no lugar da camera avaliada', () => {
    const forC = exercises.filter((e) => e.signId === 'letra-C');
    expect(forC.some((e) => e.type === 'sign_camera')).toBe(false);
    expect(forC.filter((e) => e.type === 'mirror_practice')).toHaveLength(1);
    // a pratica livre vem logo depois do intro, como a camera viria
    const introIdx = exercises.findIndex((e) => e.id === 'intro-letra-C');
    expect(exercises[introIdx + 1].type).toBe('mirror_practice');
  });

  it('letra reconhecivel mantem camera avaliada e pratica livre', () => {
    const forA = exercises.filter((e) => e.signId === 'letra-A');
    expect(forA.filter((e) => e.type === 'sign_camera')).toHaveLength(1);
    expect(forA.filter((e) => e.type === 'mirror_practice')).toHaveLength(1);
  });

  it('gera watch_choose_word para cada sinal', () => {
    const watches = exercises.filter((e) => e.type === 'watch_choose_word');
    expect(watches.map((e) => e.signId)).toEqual(signIds);
  });

  it('gera mc4 para cada sinal (round inicial + round de revisao)', () => {
    const mc4s = exercises.filter((e) => e.type === 'mc4');
    expect(mc4s).toHaveLength(signIds.length * 2);
  });

  it('gera 1 match_pairs quando ha 3 ou mais sinais', () => {
    const pairs = exercises.filter((e) => e.type === 'match_pairs');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].pairSignIds).toHaveLength(3);
  });

  it('gera 1 order_sequence quando ha 3 ou mais sinais', () => {
    expect(exercises.filter((e) => e.type === 'order_sequence')).toHaveLength(1);
  });

  it('cada mc4 tem exatamente 4 opcoes', () => {
    exercises
      .filter((e) => e.type === 'mc4')
      .forEach((e) => expect(e.choices).toHaveLength(4));
  });

  it('o sinal correto sempre esta entre as opcoes do mc4', () => {
    exercises
      .filter((e) => e.type === 'mc4')
      .forEach((e) => {
        const correctGloss = signsMap[e.signId]?.gloss;
        expect(e.choices).toContain(correctGloss);
      });
  });

  it('todas as opcoes sao glosses distintos', () => {
    exercises
      .filter((e) => e.type === 'mc4')
      .forEach((e) => {
        const unique = new Set(e.choices);
        expect(unique.size).toBe(4);
      });
  });

  it('distratores de letras sao outras letras, mesmo com o curso inteiro no pool', () => {
    const letterGlosses = new Set(LETTER_IDS.map((id) => signsMap[id].gloss));
    exercises
      .filter((e) => e.type === 'mc4' || e.type === 'watch_choose_word')
      .forEach((e) => e.choices!.forEach((c) => expect(letterGlosses.has(c)).toBe(true)));
  });

  it('cada exercicio tem id unico', () => {
    const ids = exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildExercises com sinais que a camera nao avalia', () => {
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

  it('sinal dinamico nao gera sign_camera e ganha mirror_practice', () => {
    const ex = buildExercises(['sinal-OI', 'sinal-TCHAU', 'letra-J'], ids, map);
    expect(ex.filter((e) => e.type === 'sign_camera')).toHaveLength(0);
    for (const id of ['sinal-OI', 'sinal-TCHAU', 'letra-J']) {
      expect(ex.filter((e) => e.signId === id && e.type === 'mirror_practice')).toHaveLength(1);
    }
  });

  it('numero estatico tambem fica sem camera avaliada (o reconhecedor so conhece letras)', () => {
    const ex = buildExercises(['numero-1', 'numero-2', 'numero-3'], ids, map);
    expect(ex.filter((e) => e.type === 'sign_camera')).toHaveLength(0);
    expect(ex.filter((e) => e.type === 'mirror_practice')).toHaveLength(3);
  });

  it('mantem os outros exercicios para sinais sem camera', () => {
    const ex = buildExercises(['numero-1', 'numero-2', 'numero-3'], ids, map);
    const count = (t: string) => ex.filter((e) => e.type === t).length;
    expect(count('intro')).toBe(3);
    expect(count('watch_choose_word')).toBe(3);
    expect(count('mc4')).toBe(6);
    expect(count('match_pairs')).toBe(1);
    expect(count('order_sequence')).toBe(1);
  });

  it('distratores preferem a mesma categoria', () => {
    const ex = buildExercises(['numero-1'], ids, map);
    ex.filter((e) => e.type === 'mc4').forEach((e) => {
      expect([...e.choices!].sort()).toEqual(['1', '2', '3', '4']);
    });
  });

  it('completa com outras categorias quando a categoria tem menos de 4 sinais', () => {
    const ex = buildExercises(['sinal-OI'], ids, map);
    ex.filter((e) => e.type === 'mc4').forEach((e) => {
      expect(e.choices).toHaveLength(4);
      expect(e.choices).toContain('OI');
      expect(e.choices).toContain('TCHAU');
    });
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

describe('buildSpellExercises', () => {
  it('gera uma ordenacao de letras por nome', () => {
    const ex = buildSpellExercises('u4-l4', ['DAVI', 'BIA']);
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({ type: 'order_sequence', word: 'DAVI', steps: ['D', 'A', 'V', 'I'], letters: ['D', 'A', 'V', 'I'] });
    expect(new Set(ex.map((e) => e.id)).size).toBe(2);
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
  it('contem 26 letras do alfabeto', () => {
    expect(LETTER_IDS).toHaveLength(26);
  });

  it('todas as letras de A a Z estao presentes', () => {
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((letter) => {
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

  it('glosas sao unicas (as opcoes de multipla escolha dependem disso)', () => {
    const glosses = Object.values(signsMap).map((s) => s.gloss);
    expect(new Set(glosses).size).toBe(glosses.length);
  });

  it('ids seguem a convencao letra-X, numero-N ou sinal-GLOSA', () => {
    ALL_IDS.forEach((id) => expect(id).toMatch(/^(letra-[A-Z]|numero-\d+|sinal-[A-Z0-9]+(-[A-Z0-9]+)*)$/));
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

  it('nenhuma licao gera sign_camera para sinal que a camera nao avalia', () => {
    lessons.forEach((l) =>
      l.exercises
        .filter((e) => e.type === 'sign_camera')
        .forEach((e) => expect(isCameraEvaluable(signsMap[e.signId]), `${l.id}: ${e.signId}`).toBe(true)),
    );
  });

  it('licoes so usam tipos de exercicio que o LessonScreen renderiza', () => {
    const rendered = new Set(['intro', 'sign_camera', 'mc4', 'match_pairs', 'watch_choose_word', 'mirror_practice', 'order_sequence', 'build_phrase']);
    lessons.forEach((l) => l.exercises.forEach((e) => expect(rendered.has(e.type), `${l.id}: ${e.type}`).toBe(true)));
  });

  it('a licao de soletrar nome da U4 usa so letras ja aprendidas', () => {
    const spell = lessons.filter((l) => l.exercises.some((e) => e.id.startsWith('spell-')));
    expect(spell.length).toBeGreaterThan(0);
    spell.forEach((l) => {
      expect(l.id.startsWith('u4-')).toBe(true);
      l.exercises.filter((e) => e.id.startsWith('spell-')).forEach((e) => {
        e.letters!.forEach((letter) => expect(signsMap[`letra-${letter}`]).toBeDefined());
      });
    });
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

  it('monta os blocos com a frase inteira e 2 distratores da unidade em frase curta', () => {
    const target = phrase(['ONDE', 'MORAR', 'VOCÊ?']);
    const unit = [target, phrase(['NOME', 'ME@']), phrase(['VOCÊ', 'MORAR', 'LONGE'])];
    for (let i = 0; i < 20; i++) {
      const ex = buildPhraseExercise('u4-l1', target, unit, 'sinal-OI');
      expect(ex).toMatchObject({ id: 'phrase-u4-l1', type: 'build_phrase', signId: 'sinal-OI', phrase: target });
      const tiles = ex.tiles!;
      expect(tiles).toHaveLength(5);
      expect(tiles).toEqual(expect.arrayContaining(target.glosses));
      const extras = tiles.filter((t) => !target.glosses.includes(t));
      // distratores vem da unidade e nunca repetem glosa da frase (VOCÊ = VOCÊ?, MORAR)
      extras.forEach((d) => expect(['NOME', 'ME@', 'LONGE']).toContain(d));
      expect(new Set(extras).size).toBe(2);
      // nunca comeca ja na ordem certa
      expect(tiles.slice(0, 3)).not.toEqual(target.glosses);
    }
  });

  it('frase longa ganha 1 distrator so', () => {
    const target = phrase(['EU', 'NASCER', '18', 'SETEMBRO', '1965']);
    const ex = buildPhraseExercise('u4-l2', target, [target, phrase(['ONDE', 'MORAR'])], 'x');
    expect(ex.tiles).toHaveLength(6);
  });

  it('o curso tem 1 build_phrase por licao a partir da U3, e nenhum antes', () => {
    course.units.forEach((u, i) => {
      u.lessons.forEach((l) => {
        const phrases = l.exercises.filter((e) => e.type === 'build_phrase');
        if (i >= PHRASE_FIRST_UNIT_INDEX && u.phrases?.length) {
          expect(phrases, l.id).toHaveLength(1);
          // a frase vem da propria unidade e e o ultimo exercicio da licao
          expect(u.phrases).toContainEqual(phrases[0].phrase);
          expect(l.exercises[l.exercises.length - 1].type, l.id).toBe('build_phrase');
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
        const ex = l.exercises.find((e) => e.type === 'build_phrase');
        if (!ex || i < PHRASE_FIRST_UNIT_INDEX) return;
        const chosen = u.phrases!.find((p) => p.pt === ex.phrase!.pt)!;
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
