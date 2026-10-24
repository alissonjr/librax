/**
 * Adaptador DynamoDB (producao) que implementa a mesma porta do InMemoryRepo.
 *
 * Tabela single-table `librax` (SPEC 02 secao 3 / SPEC 04 secao 1):
 *   PK + SK primarios; GSI1 (SRS por dueAt); GSI2 (liga do usuario e ligas da semana);
 *   GSI3 (squads do usuario); GSI4 (squads publicas); GSI5 (indice de convite);
 *   GSI6 (lembretes por balde de fuso). TTL no atributo `expiresAt`.
 *   Painel de administracao: contadores em OPS / <chave> e o registro SQUADINDEX (ver
 *   domain/opsMetrics.js e docs/painel-admin.md).
 *
 * Requer permissoes IAM para as acoes usadas abaixo na tabela `librax`.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { offsetBucket } from '../domain/reminders.js';
import { freshPeriods } from '../domain/opsMetrics.js';
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

/**
 * Tentativas de licao ficam 60 dias (TTL), contados da gravacao: reenvio da fila offline acontece em
 * minutos ou dias, e a migracao do convidado grava a tentativa no momento em que migra. Prazo curto
 * mantem o armazenamento e o backup (PITR) pequenos.
 */
export const ATTEMPT_TTL_SECONDS = 60 * 24 * 60 * 60;

const isConditionFailure = (e) => e?.name === 'ConditionalCheckFailedException';

