import type { Lm } from '../../lib/recognizer';
import type { Platform } from '../../platform/device';
import { normalizeHand, NORMALIZATION_VERSION } from '../normalize';

/**
 * Uma amostra do dataset coletado no navegador (uma linha do JSONL que o
 * ml-training/train_static.py lê). Só números da mão: nunca imagem.
 */
export interface CaptureSample {
  label: string;
  person_id: string;
  platform: Platform;
  device_model: string;
  browser: string;
  normalization_version: number;
  /** Rótulo do MediaPipe ('Left'/'Right', invertido no quadro não espelhado). */
  handedness: string | null;
  /** Largura / altura do quadro. */
  aspect: number;
  /** 63 valores normalizados (normalize.ts). */
  v: number[];
  /** 63 valores brutos do MediaPipe: permitem normalizar de novo se o contrato mudar. */
  raw: number[];
  /** Quando foi gravada (ISO 8601). */
  ts: string;
  /** Agrupa as amostras de uma mesma gravação. */
  session_id: string;
  /** Versão do texto de consentimento aceito. */
  consent: string;
}

export interface CaptureMeta {
  personId: string;
  platform: Platform;
  deviceModel: string;
  browser: string;
  consent: string;
}

/** 6 casas bastam (o MediaPipe não tem mais precisão que isso) e o arquivo fica menor. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function buildSample(
  landmarks: readonly Lm[],
  ctx: { handedness: string | null; aspect: number; label: string; sessionId: string; at?: Date },
  meta: CaptureMeta,
): CaptureSample | null {
  if (landmarks.length < 21) return null;
  const raw: number[] = [];
  for (const p of landmarks.slice(0, 21)) raw.push(round(p.x), round(p.y), round(p.z));
  // Normaliza a partir dos valores já arredondados: o Python recalcula igual a partir de "raw"
  const pts = [];
  for (let i = 0; i < raw.length; i += 3) pts.push({ x: raw[i], y: raw[i + 1], z: raw[i + 2] });
  const v = normalizeHand(pts, { handedness: ctx.handedness, aspect: ctx.aspect }).map(round);
  return {
    label: ctx.label,
    person_id: meta.personId,
    platform: meta.platform,
    device_model: meta.deviceModel,
    browser: meta.browser,
    normalization_version: NORMALIZATION_VERSION,
    handedness: ctx.handedness,
    aspect: round(ctx.aspect),
    v,
    raw,
    ts: (ctx.at ?? new Date()).toISOString(),
    session_id: ctx.sessionId,
    consent: meta.consent,
  };
}

export function toJsonl(samples: readonly CaptureSample[]): string {
  return samples.map(s => JSON.stringify(s)).join('\n') + (samples.length ? '\n' : '');
}
