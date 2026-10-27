/**
 * Handlers Lambda para endpoints de squad (SPEC 04 secao 2).
 *
 * POST   /v1/squads                              -> createSquad
 * POST   /v1/squads/join                         -> joinSquad
 * POST   /v1/squads/{squadId}/leave              -> leaveSquad
 * POST   /v1/squads/{squadId}/transfer           -> transferOwnership
 * PATCH  /v1/squads/{squadId}                    -> updateSquad
 * DELETE /v1/squads/{squadId}                    -> disbandSquad
 * POST   /v1/squads/{squadId}/members/{userId}/manage -> manageMember
 * POST   /v1/squads/{squadId}/invite-code/regenerate  -> regenerateInviteCode
 * GET    /v1/squads/{squadId}                    -> getSquad (nao membro de privada: so dados publicos)
 * GET    /v1/squads/public                       -> listPublicSquads
 * GET    /v1/users/me/squads                     -> listMySquads
 *
 * `makeSquadHandlers({ repo })` recebe as dependencias (testes usam InMemoryRepo);
 * os exports nomeados sao as instancias de producao (DynamoRepo).
 */

import { randomUUID, randomInt } from 'node:crypto';
import * as squadUsecases from '../usecases/squads.js';
import { SquadError } from '../usecases/squads.js';
import { squadForWeek, squadView } from '../domain/squads.js';
import { periodKey, periodStartOf } from '../domain/leagues.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';

/** RNG seguro em [0, 1) para o codigo de convite (domain/invite.js pede um em producao). */
const RNG_SCALE = 2 ** 32;
const secureRng = () => randomInt(0, RNG_SCALE) / RNG_SCALE;

/** Codigos de erro do dominio/usecases (SPEC 04 secao 2 e tela 4.4) -> status HTTP. */
const SQUAD_ERRORS = {
  GUEST_NOT_ALLOWED:        [403, 'Convidados nao podem usar squads. Crie uma conta.'],
  SQUADS_LIMIT_REACHED:     [409, 'Limite de 5 squads atingido.'],
  INVALID_NAME:             [400, 'Nome invalido (3 a 40 caracteres).'],
  INVALID_DESCRIPTION:      [400, 'Descricao invalida (ate 200 caracteres).'],
  INVALID_TYPE:             [400, 'Tipo invalido (public ou private).'],
  INVALID_MAX_MEMBERS:      [400, 'Limite de membros invalido (1 a 30).'],
  MAX_MEMBERS_BELOW_COUNT:  [409, 'O limite nao pode ficar abaixo do total de membros.'],
  NO_CHANGES:               [400, 'Nada para alterar.'],
  SQUAD_NOT_FOUND:          [404, 'Squad nao encontrada.'],
  SQUAD_FULL:               [409, 'Squad esta cheia.'],
  ALREADY_MEMBER:           [409, 'Voce ja e membro desta squad.'],
  MUST_TRANSFER_OWNERSHIP:  [409, 'Transfira a administracao antes de sair.'],
  NOT_ADMIN:                [403, 'Apenas admins podem fazer isso.'],
  NOT_MEMBER:               [404, 'Voce nao e membro da squad.'],
  TARGET_NOT_MEMBER:        [404, 'Usuario nao e membro da squad.'],
  CANNOT_MANAGE_SELF:       [400, 'Nao pode agir sobre si mesmo por este endpoint.'],
  CANNOT_DEMOTE_ONLY_ADMIN: [409, 'Nao pode rebaixar o unico admin.'],
  INVALID_ACTION:           [400, 'Acao invalida (promote, demote ou kick).'],
  INVITE_CODE_EXHAUSTED:    [503, 'Nao foi possivel gerar um codigo de convite. Tente de novo.'],
};

/** Semana corrente (mesma da liga): o XP semanal mostrado e o dela. */
const currentPeriod = (date) => periodKey(periodStartOf(date.getTime()));

/** Id de squad no caminho: o randomUUID da criacao (letras, numeros, hifen e sublinhado, ate 64). */
const SQUAD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function squadId(event) {
  const id = event.pathParameters?.squadId;
  if (!id) throw new ApiError(400, 'MISSING_SQUAD_ID', 'squadId obrigatorio na URL');
  if (!SQUAD_ID_RE.test(id)) throw new ApiError(400, 'BAD_SQUAD_ID', 'squadId invalido');
  return id;
}

/** Erro de dominio vira ApiError; erro de infraestrutura segue para o wrap (500 sem detalhe). */
function callUsecase(fn, ...args) {
  return fn(...args).catch((err) => {
    const mapped = err instanceof SquadError ? SQUAD_ERRORS[err.message] : undefined;
    if (!mapped) throw err;
    throw new ApiError(mapped[0], err.message, mapped[1]);
  });
}

