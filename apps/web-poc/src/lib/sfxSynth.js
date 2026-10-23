// Síntese dos efeitos sonoros do Librax (spec-05 seção 3.1), sem nenhum arquivo de terceiros.
//
// Módulo JS puro (sem DOM, sem Web Audio) para rodar em dois lugares:
// - no navegador, pelo src/lib/sound.ts, que copia as amostras para um AudioBuffer quando os
//   arquivos .m4a de public/audio não puderem ser carregados;
// - no Node, pelo tools/audio/build.mjs, que grava WAV e converte para AAC (.m4a).
//
// Regras de timbre: sons expressivos, nunca punitivos. O "erro" (neutral) é um sopro suave
// descendente, sem buzina, sem intervalo dissonante. Tudo é mono e normalizado com folga.

const TAU = Math.PI * 2;

/** Frequência de uma nota pelo número MIDI (69 = Lá 440 Hz). */
export function midiHz(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

// Notas usadas (MIDI)
const N = {
  C4: 60, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71,
  C5: 72, D5: 74, E5: 76, G5: 79, A5: 81, B5: 83,
  C6: 84, D6: 86, E6: 88, G6: 91, C7: 96,
};

/** Gerador pseudoaleatório determinístico (mulberry32): o mesmo som sai igual em todo lugar. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Soma uma nota no buffer.
 * @param {Float32Array} buf
 * @param {number} sr taxa de amostragem
 * @param {object} o  start (s), freq (Hz), dur (s, até o fim do decaimento), gain,
 *                    attack (s), decay (constante de tempo do decaimento, s),
 *                    partials [[razão, ganho]], glide (Hz/s), release (s antes do fim)
 */
function tone(buf, sr, o) {
  const {
    start = 0, freq, dur, gain = 0.3, attack = 0.005, decay = 0.25,
    partials = [[1, 1]], glide = 0, release = 0.03,
  } = o;
  const i0 = Math.floor(start * sr);
  const n = Math.min(buf.length - i0, Math.floor(dur * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = freq + glide * t;
    let env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    const tail = dur - t;
    if (tail < release) env *= Math.max(0, tail / release);
    let s = 0;
    for (const [ratio, g] of partials) s += g * Math.sin(TAU * f * ratio * t);
    buf[i0 + i] += gain * env * s;
  }
}

/** Ruído filtrado (passa-baixa de um polo) com corte que varre de `from` a `to` Hz. */
function noiseSweep(buf, sr, o) {
  const { start = 0, dur, gain = 0.3, from, to, attack = 0.03, seed = 1 } = o;
  const rand = rng(seed);
  const i0 = Math.floor(start * sr);
  const n = Math.min(buf.length - i0, Math.floor(dur * sr));
  let y = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const fc = from * (to / from) ** p;
    const a = 1 - Math.exp((-TAU * fc) / sr);
    const x = rand() * 2 - 1;
    y += a * (x - y);
    y2 += a * (y - y2); // dois polos: mais macio, sem chiado
    const t = i / sr;
    const env = (t < attack ? t / attack : 1) * Math.sin(Math.PI * Math.min(1, p * 1.02)) ** 1.5;
    buf[i0 + i] += gain * env * y2 * 3;
  }
}

/** Estalos esparsos (textura de fogo do sfx_streak). */
function crackle(buf, sr, o) {
  const { start = 0, dur, gain = 0.15, density = 60, seed = 7 } = o;
  const rand = rng(seed);
  const i0 = Math.floor(start * sr);
  const n = Math.min(buf.length - i0, Math.floor(dur * sr));
  const p = density / sr;
  for (let i = 0; i < n; i++) {
    if (rand() > p) continue;
    const len = Math.floor(sr * (0.002 + rand() * 0.004));
    const amp = gain * (0.4 + rand() * 0.6) * (1 - i / n);
    for (let k = 0; k < len && i0 + i + k < buf.length; k++) {
      buf[i0 + i + k] += amp * (rand() * 2 - 1) * Math.exp(-k / (len / 3));
    }
  }
}

/** Ambiência de sala leve: alguns ecos curtos e decrescentes (não é um reverb completo). */
function room(buf, sr, amount = 0.18) {
  const taps = [[0.023, 1], [0.037, 0.8], [0.053, 0.6], [0.079, 0.45], [0.113, 0.3]];
  const dry = Float32Array.from(buf);
  for (const [delay, g] of taps) {
    const d = Math.floor(delay * sr);
    for (let i = d; i < buf.length; i++) buf[i] += dry[i - d] * g * amount;
  }
}

/** Ajusta o pico e aplica rampas de 2 ms nas pontas (sem clique). */
function finish(buf, sr, peak = 0.7) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const k = max > 0 ? peak / max : 0;
  const ramp = Math.floor(sr * 0.002);
  for (let i = 0; i < buf.length; i++) {
    let g = k;
    if (i < ramp) g *= i / ramp;
    const tail = buf.length - 1 - i;
    if (tail < ramp) g *= tail / ramp;
    buf[i] *= g;
  }
  return buf;
}

