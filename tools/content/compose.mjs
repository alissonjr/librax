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
//   - a ordem das demonstrações de word_choose_video;
//   - quais distratores de build_phrase entram (1 ou 2) e a ordem dos blocos;
//   - se perform_sign é avaliado pela câmera ou vira prática livre, e se fingerspell usa a câmera
//     ou vira order_sequence (depende do reconhecedor do aparelho, que muda sem precisar gerar o
//     bundle de novo).

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
 * Tamanho da sessão (spec-03 seção 4): de 7 a 12 exercícios por lição. A única exceção é o
 * match_pairs dividido (splitMatchGroups): cada grupo além do primeiro soma um exercício.
 */
export const MIN_EXERCISES = 7;
export const MAX_EXERCISES = 12;
/** Quantos sinais a pessoa produz com a câmera numa lição sem soletração nem `produce`. */
export const PRODUCE_COUNT = 2;
/** Tamanho do match_pairs que junta o reconhecimento de vários sinais quando a lição não cabe. */
export const MATCH_MIN = 3;
export const MATCH_MAX = 4;
/**
 * Quantos sinais podem ir para o agrupamento na lição que lista a produção (`produce`): as do
 * alfabeto, com câmera em cada letra que o modelo lê bem, só cabem em 12 juntando 5 ou 6 letras.
 * Mais de MATCH_MAX viram dois match_pairs (splitMatchGroups).
 */
export const MATCH_MAX_PRODUCE = 6;

/**
 * Divide os sinais agrupados em match_pairs de no máximo `max` pares, em grupos equilibrados (os
 * tamanhos diferem em no máximo 1, os maiores primeiro): 6 viram 3 + 3, 5 viram 3 + 2. Um
 * match_pairs com mais de 4 pares passa de duas telas no celular.
 */
export function splitMatchGroups(ids, max = MATCH_MAX) {
  if (!ids.length) return [];
  const count = Math.ceil(ids.length / max);
  const base = Math.floor(ids.length / count);
  const bigger = ids.length % count;
  const out = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < bigger ? 1 : 0);
    out.push(ids.slice(start, start + size));
    start += size;
  }
  return out;
}

/**
 * Quantos sinais vão para o match_pairs para a lição caber em MAX_EXERCISES, ou null se nem
 * juntando `max` sinais cabe. 0 = cada sinal tem o seu exercício receptivo.
 */
function groupSize(signCount, fixed, max = MATCH_MAX) {
  const budget = MAX_EXERCISES - fixed;
  if (signCount <= budget) return 0;
  const group = Math.max(MATCH_MIN, signCount - budget + 1);
  return group <= Math.min(max, signCount) ? group : null;
}

/**
 * Sinais que a pessoa produz com a câmera: os novos da lição (ou todos, se não houver novo),
 * estáticos primeiro (são os que a câmera tem mais chance de avaliar), na ordem da lição.
 */
function pickProduce(signIds, fresh, signsMap, n) {
  const pool = fresh.length ? fresh : signIds;
  const isStatic = (id) => signsMap[id]?.recognition !== 'dynamic';
  return [...pool.filter(isStatic), ...pool.filter((id) => !isStatic(id))].slice(0, n);
}

/**
 * 3 distratores do word_choose_video, nesta ordem de preferência: sinais da lição já apresentados,
 * sinais da mesma categoria vistos em lições anteriores (os mais recentes primeiro), os outros
 * sinais da lição e, por fim, qualquer sinal da mesma categoria. Nunca repete glosa.
 */
function videoDistractors(signId, presented, signIds, signsMap, seenSigns, exclude = new Set()) {
  const gloss = (id) => signsMap[id]?.gloss ?? id;
  const category = signsMap[signId]?.category;
  const sameCategory = Object.keys(signsMap).filter((id) => signsMap[id].category === category);
  const learned = [...seenSigns].reverse().filter((id) => signsMap[id]?.category === category);
  const seen = new Set([gloss(signId)]);
  const out = [];
  for (const id of [...presented, ...learned, ...signIds, ...sameCategory]) {
    if (out.length === 3) break;
    if (id === signId || exclude.has(id) || seen.has(gloss(id))) continue;
    seen.add(gloss(id));
    out.push(id);
  }
  return out;
}

