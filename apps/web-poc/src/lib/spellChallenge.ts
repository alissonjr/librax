/**
 * Desafio de soletrar (aba Praticar, spec-03 5.4): 3 palavras seguidas com o tempo na tela e o
 * melhor tempo guardado no aparelho. Opcional e sem limite de tempo: o relógio conta para cima, só
 * enquanto uma palavra está em andamento (para entre a palavra feita e o "Continuar"), e com menos
 * movimento não há contagem regressiva nem relógio correndo (o tempo aparece no fim).
 */

/**
 * Palavras do desafio. Todas passam na regra da soletração do gerador (spelledWordProblem em
 * tools/content/compose.mjs) com as letras que têm câmera ao fim da U1; o teste confere. AZUL tem o Z
 * como prática livre; as outras misturam letras paradas e com movimento (H, J, K, X e Ç).
 */
export const SPELL_CHALLENGE_WORDS: readonly string[] = [
  'CASA', 'BOLO', 'SAPO', 'CHEGA', 'YAGO', 'CAÇA', 'JOIA', 'KIWI', 'XALE', 'HOJE', 'CAJU', 'FOGO', 'PIPA', 'AZUL',
];

export const SPELL_CHALLENGE_SIZE = 3;

/** Letras de uma palavra (Ç é uma letra só). */
export function wordLetters(word: string): string[] {
  return [...word];
}

/**
 * Palavras do desafio que a pessoa pode fazer: todas as letras já vistas (`knownLetters`, das
 * lições). Abaixo de SPELL_CHALLENGE_SIZE o desafio não aparece.
 */
export function availableChallengeWords(knownLetters: ReadonlySet<string>, pool: readonly string[] = SPELL_CHALLENGE_WORDS): string[] {
  return pool.filter(w => wordLetters(w).every(l => knownLetters.has(l)));
}

/** Sorteia `n` palavras diferentes (`random` só para os testes). */
export function pickChallengeWords(pool: readonly string[], n = SPELL_CHALLENGE_SIZE, random: () => number = Math.random): string[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Tempo em m:ss (o tempo do desafio fica na casa dos segundos a poucos minutos). */
export function formatChallengeTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BEST_KEY = 'librax_spellChallengeBest';

/** Melhor tempo guardado no aparelho (ms), ou null. */
export function readBestTime(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Registra um desafio completo (as 3 palavras feitas, sem pular). Devolve true quando é o novo
 * melhor tempo (o primeiro também conta). Sem armazenamento (aba privada), só não guarda.
 */
export function recordChallengeTime(ms: number): boolean {
  const best = readBestTime();
  if (best !== null && ms >= best) return false;
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(ms)));
  } catch {
    // sem armazenamento: o recorde vale só nesta tela
  }
  return true;
}

/** Menos movimento: a preferência do sistema ou a opção "Reduzir animações" do app. */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-reduced-motion') === 'true') return true;
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Relógio do desafio: soma só os trechos em andamento. `start` e `pause` com o tempo atual (ms);
 * `elapsed(now)` inclui o trecho aberto.
 */
export class ChallengeClock {
  private total = 0;
  private since: number | null = null;

  start(now: number): void {
    if (this.since === null) this.since = now;
  }

  pause(now: number): void {
    if (this.since === null) return;
    this.total += now - this.since;
    this.since = null;
  }

  get running(): boolean {
    return this.since !== null;
  }

  elapsed(now: number): number {
    return this.total + (this.since === null ? 0 : now - this.since);
  }
}
