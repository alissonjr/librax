import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';
import { completeLesson } from '@usecases/completeLesson.js';
import { newProfile } from '@domain/profile.js';

let repo: IdbRepo;

beforeEach(async () => {
  // Banco novo por teste para isolamento total
  const db = await openDB(`librax-test-${Date.now()}-${Math.random()}`, 1, { upgrade: upgradeLibraxDb });
  repo = new IdbRepo(db, 'user-test');
});

describe('perfil', () => {
  it('retorna null quando nao existe', async () => {
    expect(await repo.getProfile('user-test')).toBeNull();
  });

  it('salva e recupera o perfil', async () => {
    await repo.saveProfile({ userId: 'user-test', xpTotal: 50, streak: 3, achievements: [] });
    const p = await repo.getProfile('user-test') as { xpTotal: number };
    expect(p.xpTotal).toBe(50);
  });

  it('atualiza o perfil existente', async () => {
    await repo.saveProfile({ userId: 'user-test', xpTotal: 10, achievements: [] });
    await repo.saveProfile({ userId: 'user-test', xpTotal: 30, achievements: [] });
    const p = await repo.getProfile('user-test') as { xpTotal: number };
    expect(p.xpTotal).toBe(30);
  });
});

describe('progresso de licao', () => {
  it('retorna null para licao nao cursada', async () => {
    expect(await repo.getProgress('user-test', 'u1-l1')).toBeNull();
  });

  it('salva e recupera o progresso', async () => {
    await repo.saveProgress('user-test', 'u1-l1', { status: 'completed', bestScore: 0.9, completedAt: '2026-06-28' });
    const p = await repo.getProgress('user-test', 'u1-l1') as { status: string; bestScore: number };
    expect(p.status).toBe('completed');
    expect(p.bestScore).toBe(0.9);
  });
});

describe('SRS', () => {
  it('retorna null para sinal nunca revisado', async () => {
    expect(await repo.getSrsItem('user-test', 'letra-A')).toBeNull();
  });

  it('salva e recupera item SRS', async () => {
    await repo.saveSrsItem('user-test', 'letra-A', { ef: 2.5, reps: 1, interval: 1, dueAt: '2026-06-29' });
    const item = await repo.getSrsItem('user-test', 'letra-A') as { ef: number };
    expect(item.ef).toBe(2.5);
  });

  it('listSrsItems retorna somente itens do usuario', async () => {
    await repo.saveSrsItem('user-test', 'letra-A', { ef: 2.5, reps: 1, interval: 1, dueAt: '2026-06-29' });
    await repo.saveSrsItem('user-test', 'letra-B', { ef: 2.2, reps: 0, interval: 0, dueAt: null });
    const items = await repo.listSrsItems('user-test');
    expect(items).toHaveLength(2);
    expect(items.map((i: { signId: string }) => i.signId)).toEqual(expect.arrayContaining(['letra-A', 'letra-B']));
  });
});

describe('XP diario', () => {
  it('retorna 0 para dia sem registro', async () => {
    expect(await repo.getDayXp('user-test', '2026-06-28')).toBe(0);
  });

  it('acumula XP no mesmo dia', async () => {
    await repo.addDayXp('user-test', '2026-06-28', 10);
    await repo.addDayXp('user-test', '2026-06-28', 15);
    expect(await repo.getDayXp('user-test', '2026-06-28')).toBe(25);
  });

  it('hasDayLog retorna false antes de qualquer registro', async () => {
    expect(await repo.hasDayLog('user-test', '2026-06-28')).toBe(false);
  });

  it('hasDayLog retorna true apos addDayXp', async () => {
    await repo.addDayXp('user-test', '2026-06-28', 10);
    expect(await repo.hasDayLog('user-test', '2026-06-28')).toBe(true);
  });
});

