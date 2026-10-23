import { describe, it, expect, afterEach } from 'vitest';
import golden from '../recognition/__fixtures__/paridade/golden.json';
import { buildSample, toJsonl, type CaptureMeta } from '../recognition/capture/sample';
import { addSamples, allSamples, clearSamples, closeCaptureDbForTests, countByLabel, deleteSession } from '../recognition/capture/store';
import { exportFileName } from '../recognition/capture/export';
import { NORMALIZATION_VERSION, normalizeHand } from '../recognition/normalize';

const meta: CaptureMeta = {
  personId: 'p07',
  platform: 'ios',
  deviceModel: 'iPhone 12',
  browser: 'Safari 17.5',
  consent: 'coleta-v1',
};

const raw = golden.cases[0].raw;
const hand = Array.from({ length: 21 }, (_, i) => ({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] }));

function sample(label: string, sessionId: string) {
  return buildSample(hand, { handedness: 'Right', aspect: 4 / 3, label, sessionId }, meta)!;
}

afterEach(async () => {
  await clearSamples();
  await closeCaptureDbForTests();
});

describe('amostra da coleta', () => {
  it('tem os campos do dataset e só números da mão', () => {
    const s = sample('A', 's1');
    expect(s).toMatchObject({
      label: 'A',
      person_id: 'p07',
      platform: 'ios',
      device_model: 'iPhone 12',
      browser: 'Safari 17.5',
      normalization_version: NORMALIZATION_VERSION,
      handedness: 'Right',
      session_id: 's1',
      consent: 'coleta-v1',
    });
    expect(s.v).toHaveLength(63);
    expect(s.raw).toHaveLength(63);
    expect(Object.keys(s).sort()).toEqual([
      'aspect', 'browser', 'consent', 'device_model', 'handedness', 'label', 'normalization_version',
      'person_id', 'platform', 'raw', 'session_id', 'ts', 'v',
    ]);
  });

  it('o vetor normalizado é o mesmo que o app calcula na hora de classificar', () => {
    const s = sample('B', 's1');
    const again = normalizeHand(
      Array.from({ length: 21 }, (_, i) => ({ x: s.raw[i * 3], y: s.raw[i * 3 + 1], z: s.raw[i * 3 + 2] })),
      { handedness: 'Right', aspect: 4 / 3 },
    );
    again.forEach((v, i) => expect(s.v[i]).toBeCloseTo(v, 5));
  });

  it('recusa mão incompleta', () => {
    expect(buildSample(hand.slice(0, 5), { handedness: null, aspect: 1, label: 'A', sessionId: 's' }, meta)).toBeNull();
  });

  it('JSONL tem uma amostra por linha', () => {
    const text = toJsonl([sample('A', 's1'), sample('L', 's1')]);
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).label).toBe('L');
  });

  it('nome do arquivo não carrega caracteres estranhos do código', () => {
    expect(exportFileName('p07/../x', new Date('2026-10-23T14:05:00Z'))).toBe('librax-coleta-p07x-202610231405.jsonl');
  });
});

describe('armazenamento da coleta (IndexedDB)', () => {
  it('guarda, conta por letra, desfaz uma gravação e apaga tudo', async () => {
    await addSamples([sample('A', 's1'), sample('A', 's1'), sample('B', 's2')]);
    expect(await countByLabel()).toEqual({ A: 2, B: 1 });

    await deleteSession('s1');
    expect(await countByLabel()).toEqual({ B: 1 });
    expect((await allSamples())[0].label).toBe('B');

    await clearSamples();
    expect(await allSamples()).toEqual([]);
  });
});