/**
 * Pares de mãos parecidas da lição (`contrastPairs` em course.json), conferidos: dois sinais
 * diferentes que existem. `contexts` só nos pares da mesma mão (O e 0, S e 8): a palavra ou o
 * número em que cada sinal aparece, para a checagem perguntar pelo contexto.
 */
export function lessonContrastPairs(lesson, signsMap) {
  return (lesson.contrastPairs ?? []).map((pair) => {
    const ids = pair.signs ?? [];
    if (ids.length !== 2 || ids[0] === ids[1] || ids.some((id) => !signsMap[id])) {
      throw new Error(`Lição ${lesson.id ?? '?'}: par de mãos parecidas inválido (${ids.join(', ')}).`);
    }
    if (pair.contexts && ids.some((id) => typeof pair.contexts[id] !== 'string' || !pair.contexts[id])) {
      throw new Error(`Lição ${lesson.id ?? '?'}: o par ${ids.join(' e ')} precisa de um contexto para cada sinal.`);
    }
    return { signs: ids, contexts: pair.contexts ?? null };
  });
}

/**
 * Exercícios de uma lição, na ordem em que aparecem (sem id nem order: `numberExercises` completa).
 *
 * Regra (spec-03 seções 3 e 4), de 7 a 12 exercícios (13 ou mais só com o match_pairs dividido, item 2):
 * 1. Apresenta e reconhece: cada sinal novo ganha um sign_intro e, logo depois, um exercício
 *    receptivo próprio, alternando watch_choose_word (vê o sinal, escolhe a palavra) e
 *    word_choose_video (vê a palavra, escolhe o sinal). Sinal de revisão (já apresentado em lição
 *    anterior) não tem sign_intro, só o receptivo.
 * 2. Se a lição passar de 12, os últimos sinais (o menor grupo que faz caber, de 3 a 4, ou até 6 na
 *    lição com `produce`) dividem um match_pairs no lugar dos receptivos individuais (os sign_intro
 *    deles vêm antes do match_pairs). Grupo com mais de 4 sinais vira match_pairs equilibrados de
 *    até 4 (splitMatchGroups), cada um logo depois dos sign_intro dos seus sinais; só nesse caso a
 *    lição passa de 12 (um exercício a mais por grupo extra).
 * 3. Produz: os perform_sign de `lesson.produce`, quando a lição lista quais sinais a pessoa faz
 *    na câmera (as lições do alfabeto: cada letra que o modelo lê bem); sem a lista, 2 perform_sign
 *    (sinais novos, estáticos primeiro) ou nenhum, se a lição tem soletração. Depois, um fingerspell
 *    por palavra de `spellWords` (nomes da U4, palavras de revisão do alfabeto) e, se a lição tiver
 *    `spellOwnName`, o "soletre seu nome" (o app troca a palavra pelo nome do perfil; a de
 *    `spellOwnName` fica para quando o nome não dá). Se ainda não couber, a produção sem lista cai
 *    para 1 perform_sign.
 *    Depois, um contrast_pair por par de `contrastPairs` (revisão das mãos parecidas, como F e T ou O
 *    e 0): compara as duas mãos, checa qual é qual e faz as duas na câmera. Cada par conta como um
 *    exercício no limite de 12 e só usa sinais já ensinados (composeCourse confere).
 * 4. Da U3 em diante, a frase da lição (build_phrase) fecha a sessão.
 * Lição curta demais ganha uma rodada de watch_choose_word antes dos pares e da frase até chegar a 7.
 *
 * A revisão extensa (o mesmo sinal várias vezes) fica na prática diária: todo sinal da lição tem
 * ao menos um exercício com nota (receptivo ou match_pairs), que o põe na fila do SRS.
 *
 * `extra.producedSigns`: sinais que tiveram perform_sign em lições anteriores (composeCourse
 * preenche); a câmera do contrast_pair só pede esses.
 * `extra.seenSigns`: sinais apresentados em lições anteriores (composeCourse preenche). Quando o app
 * não avalia o sinal pela câmera, mostra o perform_sign como prática livre (resolveExercises).
 */
