// Composição das lições do Librax (JS puro, sem dependências).
//
// Monta, para cada lição de course.json, a lista de exercícios no schema da spec-03 seção 3:
//   { id, lesson_id, type, order, payload }
// Quem grava os arquivos é tools/content/build-lessons.mjs; os testes do web-poc importam
// estas funções para conferir as garantias da composição.
//
// O que fica no bundle é a composição da lição (quais exercícios, em que ordem, com quais
// sinais). O que continua sorteado no app, a cada lição aberta (apps/web-poc/src/lib/content.ts):
//   - distratores de watch_choose_word (quando o payload não traz `options`) e a ordem das opções;
//   - quais distratores de build_phrase entram (1 ou 2) e a ordem dos blocos;
//   - se perform_sign é avaliado pela câmera ou vira prática livre (depende do reconhecedor do
//     aparelho, que muda sem precisar gerar o bundle de novo).

/** Primeira unidade (índice 0) com exercício de montar a frase: U3. */
export const PHRASE_FIRST_UNIT_INDEX = 2;

/** Normaliza a glosa para comparar: caixa alta, sem pontuação, hífen nem espaço (O-I = OI, B-E-M? = BEM). */
export function normalizeGloss(gloss) {
  return gloss.toUpperCase().replace(/[^\p{L}\p{N}@]/gu, '');
}

/** Formas que contam como glosa já vista: OBRIGAD@ casa com OBRIGADO e OBRIGADA. */
function glossForms(gloss) {
  const g = normalizeGloss(gloss);
  return g.includes('@') ? [g, g.replace(/@/g, 'O'), g.replace(/@/g, 'A')] : [g];
}

/** Quantas glosas da frase já foram vistas (`seen` guarda glosas normalizadas). */
export function knownGlossCount(phrase, seen) {
  return phrase.glosses.filter((g) => glossForms(g).some((f) => seen.has(f))).length;
}

/**
 * Escolhe a frase da lição entre as da unidade, nesta ordem de preferência:
 * 1. frases com alguma glosa já vista até a lição;
 * 2. frases que ainda não saíram em outra lição da unidade (`used`, índices), para variar;
 * 3. a maior parte das glosas já vista; no empate, a ordem do conteúdo.
 * Retorna o índice, ou -1 se não houver frase.
 */
export function pickPhrase(phrases, seen, used = new Set()) {
  let best = -1;
  let bestKey = [];
  phrases.forEach((p, i) => {
    if (p.glosses.length < 2) return;
    const known = knownGlossCount(p, seen);
    const key = [known > 0 ? 1 : 0, used.has(i) ? 0 : 1, known / p.glosses.length];
    // Compara critério a critério: o primeiro que diferir decide
    const diff = key.findIndex((v, k) => v !== bestKey[k]);
    if (best < 0 || (diff >= 0 && key[diff] > bestKey[diff])) {
      best = i;
      bestKey = key;
    }
  });
  return best;
}

/**
 * Candidatos a distrator do build_phrase: glosas das outras frases da unidade, sem repetir
 * nenhuma glosa da própria frase (VOCÊ? conta como VOCÊ) nem entre si.
 */
export function phraseDistractors(phrase, unitPhrases) {
  const seen = new Set(phrase.glosses.map(normalizeGloss));
  const out = [];
  for (const p of unitPhrases) {
    for (const g of p.glosses) {
      const n = normalizeGloss(g);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(g);
    }
  }
  return out;
}

/**
 * Exercícios de uma lição, na ordem em que aparecem (sem id nem order: `numberExercises` completa).
 *
 * Por sinal: apresenta (sign_intro) -> produz (perform_sign) -> reconhece (watch_choose_word) ->
 * prática livre (mirror_practice) -> reconhece de novo (watch_choose_word). Depois: match_pairs
 * com os 3 primeiros sinais, uma rodada de revisão (watch_choose_word por sinal) e
 * order_sequence com até 4 sinais (as duas últimas só com 3 sinais ou mais). Na U4 entram as
 * soletrações de nome (order_sequence com `word`) e, da U3 em diante, uma frase por lição.
 *
 * Quando o reconhecedor do aparelho não avalia o sinal, o app mostra o perform_sign como
 * prática livre e pula a prática livre repetida do mesmo sinal (ver resolveExercises no app).
 */
