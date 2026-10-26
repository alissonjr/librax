import { describe, it, expect } from 'vitest';
import {
  FREE_START, HINT_MS, MAX_TEXT, MOTION_REPEAT_MS, RELEASE_MS, REPLACE_MS, SPACE_MS, STATIC_HOLD_MS,
  freeAddSpace, freeClear, freeDeleteLast, freeResetReading, freeStep,
  type FreeConfig, type FreeState, type FreeTick,
} from '../lib/freeSpell';

const LETRAS: FreeConfig = {
  staticLetters: new Set(['A', 'B', 'C', 'I', 'O', 'S', 'H', 'K', 'X']),
  motionLetters: new Set(['H', 'J', 'K', 'X', 'Ç']),
};
const LETRAS_SEM_MOVIMENTO: FreeConfig = { staticLetters: LETRAS.staticLetters, motionLetters: new Set() };
const NUMEROS: FreeConfig = { staticLetters: new Set(['0', '2', '3', '8', '9']), motionLetters: new Set() };

const FRAME = 66; // cerca de 15 quadros por segundo

/** Simulação: segue a leitura por `ms`, um quadro a cada FRAME ms. */
class Sim {
  state: FreeState = FREE_START;
  t = 0;
  constructor(public config: FreeConfig) {}

  run(ms: number, reading: Partial<FreeTick>) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += FRAME;
      this.state = freeStep(this.state, {
        t: this.t, handPresent: true, staticLetter: null, staticConfidence: 0, motionLetter: null, moving: false,
        ...reading,
      }, this.config);
    }
    return this;
  }

  hold(letter: string | null, ms = STATIC_HOLD_MS + 200) {
    return this.run(ms, { staticLetter: letter, staticConfidence: letter ? 0.9 : 0 });
  }

  pause(ms = RELEASE_MS + 150) {
    return this.hold(null, ms);
  }

  away(ms: number) {
    return this.run(ms, { handPresent: false });
  }

  get text() {
    return this.state.text;
  }
}

describe('freeStep: letras paradas', () => {
  it('a letra entra depois de ficar parada STATIC_HOLD_MS, não antes', () => {
    const sim = new Sim(LETRAS).hold('A', STATIC_HOLD_MS - 100);
    expect(sim.text).toBe('');
    sim.hold('A', 200);
    expect(sim.text).toBe('A');
    expect(sim.state.lastEvent).toMatchObject({ kind: 'add', char: 'A' });
  });

  it('segurar a mesma letra não repete; letra diferente entra direto', () => {
    const sim = new Sim(LETRAS).hold('A', 3000);
    expect(sim.text).toBe('A');
    sim.hold('B');
    expect(sim.text).toBe('AB');
  });

  it('letra repetida precisa soltar (pausa) entre as duas: OSSO', () => {
    const sim = new Sim(LETRAS).hold('O').hold('S').hold('S');
    expect(sim.text).toBe('OS');
    sim.pause().hold('S').hold('O');
    expect(sim.text).toBe('OSSO');
  });

  it('um quadro perdido (sem leitura ou sem mão) não solta a letra', () => {
    const sim = new Sim(LETRAS).hold('A');
    sim.run(FRAME, { staticLetter: null });
    sim.hold('A');
    sim.away(FRAME);
    sim.hold('A');
    expect(sim.text).toBe('A');
  });

  it('com a mão se mexendo a letra parada não entra', () => {
    const sim = new Sim(LETRAS).run(2000, { staticLetter: 'A', staticConfidence: 0.9, moving: true });
    expect(sim.text).toBe('');
    sim.hold('A');
    expect(sim.text).toBe('A');
  });

  it('letra fora das aceitas não escreve', () => {
    const sim = new Sim(LETRAS).hold('Q', 2000);
    expect(sim.text).toBe('');
    expect(sim.state.current?.letter).toBe('Q');
  });
});

describe('freeStep: letras com movimento', () => {
  it('a forma parada do H, do K ou do X não escreve quando há o modelo de movimento', () => {
    const sim = new Sim(LETRAS).hold('H', 2000);
    expect(sim.text).toBe('');
  });

  it('sem o modelo de movimento, H parado vale pelo estático', () => {
    const sim = new Sim(LETRAS_SEM_MOVIMENTO).hold('H');
    expect(sim.text).toBe('H');
  });

  it('o movimento confirmado escreve a letra, uma vez só enquanto a confirmação segue', () => {
    const sim = new Sim(LETRAS).run(1500, { motionLetter: 'J', moving: true });
    expect(sim.text).toBe('J');
    expect(sim.state.lastEvent).toMatchObject({ kind: 'add', char: 'J' });
  });

  it('confirmação que some e volta logo é o mesmo movimento', () => {
    const sim = new Sim(LETRAS).run(300, { motionLetter: 'J', moving: true });
    sim.run(250, { moving: true });
    sim.run(300, { motionLetter: 'J', moving: true });
    expect(sim.text).toBe('J');
  });

  it('o mesmo movimento de novo, passado MOTION_REPEAT_MS, escreve de novo', () => {
    const sim = new Sim(LETRAS).run(300, { motionLetter: 'J', moving: true });
    sim.run(MOTION_REPEAT_MS, { moving: false });
    sim.run(300, { motionLetter: 'J', moving: true });
    expect(sim.text).toBe('JJ');
  });

  it('letra parada que era o começo do movimento (I antes do J) é trocada', () => {
    const sim = new Sim(LETRAS).hold('I');
    expect(sim.text).toBe('I');
    sim.run(500, { staticLetter: 'I', staticConfidence: 0.8, motionLetter: 'J', moving: true });
    expect(sim.text).toBe('J');
    expect(sim.state.lastEvent).toMatchObject({ kind: 'replace', char: 'J' });
  });

  it('movimento bem depois da letra parada não troca: soma', () => {
    const sim = new Sim(LETRAS).hold('C');
    sim.hold('C', REPLACE_MS + 200);
    sim.run(300, { motionLetter: 'Ç', moving: true });
    expect(sim.text).toBe('CÇ');
  });

  it('depois do movimento, a forma em que ele termina não vira letra parada até uma pausa', () => {
    const sim = new Sim(LETRAS).run(400, { staticLetter: 'I', staticConfidence: 0.8, motionLetter: 'J', moving: true });
    sim.hold('I', 3000);
    expect(sim.text).toBe('J');
    sim.pause().hold('A');
    expect(sim.text).toBe('JA');
  });
});

