import { newProfile } from '@domain/profile.js';
import { course } from './course';
import { getDisplayName, getSession, isOnboarded, setDisplayName } from './auth';
import { markPolicySeen } from './usageNotice';
import { fetchAccountProgress, type AccountProgress } from './sync';
import type { IdbRepo } from './idbRepo';

/**
 * Entrar numa conta traz o progresso dela para o aparelho (GET /v1/users/me/progress): quem entra no
 * começo do app ou num aparelho novo encontra o mapa, a ofensiva e as revisões de onde parou.
 *
 * Junta, nunca apaga: o que este aparelho tem de melhor fica (lição concluída, nota mais alta, dia
 * com mais XP). Com o log do convidado já enviado antes da busca, a conta normalmente tem tudo.
 * A meta diária e a liga local ficam como estão (o servidor não guarda a meta).
 */

type Rec = Record<string, unknown>;

/** Entrou sem conseguir trazer o progresso (sem rede, erro): a próxima abertura com conta tenta de novo. */
const PENDING_KEY = 'librax_accountRestorePending';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export async function applyAccountProgress(repo: IdbRepo, userId: string, data: AccountProgress): Promise<void> {
  const local = ((await repo.getProfile(userId)) as Rec | null) ?? (newProfile(userId) as Rec);
  const remote = data.profile;
  const localDay = typeof local.lastActiveDay === 'string' ? local.lastActiveDay : '';
  const remoteDay = remote.lastActiveDay ?? '';
  // Ofensiva e protetores: os do lado com o dia ativo mais recente (no empate, a ofensiva maior)
  const remoteNewer = remoteDay > localDay || (remoteDay === localDay && num(remote.streak) > num(local.streak));
  await repo.saveProfile({
    ...local,
    userId,
    xpTotal: Math.max(num(local.xpTotal), num(remote.xpTotal)),
    signsLearned: Math.max(num(local.signsLearned), num(remote.signsLearned)),
    lessonsCompleted: Math.max(num(local.lessonsCompleted), num(remote.lessonsCompleted)),
    alphabetComplete: local.alphabetComplete === true || remote.alphabetComplete === true,
    ...(remoteNewer ? { streak: num(remote.streak), lastActiveDay: remote.lastActiveDay, freezes: num(remote.freezes) } : {}),
    // saveProfile junta com as já gravadas
    achievements: data.achievements,
  });

  for (const lesson of data.lessons) {
    if (!course.lessonsMap[lesson.lessonId]) continue;
    const prev = (await repo.getProgress(userId, lesson.lessonId)) as Rec | null;
    const prevDone = prev?.status === 'completed' && prev.placement !== true;
    if (lesson.status === 'placement') {
      if (prev?.status === 'completed') continue;
      await repo.saveProgress(userId, lesson.lessonId, {
        status: 'completed', placement: true, placementSigns: [], completedAt: lesson.completedAt,
      });
      continue;
    }
    const bestScore = Math.max(num(lesson.bestScore), prevDone ? num(prev?.bestScore) : 0);
    if (prevDone && bestScore === num(prev?.bestScore)) continue;
    await repo.saveProgress(userId, lesson.lessonId, {
      status: 'completed',
      bestScore,
      completedAt: (prevDone ? prev?.completedAt : null) ?? lesson.completedAt,
    });
  }

  for (const { signId, ...item } of data.srs) {
    if (typeof signId !== 'string') continue;
    const prev = (await repo.getSrsItem(userId, signId)) as Rec | null;
    // A revisão mais adiantada vale (mais acertos seguidos; no empate, a próxima data mais longe)
    const prevAhead = prev && (num(prev.reps) > num(item.reps)
      || (num(prev.reps) === num(item.reps) && String(prev.dueAt ?? '') >= String(item.dueAt ?? '')));
    if (!prevAhead) await repo.saveSrsItem(userId, signId, item);
  }

  for (const { day, xp } of data.days) {
    const prev = await repo.getDayXp(userId, day);
    const hasLog = await repo.hasDayLog(userId, day);
    if (!hasLog || num(xp) > prev) await repo.addDayXp(userId, day, Math.max(0, num(xp) - prev));
  }
}

/**
 * Depois de entrar (e-mail e senha, Google ou "Continuar" com a conta já aberta): traz o progresso e,
 * se as boas-vindas ainda não foram feitas, termina por elas com o nome da conta (sem nome, o do aparelho ou o padrão). Quem criou a conta
 * aceitou os termos no cadastro. Sem rede, a pessoa entra assim mesmo e o mapa fica como está.
 */
export async function enterWithAccount(
  repo: IdbRepo,
  userId: string,
  fallbackName: () => string,
): Promise<boolean> {
  // Sem sessão (voltou do Google sem login, login desligado): nada a trazer e as boas-vindas seguem
  if (!(await getSession())) return false;
  const data = await restore(repo, userId);
  if (!isOnboarded()) {
    setDisplayName(data?.profile.displayName || getDisplayName() || fallbackName());
    markPolicySeen();
  }
  return data !== null;
}

/** Abertura do app com conta: termina a busca que ficou para trás ao entrar (sem rede naquela hora). */
export async function retryAccountRestore(repo: IdbRepo, userId: string): Promise<boolean> {
  if (!readPending()) return false;
  return (await restore(repo, userId)) !== null;
}

async function restore(repo: IdbRepo, userId: string): Promise<AccountProgress | null> {
  const data = await fetchAccountProgress();
  const applied = data ? await applyAccountProgress(repo, userId, data).then(() => true, () => false) : false;
  writePending(!applied);
  return applied ? data : null;
}

function readPending(): boolean {
  try { return localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; }
}

function writePending(pending: boolean) {
  try {
    if (pending) localStorage.setItem(PENDING_KEY, '1');
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* sem armazenamento: tenta só ao entrar */ }
}
