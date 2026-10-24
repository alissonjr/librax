import { accountDeletionOutcome } from '../domain/squads.js';

/**
 * Exclusao de conta pela propria pessoa (LGPD; spec-02 secoes 11 e 12.8; DELETE /v1/users/me).
 *
 * Apaga, nesta ordem, tudo o que guarda o id ou dados da pessoa:
 * 1. squads (pelos vinculos `USER#<id> / SQUAD#<id>`): unico membro dissolve a squad (META,
 *    membros, semanas, convite e registro do painel); unico admin passa a administracao para o
 *    membro mais antigo (domain/squads.js: accountDeletionOutcome); em todas, sai do `createdBy`
 *    e do ranking das semanas fechadas e deixa a squad com o memberCount certo;
 * 2. ligas (membros pelo GSI2 e vagas da semana): sai do ranking de cada liga, e a liga aberta
 *    libera a vaga; o resultado ja gravado dos outros nao muda;
 * 3. a particao `USER#<id>` inteira (perfil, progresso, SRS, XP do dia, conquistas, estado da
 *    liga, tentativas, Web Push, lembretes, atividade);
 * 4. por ultimo, o usuario no Cognito: se algo acima falhar, a pessoa ainda consegue entrar e
 *    tentar de novo.
 *
 * Idempotente: cada passo so age sobre o que ainda existe e as saidas com contador sao
 * condicionais, entao uma nova tentativa depois de uma queda no meio termina o servico sem
 * descontar duas vezes. Os contadores agregados do painel (particao OPS) somam por dia, licao,
 * exercicio e sinal, sem o id de ninguem, e ficam.
 *
 * @param {object} repo
 * @param {{userId: string, username?: string|null, directory?: {deleteUser: Function}|null}} input
 *   username: `cognito:username` do token (Google: `google_<id>`); sem ele, o sub
 * @returns {Promise<object>} so contagens (vai para o log sem dado da pessoa)
 */
export async function deleteAccount(repo, { userId, username = null, directory = null }) {
  const report = { squadsLeft: 0, squadsDissolved: 0, squadsPromoted: 0, leagues: 0, items: 0, cognito: false };

  for (const { squadId } of await repo.listUserSquads(userId)) {
    const [squad, member] = await Promise.all([repo.getSquad(squadId), repo.getMember(squadId, userId)]);
    if (!squad || !member) {
      await repo.removeMemberWithCount(squadId, userId); // vinculo que sobrou
      continue;
    }
    const others = (await repo.listMembers(squadId)).filter((m) => m.userId !== userId);
    const outcome = accountDeletionOutcome({ others });
    if (outcome.action === 'dissolve') {
      await repo.deleteSquad(squadId);
      report.squadsDissolved += 1;
      continue;
    }
    // promove antes de sair: a squad nunca fica sem admin, mesmo se cair no meio
    if (outcome.promote) {
      await repo.setMemberRole(squadId, outcome.promote, 'admin');
      report.squadsPromoted += 1;
    }
    await repo.forgetSquadMember(squadId, userId);
    await repo.removeMemberWithCount(squadId, userId);
    report.squadsLeft += 1;
  }

  for (const leagueId of await repo.listUserLeagueIds(userId)) {
    await repo.removeLeagueMember(leagueId, userId);
    report.leagues += 1;
  }

  report.items = await repo.deleteUserItems(userId);

  if (directory) report.cognito = await directory.deleteUser(username ?? userId);
  return report;
}
