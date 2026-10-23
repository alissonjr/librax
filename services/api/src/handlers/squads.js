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
 * GET    /v1/squads/{squadId}                    -> getSquad
 * GET    /v1/squads/public                       -> listPublicSquads
 * GET    /v1/users/me/squads                     -> listMySquads
 */

import { randomUUID } from 'node:crypto';
import * as squadUsecases from '../usecases/squads.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo } from './_repo.js';

const genId = () => randomUUID();
const rng = () => Math.random();

function squadId(event) {
  const id = event.pathParameters?.squadId;
  if (!id) throw new ApiError(400, 'MISSING_SQUAD_ID', 'squadId obrigatorio na URL');
  return id;
}

function mapSquadError(err) {
  const HTTP_STATUS = {
    GUEST_CANNOT_CREATE: [403, 'Convidados nao podem criar squads. Crie uma conta.'],
    MAX_SQUADS_REACHED:  [409, 'Limite de 5 squads atingido.'],
    NAME_INVALID:        [400, 'Nome invalido (3 a 40 caracteres).'],
    SQUAD_NOT_FOUND:     [404, 'Squad nao encontrada.'],
    SQUAD_FULL:          [409, 'Squad esta cheia.'],
    ALREADY_MEMBER:      [409, 'Voce ja e membro desta squad.'],
    MUST_TRANSFER_OWNERSHIP: [409, 'Transfira a lideranca antes de sair.'],
    NOT_ADMIN:           [403, 'Apenas admins podem fazer isso.'],
    CANNOT_ACT_ON_SELF:  [400, 'Nao pode agir sobre si mesmo via este endpoint.'],
    LAST_ADMIN:          [409, 'Nao pode rebaixar o unico admin.'],
    NOT_MEMBER:          [404, 'Usuario nao e membro da squad.'],
  };
  const [status, message] = HTTP_STATUS[err.message] ?? [500, 'Erro de dominio'];
  return new ApiError(status, err.message, message);
}

function callUsecase(fn, ...args) {
  return fn(...args).catch((e) => { throw mapSquadError(e); });
}

export const createSquadHandler = wrap(async (event) => {
  const uid = userId(event);
  const { name, description, type = 'public' } = body(event);
  const squad = await callUsecase(squadUsecases.createSquad, repo, {
    userId: uid, isGuest: false, name, description, type, genId, rng, now: new Date().toISOString(),
  });
  return ok(squad, 201);
});

export const joinSquadHandler = wrap(async (event) => {
  const uid = userId(event);
  const { inviteCode, squadId: sid } = body(event);
  const squad = await callUsecase(squadUsecases.joinSquad, repo, {
    userId: uid, isGuest: false, code: inviteCode, squadId: sid,
  });
  return ok(squad);
});

export const leaveSquadHandler = wrap(async (event) => {
  const uid = userId(event);
  const sid = squadId(event);
  await callUsecase(squadUsecases.leaveSquad, repo, { userId: uid, squadId: sid });
  return ok({ ok: true });
});

export const transferOwnershipHandler = wrap(async (event) => {
  const uid = userId(event);
  const sid = squadId(event);
  const { newAdminUserId } = body(event);
  if (!newAdminUserId) throw new ApiError(400, 'MISSING_TARGET', 'newAdminUserId obrigatorio');
  await callUsecase(squadUsecases.transferOwnership, repo, { userId: uid, squadId: sid, newAdminUserId });
  return ok({ ok: true });
});

export const updateSquadHandler = wrap(async (event) => {
  const uid = userId(event);
  const sid = squadId(event);
  const changes = body(event);
  const squad = await callUsecase(squadUsecases.updateSquad, repo, { userId: uid, squadId: sid, changes });
  return ok(squad);
});

export const disbandSquadHandler = wrap(async (event) => {
  const uid = userId(event);
  const sid = squadId(event);
  await callUsecase(squadUsecases.disbandSquad, repo, { userId: uid, squadId: sid });
  return ok({ ok: true });
});

export const manageMemberHandler = wrap(async (event) => {
  const uid = userId(event);
  const sid = squadId(event);
  const targetUserId = event.pathParameters?.userId;
  if (!targetUserId) throw new ApiError(400, 'MISSING_USER_ID', 'userId na URL obrigatorio');
  const { action } = body(event);
  await callUsecase(squadUsecases.manageMember, repo, { userId: uid, squadId: sid, targetUserId, action });
  return ok({ ok: true });
});

export const regenerateInviteCodeHandler = wrap(async (event) => {
  const uid = userId(event);
  const sid = squadId(event);
  const result = await callUsecase(squadUsecases.regenerateInviteCode, repo, { userId: uid, squadId: sid, rng });
  return ok(result);
});

export const getSquadHandler = wrap(async (event) => {
  const uid = userId(event);
  const sid = squadId(event);
  const squad = await repo.getSquad(sid);
  if (!squad) throw new ApiError(404, 'SQUAD_NOT_FOUND', 'Squad nao encontrada');
  const members = await repo.listMembers(sid);
  const userMembership = members.find((m) => m.userId === uid) ?? null;
  return ok({
    squad,
    members: members.sort((a, b) => (b.xpWeeklyContrib ?? 0) - (a.xpWeeklyContrib ?? 0)),
    userMembership: userMembership ? { role: userMembership.role } : null,
  });
});

export const listMySquadsHandler = wrap(async (event) => {
  const uid = userId(event);
  const squads = await repo.listUserSquads(uid);
  const details = await Promise.all(squads.map(({ squadId: sid }) => repo.getSquad(sid)));
  return ok({ squads: details.filter(Boolean) });
});
