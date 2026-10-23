export interface Lm {
  x: number;
  y: number;
  z: number;
}

export interface FingerExtensions {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/**
 * Indices do MediaPipe Hand Landmarker (21 pontos):
 * 0=punho, 1-4=polegar(CMC/MCP/IP/tip), 5-8=indicador(MCP/PIP/DIP/tip),
 * 9-12=medio, 13-16=anelar, 17-20=minimo
 */
export function getFingerExtensions(pts: Lm[]): FingerExtensions {
  // Normaliza pelo tamanho da palma (punho -> MCP do medio)
  // para funcionar em qualquer distancia da camera
  const palmLen = Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y);
  const THRESHOLD = Math.max(0.025, palmLen * 0.25);

  // Polegar: calcula distancia da ponta (4) ao MCP (2) relativa ao tamanho da palma
  const thumbDist = Math.hypot(pts[4].x - pts[2].x, pts[4].y - pts[2].y);
  const thumb = thumbDist > palmLen * 0.55;

  // Dedos: ponta deve estar acima do MCP por uma fração do comprimento da palma
  const index  = pts[5].y - pts[8].y  > THRESHOLD;
  const middle = pts[9].y - pts[12].y > THRESHOLD;
  const ring   = pts[13].y - pts[16].y > THRESHOLD;
  const pinky  = pts[17].y - pts[20].y > THRESHOLD;

  return { thumb, index, middle, ring, pinky };
}

interface Pattern {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/** Padroes de extensao para letras distinguiveis so pela extensao dos dedos. */
const PATTERNS: Array<{ letter: string } & Pattern> = [
  { letter: 'B', thumb: false, index: true,  middle: true,  ring: true,  pinky: true  },
  { letter: 'D', thumb: false, index: true,  middle: false, ring: false, pinky: false },
  { letter: 'I', thumb: false, index: false, middle: false, ring: false, pinky: true  },
  { letter: 'L', thumb: true,  index: true,  middle: false, ring: false, pinky: false },
  { letter: 'V', thumb: false, index: true,  middle: true,  ring: false, pinky: false },
  { letter: 'W', thumb: false, index: true,  middle: true,  ring: true,  pinky: false },
  { letter: 'Y', thumb: true,  index: false, middle: false, ring: false, pinky: true  },
  // Punho fechado: A, E, S sao visualmente semelhantes por extensao
  { letter: 'A', thumb: false, index: false, middle: false, ring: false, pinky: false },
];

function patternScore(ext: FingerExtensions, pat: Pattern): number {
  let hits = 0;
  if (ext.thumb  === pat.thumb)  hits++;
  if (ext.index  === pat.index)  hits++;
  if (ext.middle === pat.middle) hits++;
  if (ext.ring   === pat.ring)   hits++;
  if (ext.pinky  === pat.pinky)  hits++;
  return hits / 5;
}

export interface RecognitionResult {
  letter: string | null;
  confidence: number;
  extensions: FingerExtensions;
}

/** Limiar minimo: 4/5 dedos corretos = 0.8 */
const MIN_CONFIDENCE = 0.8;

// Limiares geometricos (distancias normalizadas pelo tamanho da palma).
const UV_TIP_GAP = 0.45;   // ponta indicador<->medio: < junto (U), >= afastado (V)
const TOUCH_GAP = 0.4;     // ponta polegar<->indicador: < encostando (F)

function dist(a: Lm, b: Lm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function recognizeGesture(landmarks: Lm[]): RecognitionResult {
  const extensions = getFingerExtensions(landmarks);

  let bestLetter: string | null = null;
  let bestScore = 0;

  for (const pat of PATTERNS) {
    const score = patternScore(extensions, pat);
    if (score > bestScore) {
      bestScore = score;
      bestLetter = score >= MIN_CONFIDENCE ? pat.letter : null;
    }
  }

  // Desambiguacao geometrica sobre os padroes que a extensao sozinha confunde.
  if (bestScore >= MIN_CONFIDENCE) {
    const palm = Math.max(1e-4, dist(landmarks[0], landmarks[9]));
    const imTipGap = dist(landmarks[8], landmarks[12]) / palm;  // indicador<->medio
    const tiTipGap = dist(landmarks[4], landmarks[8]) / palm;   // polegar<->indicador
    const { thumb, index, middle, ring, pinky } = extensions;

    // U vs V: indicador + medio estendidos, demais nao.
    if (index && middle && !ring && !pinky && !thumb) {
      bestLetter = imTipGap < UV_TIP_GAP ? 'U' : 'V';
    }

    // F: medio + anelar + minimo estendidos, indicador curvado encostando no polegar.
    if (!index && middle && ring && pinky && tiTipGap < TOUCH_GAP) {
      bestLetter = 'F';
    }

    // Punho: nenhum dedo longo estendido = familia A/E/S. Tratamos como A de
    // forma robusta (mesmo com o polegar de fora, que confundiria com L/Y).
    if (!index && !middle && !ring && !pinky) {
      bestLetter = 'A';
    }
  }

  return { letter: bestLetter, confidence: bestScore, extensions };
}

/** Conexoes da mao para referencias externas. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];