describe('conquistas', () => {
  it('listEarnedAchievements retorna [] para usuario sem perfil', async () => {
    expect(await repo.listEarnedAchievements('user-test')).toEqual([]);
  });

  it('adiciona conquista ao perfil existente', async () => {
    await repo.saveProfile({ userId: 'user-test', achievements: [] });
    await repo.addAchievement('user-test', 'PRIMEIRA_LICAO');
    const list = await repo.listEarnedAchievements('user-test');
    expect(list).toContain('PRIMEIRA_LICAO');
  });

  it('nao duplica conquista ja existente', async () => {
    await repo.saveProfile({ userId: 'user-test', achievements: ['PRIMEIRA_LICAO'] });
    await repo.addAchievement('user-test', 'PRIMEIRA_LICAO');
    const list = await repo.listEarnedAchievements('user-test');
    expect(list.filter((c: string) => c === 'PRIMEIRA_LICAO')).toHaveLength(1);
  });

  // Pela porta do repositorio, conquistas sao uma colecao propria (InMemoryRepo e DynamoRepo
  // guardam em itens separados). Aqui elas vivem dentro do perfil, entao salvar uma copia do
  // perfil lida antes do addAchievement nao pode apagar as conquistas recem-gravadas.
  it('saveProfile com copia antiga do perfil nao apaga conquistas ja gravadas', async () => {
    await repo.saveProfile({ userId: 'user-test', xpTotal: 0, achievements: [] });
    const stale = await repo.getProfile('user-test') as Record<string, unknown>;
    await repo.addAchievement('user-test', 'first_lesson');
    await repo.saveProfile({ ...stale, xpTotal: 10 });
    const p = await repo.getProfile('user-test') as { xpTotal: number };
    expect(p.xpTotal).toBe(10);
    expect(await repo.listEarnedAchievements('user-test')).toEqual(['first_lesson']);
  });

  it('addAchievement grava a conquista mesmo antes de existir perfil salvo', async () => {
    await repo.addAchievement('user-test', 'first_lesson');
    await repo.saveProfile({ ...newProfile('user-test') });
    expect(await repo.listEarnedAchievements('user-test')).toEqual(['first_lesson']);
  });
});

describe('conquistas via completeLesson', () => {
  const content = {
    lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 }, 'u1-l2': { id: 'u1-l2', xpReward: 10 } },
    achievementRules: [{ code: 'first_lesson', type: 'lessons_completed', gte: 1 }],
  };
  const input = (lessonId: string) => ({ userId: 'user-test', lessonId, score: 1, today: '2026-06-28', reviewed: [] });

  it('conquista ganha numa licao nao reaparece como nova na licao seguinte', async () => {
    await repo.saveProfile({ ...newProfile('user-test'), achievements: [] });

    const r1 = await completeLesson(repo, content, input('u1-l1')) as { achievementsEarned: string[] };
    expect(r1.achievementsEarned).toEqual(['first_lesson']);

    const r2 = await completeLesson(repo, content, input('u1-l2')) as { achievementsEarned: string[] };
    expect(r2.achievementsEarned).toEqual([]);
    expect(await repo.listEarnedAchievements('user-test')).toEqual(['first_lesson']);
  });

  it('nao repete a conquista quando a primeira licao roda sem perfil salvo', async () => {
    const r1 = await completeLesson(repo, content, input('u1-l1')) as { achievementsEarned: string[] };
    expect(r1.achievementsEarned).toEqual(['first_lesson']);

    const r2 = await completeLesson(repo, content, input('u1-l2')) as { achievementsEarned: string[] };
    expect(r2.achievementsEarned).toEqual([]);
  });
});

describe('no-ops de squads', () => {
  it('listUserSquads retorna array vazio', async () => {
    expect(await repo.listUserSquads()).toEqual([]);
  });
});

describe('ligas (modo local)', () => {
  // Quarta-feira, 21/10/2026 12:00 UTC: semana que começa na segunda 19/10 (ISO 2026-W43)
  const NOW = Date.UTC(2026, 9, 21, 12);

  it('getUserLeague inscreve na Bronze da semana', async () => {
    expect(await repo.getUserLeague('user-test', NOW)).toEqual({ leagueId: 'bronze-2026-w43' });
    const state = await repo.getLeagueState('user-test');
    expect(state?.tier).toBe('bronze');
  });

  it('incrementLeagueXp acumula o XP do periodo', async () => {
    await repo.incrementLeagueXp('bronze-2026-w43', 'user-test', 10);
    await repo.incrementLeagueXp('bronze-2026-w43', 'user-test', 15);
    expect(await repo.getLeagueMemberXp('bronze-2026-w43', 'user-test')).toBe(25);
  });

  it('completeLesson faz o fan-out do XP para a liga da semana', async () => {
    const content = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } }, achievementRules: [] };
    await completeLesson(repo, content, { userId: 'user-test', lessonId: 'u1-l1', score: 1, today: '2026-10-21', reviewed: [] });
    const league = await repo.getUserLeague('user-test');
    expect(league).not.toBeNull();
    expect(await repo.getLeagueMemberXp(league!.leagueId, 'user-test')).toBe(10);
  });

  it('clearAllData apaga as ligas', async () => {
    await repo.getUserLeague('user-test', NOW);
    await repo.clearAllData();
    expect(await repo.getLeagueState('user-test')).toBeNull();
  });
});
