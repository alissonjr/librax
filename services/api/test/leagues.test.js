import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import {
  rankLeague,
  closeLeague,
  leagueResults,
  zoneOptsForTier,
  periodStartOf,
  periodKey,
  leagueIdOf,
  TIERS,
  PROMOTE,
  RELEGATE,
  LEAGUE_SIZE,
  MIN_MEMBERS_TO_MOVE,
} from '../src/domain/leagues.js';

// SPEC 02 secao 5.5 / frontend 12.7: ranking por xpPeriod desc; top 3 promovem,
// bottom 10 rebaixam, ~30 por liga.

function makeMembers(n) {
  // userId u01..uNN, xpPeriod decrescente e distinto
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${String(i + 1).padStart(2, '0')}`,
    xpPeriod: (n - i) * 10,
  }));
}

test('ranqueia por xpPeriod desc e atribui zonas (liga de 30)', () => {
  const ranked = rankLeague(makeMembers(30));
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].zone, 'promotion');
  assert.equal(ranked[2].zone, 'promotion'); // top 3
  assert.equal(ranked[3].zone, 'stay');
  assert.equal(ranked[19].zone, 'stay'); // rank 20 (30 - 10)
  assert.equal(ranked[20].zone, 'relegation'); // rank 21 entra na zona de rebaixamento
  assert.equal(ranked[29].zone, 'relegation');
});

test('desempate estavel por userId asc', () => {
  const ranked = rankLeague([
    { userId: 'ub', xpPeriod: 100 },
    { userId: 'ua', xpPeriod: 100 },
    { userId: 'uc', xpPeriod: 50 },
  ]);
  assert.equal(ranked[0].userId, 'ua');
  assert.equal(ranked[1].userId, 'ub');
  assert.equal(ranked[2].userId, 'uc');
});

test('liga pequena nao sobrepoe promocao e rebaixamento', () => {
  // n=5, promove 3, rebaixaria 10 -> rebaixa apenas os 2 que sobram, ninguem fica em duas zonas
  const ranked = rankLeague(makeMembers(5));
  const zones = ranked.map((m) => m.zone);
  assert.deepEqual(zones, ['promotion', 'promotion', 'promotion', 'relegation', 'relegation']);
});

test('closeLeague classifica os userIds em promoted/relegated/stayed', () => {
  const result = closeLeague(makeMembers(30));
  assert.equal(result.promoted.length, 3);
  assert.equal(result.relegated.length, 10);
  assert.equal(result.stayed.length, 17);
  assert.equal(result.promoted[0], 'u01'); // maior xp
  assert.equal(result.relegated.at(-1), 'u30'); // menor xp
});

// --- ligas, semana e resultado por membro (mesmas regras do app: apps/web-poc/src/lib/leagueLocal.ts) ---

const utc = (iso) => Date.parse(iso);

test('ligas em ordem, de Bronze a Diamante', () => {
  assert.deepEqual(TIERS, ['bronze', 'prata', 'ouro', 'safira', 'rubi', 'ametista', 'diamante']);
  assert.equal(PROMOTE, 3);
  assert.equal(RELEGATE, 10);
});

test('Bronze nao rebaixa e Diamante nao promove', () => {
  assert.deepEqual(zoneOptsForTier('bronze'), { promote: 3, relegate: 0 });
  assert.deepEqual(zoneOptsForTier('ouro'), { promote: 3, relegate: 10 });
  assert.deepEqual(zoneOptsForTier('diamante'), { promote: 0, relegate: 10 });
  assert.throws(() => zoneOptsForTier('gold'), /liga desconhecida/);
  // Pouca gente: ninguem sobe nem desce
  assert.deepEqual(zoneOptsForTier('ouro', 9), { promote: 0, relegate: 0 });
  assert.deepEqual(zoneOptsForTier('ouro', 10), { promote: 3, relegate: 10 });
});

test('semana comeca segunda 00:00 UTC', () => {
  assert.equal(periodStartOf(utc('2026-10-23T12:00:00Z')), utc('2026-10-19T00:00:00Z')); // sexta
  assert.equal(periodStartOf(utc('2026-10-19T00:00:00Z')), utc('2026-10-19T00:00:00Z')); // segunda 00:00
  assert.equal(periodStartOf(utc('2026-10-25T23:59:59Z')), utc('2026-10-19T00:00:00Z')); // domingo
});

test('leagueId no formato do app (tier-ano-wSS), com grupo opcional', () => {
  const w43 = utc('2026-10-19T00:00:00Z');
  assert.equal(periodKey(w43), '2026-w43');
  assert.equal(leagueIdOf('bronze', w43), 'bronze-2026-w43');
  assert.equal(leagueIdOf('ouro', w43, 2), 'ouro-2026-w43-g2');
  // semana ISO na virada do ano: 2026 tem 53 semanas
  assert.equal(periodKey(utc('2026-12-28T00:00:00Z')), '2026-w53');
  assert.equal(periodKey(utc('2027-01-04T00:00:00Z')), '2027-w01');
});

test('leagueResults usa rankLeague/closeLeague com as zonas da liga', () => {
  const results = leagueResults(makeMembers(30), 'ouro');
  const byUser = Object.fromEntries(results.map((r) => [r.userId, r]));
  assert.deepEqual(byUser.u01, {
    userId: 'u01', xp: 300, rank: 1, total: 30, outcome: 'promoted', fromTier: 'ouro', toTier: 'safira',
  });
  assert.equal(byUser.u15.outcome, 'stayed');
  assert.equal(byUser.u15.toTier, 'ouro');
  assert.equal(byUser.u30.outcome, 'relegated');
  assert.equal(byUser.u30.toTier, 'prata');
  assert.deepEqual(
    results.filter((r) => r.outcome === 'promoted').map((r) => r.userId),
    closeLeague(makeMembers(30), zoneOptsForTier('ouro')).promoted,
  );
});

test('leagueResults: liga com menos de 10 pessoas fecha sem ninguem mudar de liga', () => {
  const results = leagueResults(makeMembers(9), 'prata');
  assert.equal(results.length, 9);
  assert.ok(results.every((r) => r.outcome === 'stayed' && r.toTier === 'prata'));
  assert.equal(results[0].rank, 1);
  assert.equal(leagueResults(makeMembers(10), 'prata').filter((r) => r.outcome === 'promoted').length, 3);
});

test('leagueResults: na Bronze ninguem desce e na Diamante ninguem sobe', () => {
  const bronze = leagueResults(makeMembers(30), 'bronze');
  assert.equal(bronze.filter((r) => r.outcome === 'relegated').length, 0);
  assert.equal(bronze.find((r) => r.userId === 'u30').toTier, 'bronze');
  const diamante = leagueResults(makeMembers(30), 'diamante');
  assert.equal(diamante.filter((r) => r.outcome === 'promoted').length, 0);
  assert.equal(diamante.find((r) => r.userId === 'u01').toTier, 'diamante');
});

test('coerencia com o app: mesmas ligas e o mesmo tamanho de liga que apps/web-poc/src/lib/league.ts', () => {
  const src = readFileSync(new URL('../../../apps/web-poc/src/lib/league.ts', import.meta.url), 'utf8');
  const tiers = /export const TIERS = \[([^\]]*)\]/.exec(src)[1].match(/'([^']+)'/g).map((t) => t.slice(1, -1));
  assert.deepEqual(tiers, TIERS);
  assert.equal(Number(/export const LEAGUE_SIZE = (\d+)/.exec(src)[1]), LEAGUE_SIZE);
  assert.equal(Number(/export const LEAGUE_MIN_TO_MOVE = (\d+)/.exec(src)[1]), MIN_MEMBERS_TO_MOVE);
});