export function composeLessonExercises(lesson, signsMap, extra = {}) {
  const sign = (id) => signsMap[id];
  const gloss = (id) => sign(id)?.gloss ?? id;
  const out = [];
  const push = (type, payload) => out.push({ type, payload });

  for (const signId of lesson.signIds) {
    push('sign_intro', { sign_id: signId });
    push('perform_sign', {
      sign_id: signId,
      recognition: sign(signId)?.recognition === 'dynamic' ? 'dynamic' : 'static',
      // null = padrão do reconhecedor até a calibração com dados reais (spec-03 5.3)
      min_confidence: null,
      max_attempts: null,
      hint_video_url: sign(signId)?.video_url ?? null,
    });
    push('watch_choose_word', { sign_id: signId, correct: gloss(signId) });
    push('mirror_practice', { sign_id: signId });
    push('watch_choose_word', { sign_id: signId, correct: gloss(signId) });
  }

  if (lesson.signIds.length >= 3) {
    push('match_pairs', {
      pairs: lesson.signIds.slice(0, 3).map((id) => ({ sign_id: id, gloss: gloss(id) })),
    });
  }

  for (const signId of lesson.signIds) {
    push('watch_choose_word', { sign_id: signId, correct: gloss(signId) });
  }

  if (lesson.signIds.length >= 3) {
    const steps = lesson.signIds.slice(0, 4).map(gloss);
    push('order_sequence', { steps, correct_order: steps.map((_, i) => i) });
  }

  // Soletração de nomes com letras já aprendidas (U4). Enquanto o app não renderiza o tipo
  // fingerspell, a soletração entra como order_sequence: a pessoa põe as letras do nome na ordem.
  for (const word of lesson.spellWords ?? []) {
    const letters = word.split('');
    push('order_sequence', { steps: letters, correct_order: letters.map((_, i) => i), word });
  }

  if (extra.phrase) {
    push('build_phrase', {
      pt: extra.phrase.pt,
      glosses: extra.phrase.glosses,
      distractors: phraseDistractors(extra.phrase, extra.unitPhrases ?? []),
      source: extra.phrase.source,
    });
  }

  return out;
}

/** Completa id, lesson_id e order (1, 2, 3...) no schema da spec-03 seção 3. */
export function numberExercises(lessonId, items) {
  return items.map((ex, i) => ({
    id: `${lessonId}-ex${String(i + 1).padStart(2, '0')}`,
    lesson_id: lessonId,
    type: ex.type,
    order: i + 1,
    payload: ex.payload,
  }));
}

/**
 * Bundle do curso inteiro: { [lessonId]: exercícios }. Percorre as lições na ordem do curso
 * para saber quais glosas já foram vistas (a frase de cada lição depende disso).
 */
export function composeCourse(course, signsList) {
  const signsMap = Object.fromEntries(signsList.map((s) => [s.id, s]));
  const seenGlosses = new Set();
  const bundle = {};

  course.units.forEach((unit, unitIdx) => {
    const usedPhrases = new Set();
    for (const lesson of unit.lessons) {
      for (const id of lesson.signIds) seenGlosses.add(normalizeGloss(signsMap[id]?.gloss ?? ''));
      let phrase = null;
      if (unitIdx >= PHRASE_FIRST_UNIT_INDEX && unit.phrases?.length) {
        const pick = pickPhrase(unit.phrases, seenGlosses, usedPhrases);
        if (pick >= 0) {
          usedPhrases.add(pick);
          phrase = unit.phrases[pick];
        }
      }
      const items = composeLessonExercises(lesson, signsMap, { phrase, unitPhrases: unit.phrases });
      bundle[lesson.id] = numberExercises(lesson.id, items);
    }
  });

  return bundle;
}

/** Conteúdo do arquivo de uma lição (o mesmo que build-lessons.mjs grava). */
export function lessonFile(lessonId, exercises) {
  return { generated_by: 'tools/content/build-lessons.mjs', lesson_id: lessonId, exercises };
}
