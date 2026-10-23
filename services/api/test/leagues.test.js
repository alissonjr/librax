import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rankLeague, closeLeague } from '../src/domain/leagues.js';

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