/** Particao dos contadores do painel de administracao. */
const OPS_PK = 'OPS';
/** Registro de todas as squads (lista do painel), da mais nova para a mais velha. */
const SQUAD_INDEX_PK = 'SQUADINDEX';
const squadIndexKey = (squadId, createdAt) => ({ PK: SQUAD_INDEX_PK, SK: `SQUAD#${createdAt ?? '-'}#${squadId}` });

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

  /** Progresso de todas as licoes da pessoa (resumo da conta no painel). */
  async listProgress(userId) {
    const items = await this._queryAll({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'PROG#' },
    });
    return items.map((i) => ({ lessonId: i.SK.slice(5), ...this._stripKeys(i) }));
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

  /**
   * So na criacao (condicional): depois disso nenhuma escrita regrava a squad inteira, para
   * nao apagar XP (ADD) nem memberCount somados ao mesmo tempo por outra requisicao.
   */
  async putSquad(squad) {
    const { squadId, type, inviteCode } = squad;
    const item = {
      PK: `SQUAD#${squadId}`,
      SK: 'META',
      ...squad,
      ...(type === 'public' ? this._publicIndex(squadId, squad.xpWeekly) : {}),
      ...(inviteCode ? { GSI5PK: `INVITE#${inviteCode}`, GSI5SK: 'META' } : {}),
    };
    await this._db.send(
      new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }),
    );
    // Registro para a lista do painel (sem Scan). Fica fora do META: o XP somado a cada licao
    // nao escreve nele.
    await this._db.send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...squadIndexKey(squadId, squad.createdAt), squadId, createdAt: squad.createdAt ?? null },
      }),
    );
  }

  /** Uma pagina do registro de squads, da mais nova para a mais velha. */
  async listSquadIndex({ limit = 25, cursor = null } = {}) {
    const page = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': SQUAD_INDEX_PK },
        ScanIndexForward: false,
        Limit: limit,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    );
    return {
      squads: (page.Items ?? []).map((i) => ({ squadId: i.squadId, createdAt: i.createdAt ?? null })),
      cursor: page.LastEvaluatedKey ?? null,
    };
  }

  /**
   * Edita so os campos dados (name, description, type, maxMembers, inviteCode) com SET; o XP
   * e o memberCount ficam com os ADD. Trocar `type` liga ou desliga o GSI4 (diretorio
   * publico) e trocar `inviteCode` move o GSI5. Devolve a squad depois da escrita.
   */
  async updateSquadFields(squadId, fields) {
    const names = {};
    const values = {};
    const sets = [];
    const removes = [];
    const set = (attr, value) => {
      names[`#${attr}`] = attr;
      values[`:${attr}`] = value;
      sets.push(`#${attr} = :${attr}`);
    };
    for (const [k, v] of Object.entries(fields)) set(k, v);
    if (fields.type === 'public') {
      for (const [k, v] of Object.entries(this._publicIndex(squadId, 0))) set(k, v);
    } else if (fields.type) {
      removes.push('GSI4PK', 'GSI4SK');
    }
    if (fields.inviteCode) {
      set('GSI5PK', `INVITE#${fields.inviteCode}`);
      set('GSI5SK', 'META');
    }

    const { Attributes } = await this._db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `SQUAD#${squadId}`, SK: 'META' },
        UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return Attributes ? this._stripKeys(Attributes) : null;
  }

  /**
   * Soma `delta` ao memberCount (ADD). Para entrar (delta > 0), so se `memberCount <
   * maxMembers` na hora da escrita: duas entradas concorrentes nao passam do limite.
   * @returns {Promise<boolean>} false se a squad esta cheia ou nao existe
   */
  async changeSquadMemberCount(squadId, delta) {
    try {
      await this._db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `SQUAD#${squadId}`, SK: 'META' },
          UpdateExpression: 'ADD memberCount :delta',
          ConditionExpression: delta > 0 ? 'attribute_exists(PK) AND memberCount < maxMembers' : 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':delta': delta },
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFailure(e)) return false;
      throw e;
    }
  }

  /**
   * GSI4 do diretorio publico. O SK leva o xpWeekly com zero-padding (SPEC 04 1.2), mas os ADD
   * de XP nao reescrevem o SK: a ordem por XP fica para quando o diretorio for implementado.
   */
  _publicIndex(squadId, xpWeekly = 0) {
    return { GSI4PK: 'SQUADS_PUBLIC', GSI4SK: `XP#${String(xpWeekly ?? 0).padStart(12, '0')}#${squadId}` };
  }

  async deleteSquad(squadId) {
    const squad = await this.getSquad(squadId);
    if (!squad) return;

    // tudo da particao: META, MEMBER# e o historico WEEK#
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await this._db.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `SQUAD#${squadId}` },
          ProjectionExpression: 'PK, SK, userId',
          ExclusiveStartKey,
        }),
      );
      items.push(...(page.Items ?? []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const members = items.filter((i) => i.SK.startsWith('MEMBER#'));

    const deletes = [
      { Delete: { TableName: TABLE, Key: { PK: `SQUAD#${squadId}`, SK: 'META' } } },
      ...(squad.inviteCode ? [{ Delete: { TableName: TABLE, Key: this._inviteKey(squad.inviteCode) } }] : []),
      ...items
        .filter((i) => i.SK !== 'META')
        .map((i) => ({ Delete: { TableName: TABLE, Key: { PK: `SQUAD#${squadId}`, SK: i.SK } } })),
      ...members.map((m) => ({
        Delete: { TableName: TABLE, Key: { PK: `USER#${m.userId ?? m.SK.slice(7)}`, SK: `SQUAD#${squadId}` } },
      })),
    ];

    // TransactWrite aceita 100 itens no maximo; para MVP esse limite e seguro
    for (let i = 0; i < deletes.length; i += 100) {
      await this._db.send(new TransactWriteCommand({ TransactItems: deletes.slice(i, i + 100) }));
    }
    // registro do painel por ultimo: se falhar, a lista so pula a squad que nao existe mais
    await this._db.send(new DeleteCommand({ TableName: TABLE, Key: squadIndexKey(squadId, squad.createdAt) }));
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

  /**
   * Membro novo (MEMBER# + vinculo USER#/SQUAD#). Condicional: nunca sobrescreve um membro
   * que ja existe (e a contribuicao dele).
   * @returns {Promise<boolean>} false se a pessoa ja e membro
   */
  async putMember(squadId, userId, member) {
    try {
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
                ConditionExpression: 'attribute_not_exists(PK)',
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
      return true;
    } catch (e) {
      if (e?.name === 'TransactionCanceledException' && e.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') {
        return false;
      }
      throw e;
    }
  }

  /** Troca so o papel no MEMBER# e no vinculo USER#/SQUAD# (promote, demote, transfer). */
  async setMemberRole(squadId, userId, role) {
    const setRole = (Key, extra = {}) => ({
      Update: {
        TableName: TABLE,
        Key,
        UpdateExpression: 'SET #role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': role },
        ...extra,
      },
    });
    await this._db.send(
      new TransactWriteCommand({
        TransactItems: [
          setRole({ PK: `SQUAD#${squadId}`, SK: `MEMBER#${userId}` }, { ConditionExpression: 'attribute_exists(PK)' }),
          setRole({ PK: `USER#${userId}`, SK: `SQUAD#${squadId}` }),
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

  /**
   * Soma XP na squad (META) e no membro, sempre com ADD (nunca le e regrava):
   * - `period` ('AAAA-wSS'): ADD condicional a `xpWeekPeriod = :p`. Se o item ainda e de uma
   *   semana velha, vira a semana com escrita condicional (valor anterior em lastWeekXp e
   *   lastWeekPeriod) e, no META, marca a squad como ativa na semana (`SQUAD#<id> /
   *   WEEK#<semana>`, GSI2 `SQUADS#<semana>`), que e o que o job semanal percorre;
   * - `period: null`: licao de outra semana, so xpAllTime;
   * - sem `period` (seeds e testes antigos): ADD direto no semanal.
   * Squad ou membro que nao existe mais nao vira item solto (attribute_exists).
   */
  async incrementSquadXp(squadId, userId, amount, { period } = {}) {
    await Promise.all([
      this._addWeekXp({ PK: `SQUAD#${squadId}`, SK: 'META' }, 'xpWeekly', 'xpAllTime', amount, period, squadId),
      this._addWeekXp({ PK: `SQUAD#${squadId}`, SK: `MEMBER#${userId}` }, 'xpWeeklyContrib', 'xpAllTimeContrib', amount, period),
    ]);
  }

  async _addWeekXp(Key, weekly, allTime, amount, period, markSquadId = null) {
    const update = (UpdateExpression, ConditionExpression, values = {}) =>
      new UpdateCommand({
        TableName: TABLE,
        Key,
        UpdateExpression,
        ConditionExpression,
        ExpressionAttributeValues: { ':d': amount, ...values },
      });
    const ignoreMissing = (p) =>
      p.catch((e) => {
        if (!isConditionFailure(e)) throw e;
      });

    if (period === undefined) {
      return ignoreMissing(this._db.send(update(`ADD ${weekly} :d, ${allTime} :d`, 'attribute_exists(PK)')));
    }
    if (period === null) {
      return ignoreMissing(this._db.send(update(`ADD ${allTime} :d`, 'attribute_exists(PK)')));
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this._db.send(
          update(`ADD ${weekly} :d, ${allTime} :d`, 'attribute_exists(PK) AND xpWeekPeriod = :p', { ':p': period }),
        );
        return;
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
      }

      const { Item } = await this._db.send(new GetCommand({ TableName: TABLE, Key, ConsistentRead: true }));
      if (!Item) return; // squad dissolvida ou membro saiu no meio
      if (Item.xpWeekPeriod === period) continue; // outra licao acabou de virar a semana
      if (Item.xpWeekPeriod && Item.xpWeekPeriod > period) {
        return ignoreMissing(this._db.send(update(`ADD ${allTime} :d`, 'attribute_exists(PK)')));
      }

      const prev = Item.xpWeekPeriod ?? null;
      const roll = {
        TableName: TABLE,
        Key,
        UpdateExpression: prev
          ? `SET lastWeekXp = if_not_exists(${weekly}, :zero), lastWeekPeriod = xpWeekPeriod, ` +
            `${weekly} = :d, xpWeekPeriod = :p ADD ${allTime} :d`
          : `SET ${weekly} = :d, xpWeekPeriod = :p ADD ${allTime} :d`,
        ConditionExpression: prev ? 'xpWeekPeriod = :prev' : 'attribute_exists(PK) AND attribute_not_exists(xpWeekPeriod)',
        ExpressionAttributeValues: { ':d': amount, ':p': period, ...(prev ? { ':prev': prev, ':zero': 0 } : {}) },
      };
      try {
        if (markSquadId) {
          await this._db.send(
            new TransactWriteCommand({
              TransactItems: [{ Update: roll }, { Update: this._squadWeekMarker(markSquadId, period) }],
            }),
          );
        } else {
          await this._db.send(new UpdateCommand(roll));
        }
        return;
      } catch (e) {
        if (!isConditionFailure(e) && e?.name !== 'TransactionCanceledException') throw e;
      }
    }
    throw new Error(`SQUAD_XP_CONFLICT: ${Key.PK} ${Key.SK}`);
  }

  /** Marca a squad como ativa na semana (upsert, nunca reabre uma semana fechada). */
  _squadWeekMarker(squadId, period) {
    return {
      TableName: TABLE,
      Key: { PK: `SQUAD#${squadId}`, SK: `WEEK#${period}` },
      UpdateExpression:
        'SET squadId = :sid, #period = :p, GSI2PK = :g2pk, GSI2SK = :g2sk, #status = if_not_exists(#status, :open)',
      ExpressionAttributeNames: { '#period': 'period', '#status': 'status' },
      ExpressionAttributeValues: {
        ':sid': squadId, ':p': period, ':g2pk': `SQUADS#${period}`, ':g2sk': `SQUAD#${squadId}`, ':open': 'open',
      },
    };
  }

  // -----------------------------------------------------------------------
  // SQUADS - RESET SEMANAL E HISTORICO
  // Semana: SQUAD#<id> / WEEK#<semana>; GSI2: SQUADS#<semana> / SQUAD#<id> (squads com XP na
  // semana). Escrito uma vez por squad e semana pela licao e fechado pelo job.
  // -----------------------------------------------------------------------

  /** Uma pagina das squads com XP na semana; `cursor` e o LastEvaluatedKey (null no fim). */
  async listSquadWeeks(period, { limit = 25, cursor = null } = {}) {
    const page = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `SQUADS#${period}` },
        Limit: limit,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    );
    return {
      weeks: (page.Items ?? []).map((i) => ({ squadId: i.squadId, period: i.period, status: i.status })),
      cursor: page.LastEvaluatedKey ?? null,
    };
  }

  /**
   * Vira a semana `period` no META e em cada membro que ainda esta nela: o XP vai para
   * lastWeekXp e o semanal volta a zero. Condicional a `xpWeekPeriod = :old`: quem ja virou
   * (licao na semana nova) ou ja foi virado (nova tentativa do job) fica como esta.
   */
  async rollSquadWeek(squadId, period) {
    const roll = (SK, weekly) =>
      this._db
        .send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `SQUAD#${squadId}`, SK },
            UpdateExpression: `SET lastWeekXp = ${weekly}, lastWeekPeriod = :old, ${weekly} = :zero REMOVE xpWeekPeriod`,
            ConditionExpression: 'xpWeekPeriod = :old',
            ExpressionAttributeValues: { ':old': period, ':zero': 0 },
          }),
        )
        .catch((e) => {
          if (!isConditionFailure(e)) throw e;
        });

    await roll('META', 'xpWeekly');
    for (const m of await this.listMembers(squadId)) await roll(`MEMBER#${m.userId}`, 'xpWeeklyContrib');
  }

  /** Fecha a semana com o total e o ranking, uma vez so. @returns {Promise<boolean>} */
  async saveSquadWeek(squadId, period, snapshot) {
    const names = { '#status': 'status', '#period': 'period' };
    const values = { ':closed': 'closed', ':sid': squadId, ':p': period };
    const sets = ['#status = :closed', 'squadId = :sid', '#period = :p'];
    for (const [k, v] of Object.entries(snapshot)) {
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
    try {
      await this._db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `SQUAD#${squadId}`, SK: `WEEK#${period}` },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_not_exists(#status) OR #status <> :closed',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFailure(e)) return false;
      throw e;
    }
  }

  async getSquadWeek(squadId, period) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `SQUAD#${squadId}`, SK: `WEEK#${period}` } }),
    );
    return Item ? this._stripKeys(Item) : null;
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

  /** Liga mais recente do usuario (GSI2SK = LEAGUE#<semana>, do mais novo para o mais velho). */
  async getUserLeague(userId) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'LEAGUE#' },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return Items.length > 0 ? { leagueId: Items[0].leagueId, period: Items[0].period } : null;
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
  // LIGAS - SEMANA, MEMBROS E FECHAMENTO
  // META:   LEAGUE#<id> / META;  GSI2: LEAGUES#<semana> / LEAGUE#<id> (todas as ligas da semana)
  // Membro: LEAGUE#<id> / USER#<id>; GSI2: USER#<id> / LEAGUE#<semana> (liga do usuario)
  // Estado: USER#<id> / LEAGUE (liga atual + resultado da ultima semana fechada)
  // -----------------------------------------------------------------------

  /**
   * Entra na liga (idempotente): cria o META aberto se faltar e nao zera XP ja somado.
   * Numa transacao so: membro, META com `ADD memberCount` e a vaga da semana
   * (`USER#<id> / LEAGUEWEEK#<semana>`, condicional: uma liga por pessoa e semana). Com
   * `maxMembers`, o META so aceita se `memberCount < maxMembers` (grupos de ate 30 mesmo com
   * entradas concorrentes).
   * @returns {Promise<{status: 'joined'|'already'|'full', leagueId: string}>}
   */
  async joinLeague(league, userId, { maxMembers = null, displayName = null } = {}) {
    const { leagueId, tier, period, periodStart, group } = league;
    const pk = `LEAGUE#${leagueId}`;
    const capped = maxMembers != null;
    try {
      await this._db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE,
                Key: { PK: pk, SK: `USER#${userId}` },
                UpdateExpression:
                  'SET leagueId = :lid, userId = :uid, tier = :tier, period = :period, periodStart = :ps, ' +
                  'GSI2PK = :g2pk, GSI2SK = :g2sk, xpPeriod = if_not_exists(xpPeriod, :zero)' +
                  (displayName ? ', displayName = :dn' : ''),
                ExpressionAttributeValues: {
                  ':lid': leagueId, ':uid': userId, ':tier': tier, ':period': period, ':ps': periodStart,
                  ':g2pk': `USER#${userId}`, ':g2sk': `LEAGUE#${period}`, ':zero': 0,
                  ...(displayName ? { ':dn': displayName } : {}),
                },
              },
            },
            {
              Update: {
                TableName: TABLE,
                Key: { PK: pk, SK: 'META' },
                UpdateExpression:
                  'SET leagueId = :lid, tier = :tier, period = :period, periodStart = :ps, ' +
                  'GSI2PK = :g2pk, GSI2SK = :g2sk, #status = if_not_exists(#status, :open)' +
                  (group ? ', #group = :group' : '') +
                  ' ADD memberCount :one',
                ExpressionAttributeNames: { '#status': 'status', ...(group ? { '#group': 'group' } : {}) },
                ExpressionAttributeValues: {
                  ':lid': leagueId, ':tier': tier, ':period': period, ':ps': periodStart,
                  ':g2pk': `LEAGUES#${period}`, ':g2sk': `LEAGUE#${leagueId}`, ':open': 'open', ':one': 1,
                  ...(group ? { ':group': group } : {}),
                  ...(capped ? { ':max': maxMembers } : {}),
                },
                ...(capped ? { ConditionExpression: 'attribute_not_exists(memberCount) OR memberCount < :max' } : {}),
              },
            },
            {
              Put: {
                TableName: TABLE,
                Item: { PK: `USER#${userId}`, SK: `LEAGUEWEEK#${period}`, leagueId, tier, period },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
      return { status: 'joined', leagueId };
    } catch (e) {
      const reasons = e?.name === 'TransactionCanceledException' ? e.CancellationReasons ?? [] : null;
      if (!reasons) throw e;
      if (reasons[2]?.Code === 'ConditionalCheckFailed') {
        const seat = await this.getLeaguePlacement(userId, period);
        if (seat) return { status: 'already', leagueId: seat.leagueId };
      }
      if (reasons[1]?.Code === 'ConditionalCheckFailed') return { status: 'full', leagueId };
      throw e;
    }
  }

  /** Vaga da pessoa na semana (`USER#<id> / LEAGUEWEEK#<semana>`), leitura consistente. */
  async getLeaguePlacement(userId, period) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `LEAGUEWEEK#${period}` },
        ConsistentRead: true,
      }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  /** Grupo aberto da liga na semana (`LEAGUEGROUPS#<tier>#<semana> / META`), 1 se nao houver. */
  async getLeagueGroupCursor(tier, period) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: this._groupCursorKey(tier, period), ConsistentRead: true }),
    );
    return Item?.group ?? 1;
  }

  /** Avanca o cursor so se ele ainda aponta para `fromGroup` (cheio); senao devolve o atual. */
  async advanceLeagueGroup(tier, period, fromGroup) {
    try {
      await this._db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: this._groupCursorKey(tier, period),
          UpdateExpression: 'SET #group = :next',
          ConditionExpression: fromGroup === 1 ? 'attribute_not_exists(#group) OR #group = :cur' : '#group = :cur',
          ExpressionAttributeNames: { '#group': 'group' },
          ExpressionAttributeValues: { ':next': fromGroup + 1, ':cur': fromGroup },
        }),
      );
      return fromGroup + 1;
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      return this.getLeagueGroupCursor(tier, period);
    }
  }

  _groupCursorKey(tier, period) {
    return { PK: `LEAGUEGROUPS#${tier}#${period}`, SK: 'META' };
  }

  async getLeague(leagueId) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `LEAGUE#${leagueId}`, SK: 'META' } }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  /** Uma pagina das ligas da semana; `cursor` e o LastEvaluatedKey (null no fim). */
  async listLeaguesOfPeriod(period, { limit = 25, cursor = null } = {}) {
    const page = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `LEAGUES#${period}` },
        Limit: limit,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    );
    return {
      leagues: (page.Items ?? []).map((i) => this._stripKeys(i)),
      cursor: page.LastEvaluatedKey ?? null,
    };
  }

  /** Todos os membros da liga (todas as paginas), sem o META. */
  async listLeagueMembers(leagueId) {
    const out = [];
    let ExclusiveStartKey;
    do {
      const page = await this._db.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `LEAGUE#${leagueId}`, ':prefix': 'USER#' },
          ProjectionExpression: 'SK, userId, xpPeriod, displayName',
          ExclusiveStartKey,
        }),
      );
      for (const i of page.Items ?? []) {
        out.push({
          userId: i.userId ?? i.SK.slice(5),
          xpPeriod: i.xpPeriod ?? 0,
          ...(i.displayName ? { displayName: i.displayName } : {}),
        });
      }
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /**
   * Grava o resultado da semana em USER#<id> / LEAGUE uma vez so (condicao por semana).
   * Repetido: devolve o resultado ja gravado, com applied=false.
   */
  async applyLeagueResult(userId, result) {
    try {
      await this._db.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            PK: `USER#${userId}`,
            SK: 'LEAGUE',
            userId,
            tier: result.toTier,
            lastResult: result,
            lastClosedPeriod: result.period,
          },
          ConditionExpression: 'attribute_not_exists(lastClosedPeriod) OR lastClosedPeriod < :period',
          ExpressionAttributeValues: { ':period': result.period },
        }),
      );
      return { applied: true, result };
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      const state = await this.getLeagueState(userId, { consistent: true });
      return { applied: false, result: state.lastResult };
    }
  }

  async getLeagueState(userId, { consistent = false } = {}) {
    const { Item } = await this._db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: 'LEAGUE' },
        ...(consistent ? { ConsistentRead: true } : {}),
      }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  /** Semana do ultimo LeagueResultSheet visto (`USER#<id> / LEAGUE_SEEN`), so para frente. */
  async markLeagueResultSeen(userId, period) {
    await this._db
      .send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `USER#${userId}`, SK: 'LEAGUE_SEEN' },
          UpdateExpression: 'SET #period = :p, userId = :uid',
          ConditionExpression: 'attribute_not_exists(#period) OR #period < :p',
          ExpressionAttributeNames: { '#period': 'period' },
          ExpressionAttributeValues: { ':p': period, ':uid': userId },
        }),
      )
      .catch((e) => {
        if (!isConditionFailure(e)) throw e;
      });
  }

  async getLeagueResultSeen(userId) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: 'LEAGUE_SEEN' } }),
    );
    return Item?.period ?? null;
  }

  async markLeagueClosed(leagueId, summary = {}) {
    const names = { '#status': 'status' };
    const values = { ':closed': 'closed' };
    const sets = ['#status = :closed'];
    for (const [k, v] of Object.entries(summary)) {
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
    await this._db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `LEAGUE#${leagueId}`, SK: 'META' },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
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
  // PAINEL DE ADMINISTRACAO - CONTADORES E ATIVIDADE
  // OPS / DAY#<dia>[#LESSON|#EXERCISE|#SIGN], WEEK#<semana>, MONTH#<mes>, COST#<mes>
  // USER#<id> / ACTIVITY (ultimo dia, semana e mes em que a pessoa contou como ativa)
  // -----------------------------------------------------------------------

  async getActivity(userId) {
    const { Item } = await this._db.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: 'ACTIVITY' } }),
    );
    return Item ? this._stripKeys(Item) : null;
  }

  /**
   * Marca a pessoa como ativa e devolve o que ainda nao tinha sido contado. Le antes (a maioria
   * das licoes do dia nao e a primeira e nao escreve nada) e grava com condicao no dia: duas
   * licoes ao mesmo tempo contam a pessoa uma vez so.
   * @returns {Promise<{day: boolean, week: boolean, month: boolean}>}
   */
  async markActivity(userId, periods) {
    const none = { day: false, week: false, month: false };
    if (!freshPeriods(await this.getActivity(userId), periods).day) return none;
    try {
      const { Attributes } = await this._db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `USER#${userId}`, SK: 'ACTIVITY' },
          UpdateExpression: 'SET lastDay = :d, lastWeek = :w, lastMonth = :m, userId = :uid',
          ConditionExpression: 'attribute_not_exists(lastDay) OR lastDay < :d',
          ExpressionAttributeValues: { ':d': periods.day, ':w': periods.week, ':m': periods.month, ':uid': userId },
          ReturnValues: 'UPDATED_OLD',
        }),
      );
      return freshPeriods(Attributes ?? null, periods);
    } catch (e) {
      if (isConditionFailure(e)) return none;
      throw e;
    }
  }

  /** Soma os contadores com ADD (nomes planos, ver domain/opsMetrics.js); TTL so na criacao. */
  async addOpsCounters(key, counters, { expiresAt = null } = {}) {
    const entries = Object.entries(counters);
    if (entries.length === 0) return;
    const names = {};
    const values = {};
    const adds = entries.map(([name, n], i) => {
      names[`#c${i}`] = name;
      values[`:c${i}`] = n;
      return `#c${i} :c${i}`;
    });
    let expr = `ADD ${adds.join(', ')}`;
    if (expiresAt != null) {
      values[':exp'] = expiresAt;
      expr += ' SET expiresAt = if_not_exists(expiresAt, :exp)';
    }
    await this._db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: OPS_PK, SK: key },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  /** Grava campos com SET (resultado do job diario: CloudWatch e custo), sem mexer nos ADD. */
  async setOpsFields(key, fields, { expiresAt = null } = {}) {
    const names = {};
    const values = {};
    const sets = Object.entries(fields).map(([name, v], i) => {
      names[`#f${i}`] = name;
      values[`:f${i}`] = v;
      return `#f${i} = :f${i}`;
    });
    if (expiresAt != null) {
      values[':exp'] = expiresAt;
      sets.push('expiresAt = if_not_exists(expiresAt, :exp)');
    }
    await this._db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: OPS_PK, SK: key },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async getOpsItem(key) {
    const { Item } = await this._db.send(new GetCommand({ TableName: TABLE, Key: { PK: OPS_PK, SK: key } }));
    return Item ? this._opsItem(Item) : null;
  }

  /** Itens com chave entre `from` e `to` (inclusive): uma Query na particao OPS, nunca Scan. */
  async listOpsRange(from, to) {
    const items = await this._queryAll({
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':pk': OPS_PK, ':from': from, ':to': to },
    });
    return items.map((i) => this._opsItem(i));
  }

  /** Os `limit` itens mais recentes com o prefixo (WEEK#, MONTH#, COST#). */
  async listOpsLatest(prefix, limit) {
    const { Items = [] } = await this._db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': OPS_PK, ':prefix': prefix },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return Items.map((i) => this._opsItem(i));
  }

  _opsItem(item) {
    const { PK, SK, expiresAt, ...rest } = item;
    return { key: SK, ...rest };
  }

  // -----------------------------------------------------------------------
  // UTIL
  // -----------------------------------------------------------------------

  /** Query com todas as paginas. */
  async _queryAll(params) {
    const out = [];
    let ExclusiveStartKey;
    do {
      const page = await this._db.send(new QueryCommand({ TableName: TABLE, ...params, ExclusiveStartKey }));
      out.push(...(page.Items ?? []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /** Remove PK/SK/GSI* antes de devolver ao usecase. */
  _stripKeys(item) {
    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, GSI3PK, GSI3SK, GSI4PK, GSI4SK, GSI5PK, GSI5SK, GSI6PK, GSI6SK, ...rest } = item;
    return rest;
  }
}
