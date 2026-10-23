import { newProfile } from '../domain/profile.js';
import { applyStreak } from '../domain/streak.js';
import { reviewSigns } from './reviewSigns.js';
import { xpForLesson, isDailyGoalMet } from '../domain/xp.js';
import { evaluateAchievements } from '../domain/achievements.js';

/**
 * Orquestra a conclusao de uma licao (SPEC 02 - Definicao de pronto; SPEC 04 secao 1.4).
 * Tudo server-authoritative: o XP vem da definicao da licao, nunca do cliente.
 *
 * @param {object} repo      repositorio (porta) - ver InMemoryRepo
 * @param {object} content   bundle de conteudo: { lessons, achievementRules }
 * @param {object} input     { userId, lessonId, score, today, reviewed[], signsLearnedDelta?, alphabetComplete? }
 * @returns {Promise<object>} resumo dos efeitos
 */
export async function completeLesson(repo, content, input) {
  const { userId, lessonId, today, score = 0, reviewed = [] } = input;

  const lesson = content.lessons?.[lessonId];
  if (!lesson) throw new Error(`licao desconhecida: ${lessonId}`);

  const profile = (await repo.getProfile(userId)) ?? newProfile(userId);

  // 1. XP (da definicao da licao) ---------------------------------------
  const xpAwarded = xpForLesson(lesson);
  const dayXpBefore = await repo.getDayXp(userId, today);
  const goalMet = isDailyGoalMet(dayXpBefore, xpAwarded, profile.dailyGoalXp);
  profile.xpTotal += xpAwarded;
  await repo.addDayXp(userId, today, xpAwarded);

  // 2. Streak / ofensiva -------------------------------------------------
  const streakResult = applyStreak(profile, today);
  profile.streak = streakResult.streak;
  profile.lastActiveDay = streakResult.lastActiveDay;
  profile.freezes = streakResult.freezes;

  // 3. SRS dos sinais revisados -----------------------------------------
  const { srsUpdated } = await reviewSigns(repo, { userId, today, reviewed });

  // 4. Progresso da licao (melhor score) --------------------------------
  const prev = await repo.getProgress(userId, lessonId);
  const bestScore = Math.max(prev?.bestScore ?? 0, score);
  await repo.saveProgress(userId, lessonId, { status: 'completed', bestScore, completedAt: today });

  // 5. Contadores de progresso ------------------------------------------
  profile.lessonsCompleted = (profile.lessonsCompleted ?? 0) + 1;
  profile.signsLearned = (profile.signsLearned ?? 0) + (input.signsLearnedDelta ?? 0);
  if (input.alphabetComplete) profile.alphabetComplete = true;

  // 6. Conquistas (idempotente) -----------------------------------------
  const earned = await repo.listEarnedAchievements(userId);
  const achievementsEarned = evaluateAchievements(
    content.achievementRules ?? [],
    {
      streak: profile.streak,
      signsLearned: profile.signsLearned,
      lessonsCompleted: profile.lessonsCompleted,
      alphabetComplete: profile.alphabetComplete,
    },
    earned,
  );
  for (const code of achievementsEarned) await repo.addAchievement(userId, code);

  // 7. Fan-out de XP: squads + liga da semana ---------------------------
  const squads = await repo.listUserSquads(userId);
  for (const { squadId } of squads) await repo.incrementSquadXp(squadId, userId, xpAwarded);

  const league = await repo.getUserLeague(userId);
  if (league) await repo.incrementLeagueXp(league.leagueId, userId, xpAwarded);

  await repo.saveProfile(profile);

  return {
    xpAwarded,
    xpTotal: profile.xpTotal,
    streak: profile.streak,
    freezeConsumed: streakResult.freezeConsumed,
    goalMet,
    srsUpdated,
    achievementsEarned,
    squadsUpdated: squads.length,
  };
}
