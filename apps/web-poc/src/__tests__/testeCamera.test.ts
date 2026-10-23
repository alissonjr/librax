import { describe, it, expect } from 'vitest';
import { DetectionStats, EnduranceTest, ENDURANCE_MS, percentile } from '../teste-camera/metrics';
import { buildSummary, fmtClock, type ReportData } from '../teste-camera/summary';
import { describeDevice } from '../platform/device';

describe('percentile', () => {
  it('usa o posto mais próximo', () => {
    const v = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile([], 50)).toBeNaN();
  });
});

describe('DetectionStats', () => {
  it('mede fps, p50, p95 e a fração com mão', () => {
    const s = new DetectionStats();
    for (let i = 0; i < 30; i++) s.record(i * (1000 / 15), i < 15 ? 10 : 30, i % 2 === 0);
    const now = 29 * (1000 / 15);
    expect(s.fps(now)).toBeCloseTo(15, 0);
    expect(s.p50()).toBe(10);
    expect(s.p95()).toBe(30);
    expect(s.handRatio()).toBeCloseTo(0.5, 1);
  });
});

describe('EnduranceTest', () => {
  it('registra o fps por minuto, mede a queda e para em 10 minutos', () => {
    const e = new EnduranceTest();
    e.start(0);
    // 15 fps nos 5 primeiros minutos, 12 fps nos 5 últimos
    for (let t = 0; t < ENDURANCE_MS; t += t < 5 * 60000 ? 1000 / 15 : 1000 / 12) e.record(t, 20);
    e.update(ENDURANCE_MS + 1);
    expect(e.running).toBe(false);
    expect(e.completed).toBe(true);
    const minutes = e.minutes(ENDURANCE_MS);
    expect(minutes).toHaveLength(10);
    expect(minutes[0].fps).toBeCloseTo(15, 0);
    expect(minutes[9].fps).toBeCloseTo(12, 0);
    const drop = e.drop(ENDURANCE_MS)!;
    expect(drop.end).toBeCloseTo(0.2, 1);
    expect(drop.worst).toBeCloseTo(0.2, 1);
  });
});

describe('describeDevice', () => {
  it('reconhece iPhone com Safari', () => {
    const d = describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
    expect(d.platform).toBe('ios');
    expect(d.summary).toBe('iPhone · iOS 17.5 · Safari 17.5');
    expect(d.embedded).toBeNull();
  });

  it('reconhece Android com modelo e Samsung Internet', () => {
    const d = describeDevice('Mozilla/5.0 (Linux; Android 13; SM-A145M Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36');
    expect(d.platform).toBe('android');
    expect(d.model).toBe('SM-A145M');
    expect(d.browser).toBe('Samsung Internet 26');
  });

  it('não inventa modelo no UA reduzido do Chrome', () => {
    const d = describeDevice('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
    expect(d.model).toBe('');
    expect(d.summary).toBe('Android 10 · Chrome 130');
  });

  it('marca navegador embutido do Instagram', () => {
    const d = describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0');
    expect(d.embedded).toBe('Instagram');
  });
});

describe('buildSummary', () => {
  it('gera o texto para colar na conversa', () => {
    const data: ReportData = {
      at: new Date(2026, 9, 23, 10, 0),
      device: describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
      userAgent: 'UA',
      secure: true,
      delegate: 'GPU',
      loop: 'requestVideoFrameCallback',
      camera: { width: 640, height: 480, fps: 30 },
      fps: 14.9,
      p50: 18,
      p95: 31,
      handRatio: 0.9,
      frames: 300,
      cold: {
        kind: 'cold', requested: 'GPU', delegate: 'GPU', importMs: 120, createMs: 3100,
        wasm: { ms: 2300, source: 'rede', kb: 13200 }, model: { ms: 900, source: 'rede', kb: 7636 },
        firstDetectMs: 250, readyMs: 3500,
      },
      warm: null,
      memory: { usedMB: null, deviceGB: null },
      wakeLock: 'active',
      endurance: { state: 'idle', elapsedMs: 0, minutes: [], drop: null, interruptions: 0 },
    };
    const text = buildSummary(data);
    expect(text).toContain('iPhone · iOS 17.5 · Safari 17.5');
    expect(text).toContain('Detecção: 14,9 fps | p50 18 ms | p95 31 ms');
    expect(text).toContain('Carga a frio (GPU): JS 120 ms, WASM 2.300 ms (rede, 13.200 KB)');
    expect(text).toContain('Wake Lock: obtido');
    expect(text).toContain('Memória: não exposta pelo navegador');
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it('formata o cronômetro', () => {
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(ENDURANCE_MS)).toBe('10:00');
  });
});
