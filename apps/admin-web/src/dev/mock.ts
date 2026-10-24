// Modo de exemplo (npm run dev:mock): o painel inteiro sem AWS e sem login, para desenvolver as
// telas e tirar prints. Só é carregado com `--mode mock`.
import type { AdminApi } from '../lib/api';
import type { Session } from '../App';
import { SAMPLE_USER, sampleAccount, sampleContent, sampleCost, sampleOverview, sampleSquads } from './fixtures';

const wait = <T,>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 150));

export function mockApi(): AdminApi {
  const squads = sampleSquads();
  return {
    me: () => wait({ userId: '11111111-1111-4111-8111-111111111111', email: 'dono@exemplo.com', groups: ['admin'] }),
    overview: () => wait(sampleOverview()),
    content: () => wait(sampleContent),
    searchAccounts: (q) => wait({ accounts: 'ana@exemplo.com'.startsWith(q.toLowerCase()) || q === SAMPLE_USER ? [sampleAccount.account!] : [] }),
    account: () => wait(sampleAccount),
    squads: (cursor) => wait(cursor ? { squads: squads.slice(4), cursor: null } : { squads: squads.slice(0, 4), cursor: 'c1' }),
    cost: () => wait(sampleCost),
  };
}

export function mockSession(): Session {
  return { hasToken: () => true, login: () => {}, logout: () => {}, completeLogin: async () => {}, clear: () => {} };
}