export function makeSquadHandlers({ repo, now = () => new Date(), genId = randomUUID, rng = secureRng }) {
  const createSquadHandler = wrap(async (event) => {
    const uid = userId(event);
    const { name, description, type = 'public' } = body(event);
    const squad = await callUsecase(squadUsecases.createSquad, repo, {
      userId: uid, isGuest: false, name, description, type, genId, rng, now: now().toISOString(),
    });
    return ok(squadForWeek(squad, currentPeriod(now())), 201);
  });

  const joinSquadHandler = wrap(async (event) => {
    const uid = userId(event);
    const { inviteCode, squadId: sid } = body(event);
    if (sid !== undefined && sid !== null && !(typeof sid === 'string' && SQUAD_ID_RE.test(sid))) {
      throw new ApiError(400, 'BAD_SQUAD_ID', 'squadId invalido');
    }
    const squad = await callUsecase(squadUsecases.joinSquad, repo, {
      userId: uid, isGuest: false, code: inviteCode, squadId: sid, now: now().toISOString(),
    });
    return ok(squadForWeek(squad, currentPeriod(now())));
  });

  const leaveSquadHandler = wrap(async (event) => {
    const uid = userId(event);
    const sid = squadId(event);
    await callUsecase(squadUsecases.leaveSquad, repo, { userId: uid, squadId: sid });
    return ok({ ok: true });
  });

  const transferOwnershipHandler = wrap(async (event) => {
    const uid = userId(event);
    const sid = squadId(event);
    const { newAdminUserId } = body(event);
    if (!newAdminUserId) throw new ApiError(400, 'MISSING_TARGET', 'newAdminUserId obrigatorio');
    await callUsecase(squadUsecases.transferOwnership, repo, { userId: uid, squadId: sid, newAdminUserId });
    return ok({ ok: true });
  });

  const updateSquadHandler = wrap(async (event) => {
    const uid = userId(event);
    const sid = squadId(event);
    const changes = body(event);
    const squad = await callUsecase(squadUsecases.updateSquad, repo, { userId: uid, squadId: sid, changes });
    return ok(squadForWeek(squad, currentPeriod(now())));
  });

  const disbandSquadHandler = wrap(async (event) => {
    const uid = userId(event);
    const sid = squadId(event);
    await callUsecase(squadUsecases.disbandSquad, repo, { userId: uid, squadId: sid });
    return ok({ ok: true });
  });

  const manageMemberHandler = wrap(async (event) => {
    const uid = userId(event);
    const sid = squadId(event);
    const targetUserId = event.pathParameters?.userId;
    if (!targetUserId) throw new ApiError(400, 'MISSING_USER_ID', 'userId na URL obrigatorio');
    const { action } = body(event);
    await callUsecase(squadUsecases.manageMember, repo, { actorId: uid, squadId: sid, targetUserId, action });
    return ok({ ok: true });
  });

  const regenerateInviteCodeHandler = wrap(async (event) => {
    const uid = userId(event);
    const sid = squadId(event);
    const result = await callUsecase(squadUsecases.regenerateInviteCode, repo, { userId: uid, squadId: sid, rng });
    return ok(result);
  });

  const getSquadHandler = wrap(async (event) => {
    const uid = userId(event);
    const sid = squadId(event);
    const squad = await repo.getSquad(sid);
    if (!squad) throw new ApiError(404, 'SQUAD_NOT_FOUND', 'Squad nao encontrada');
    const members = await repo.listMembers(sid);
    // nao membro de squad privada ve so os dados publicos (domain/squads.js: squadView)
    return ok(squadView({ squad, members, viewerId: uid, period: currentPeriod(now()) }));
  });

  const listMySquadsHandler = wrap(async (event) => {
    const uid = userId(event);
    const squads = await repo.listUserSquads(uid);
    const details = await Promise.all(squads.map(({ squadId: sid }) => repo.getSquad(sid)));
    const period = currentPeriod(now());
    return ok({ squads: details.filter(Boolean).map((sq) => squadForWeek(sq, period)) });
  });

  return {
    createSquadHandler,
    joinSquadHandler,
    leaveSquadHandler,
    transferOwnershipHandler,
    updateSquadHandler,
    disbandSquadHandler,
    manageMemberHandler,
    regenerateInviteCodeHandler,
    getSquadHandler,
    listMySquadsHandler,
  };
}

export const {
  createSquadHandler,
  joinSquadHandler,
  leaveSquadHandler,
  transferOwnershipHandler,
  updateSquadHandler,
  disbandSquadHandler,
  manageMemberHandler,
  regenerateInviteCodeHandler,
  getSquadHandler,
  listMySquadsHandler,
} = makeSquadHandlers({ repo: dynamoRepo });
