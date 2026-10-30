import type { NavSection } from '../components/Nav';

/**
 * URLs do app (docs/design-system.md 11.13). Em português, como as abas.
 * Toda tela tem URL: o voltar do navegador e o do Android funcionam e recarregar mantém a tela.
 */
export const ROUTES = {
  home: '/',
  onboarding: '/boas-vindas',
  learn: '/aprender',
  practice: '/praticar',
  spellChallenge: '/praticar/soletrar',
  social: '/social',
  league: '/social/liga',
  /** Liga geral: todo mundo com conta, pelo XP total. */
  globalLeague: '/social/geral',
  /** Ligas privadas (squads privadas do servidor): criar, entrar com código e ver uma. */
  privateNew: '/social/ligas/nova',
  privateJoin: '/social/ligas/entrar',
  /** Link de convite compartilhado: /convite/<código> leva a entrar na liga. */
  invite: '/convite',
  profile: '/perfil',
  camera: '/camera',
  /** Modo livre da câmera: soletrar o que quiser (screens/FreeModeScreen.tsx). */
  freeMode: '/camera/livre',
  streak: '/sequencia',
  achievements: '/conquistas',
  settings: '/configuracoes',
  cameraStats: '/configuracoes/camera',
  /** Trocar o nome (o que aparece nas ligas). */
  name: '/configuracoes/nome',
  login: '/entrar',
  register: '/criar-conta',
  authCallback: '/auth/callback',
  // Abertas sem login nem onboarding: o Google pede a URL da política na tela de consentimento
  privacy: '/privacidade',
  terms: '/termos',
  courseDone: '/curso/concluido',
  // Teste de nivelamento (opcional): convite no fim do onboarding, no mapa e nas Configurações
  placement: '/nivelamento',
  privateLeague: (id: string) => `/social/ligas/${encodeURIComponent(id)}`,
  lesson: (id: string) => `/licao/${encodeURIComponent(id)}`,
  lessonDone: (id: string) => `/licao/${encodeURIComponent(id)}/concluida`,
  unitDone: (id: string) => `/unidade/${encodeURIComponent(id)}/concluida`,
} as const;

/** Rota de cada aba da barra de navegação. */
export const TAB_PATHS: Record<NavSection, string> = {
  aprender: ROUTES.learn,
  praticar: ROUTES.practice,
  social: ROUTES.social,
  perfil: ROUTES.profile,
};

/** Aba acesa para a rota atual (a câmera fica dentro de Praticar). */
export function sectionForPath(pathname: string): NavSection {
  if (pathname.startsWith(ROUTES.practice) || pathname.startsWith(ROUTES.camera)) return 'praticar';
  if (pathname.startsWith(ROUTES.social)) return 'social';
  if (pathname.startsWith(ROUTES.profile)) return 'perfil';
  return 'aprender';
}
