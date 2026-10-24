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
  social: '/social',
  league: '/social/liga',
  profile: '/perfil',
  camera: '/camera',
  streak: '/sequencia',
  achievements: '/conquistas',
  settings: '/configuracoes',
  login: '/entrar',
  register: '/criar-conta',
  authCallback: '/auth/callback',
  // Abertas sem login nem onboarding: o Google pede a URL da política na tela de consentimento
  privacy: '/privacidade',
  terms: '/termos',
  courseDone: '/curso/concluido',
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
