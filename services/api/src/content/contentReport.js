/**
 * Situacao do conteudo para o painel de administracao (GET /v1/admin/content): as unidades e os
 * sinais do curso, quais ja foram validados com a comunidade surda (`validated`), de onde veio a
 * referencia (`source`), se ha video gravado ou avatar e o que ainda falta em cada sinal.
 *
 * Mesma fonte do app (course.json e signs.json do web-poc). O resultado e gerado por
 * `npm run catalog` em content/contentStatus.js e empacotado so na Lambda do painel.
 *
 * O que falta em cada sinal (`missing`):
 *   validated  ainda nao validado (docs/conteudo-e-validacao.md)
 *   video      sem video gravado (`video_url`)
 *   avatar     sem demonstracao provisoria pelo avatar
 *   source     sem referencia de dicionario
 *
 * @param {object} course  course.json
 * @param {object[]} signs signs.json
 */
export function contentReportFromBundle(course, signs) {
  const byId = new Map(signs.map((s) => [s.id, s]));
  const where = new Map(); // signId -> { unitId, lessonId }: a primeira licao que ensina o sinal
  for (const unit of course.units ?? []) {
    for (const lesson of unit.lessons ?? []) {
      for (const signId of lesson.signIds ?? []) {
        if (!where.has(signId)) where.set(signId, { unitId: unit.id, lessonId: lesson.id });
      }
    }
  }

  const signRows = signs.map((s) => {
    const hasVideo = typeof s.video_url === 'string' && s.video_url.length > 0;
    const hasAvatar = Boolean(s.avatar?.provider);
    const source = s.source?.name ? { name: s.source.name, url: s.source.url ?? null } : null;
    const validated = s.validated === true;
    const missing = [
      ...(validated ? [] : ['validated']),
      ...(hasVideo ? [] : ['video']),
      ...(hasAvatar ? [] : ['avatar']),
      ...(source ? [] : ['source']),
    ];
    return {
      id: s.id,
      gloss: s.gloss ?? s.id,
      category: s.category ?? null,
      recognition: s.recognition ?? null,
      unitId: where.get(s.id)?.unitId ?? null,
      lessonId: where.get(s.id)?.lessonId ?? null,
      status: s.status ?? null,
      validated,
      hasVideo,
      hasAvatar,
      source,
      missing,
    };
  });

  const count = (rows, test) => rows.filter(test).length;
  const tally = (rows) => ({
    signs: rows.length,
    validated: count(rows, (r) => r.validated),
    withVideo: count(rows, (r) => r.hasVideo),
    withAvatar: count(rows, (r) => r.hasAvatar),
    withSource: count(rows, (r) => r.source !== null),
  });

  const units = (course.units ?? []).map((unit) => {
    const ids = new Set((unit.lessons ?? []).flatMap((l) => l.signIds ?? []));
    const rows = signRows.filter((r) => ids.has(r.id));
    return {
      id: unit.id,
      title: unit.title ?? unit.id,
      lessons: (unit.lessons ?? []).map((l) => ({ id: l.id, title: l.title ?? l.id, signCount: (l.signIds ?? []).length })),
      ...tally(rows),
    };
  });

  const unknownInLessons = [...where.keys()].filter((id) => !byId.has(id));

  return {
    courseId: course.courseId ?? null,
    title: course.title ?? null,
    totals: {
      units: units.length,
      lessons: units.reduce((acc, u) => acc + u.lessons.length, 0),
      ...tally(signRows),
      unknownInLessons,
    },
    units,
    signs: signRows,
  };
}

/** Nomes legiveis para os rankings da tela de operacao (licao, unidade e glosa do sinal). */
export function labelsFromReport(report) {
  const lessons = {};
  for (const unit of report.units ?? []) {
    for (const l of unit.lessons) lessons[l.id] = { title: l.title, unitId: unit.id, unitTitle: unit.title };
  }
  const signs = Object.fromEntries((report.signs ?? []).map((s) => [s.id, s.gloss]));
  // letra (alfabeto) ou sinal, para a tela de camera do painel
  const signKinds = Object.fromEntries((report.signs ?? []).map((s) => [s.id, s.category === 'alfabeto' ? 'letter' : 'sign']));
  return { lessons, signs, signKinds };
}
