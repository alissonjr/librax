import { describe, it, expect, beforeEach } from 'vitest';
import {
  periodStartOf, isoWeek, leagueIdOf, timeLeft, simulatedMembers, syncLeague, loadLeagueView,
  markLeagueResultSeen, zoneOpts, TIERS, LEAGUE_SIZE, LEAGUE_MODE,
  type LeagueRepo, type LeagueState,
} from '../lib/leagueLocal';

const DAY = 24 * 60 * 60 * 1000;
// Quarta-feira, 21/10/2026 12:00 UTC (semana ISO 2026-W43, começa na segunda 19/10)
const WED = Date.UTC(2026, 9, 21, 12);
const MONDAY = Date.UTC(2026, 9, 19);

class MemRepo implements LeagueRepo {
  state: LeagueState | null = null;
  xp = new Map<string, number>();
  days = new Map<string, number>();
  async getLeagueState() { return this.state; }
  async saveLeagueState(s: LeagueState) { this.state = s; }
  async getLeagueMemberXp(leagueId: string, userId: string) { return this.xp.get(`${leagueId}#${userId}`) ?? 0; }
  async setLeagueMemberXp(leagueId: string, userId: string, v: number) { this.xp.set(`${leagueId}#${userId}`, v); }
  async getDayXp(_u: string, day: string) { return this.days.get(day) ?? 0; }
}

let repo: MemRepo;
beforeEach(() => {
  repo = new MemRepo();
  localStorage.clear();
});

describe('semana', () => {
  it('começa na segunda 00:00 UTC', () => {
    expect(periodStartOf(WED)).toBe(MONDAY);
    expect(periodStartOf(MONDAY)).toBe(MONDAY);
    expect(periodStartOf(MONDAY - 1)).toBe(MONDAY - 7 * DAY);
  });

  it('numera pela semana ISO e monta o leagueId', () => {
    expect(isoWeek(MONDAY)).toEqual({ year: 2026, week: 43 });
    expect(isoWeek(Date.UTC(2025, 11, 29))).toEqual({ year: 2026, week: 1 });
    expect(leagueIdOf('ouro', MONDAY)).toBe('ouro-2026-w43');
  });

  it('calcula o tempo até o fechamento', () => {
    expect(timeLeft(WED, MONDAY + 7 * DAY)).toEqual({ days: 4, hours: 12, minutes: 0 });
    expect(timeLeft(MONDAY + 8 * DAY, MONDAY + 7 * DAY)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe('membros simulados (modo local/demo)', () => {
  it('são determinísticos por liga e semana', () => {
    expect(simulatedMembers('prata', MONDAY, WED)).toEqual(simulatedMembers('prata', MONDAY, WED));
    expect(simulatedMembers('prata', MONDAY, WED)).not.toEqual(simulatedMembers('prata', MONDAY + 7 * DAY, WED + 7 * DAY));
  });

  it('completam a liga de 30 e o XP só cresce ao longo da semana', () => {
    const early = simulatedMembers('bronze', MONDAY, MONDAY + DAY);
    const late = simulatedMembers('bronze', MONDAY, MONDAY + 7 * DAY);
    expect(late).toHaveLength(LEAGUE_SIZE - 1);
    early.forEach((m, i) => expect(late[i].xpPeriod).toBeGreaterThanOrEqual(m.xpPeriod));
    expect(late.some(m => m.xpPeriod > 0)).toBe(true);
    expect(simulatedMembers('bronze', MONDAY, MONDAY).every(m => m.xpPeriod === 0)).toBe(true);
  });

  it('o modo fica explícito para a troca pela API', () => {
    expect(LEAGUE_MODE).toBe('local-demo');
  });
});

describe('zonas', () => {
  it('Bronze não rebaixa e Diamante não promove', () => {
    expect(zoneOpts('bronze')).toEqual({ promote: 3, relegate: 0 });
    expect(zoneOpts('ouro')).toEqual({ promote: 3, relegate: 10 });
    expect(zoneOpts('diamante')).toEqual({ promote: 0, relegate: 10 });
    expect(TIERS).toHaveLength(7);
  });
});

describe('syncLeague', () => {
  it('sem liga e sem inscrição devolve null (estado vazio)', async () => {
    expect(await syncLeague(repo, 'me', WED, { enroll: false })).toBeNull();
    expect(await loadLeagueView(repo, 'me', WED, 'Eu')).toBeNull();
  });

  it('quem já tem XP na semana entra na Bronze com esse XP', async () => {
    repo.days.set('2026-10-20', 30);
    const view = await loadLeagueView(repo, 'me', WED, 'Eu');
    expect(view?.tier).toBe('bronze');
    expect(view?.you.xpPeriod).toBe(30);
    expect(view?.rows).toHaveLength(30);
    expect(view?.you.name).toBe('Eu');
  });

  it('na virada de semana fecha a liga com o domínio e promove o top 3', async () => {
    repo.state = { userId: 'me', tier: 'prata', periodStart: MONDAY };
    repo.xp.set(`prata-2026-w43#me`, 99999);
    const next = await syncLeague(repo, 'me', WED + 7 * DAY, { enroll: false });
    expect(next?.tier).toBe('ouro');
    expect(next?.periodStart).toBe(MONDAY + 7 * DAY);
    expect(next?.lastResult).toMatchObject({ outcome: 'promoted', fromTier: 'prata', toTier: 'ouro', rank: 1, total: 30, xp: 99999 });
  });

  it('sem XP na semana rebaixa (bottom 10)', async () => {
    repo.state = { userId: 'me', tier: 'safira', periodStart: MONDAY };
    const next = await syncLeague(repo, 'me', WED + 7 * DAY, { enroll: false });
    expect(next?.lastResult?.outcome).toBe('relegated');
    expect(next?.tier).toBe('ouro');
  });

  it('na Bronze, sem XP, a pessoa fica (não há liga abaixo)', async () => {
    repo.state = { userId: 'me', tier: 'bronze', periodStart: MONDAY };
    const next = await syncLeague(repo, 'me', WED + 7 * DAY, { enroll: false });
    expect(next?.lastResult?.outcome).toBe('stayed');
    expect(next?.tier).toBe('bronze');
  });
});

describe('resultado pendente (leagueResultSeen)', () => {
  it('aparece uma vez e some depois de marcado como visto', async () => {
    repo.state = { userId: 'me', tier: 'prata', periodStart: MONDAY };
    repo.xp.set(`prata-2026-w43#me`, 99999);
    const view = await loadLeagueView(repo, 'me', WED + 7 * DAY, 'Eu');
    expect(view?.pendingResult?.outcome).toBe('promoted');
    markLeagueResultSeen(view!.pendingResult!.periodStart);
    const again = await loadLeagueView(repo, 'me', WED + 7 * DAY, 'Eu');
    expect(again?.pendingResult).toBeNull();
  });
});
