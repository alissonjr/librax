/**
 * Adaptador DynamoDB (producao) que implementa a mesma porta do InMemoryRepo.
 *
 * Tabela single-table `librax` (SPEC 02 secao 3 / SPEC 04 secao 1):
 *   PK + SK primarios; GSI1 (SRS por dueAt); GSI2 (liga do usuario);
 *   GSI3 (squads do usuario); GSI4 (squads publicas); GSI5 (indice de convite);
 *   GSI6 (lembretes por balde de fuso). TTL no atributo `expiresAt`.
 *
 * Requer permissoes IAM para as acoes usadas abaixo na tabela `librax`.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { offsetBucket } from '../domain/reminders.js';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.LIBRAX_TABLE ?? 'librax';

/** Tentativas de licao ficam ~400 dias (TTL): a fila offline nunca reenvia algo tao antigo. */
const ATTEMPT_TTL_SECONDS = 400 * 24 * 60 * 60;

const isConditionFailure = (e) => e?.name === 'ConditionalCheckFailedException';

/** Cria um client configurado para producao (regiao via env AWS_REGION). */
export function makeDynamoClient(options = {}) {
  const raw = new DynamoDBClient(options);
  return DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export class DynamoRepo {
  /** @param {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} client */
  constructor(client) {
    this._db = client;
  }

  // -----------------------------------------------------------------------
  // PERFIL
  // -----------------------------------------------------------------------

  async getProfile(userId) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: 'PROFILE' } }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  async saveProfile(profile) {
    const { userId } = profile;
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: `USER#${userId}`, SK: 'PROFILE', ...profile },
      }),
    );
  }

  // -----------------------------------------------------------------------
  // PROGRESSO DE LICAO
  // -----------------------------------------------------------------------

  async getProgress(userId, lessonId) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `PROG#${lessonId}` },
      }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  async saveProgress(userId, lessonId, progress) {
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: `USER#${userId}`, SK: `PROG#${lessonId}`, ...progress },
      }),
    );
  }

  // -----------------------------------------------------------------------
  // SRS (SM-2)
  // GSI1: PK = USER#<userId>, GSI1SK = DUE#<dueAt>
  // -----------------------------------------------------------------------

  async getSrsItem(userId, signId) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `SRS#${signId}` },
      }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  async saveSrsItem(userId, signId, item) {
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: `SRS#${signId}`,
          GSI1PK: `USER#${userId}`,
          GSI1SK: `DUE#${item.dueAt}`,
          ...item,
        },
      }),
    );
  }

  /** Lista todos os itens SRS do usuario (sem filtrar por dueAt). */
  async listSrsItems(userId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'SRS#' },
      }),
    );
    return Items.map((i) => ({ signId: i.SK.slice(4), ...this._stripKeys(i) }));
  }

  // -----------------------------------------------------------------------
  // XP / LOG DO DIA
  // -----------------------------------------------------------------------

  async getDayXp(userId, day) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `DAY#${day}` },
      }),
    );
    return Item?.xp ?? 0;
  }

  async addDayXp(userId, day, xp) {
    await this._db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `DAY#${day}` },
        UpdateExpression: 'ADD xp :delta SET userId = if_not_exists(userId, :uid), #day = if_not_exists(#day, :day)',
        ExpressionAttributeNames: { '#day': 'day' },
        ExpressionAttributeValues: { ':delta': xp, ':uid': userId, ':day': day },
      }),
    );
  }

  async hasDayLog(userId, day) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `DAY#${day}` },
        ProjectionExpression: 'PK',
      }),
    );
    return Item != null;
  }

  // -----------------------------------------------------------------------
  // CONQUISTAS
  // -----------------------------------------------------------------------

  async listEarnedAchievements(userId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'ACH#' },
        ProjectionExpression: 'SK',
      }),
    );
    return Items.map((i) => i.SK.slice(4));
  }

  async addAchievement(userId, code) {
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: `ACH#${code}`,
          userId,
          code,
          earnedAt: new Date().toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    ).catch((e) => {
      if (e.name !== 'ConditionalCheckFailedException') throw e;
    });
  }

  // -----------------------------------------------------------------------
  // SQUADS - META
  // -----------------------------------------------------------------------

  async getSquad(squadId) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `SQUAD#${squadId}`, SK: 'META' } }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  async putSquad(squad) {
    const { squadId, type, inviteCode } = squad;
    const item = {
      PK: `SQUAD#${squadId}`,
      SK: 'META',
      ...squad,
      ...(type === 'public' ? { GSI4PK: 'SQUADS_PUBLIC', GSI4SK: `XP#${String(squad.xpWeekly ?? 0).padStart(12, '0')}#${squadId}` } : {}),
      ...(inviteCode ? { GSI5PK: `INVITE#${inviteCode}`, GSI5SK: 'META' } : {}),
    };
    await this._db.send(new PutCommand({ TableName: TABLE, Item: item }));
  }

  async deleteSquad(squadId) {
    const squad = await this.getSquad(squadId);
    if (!squad) return;

    const members = await this.listMembers(squadId);

    const deletes = [
      { Delete: { TableName: TABLE, Key: { PK: `SQUAD#${squadId}`, SK: 'META' } } },
      ...(squad.inviteCode ? [{ Delete: { TableName: TABLE, Key: this._inviteKey(squad.inviteCode) } }] : []),
      ...members.map((m) => ({
        Delete: { TableName: TABLE, Key: { PK: `SQUAD#${squadId}`, SK: `MEMBER#${m.userId}` } },
      })),
      ...members.map((m) => ({
        Delete: { TableName: TABLE, Key: { PK: `USER#${m.userId}`, SK: `SQUAD#${squadId}` } },
      })),
    ];

    // TransactWrite aceita 100 itens no maximo; para MVP esse limite e seguro
    for (let i = 0; i < deletes.length; i += 100) {
      await this._db.send(new TransactWriteCommand({ TransactItems: deletes.slice(i, i + 100) }));
    }
  }

  // -----------------------------------------------------------------------
  // SQUADS - MEMBROS
  // -----------------------------------------------------------------------

  async getMember(squadId, userId) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `SQUAD#${squadId}`, SK: `MEMBER#${userId}` },
      }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  async putMember(squadId, userId, member) {
    await this._db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: {
                PK: `SQUAD#${squadId}`,
                SK: `MEMBER#${userId}`,
                GSI3PK: `USER#${userId}`,
                GSI3SK: `SQUAD#${squadId}`,
                userId,
                xpWeeklyContrib: 0,
                ...member,
              },
            },
          },
          {
            Put: {
              TableName: TABLE,
              Item: {
                PK: `USER#${userId}`,
                SK: `SQUAD#${squadId}`,
                squadId,
                role: member.role ?? 'member',
              },
            },
          },
        ],
      }),
    );
  }

  async removeMember(squadId, userId) {
    await this._db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: TABLE, Key: { PK: `SQUAD#${squadId}`, SK: `MEMBER#${userId}` } } },
          { Delete: { TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `SQUAD#${squadId}` } } },
        ],
      }),
    );
  }

  async listMembers(squadId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `SQUAD#${squadId}`, ':prefix': 'MEMBER#' },
      }),
    );
    return Items.map((i) => this._stripKeys(i));
  }

  async countAdmins(squadId) {
    const members = await this.listMembers(squadId);
    return members.filter((m) => m.role === 'admin').length;
  }

  async countUserB2cSquads(userId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'SQUAD#' },
      }),
    );
    // Filtra tipo B2B (org) do lado do cliente (escasso no MVP)
    const squadIds = Items.map((i) => i.SK.slice(6));
    let b2c = 0;
    for (const sid of squadIds) {
      const squad = await this.getSquad(sid);
      if (squad?.type !== 'org') b2c++;
    }
    return b2c;
  }

  // -----------------------------------------------------------------------
  // SQUADS - INDICE DE CONVITE (GSI5)
  // -----------------------------------------------------------------------

  async indexInvite(code, squadId) {
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...this._inviteKey(code), squadId },
      }),
    );
  }

  async findSquadIdByInvite(code) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: this._inviteKey(code),
      }),
    );
    return Item?.squadId ?? null;
  }

  /** Apaga o codigo antigo (regenerateInviteCode). */
  async removeInvite(code) {
    await this._db.send(new DeleteCommand({ TableName: TABLE, Key: this._inviteKey(code) }));
  }

  _inviteKey(code) {
    return { PK: `INVITE#${code.toUpperCase()}`, SK: 'META' };
  }

  // -----------------------------------------------------------------------
  // SQUADS - FAN-OUT DE XP SEMANAL
  // -----------------------------------------------------------------------

  async listUserSquads(userId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'SQUAD#' },
      }),
    );
    return Items.map((i) => ({ squadId: i.SK.slice(6), type: i.type }));
  }

  async incrementSquadXp(squadId, userId, amount) {
    await Promise.all([
      this._db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `SQUAD#${squadId}`, SK: 'META' },
          UpdateExpression: 'ADD xpWeekly :delta',
          ExpressionAttributeValues: { ':delta': amount },
        }),
      ),
      this._db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `SQUAD#${squadId}`, SK: `MEMBER#${userId}` },
          UpdateExpression: 'ADD xpWeeklyContrib :delta',
          ExpressionAttributeValues: { ':delta': amount },
        }),
      ),
    ]);
  }

  async getSquadMemberXp(squadId, userId) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `SQUAD#${squadId}`, SK: `MEMBER#${userId}` },
        ProjectionExpression: 'xpWeeklyContrib',
      }),
    );
    return Item?.xpWeeklyContrib ?? 0;
  }

  // -----------------------------------------------------------------------
  // LIGAS - FAN-OUT DE XP SEMANAL (GSI2)
  // -----------------------------------------------------------------------

  async getUserLeague(userId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        Limit: 1,
      }),
    );
    return Items.length > 0 ? { leagueId: Items[0].leagueId } : null;
  }

  async incrementLeagueXp(leagueId, userId, amount) {
    await this._db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `LEAGUE#${leagueId}`, SK: `USER#${userId}` },
        UpdateExpression: 'ADD xpPeriod :delta SET leagueId = if_not_exists(leagueId, :lid), userId = if_not_exists(userId, :uid)',
        ExpressionAttributeValues: { ':delta': amount, ':lid': leagueId, ':uid': userId },
      }),
    );
  }

  async getLeagueMemberXp(leagueId, userId) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `LEAGUE#${leagueId}`, SK: `USER#${userId}` },
        ProjectionExpression: 'xpPeriod',
      }),
    );
    return Item?.xpPeriod ?? 0;
  }

  // -----------------------------------------------------------------------
  // TENTATIVAS DE LICAO (idempotencia por lessonAttemptId)
  // USER#<id> / ATTEMPT#<lessonAttemptId>
  // -----------------------------------------------------------------------

  /** Reserva a tentativa; false se ela ja existe (reenvio). */
  async claimLessonAttempt(userId, lessonAttemptId, meta = {}) {
    try {
      await this._db.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            PK: `USER#${userId}`,
            SK: `ATTEMPT#${lessonAttemptId}`,
            ...meta,
            status: 'pending',
            claimedAt: new Date().toISOString(),
            expiresAt: Math.floor(Date.now() / 1000) + ATTEMPT_TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFailure(e)) return false;
      throw e;
    }
  }

  async getLessonAttempt(userId, lessonAttemptId) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `ATTEMPT#${lessonAttemptId}` },
        ConsistentRead: true,
      }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  async finishLessonAttempt(userId, lessonAttemptId, result) {
    await this._db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `ATTEMPT#${lessonAttemptId}` },
        UpdateExpression: 'SET #status = :done, #result = :result',
        ExpressionAttributeNames: { '#status': 'status', '#result': 'result' },
        ExpressionAttributeValues: { ':done': 'done', ':result': result },
      }),
    );
  }

  /** Libera a reserva se o completeLesson falhou (so se ainda estiver pendente). */
  async releaseLessonAttempt(userId, lessonAttemptId) {
    await this._db
      .send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { PK: `USER#${userId}`, SK: `ATTEMPT#${lessonAttemptId}` },
          ConditionExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pending': 'pending' },
        }),
      )
      .catch((e) => {
        if (!isConditionFailure(e)) throw e;
      });
  }

  // -----------------------------------------------------------------------
  // WEB PUSH - INSCRICOES
  // USER#<id> / PUSH#<hash do endpoint>
  // -----------------------------------------------------------------------

  async putPushSubscription(userId, subscriptionId, sub) {
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: `USER#${userId}`, SK: `PUSH#${subscriptionId}`, ...sub },
      }),
    );
  }

  async deletePushSubscription(userId, subscriptionId) {
    await this._db.send(
      new DeleteCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `PUSH#${subscriptionId}` } }),
    );
  }

  async listPushSubscriptions(userId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'PUSH#' },
      }),
    );
    return Items.map((i) => ({ subscriptionId: i.SK.slice(5), ...this._stripKeys(i) }));
  }

  // -----------------------------------------------------------------------
  // LEMBRETES - PREFERENCIAS + ESTADO
  // USER#<id> / NOTIF; GSI6: NOTIF#H<balde de fuso> / USER#<id> (so com lembrete ligado)
  // -----------------------------------------------------------------------

  async getNotifState(userId) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: 'NOTIF' } }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  async saveNotifState(userId, record, now = new Date()) {
    const { bucket: _old, ...rest } = record;
    const enabled = record.reminderHour != null;
    const bucket = enabled ? offsetBucket(now, record.timezone) : null;
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: 'NOTIF',
          ...rest,
          userId,
          bucket,
          ...(enabled ? { GSI6PK: `NOTIF#H${bucket}`, GSI6SK: `USER#${userId}` } : {}),
        },
      }),
    );
  }

  async listNotifCandidates(bucket) {
    const out = [];
    let ExclusiveStartKey;
    do {
      const page = await this._db.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: 'GSI6',
          KeyConditionExpression: 'GSI6PK = :pk',
          ExpressionAttributeValues: { ':pk': `NOTIF#H${bucket}` },
          ExclusiveStartKey,
        }),
      );
      out.push(...(page.Items ?? []).map((i) => this._stripKeys(i)));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  // -----------------------------------------------------------------------
  // UTIL
  // -----------------------------------------------------------------------

  /** Remove PK/SK/GSI* antes de devolver ao usecase. */
  _stripKeys(item) {
    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, GSI3PK, GSI3SK, GSI4PK, GSI4SK, GSI5PK, GSI5SK, GSI6PK, GSI6SK, ...rest } = item;
    return rest;
  }
}
