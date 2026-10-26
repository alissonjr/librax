/*
 * Parte leve da mão em 3D (entra no código da lição): quais sinais têm mão em 3D, se o navegador
 * desenha 3D, as preferências de quem usa (tom de pele, aba) e o "menos movimento". O motor 3D, o
 * modelo e as poses (Mao3DView.tsx, cena.ts, poses.ts) só baixam quando uma apresentação de letra
 * ou número abre.
 */

/** Letras e números com mãos reais em maos-licoes.json (o teste mao3dPoses.test.ts confere). */
export const MAO3D_STATIC: readonly string[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y',
  '0', '1', '2', '3', '4', '6', '7', '8', '9',
];
/** Letras com o movimento real (quadros a 15 por segundo). */
export const MAO3D_MOVING: readonly string[] = ['H', 'J', 'K', 'X', 'Z', 'Ç'];

const ALL = new Set([...MAO3D_STATIC, ...MAO3D_MOVING]);

/**
 * Só letras do alfabeto manual e números de 0 a 9. Nos sinais de palavras o avatar continua
 * sozinho: o lugar no corpo e a expressão do rosto fazem parte do sinal.
 */
export function hasHand3d(sign: { category: string; gloss: string }): boolean {
  return (sign.category === 'alfabeto' || sign.category === 'numeros') && ALL.has(sign.gloss);
}

export function isMovingLetter(gloss: string): boolean {
  return MAO3D_MOVING.includes(gloss);
}

let webgl: boolean | null = null;

/** O navegador cria um contexto WebGL? (uma vez por sessão; sem 3D, a apresentação fica como antes) */
export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  webgl = false;
  try {
    if (typeof document !== 'undefined' && typeof window !== 'undefined' && 'WebGLRenderingContext' in window) {
      const c = document.createElement('canvas');
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
      webgl = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl = false;
  }
  return webgl;
}

/** Só para os testes. */
export function setWebglAvailableForTests(value: boolean | null) {
  webgl = value;
}

/** Menos movimento: a opção do sistema ou "Reduzir animações" do app (design system 9.3). */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-reduced-motion') === 'true') return true;
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Tons de pele (sRGB), do mais claro ao mais escuro. Ilustrativos: os dados da mão não dizem a cor
 * de ninguém. Os mesmos da abertura da landing.
 */
export const SKIN_TONES = ['#F3CDB0', '#E2AE8A', '#C98F68', '#A86F4C', '#86553A', '#5E3B29'] as const;
/** Sem escolha: o tom do meio. */
export const DEFAULT_SKIN_TONE = 2;

const SKIN_KEY = 'librax_mao3dTom';
const VIEW_KEY = 'librax_mao3dAba';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}

export function getSkinTone(): number {
  const n = Number(read(SKIN_KEY));
  return Number.isInteger(n) && n >= 0 && n < SKIN_TONES.length && read(SKIN_KEY) !== null ? n : DEFAULT_SKIN_TONE;
}
export function setSkinTone(index: number) {
  write(SKIN_KEY, String(index));
}

export type DemoView = 'mao3d' | 'avatar';
/** Aba da demonstração das letras e números: a mão em 3D, a não ser que a pessoa escolha o avatar. */
export function getDemoView(): DemoView {
  return read(VIEW_KEY) === 'avatar' ? 'avatar' : 'mao3d';
}
export function setDemoView(view: DemoView) {
  write(VIEW_KEY, view);
}
