/**
 * Adaptador DynamoDB (producao) que implementa a mesma porta do InMemoryRepo.
 *
 * Tabela single-table `librax` (SPEC 02 secao 3 / SPEC 04 secao 1):
 *   PK + SK primarios; GSI1 (SRS por dueAt); GSI2 (liga do usuario);
 *   GSI3 (squads do usuario); GSI4 (squads publicas); GSI5 (indice de convite).
 *
 * Requer permissoes IAM para as acoes usadas abaixo na tabela `librax`.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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
        Item: { PK: `INVITE#${code.toUpperCase()}`, SK: 'META', squadId },
      }),
    );
  }

  async findSquadIdByInvite(code) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `INVITE#${code.toUpperCase()}`, SK: 'META' },
      }),
    );
    return Item?.squadId ?? null;
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
  // UTIL
  // -----------------------------------------------------------------------

  /** Remove PK/SK/GSI* antes de devolver ao usecase. */
  _stripKeys(item) {
    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, GSI3PK, GSI3SK, GSI4PK, GSI4SK, GSI5PK, GSI5SK, ...rest } = item;
    return rest;
  }
}
