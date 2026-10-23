/**
 * Métricas da página de teste da câmera (fase W0 do plano mobile web).
 * Tudo em memória e sem React: o laço de quadros grava aqui e a tela lê a cerca de 10 Hz.
 */

/** Percentil pelo método do posto mais próximo. NaN se não houver valores. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Janela do fps: 2 s dá número estável sem esconder quedas. */
const FPS_WINDOW_MS = 2000;
/** Durações guardadas para p50 e p95 (cerca de 10 s a 15 fps). */
const DURATION_SAMPLES = 150;

export class DetectionStats {
  private times: number[] = [];
  private durations: number[] = [];
  private frames = 0;
  private handFrames = 0;

  record(now: number, ms: number, hand: boolean): void {
    this.times.push(now);
    while (this.times.length > 0 && this.times[0] < now - FPS_WINDOW_MS) this.times.shift();
    this.durations.push(ms);
    if (this.durations.length > DURATION_SAMPLES) this.durations.shift();
    this.frames += 1;
    if (hand) this.handFrames += 1;
  }

  /** Detecções por segundo na janela recente. */
  fps(now: number): number {
    const recent = this.times.filter(t => t >= now - FPS_WINDOW_MS);
    if (recent.length < 2) return 0;
    const span = Math.max(now - recent[0], 1);
    return Math.min(recent.length, ((recent.length - 1) * 1000) / span);
  }

  p50(): number { return percentile(this.durations, 50); }
  p95(): number { return percentile(this.durations, 95); }
  /** Fração dos quadros em que havia mão (0 a 1). */
  handRatio(): number { return this.frames ? this.handFrames / this.frames : 0; }
  totalFrames(): number { return this.frames; }

  reset(): void {
    this.times = [];
    this.durations = [];
    this.frames = 0;
    this.handFrames = 0;
  }
}

export const ENDURANCE_MS = 10 * 60 * 1000;
/** Critério GO da W0: 10 minutos seguidos com queda de fps de até 30%. */
export const MAX_DROP = 0.3;

export interface MinuteRecord {
  /** 1 a 10. */
  minute: number;
  fps: number;
  p95: number;
  /** Minuto ainda em andamento. */
  partial: boolean;
}

/** Teste de 10 minutos: grava o fps de cada minuto para medir a queda (aquecimento, throttling). */
export class EnduranceTest {
  private startedAt: number | null = null;
  private stoppedAt: number | null = null;
  private buckets: { frames: number; durations: number[] }[] = [];
  /** Vezes em que a página foi para segundo plano no meio do teste (invalida a medida). */
  interruptions = 0;

  get running(): boolean { return this.startedAt !== null && this.stoppedAt === null; }
  get started(): boolean { return this.startedAt !== null; }

  start(now: number): void {
    this.startedAt = now;
    this.stoppedAt = null;
    this.buckets = [];
    this.interruptions = 0;
  }

  stop(now: number): void {
    if (this.running) this.stoppedAt = now;
  }

  /** Para sozinho ao completar 10 minutos. */
  record(now: number, ms: number): void {
    if (!this.running || this.startedAt === null) return;
    const elapsed = now - this.startedAt;
    if (elapsed >= ENDURANCE_MS) { this.stoppedAt = this.startedAt + ENDURANCE_MS; return; }
    const i = Math.floor(elapsed / 60000);
    while (this.buckets.length <= i) this.buckets.push({ frames: 0, durations: [] });
    this.buckets[i].frames += 1;
    this.buckets[i].durations.push(ms);
  }

  elapsed(now: number): number {
    if (this.startedAt === null) return 0;
    return Math.min(ENDURANCE_MS, (this.stoppedAt ?? now) - this.startedAt);
  }

  get completed(): boolean {
    return this.startedAt !== null && this.stoppedAt !== null && this.stoppedAt - this.startedAt >= ENDURANCE_MS;
  }

  /** Chamado pela tela: encerra no tempo certo mesmo se não chegar quadro. */
  update(now: number): void {
    if (this.running && this.startedAt !== null && now - this.startedAt >= ENDURANCE_MS) {
      this.stoppedAt = this.startedAt + ENDURANCE_MS;
    }
  }

  minutes(now: number): MinuteRecord[] {
    const elapsed = this.elapsed(now);
    return this.buckets.map((b, i) => {
      const inMinute = Math.min(60000, elapsed - i * 60000);
      return {
        minute: i + 1,
        fps: inMinute > 0 ? (b.frames * 1000) / inMinute : 0,
        p95: percentile(b.durations, 95),
        partial: inMinute < 60000,
      };
    });
  }

  /**
   * Queda do fps em relação ao primeiro minuto completo: `fim` compara o último minuto completo
   * e `pior` o minuto mais lento. Null enquanto não houver dois minutos completos.
   */
  drop(now: number): { end: number; worst: number } | null {
    const full = this.minutes(now).filter(m => !m.partial);
    if (full.length < 2 || full[0].fps <= 0) return null;
    const base = full[0].fps;
    const rest = full.slice(1);
    const last = rest[rest.length - 1].fps;
    const min = Math.min(...rest.map(m => m.fps));
    return { end: Math.max(0, (base - last) / base), worst: Math.max(0, (base - min) / base) };
  }
}
