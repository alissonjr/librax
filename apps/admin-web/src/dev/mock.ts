// Modo de exemplo (npm run dev:mock): o painel inteiro sem AWS, para desenvolver as telas e tirar
// prints. Só é carregado com `--mode mock`.
import type { AdminApi } from '../lib/api';
import type { Account } from '../lib/types';
import { AuthError, type AdminAuth, type Challenge } from '../lib/auth';
import { SAMPLE_USER, sampleAccount, sampleAccountList, sampleContent, sampleCost, sampleOverview, sampleSquads } from './fixtures';
import { sampleFeedbackPage, sampleUsage } from './usageFixtures';

const wait = <T,>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 150));

export function mockApi(): AdminApi {
  const squads = sampleSquads();
  // Contas de exemplo com os grupos (a dona é quem está no painel; a carla2 já é admin)
  const accounts = sampleAccountList();
  const groups = new Map<string, string[]>([[accounts[2].userId!, ['admin']]]);
  const withGroups = (a: Account): Account => ({ ...a, groups: groups.get(a.userId!) ?? [] });
  const setGroups = (userId: string, next: string[]) => {
    groups.set(userId, next);
    return wait({ ok: true as const, groups: next });
  };
  return {
    me: () => wait({ userId: '11111111-1111-4111-8111-111111111111', email: 'dono@exemplo.com', groups: ['admin', 'owner'] }),
    overview: (days) => wait(sampleOverview(undefined, days ?? 30)),
    content: () => wait(sampleContent),
    searchAccounts: (q) => wait({ accounts: 'ana@exemplo.com'.startsWith(q.toLowerCase()) || q === SAMPLE_USER ? [sampleAccount.account!] : [] }),
    listAccounts: (cursor, opts) => {
      if (opts?.group === 'admin') {
        const dona: Account = { ...sampleAccountList()[1], userId: '11111111-1111-4111-8111-111111111111', email: 'dono@exemplo.com', provider: 'email', status: 'CONFIRMED', groups: ['admin', 'owner'] };
        return wait({ accounts: [dona, ...accounts.filter((a) => groups.get(a.userId!)?.includes('admin')).map(withGroups)], cursor: null });
      }
      const all = accounts;
      const start = cursor ? Number(cursor) : 0;
      const next = start + 25;
      return wait({ accounts: all.slice(start, next), cursor: next < all.length ? String(next) : null });
    },
    account: (userId) => {
      const a = accounts.find((x) => x.userId === userId);
      return wait(a && userId !== SAMPLE_USER
        ? { ...sampleAccount, userId, account: withGroups(a), profile: null, progress: { ...sampleAccount.progress, distinctLessons: 0, lessons: [] }, squads: [] }
        : { ...sampleAccount, account: withGroups(sampleAccount.account!) });
    },
    disableAccount: () => wait({ ok: true as const, enabled: false }),
    enableAccount: () => wait({ ok: true as const, enabled: true }),
    deleteAccount: () => wait({ ok: true as const }),
    grantAdmin: (userId) => setGroups(userId, ['admin']),
    revokeAdmin: (userId) => setGroups(userId, []),
    squads: (cursor) => wait(cursor ? { squads: squads.slice(4), cursor: null } : { squads: squads.slice(0, 4), cursor: 'c1' }),
    cost: () => wait(sampleCost),
    usage: () => wait(sampleUsage()),
    feedback: (opts) => wait(sampleFeedbackPage(opts)),
  };
}

const SIGNED_OUT_KEY = 'librax_admin_mock_saiu';

/**
 * Login de mentira, para ver as telas de entrar: abre já dentro do painel; "Sair" (ou abrir com
 * `?entrar` na URL) leva à tela de entrar. Qualquer e-mail e senha vão para o código, com estas
 * exceções na senha: `errada`, `muitas`, `rede` e `nova` (senha temporária). No código, `000000`
 * não confere e `999999` faz o tempo acabar; qualquer outro entra.
 */
export function mockSession(): AdminAuth {
  if (new URLSearchParams(window.location.search).has('entrar')) sessionStorage.setItem(SIGNED_OUT_KEY, '1');
  const totp = (): Challenge => ({ kind: 'totp', session: 'sessao-de-exemplo', username: 'exemplo' });
  return {
    hasSession: () => sessionStorage.getItem(SIGNED_OUT_KEY) !== '1',
    async signIn(_email, password) {
      await wait(null);
      if (password === 'errada') throw new AuthError('INVALID_CREDENTIALS');
      if (password === 'muitas') throw new AuthError('TOO_MANY_ATTEMPTS');
      if (password === 'rede') throw new AuthError('NETWORK');
      if (password === 'nova') return { kind: 'newPassword', session: 'sessao-de-exemplo', username: 'exemplo' };
      return totp();
    },
    async confirmTotp(_challenge, code) {
      await wait(null);
      if (code === '000000') throw new AuthError('BAD_CODE');
      if (code === '999999') throw new AuthError('SESSION_EXPIRED');
      sessionStorage.removeItem(SIGNED_OUT_KEY);
      return { kind: 'done' };
    },
    async completeNewPassword() {
      await wait(null);
      return totp();
    },
    async signOut() {
      sessionStorage.setItem(SIGNED_OUT_KEY, '1');
    },
    clear: () => sessionStorage.setItem(SIGNED_OUT_KEY, '1'),
  };
}