// Timbres
const SOFT = [[1, 1], [2, 0.22], [3, 0.06]];
const WARM = [[1, 1], [2, 0.35], [3, 0.12], [4, 0.05]];
// Sino: parciais inarmônicos de um sino pequeno, bem baixos para não soar metálico demais
const BELL = [[1, 1], [2.01, 0.28], [2.76, 0.16], [5.4, 0.05]];

/**
 * Receitas: cada uma recebe (buffer, sr) já com a duração do token e escreve o som.
 * As chaves são os eventos de `sound.*` em docs/design-tokens.json.
 */
const RECIPES = {
  // Toque curto em Mi5, reverb leve (~300 ms)
  correct(b, sr) {
    tone(b, sr, { freq: midiHz(N.E5), dur: 0.3, gain: 0.5, attack: 0.004, decay: 0.09, partials: SOFT });
    tone(b, sr, { start: 0.0, freq: midiHz(N.E6), dur: 0.2, gain: 0.08, attack: 0.004, decay: 0.05 });
    room(b, sr, 0.16);
  },
  // Acorde Dó-Mi-Sol com sustain (~1 s)
  correctCamera(b, sr) {
    [N.C5, N.E5, N.G5].forEach((n, i) =>
      tone(b, sr, { start: i * 0.03, freq: midiHz(n), dur: 0.97 - i * 0.03, gain: 0.32, attack: 0.012, decay: 0.45, partials: WARM, release: 0.2 }),
    );
    tone(b, sr, { start: 0.09, freq: midiHz(N.C6), dur: 0.85, gain: 0.12, attack: 0.02, decay: 0.35, partials: SOFT, release: 0.2 });
    room(b, sr, 0.2);
  },
  // Erro: sopro suave descendente, sem timbre negativo (~200 ms)
  neutral(b, sr) {
    noiseSweep(b, sr, { dur: 0.2, gain: 0.5, from: 2200, to: 500, attack: 0.04, seed: 11 });
  },
  // Clique seco de virar página (~80 ms)
  advance(b, sr) {
    noiseSweep(b, sr, { dur: 0.05, gain: 0.5, from: 5000, to: 1500, attack: 0.002, seed: 23 });
    tone(b, sr, { freq: 1200, dur: 0.06, gain: 0.18, attack: 0.001, decay: 0.012 });
  },
  // Bip curto (~50 ms)
  xpTick(b, sr) {
    tone(b, sr, { freq: midiHz(N.A5), dur: 0.05, gain: 0.4, attack: 0.002, decay: 0.02, glide: 400, partials: SOFT, release: 0.01 });
  },
  // Sopro ascendente + estalos de fogo (~500 ms)
  streak(b, sr) {
    noiseSweep(b, sr, { dur: 0.5, gain: 0.45, from: 400, to: 3200, attack: 0.08, seed: 31 });
    crackle(b, sr, { start: 0.12, dur: 0.38, gain: 0.25, density: 70, seed: 37 });
  },
  // Acorde de resolução, alegre (~600 ms): Sol maior -> Dó maior
  goalMet(b, sr) {
    [N.G4, N.B4, N.D5].forEach(n => tone(b, sr, { freq: midiHz(n), dur: 0.22, gain: 0.25, attack: 0.006, decay: 0.12, partials: WARM }));
    [N.C5, N.E5, N.G5].forEach(n => tone(b, sr, { start: 0.18, freq: midiHz(n), dur: 0.42, gain: 0.28, attack: 0.008, decay: 0.2, partials: WARM, release: 0.1 }));
    room(b, sr, 0.18);
  },
  // Fanfarra curta ascendente de 4 notas (~800 ms)
  lessonDone(b, sr) {
    const notes = [N.C5, N.E5, N.G5, N.C6];
    notes.forEach((n, i) => {
      const last = i === notes.length - 1;
      tone(b, sr, {
        start: i * 0.11, freq: midiHz(n), dur: last ? 0.8 - i * 0.11 : 0.2, gain: last ? 0.38 : 0.3,
        attack: 0.006, decay: last ? 0.28 : 0.1, partials: WARM, release: last ? 0.15 : 0.03,
      });
    });
    room(b, sr, 0.2);
  },
  // Sino de 3 notas ascendentes, distinto da conclusão (~600 ms)
  achievement(b, sr) {
    [N.G5, N.B5, N.D6].forEach((n, i) =>
      tone(b, sr, { start: i * 0.1, freq: midiHz(n), dur: 0.6 - i * 0.1, gain: 0.3, attack: 0.003, decay: 0.22, partials: BELL, release: 0.08 }),
    );
    room(b, sr, 0.22);
  },
  // Fanfarra média de 6 notas + eco (~1200 ms)
  unitDone(b, sr) {
    const notes = [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6];
    notes.forEach((n, i) => {
      const last = i === notes.length - 1;
      tone(b, sr, {
        start: i * 0.09, freq: midiHz(n), dur: last ? 1.2 - i * 0.09 : 0.18, gain: last ? 0.36 : 0.26,
        attack: 0.005, decay: last ? 0.35 : 0.09, partials: WARM, release: last ? 0.25 : 0.03,
      });
    });
    room(b, sr, 0.3);
  },
  // Fanfarra completa + resolução harmônica (~2500 ms)
  courseDone(b, sr) {
    const run = [N.C4, N.E4, N.G4, N.C5, N.E5, N.G5];
    run.forEach((n, i) => tone(b, sr, { start: i * 0.1, freq: midiHz(n), dur: 0.22, gain: 0.26, attack: 0.005, decay: 0.1, partials: WARM }));
    // Fá maior -> Sol maior -> Dó maior
    [[N.F4, N.A4, N.C5], [N.G4, N.B4, N.D5]].forEach((chord, k) =>
      chord.forEach(n => tone(b, sr, { start: 0.65 + k * 0.3, freq: midiHz(n), dur: 0.32, gain: 0.2, attack: 0.01, decay: 0.2, partials: WARM })),
    );
    [N.C5, N.E5, N.G5, N.C6].forEach(n =>
      tone(b, sr, { start: 1.25, freq: midiHz(n), dur: 1.25, gain: 0.22, attack: 0.015, decay: 0.6, partials: WARM, release: 0.4 }),
    );
    room(b, sr, 0.28);
  },
  // Cristal gelado, descendente (~400 ms)
  freeze(b, sr) {
    [N.C7, N.G6, N.E6, N.C6].forEach((n, i) =>
      tone(b, sr, { start: i * 0.07, freq: midiHz(n), dur: 0.4 - i * 0.07, gain: 0.2, attack: 0.002, decay: 0.12, partials: BELL, release: 0.05 }),
    );
    room(b, sr, 0.25);
  },
  // Subida de liga: arpejo rápido de 5 notas + acorde brilhante sustentado (~900 ms)
  leagueUp(b, sr) {
    const notes = [N.G4, N.C5, N.E5, N.G5, N.C6];
    notes.forEach((n, i) =>
      tone(b, sr, { start: i * 0.07, freq: midiHz(n), dur: 0.2, gain: 0.26, attack: 0.004, decay: 0.08, partials: WARM }),
    );
    [N.C5, N.E5, N.G5, N.C6].forEach(n =>
      tone(b, sr, { start: 0.36, freq: midiHz(n), dur: 0.54, gain: 0.2, attack: 0.01, decay: 0.3, partials: SOFT, release: 0.15 }),
    );
    tone(b, sr, { start: 0.36, freq: midiHz(N.E6), dur: 0.5, gain: 0.08, attack: 0.004, decay: 0.2, partials: BELL, release: 0.12 });
    room(b, sr, 0.24);
  },
};

/** Eventos com receita de síntese. */
export const SYNTH_EVENTS = Object.keys(RECIPES);

/**
 * Gera as amostras (mono, -1..1) de um evento.
 * @param {string} event chave de `sound.*` (ex.: 'correct')
 * @param {number} sampleRate taxa de amostragem (ex.: 44100 ou a do AudioContext)
 * @param {number} durationMs duração do token sound.<evento>.durationMs
 * @returns {Float32Array}
 */
export function synthesize(event, sampleRate, durationMs) {
  const recipe = RECIPES[event];
  if (!recipe) throw new Error(`Som sem receita de síntese: ${event}`);
  const buf = new Float32Array(Math.max(1, Math.round((durationMs / 1000) * sampleRate)));
  recipe(buf, sampleRate);
  return finish(buf, sampleRate);
}