describe('freeStep: espaço', () => {
  it('mão fora por SPACE_MS põe um espaço, uma vez por saída', () => {
    const sim = new Sim(LETRAS).hold('O').away(SPACE_MS - 200);
    expect(sim.text).toBe('O');
    sim.away(400);
    expect(sim.text).toBe('O ');
    expect(sim.state.lastEvent).toMatchObject({ kind: 'space' });
    sim.away(5000);
    expect(sim.text).toBe('O ');
  });

  it('nunca espaço no começo nem dois seguidos', () => {
    const sim = new Sim(LETRAS).away(3000);
    expect(sim.text).toBe('');
    sim.hold('A').away(2000).pause().away(2000);
    expect(sim.text).toBe('A ');
  });

  it('a saída da mão solta a letra: a mesma letra vale de novo', () => {
    const sim = new Sim(LETRAS).hold('A').away(RELEASE_MS + 100).hold('A');
    expect(sim.text).toBe('AA');
  });
});

describe('freeStep: dica', () => {
  it('mão no quadro sem nenhuma letra por HINT_MS mostra a dica de segurar parado', () => {
    const sim = new Sim(LETRAS).run(HINT_MS - 300, { moving: true, staticLetter: 'A', staticConfidence: 0.5 });
    expect(sim.state.hint).toBeNull();
    sim.run(500, { moving: true, staticLetter: 'A', staticConfidence: 0.5 });
    expect(sim.state.hint).toBe('hold');
    sim.hold('A');
    expect(sim.state.hint).toBeNull();
  });

  it('forma parada de letra com movimento pede o movimento', () => {
    const sim = new Sim(LETRAS).hold('K', HINT_MS + 200);
    expect(sim.state.hint).toBe('motion');
    expect(sim.state.hintLetter).toBe('K');
  });

  it('segurar a letra que acabou de entrar sugere soltar', () => {
    const sim = new Sim(LETRAS).hold('A').hold('A', HINT_MS + 200);
    expect(sim.state.hint).toBe('release');
  });

  it('a mão fora some com a dica', () => {
    const sim = new Sim(LETRAS).run(HINT_MS + 200, { moving: true });
    expect(sim.state.hint).toBe('hold');
    sim.away(FRAME);
    expect(sim.state.hint).toBeNull();
  });
});

describe('edição e troca de modo', () => {
  it('apagar tira o último caractere; a letra ainda na mão não volta sozinha', () => {
    const sim = new Sim(LETRAS).hold('O').hold('I');
    sim.state = freeDeleteLast(sim.state);
    expect(sim.text).toBe('O');
    sim.hold('I', 2000);
    expect(sim.text).toBe('O');
    sim.pause().hold('I');
    expect(sim.text).toBe('OI');
  });

  it('apagar não deixa o movimento trocar a letra errada', () => {
    const sim = new Sim(LETRAS).hold('A').hold('I');
    sim.state = freeDeleteLast(sim.state);
    sim.run(300, { motionLetter: 'J', moving: true });
    expect(sim.text).toBe('AJ');
  });

  it('limpar esvazia; espaço pelo botão segue a mesma regra do gesto', () => {
    let s = new Sim(LETRAS).hold('A').state;
    s = freeAddSpace(s);
    expect(s.text).toBe('A ');
    expect(freeAddSpace(s).text).toBe('A ');
    expect(freeAddSpace(FREE_START)).toBe(FREE_START);
    s = freeClear(s);
    expect(s.text).toBe('');
    expect(freeDeleteLast(s)).toBe(s);
  });

  it('apagar trata o Ç como um caractere só', () => {
    const sim = new Sim(LETRAS).run(300, { motionLetter: 'Ç', moving: true });
    expect(freeDeleteLast(sim.state).text).toBe('');
  });

  it('trocar de modo mantém o texto e recomeça a leitura', () => {
    const sim = new Sim(LETRAS).hold('R').hold('A');
    sim.state = freeResetReading(sim.state);
    expect(sim.text).toBe('A');
    expect(sim.state.release).toBeNull();
    expect(sim.state.current).toBeNull();
  });

  it('no modo números: o O das letras não existe, o 0 entra; letras do outro modo não escrevem', () => {
    const sim = new Sim(LETRAS).hold('O').away(SPACE_MS + 100);
    sim.config = NUMEROS;
    sim.state = freeResetReading(sim.state);
    sim.hold('0').hold('8').hold('S');
    expect(sim.text).toBe('O 08');
  });

  it('o texto para em MAX_TEXT', () => {
    let s: FreeState = { ...FREE_START, text: 'A'.repeat(MAX_TEXT) };
    s = freeAddSpace(s);
    expect(s.text.length).toBe(MAX_TEXT);
    const sim = new Sim(LETRAS);
    sim.state = s;
    sim.hold('B');
    expect(sim.text.length).toBe(MAX_TEXT);
  });
});
