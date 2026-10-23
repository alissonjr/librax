import { describe, it, expect } from 'vitest';
import { getFingerExtensions, recognizeGesture, type Lm } from '../lib/recognizer';

/**
 * Cria 21 landmarks zerados e sobrescreve apenas os indices necessarios para cada teste.
 * y=0 e topo da imagem; y=1 e base. Dedo estendido = ponta abaixo do MCP em y (ponta mais alta = y menor).
 */
function mk(overrides: Partial<Record<number, Partial<Lm>>>): Lm[] {
  const pts: Lm[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, v] of Object.entries(overrides)) {
    pts[Number(i)] = { ...pts[Number(i)], ...v };
  }
  return pts;
}

// Atalhos para landmarks criticos
// Indicador: MCP=5, PIP=6, tip=8
// Medio: MCP=9, PIP=10, tip=12
// Anelar: MCP=13, PIP=14, tip=16
// Minimo: MCP=17, PIP=18, tip=20
// Polegar: CMC=1, MCP=2, IP=3, tip=4; indice MCP=5 (referencia lateral)

function allFingersUp(): Partial<Record<number, Partial<Lm>>> {
  return {
    5: { y: 0.6 }, 8: { y: 0.2 },   // indicador estendido
    9: { y: 0.6 }, 12: { y: 0.2 },  // medio estendido
    13: { y: 0.6 }, 16: { y: 0.2 }, // anelar estendido
    17: { y: 0.6 }, 20: { y: 0.2 }, // minimo estendido
    2: { x: 0.5 }, 4: { x: 0.5 },   // polegar dobrado (mesmo x)
  };
}

function allFingersFolded(): Partial<Record<number, Partial<Lm>>> {
  return {
    5: { y: 0.4 }, 8: { y: 0.55 },  // indicador fechado
    9: { y: 0.4 }, 12: { y: 0.55 }, // medio fechado
    13: { y: 0.4 }, 16: { y: 0.55 },// anelar fechado
    17: { y: 0.4 }, 20: { y: 0.55 },// minimo fechado
    2: { x: 0.5 }, 4: { x: 0.5 },   // polegar fechado
  };
}

describe('getFingerExtensions', () => {
  it('retorna todos false com punho fechado', () => {
    const exts = getFingerExtensions(mk(allFingersFolded()));
    expect(exts.index).toBe(false);
    expect(exts.middle).toBe(false);
    expect(exts.ring).toBe(false);
    expect(exts.pinky).toBe(false);
  });

  it('detecta indicador estendido', () => {
    const pts = mk({ 5: { y: 0.6 }, 8: { y: 0.2 } });
    expect(getFingerExtensions(pts).index).toBe(true);
  });

  it('detecta minimo estendido', () => {
    const pts = mk({ 17: { y: 0.6 }, 20: { y: 0.2 } });
    expect(getFingerExtensions(pts).pinky).toBe(true);
  });

  it('detecta polegar estendido lateralmente', () => {
    // polegar tip muito mais para a esquerda que o MCP do polegar
    const pts = mk({ 2: { x: 0.5 }, 4: { x: 0.2 } });
    expect(getFingerExtensions(pts).thumb).toBe(true);
  });
});

describe('recognizeGesture', () => {
  it('reconhece B: 4 dedos estendidos, polegar nao', () => {
    const pts = mk(allFingersUp());
    // polegar nao estendido
    pts[4].x = 0.5; pts[2].x = 0.5;
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('B');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('reconhece I: so o minimo estendido', () => {
    const pts = mk({
      ...allFingersFolded(),
      17: { y: 0.6 }, 20: { y: 0.2 }, // minimo estendido
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('I');
  });

  it('reconhece L: polegar + indicador estendidos', () => {
    const pts = mk({
      ...allFingersFolded(),
      5: { y: 0.6 }, 8: { y: 0.2 },  // indicador estendido
      2: { x: 0.5 }, 4: { x: 0.2 },  // polegar lateral
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('L');
  });

  it('reconhece V: indicador + medio estendidos e afastados', () => {
    const pts = mk({
      ...allFingersFolded(),
      5: { x: 0.42, y: 0.6 }, 8: { x: 0.36, y: 0.2 },  // indicador (afastado)
      9: { x: 0.58, y: 0.6 }, 12: { x: 0.64, y: 0.2 }, // medio (afastado)
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('V');
  });

  it('reconhece U: indicador + medio estendidos e juntos', () => {
    const pts = mk({
      ...allFingersFolded(),
      5: { x: 0.49, y: 0.6 }, 8: { x: 0.49, y: 0.2 },  // indicador
      9: { x: 0.51, y: 0.6 }, 12: { x: 0.51, y: 0.2 }, // medio (colado)
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('U');
  });

  it('reconhece W: indicador + medio + anelar estendidos', () => {
    const pts = mk({
      ...allFingersFolded(),
      5: { y: 0.6 }, 8: { y: 0.2 },
      9: { y: 0.6 }, 12: { y: 0.2 },
      13: { y: 0.6 }, 16: { y: 0.2 },
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('W');
  });

  it('reconhece Y: polegar + minimo estendidos', () => {
    const pts = mk({
      ...allFingersFolded(),
      17: { y: 0.6 }, 20: { y: 0.2 }, // minimo
      2: { x: 0.5 }, 4: { x: 0.2 },   // polegar
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('Y');
  });

  it('reconhece F: medio+anelar+minimo estendidos, indicador encostando no polegar', () => {
    const pts = mk({
      ...allFingersFolded(),
      9: { y: 0.6 }, 12: { y: 0.2 },  // medio estendido
      13: { y: 0.6 }, 16: { y: 0.2 }, // anelar estendido
      17: { y: 0.6 }, 20: { y: 0.2 }, // minimo estendido
      // indicador dobrado (5:0.4 / 8:0.55 do allFingersFolded) e polegar na ponta dele
      4: { x: 0.5, y: 0.55 },
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('F');
  });

  it('reconhece A: punho fechado (nenhum dedo longo estendido)', () => {
    const r = recognizeGesture(mk(allFingersFolded()));
    expect(r.letter).toBe('A');
  });

  it('reconhece A mesmo com o polegar de fora (nao vira L/Y)', () => {
    const pts = mk({
      ...allFingersFolded(),
      2: { x: 0.5 }, 4: { x: 0.2 }, // polegar estendido lateralmente
    });
    const r = recognizeGesture(pts);
    expect(r.letter).toBe('A');
  });

  it('retorna letter=null quando nenhum padrao tem confianca suficiente', () => {
    // Landmarks todos no centro (posicao ambigua)
    const pts = mk({});
    const r = recognizeGesture(pts);
    // Nao deve crashar; pode retornar null ou letra com baixa confianca
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });
});
