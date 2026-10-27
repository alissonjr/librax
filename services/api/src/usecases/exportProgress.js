/**
 * GET /v1/users/me/progress: o progresso da conta para o app gravar no aparelho.
 *
 * Quem entra numa conta (no comeco do app ou num aparelho novo) recebe o que o servidor ja tem:
 * licoes concluidas e puladas pelo teste de nivelamento, revisoes (SRS), XP por dia, conquistas e o
 * resumo do perfil. O servidor continua mandando no progresso da conta; o app so copia.
 *
 * A meta diaria fica de fora: ela so existe no aparelho (o servidor guarda sempre a padrao).
 *
 * @param {object} repo
 * @param {{userId: string, name?: string|null}} input `name` do token, quando o perfil nao tem nome
 */
export async function exportProgress(repo, { userId, name = null }) {
  const [profile, lessons, srs, days, achievements] = await Promise.all([
    repo.getProfile(userId),
    repo.listProgress(userId),
    repo.listSrsItems(userId),
    repo.listDayXp(userId),
    repo.listEarnedAchievements(userId),
  ]);
  return {
    profile: {
      displayName: cleanName(profile?.displayName) ?? cleanName(name),
      xpTotal: profile?.xpTotal ?? 0,
      streak: profile?.streak ?? 0,
      lastActiveDay: profile?.lastActiveDay ?? null,
      freezes: profile?.freezes ?? 0,
      signsLearned: profile?.signsLearned ?? 0,
      lessonsCompleted: profile?.lessonsCompleted ?? 0,
      alphabetComplete: profile?.alphabetComplete ?? false,
    },
    lessons: lessons.map(toLesson).filter(Boolean),
    srs: srs.map(({ userId: _u, ...item }) => item),
    days,
    achievements,
  };
}

/** Concluida ou pulada pelo teste; o resto (licao so comecada) nao conta para o mapa. */
function toLesson(p) {
  if (p.status === 'completed') {
    return { lessonId: p.lessonId, status: 'completed', bestScore: p.bestScore ?? null, completedAt: p.completedAt ?? null };
  }
  if (p.status === 'placement') {
    return { lessonId: p.lessonId, status: 'placement', completedAt: p.skippedAt ?? null };
  }
  return null;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 30);
  return trimmed || null;
}