export function composeLessonExercises(lesson, signsMap, extra = {}) {
  const sign = (id) => signsMap[id];
  const gloss = (id) => sign(id)?.gloss ?? id;
  const seenSigns = extra.seenSigns ?? new Set();
  const signIds = lesson.signIds;
  const fresh = signIds.filter((id) => !seenSigns.has(id));
  const review = signIds.filter((id) => seenSigns.has(id));
  const spellWords = lesson.spellWords ?? [];
  const ownName = lesson.spellOwnName ?? null;
  const spellCount = spellWords.length + (ownName ? 1 : 0);
  const phraseCount = extra.phrase ? 1 : 0;
  const pairs = lessonContrastPairs(lesson, signsMap);
  const listed = lesson.produce ?? null;
  const outside = (listed ?? []).filter((id) => !signIds.includes(id));
  if (outside.length) {
    throw new Error(`Lição ${lesson.id ?? '?'}: produce cita sinais fora da lição (${outside.join(', ')}).`);
  }

  // Produção e agrupamento: a lista da lição, ou tenta 2 perform_sign; se nem com o match_pairs
  // cabe, tenta 1
  let produce = [];
  let group = null;
  const produceOptions = listed ? [listed.length] : spellCount ? [0] : [PRODUCE_COUNT, 1];
  for (const n of produceOptions) {
    group = groupSize(signIds.length, fresh.length + phraseCount + spellCount + pairs.length + n, listed ? MATCH_MAX_PRODUCE : MATCH_MAX);
    if (group !== null) {
      produce = listed ?? pickProduce(signIds, fresh, signsMap, n);
      break;
    }
  }
  if (group === null) {
    throw new Error(
      `Lição ${lesson.id ?? '?'}: ${signIds.length} sinais não cabem em ${MAX_EXERCISES} exercícios. Divida a lição.`,
    );
  }

  const out = [];
  const push = (type, payload) => out.push({ type, payload });
  const presented = [...review];
  let receptive = 0;
  // Par da mesma mão (O e 0): um não entra como distrator do outro no "Qual é o sinal de"
  const sameHand = new Map();
  for (const p of pairs) {
    if (!p.contexts) continue;
    sameHand.set(p.signs[0], p.signs[1]);
    sameHand.set(p.signs[1], p.signs[0]);
  }

  const intro = (id) => {
    if (fresh.includes(id)) push('sign_intro', { sign_id: id });
  };
  const recognize = (id) => {
    if (receptive++ % 2 === 0) {
      push('watch_choose_word', { sign_id: id, correct: gloss(id) });
    } else {
      push('word_choose_video', {
        word: gloss(id),
        video_options: [id, ...videoDistractors(id, presented, signIds, signsMap, seenSigns, new Set(sameHand.has(id) ? [sameHand.get(id)] : []))],
        correct_sign_id: id,
      });
    }
  };

  // 1 e 2. Apresenta e reconhece (novos primeiro, depois a revisão; o grupo fica no fim)
  const ordered = [...fresh, ...review];
  const single = ordered.slice(0, ordered.length - group);
  const grouped = ordered.slice(ordered.length - group);
  for (const id of single) {
    intro(id);
    recognize(id);
    if (!presented.includes(id)) presented.push(id);
  }
  for (const part of splitMatchGroups(grouped)) {
    part.forEach(intro);
    push('match_pairs', { pairs: part.map((id) => ({ sign_id: id, gloss: gloss(id) })) });
  }

  // 3. Produz
  for (const id of produce) {
    push('perform_sign', {
      sign_id: id,
      recognition: sign(id)?.recognition === 'dynamic' ? 'dynamic' : 'static',
      // null = padrão do reconhecedor até a calibração com dados reais (spec-03 5.3)
      min_confidence: null,
      max_attempts: null,
      hint_video_url: sign(id)?.video_url ?? null,
    });
  }
  // Soletração com letras que já tiveram câmera (nomes da U4, revisão do alfabeto; composeCourse
  // confere). O app usa a câmera quando avalia todas as letras da palavra; senão mostra como
  // order_sequence (resolveExercises).
  for (const word of spellWords) {
    push('fingerspell', { word, letters: word.split(''), per_letter_confidence: null });
  }
  // "Soletre seu nome": o app troca a palavra pelo nome do perfil (resolveExercises); `word` é a
  // palavra de reserva, para nome vazio, longo demais ou com letra de movimento
  if (ownName) {
    push('fingerspell', { word: ownName, letters: ownName.split(''), per_letter_confidence: null, own_name: true });
  }

  // Lição curta: completa com uma rodada de reconhecimento até o mínimo
  for (let i = 0; signIds.length && out.length + pairs.length + phraseCount < MIN_EXERCISES; i++) {
    const id = signIds[i % signIds.length];
    push('watch_choose_word', { sign_id: id, correct: gloss(id) });
  }

  // 3b. Mãos parecidas: compara, checa e faz os dois na câmera. A câmera só pede o sinal que já teve
  // perform_sign em lição anterior (`extra.producedSigns`, as letras que o modelo lê bem) e que esta
  // lição ainda não pediu
  const producedBefore = extra.producedSigns ?? new Set();
  for (const p of pairs) {
    push('contrast_pair', {
      sign_ids: p.signs,
      camera_sign_ids: p.signs.filter((id) => producedBefore.has(id) && !produce.includes(id)),
      ...(p.contexts ? { contexts: p.contexts } : {}),
    });
  }

  // 4. A frase fecha a lição
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
 *
 * Falha se uma palavra soletrada (fingerspell) usa letra que ainda não teve perform_sign até a
 * lição: a soletração só pede letras já ensinadas e que a câmera lê bem (as de `produce`).
 * Falha também com letra de movimento (recognition dynamic: J, Z e Ç), que a soletração pela
 * câmera não lê, mesmo quando ela tem perform_sign com o modelo das letras com movimento.
 */
export function composeCourse(course, signsList) {
  const signsMap = Object.fromEntries(signsList.map((s) => [s.id, s]));
  const seenGlosses = new Set();
  // Sinais já apresentados (sign_intro) em lições anteriores: na lição de revisão não se repetem
  const seenSigns = new Set();
  // Letras que já tiveram perform_sign (até a lição atual, inclusive)
  const producedLetters = new Set();
  // Sinais que já tiveram perform_sign em lições anteriores (câmera do contrast_pair)
  const producedSigns = new Set();
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
      // Par de mãos parecidas só com sinais já ensinados (em lição anterior ou nesta)
      for (const p of lessonContrastPairs(lesson, signsMap)) {
        const missing = p.signs.filter((id) => !seenSigns.has(id) && !lesson.signIds.includes(id));
        if (missing.length) {
          throw new Error(`Lição ${lesson.id}: o par ${p.signs.join(' e ')} usa sinal ainda não ensinado (${missing.join(', ')}).`);
        }
      }
      const items = composeLessonExercises(lesson, signsMap, { phrase, unitPhrases: unit.phrases, seenSigns, producedSigns });
      for (const e of items) {
        const s = e.type === 'perform_sign' ? signsMap[e.payload.sign_id] : null;
        if (s?.category === 'alfabeto') producedLetters.add(s.gloss);
        if (s) producedSigns.add(s.id);
      }
      for (const e of items) {
        if (e.type !== 'fingerspell') continue;
        const missing = e.payload.letters.filter((l) => !producedLetters.has(l));
        if (missing.length) {
          throw new Error(
            `Lição ${lesson.id}: a palavra ${e.payload.word} usa letra sem exercício de câmera até aqui (${missing.join(', ')}).`,
          );
        }
        // J e Ç têm câmera no perform_sign (modelo das letras com movimento), mas a soletração pela
        // câmera lê só a forma parada da mão: palavra com letra de movimento viraria order_sequence
        const moving = e.payload.letters.filter((l) => signsMap[`letra-${l}`]?.recognition === 'dynamic');
        if (moving.length) {
          throw new Error(
            `Lição ${lesson.id}: a palavra ${e.payload.word} usa letra com movimento (${moving.join(', ')}), que a soletração pela câmera não lê.`,
          );
        }
      }
      bundle[lesson.id] = numberExercises(lesson.id, items);
      for (const id of lesson.signIds) seenSigns.add(id);
    }
  });

  return bundle;
}

/** Conteúdo do arquivo de uma lição (o mesmo que build-lessons.mjs grava). */
export function lessonFile(lessonId, exercises) {
  return { generated_by: 'tools/content/build-lessons.mjs', lesson_id: lessonId, exercises };
}
