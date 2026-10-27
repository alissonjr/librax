import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDB } from 'idb';

// Sessão e busca do progresso mockadas; o resto do auth (nome no localStorage) é o de verdade.
const m = vi.hoisted(() => ({ getSession: vi.fn(), fetchAccountProgress: vi.fn() }));
vi.mock('../lib/auth', async (orig) => ({ ...(await orig<typeof import('../lib/auth')>()), getSession: m.getSession }));
vi.mock('../lib/sync', () => ({ fetchAccountProgress: m.fetchAccountProgress }));

import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';
import { course } from '../lib/course';
import { getDisplayName, isOnboarded, setDisplayName } from '../lib/auth';
import { applyAccountProgress, enterWithAccount, retryAccountRestore } from '../lib/accountRestore';
import type { AccountProgress } from '../lib/sync';

const [L1, L2, L3] = course.units.flatMap(u => u.lessons).map(l => l.id);
const USER = 'usr-local';
let repo: IdbRepo;

function progress(over: Partial<AccountProgress> = {}): AccountProgress {
  return {
    profile: {
      displayName: 'Ana', xpTotal: 120, streak: 4, lastActiveDay: '2026-10-26', freezes: 1,
      signsLearned: 9, lessonsCompleted: 3, alphabetComplete: false,
    },
    lessons: [
      { lessonId: L1, status: 'completed', bestScore: 0.9, completedAt: '2026-10-20' },
      { lessonId: L2, status: 'completed', bestScore: 0.8, completedAt: '2026-10-21' },
      { lessonId: L3, status: 'placement', completedAt: '2026-10-22' },
      { lessonId: 'licao-que-nao-existe', status: 'completed', bestScore: 1, completedAt: '2026-10-22' },
    ],
    srs: [{ signId: 'letra-A', ef: 2.6, reps: 3, interval: 6, dueAt: '2026-10-30' }],
    days: [{ day: '2026-10-25', xp: 40 }, { day: '2026-10-26', xp: 30 }],
    achievements: ['PRIMEIRA_LICAO'],
    ...over,
  };
}

beforeEach(async () => {
  localStorage.clear();
  m.getSession.mockReset().mockResolvedValue({ token: 't', userId: 'sub-1' });
  m.fetchAccountProgress.mockReset();
  const db = await openDB(`librax-restore-${Date.now()}-${Math.random()}`, 3, { upgrade: (d, old) => upgradeLibraxDb(d, old) });
  repo = new IdbRepo(db, USER);
});

