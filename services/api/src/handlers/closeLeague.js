/**
 * Handler Lambda acionado pelo EventBridge Scheduler no fim de cada semana
 * para fechar a liga: calcula ranking, promove/rebaixa, reseta XP do periodo.
 *
 * O Scheduler envia o leagueId no body do evento:
 * { "leagueId": "gold-2026-w26" }
 *
 * Nao usa API Gateway (nao e HTTP); o evento chega diretamente.
 */

import { closeLeague } from '../domain/leagues.js';
import { repo } from './_repo.js';

export async function handler(event) {
  const leagueId = event.leagueId ?? event?.detail?.leagueId;
  if (!leagueId) {
    console.error('[closeLeague] leagueId ausente', event);
    return;
  }

  console.log('[closeLeague] iniciando para liga', leagueId);

  // 1. Carrega todos os membros da liga e seus XPs do periodo
  const { Items: members = [] } = await repo._db.send(
    new (await import('@aws-sdk/lib-dynamodb')).QueryCommand({
      TableName: process.env.LIBRAX_TABLE ?? 'librax',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `LEAGUE#${leagueId}` },
    }),
  );

  if (members.length === 0) {
    console.log('[closeLeague] liga vazia, nada a fazer');
    return;
  }

  const input = members.map((m) => ({
    userId: m.userId ?? m.SK?.replace('USER#', ''),
    xpPeriod: m.xpPeriod ?? 0,
  }));

  // 2. Aplica logica pura de ranking
  const { promoted, relegated, stayed } = closeLeague(input);
  console.log('[closeLeague] promoted:', promoted.length, 'relegated:', relegated.length, 'stayed:', stayed.length);

  // 3. Persistencia: aqui ficaria o reset de XP e a atualizacao de liga por usuario.
  //    Implementar quando a estrutura de "proxima liga" for definida (pos-MVP).
  //    Por ora: loga e retorna o resultado para auditoria.

  return { leagueId, promoted, relegated, stayed, processedAt: new Date().toISOString() };
}