describe('applyAccountProgress', () => {
  it('aparelho vazio: grava mapa, revisões, XP por dia, conquistas e o perfil da conta', async () => {
    await applyAccountProgress(repo, USER, progress());

    expect(await repo.getProgress(USER, L1)).toMatchObject({ status: 'completed', bestScore: 0.9 });
    expect(await repo.getProgress(USER, L3)).toMatchObject({ status: 'completed', placement: true });
    expect(await repo.getProgress(USER, 'licao-que-nao-existe')).toBeNull();
    expect(await repo.getSrsItem(USER, 'letra-A')).toMatchObject({ reps: 3, dueAt: '2026-10-30' });
    expect(await repo.getDayXp(USER, '2026-10-25')).toBe(40);
    const profile = await repo.getProfile(USER) as Record<string, unknown>;
    expect(profile).toMatchObject({ userId: USER, xpTotal: 120, streak: 4, lastActiveDay: '2026-10-26', freezes: 1, lessonsCompleted: 3 });
    expect(profile.achievements).toEqual(['PRIMEIRA_LICAO']);
  });

  it('junta sem apagar: o melhor do aparelho fica e a meta diária não muda', async () => {
    await repo.saveProfile({ userId: USER, xpTotal: 500, streak: 9, lastActiveDay: '2026-10-27', dailyGoalXp: 50, achievements: ['OUTRA'] });
    await repo.saveProgress(USER, L1, { status: 'completed', bestScore: 1, completedAt: '2026-10-19' });
    await repo.saveSrsItem(USER, 'letra-A', { ef: 2.5, reps: 5, interval: 15, dueAt: '2026-11-10' });
    await repo.addDayXp(USER, '2026-10-25', 60);

    await applyAccountProgress(repo, USER, progress());

    expect(await repo.getProgress(USER, L1)).toMatchObject({ bestScore: 1, completedAt: '2026-10-19' });
    expect(await repo.getSrsItem(USER, 'letra-A')).toMatchObject({ reps: 5 });
    expect(await repo.getDayXp(USER, '2026-10-25')).toBe(60);
    const profile = await repo.getProfile(USER) as Record<string, unknown>;
    expect(profile).toMatchObject({ xpTotal: 500, streak: 9, lastActiveDay: '2026-10-27', dailyGoalXp: 50 });
    expect(profile.achievements).toEqual(['OUTRA', 'PRIMEIRA_LICAO']);
  });

  it('nota maior na conta sobe a do aparelho; lição pulada no aparelho vira concluída de verdade', async () => {
    await repo.saveProgress(USER, L1, { status: 'completed', bestScore: 0.7, completedAt: '2026-10-19' });
    await repo.saveProgress(USER, L2, { status: 'completed', placement: true, completedAt: '2026-10-19' });
    await applyAccountProgress(repo, USER, progress());
    expect(await repo.getProgress(USER, L1)).toMatchObject({ bestScore: 0.9, completedAt: '2026-10-19' });
    const l2 = await repo.getProgress(USER, L2) as Record<string, unknown>;
    expect(l2).toMatchObject({ status: 'completed', bestScore: 0.8 });
    expect(l2.placement).toBeUndefined();
  });
});

describe('enterWithAccount', () => {
  it('nas boas-vindas: traz o progresso e termina por elas com o nome da conta', async () => {
    m.fetchAccountProgress.mockResolvedValue(progress());
    expect(isOnboarded()).toBe(false);
    expect(await enterWithAccount(repo, USER, () => 'Você')).toBe(true);
    expect(getDisplayName()).toBe('Ana');
    expect(await repo.getProgress(USER, L1)).not.toBeNull();
  });

  it('conta sem nome: o nome padrão; quem já fez as boas-vindas mantém o nome do aparelho', async () => {
    m.fetchAccountProgress.mockResolvedValue(progress({ profile: { ...progress().profile, displayName: null } }));
    await enterWithAccount(repo, USER, () => 'Você');
    expect(getDisplayName()).toBe('Você');

    setDisplayName('Bia');
    m.fetchAccountProgress.mockResolvedValue(progress());
    await enterWithAccount(repo, USER, () => 'Você');
    expect(getDisplayName()).toBe('Bia');
  });

  it('sem sessão: nada muda e as boas-vindas seguem', async () => {
    m.getSession.mockResolvedValue(null);
    expect(await enterWithAccount(repo, USER, () => 'Você')).toBe(false);
    expect(m.fetchAccountProgress).not.toHaveBeenCalled();
    expect(isOnboarded()).toBe(false);
  });

  it('sem rede ao entrar: entra assim mesmo e a próxima abertura com conta tenta de novo', async () => {
    m.fetchAccountProgress.mockResolvedValue(null);
    expect(await enterWithAccount(repo, USER, () => 'Você')).toBe(false);
    expect(isOnboarded()).toBe(true);

    m.fetchAccountProgress.mockResolvedValue(progress());
    expect(await retryAccountRestore(repo, USER)).toBe(true);
    expect(await repo.getProgress(USER, L1)).not.toBeNull();
    // deu certo: não busca mais a cada abertura
    expect(await retryAccountRestore(repo, USER)).toBe(false);
    expect(m.fetchAccountProgress).toHaveBeenCalledTimes(2);
  });
});
