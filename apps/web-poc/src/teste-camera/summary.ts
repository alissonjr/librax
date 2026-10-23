import type { Delegate } from '../recognition/landmarker';
import type { DeviceInfo } from '../platform/device';
import type { WakeLockStatus } from '../platform/wakeLock';
import { ENDURANCE_MS, MAX_DROP, type MinuteRecord } from './metrics';

/** De onde veio um arquivo (Resource Timing). */
export type ResourceSource = 'rede' | 'cache HTTP' | 'service worker' | 'n/d';

export interface ResourceLoad {
  ms: number;
  source: ResourceSource;
  /** Bytes trafegados em KB; null quando o navegador não informa. */
  kb: number | null;
}

export interface LoadRecord {
  kind: 'cold' | 'warm';
  requested: Delegate;
  delegate: Delegate;
  importMs: number;
  createMs: number;
  wasm: ResourceLoad | null;
  model: ResourceLoad | null;
  /** Duração da primeira detecção (inclui compilar shaders na GPU). */
  firstDetectMs: number | null;
  /** Do início da carga até o primeiro resultado. */
  readyMs: number | null;
  gpuError?: string;
}

export interface ReportData {
  at: Date;
  device: DeviceInfo;
  userAgent: string;
  secure: boolean;
  delegate: Delegate | null;
  loop: 'requestVideoFrameCallback' | 'requestAnimationFrame' | null;
  camera: { width: number; height: number; fps: number | null } | null;
  fps: number;
  p50: number;
  p95: number;
  handRatio: number;
  frames: number;
  cold: LoadRecord | null;
  warm: LoadRecord | null;
  memory: { usedMB: number | null; deviceGB: number | null };
  wakeLock: WakeLockStatus;
  endurance: {
    state: 'idle' | 'running' | 'done' | 'stopped';
    elapsedMs: number;
    minutes: MinuteRecord[];
    drop: { end: number; worst: number } | null;
    interruptions: number;
  };
}

export const WAKE_LOCK_LABEL: Record<WakeLockStatus, string> = {
  active: 'obtido',
  pending: 'pedindo',
  denied: 'negado',
  released: 'solto pelo sistema',
  unsupported: 'sem suporte',
};

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function fmt1(n: number): string { return Number.isFinite(n) ? nf1.format(n) : '-'; }
export function fmtMs(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '-' : `${nf0.format(n)} ms`;
}
export function fmtPct(n: number): string { return `${nf0.format(n * 100)}%`; }
export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function resource(r: ResourceLoad | null): string {
  if (!r) return '-';
  const size = r.kb !== null && r.kb > 0 ? `, ${nf0.format(r.kb)} KB` : '';
  return `${fmtMs(r.ms)} (${r.source}${size})`;
}

function loadLine(label: string, l: LoadRecord | null): string {
  if (!l) return `${label}: não medida`;
  const parts = [
    `JS ${fmtMs(l.importMs)}`,
    `WASM ${resource(l.wasm)}`,
    `modelo ${resource(l.model)}`,
    `init ${fmtMs(l.createMs)}`,
    `1ª detecção ${fmtMs(l.firstDetectMs)}`,
    `pronto em ${fmtMs(l.readyMs)}`,
  ];
  const gpu = l.gpuError ? ` | GPU falhou, caiu para CPU: ${l.gpuError}` : '';
  return `${label} (${l.delegate}): ${parts.join(', ')}${gpu}`;
}

function enduranceLines(e: ReportData['endurance']): string[] {
  if (e.state === 'idle') return ['Teste de 10 min: não iniciado'];
  const state = { running: 'em andamento', done: 'concluído', stopped: 'parado antes do fim' }[e.state];
  const lines = [`Teste de 10 min: ${state} (${fmtClock(e.elapsedMs)} de ${fmtClock(ENDURANCE_MS)})`];
  if (e.minutes.length) {
    lines.push(`  fps por minuto: ${e.minutes.map(m => `${m.minute}: ${fmt1(m.fps)}${m.partial ? '*' : ''}`).join(' | ')}`);
  }
  if (e.drop) {
    const ok = e.drop.worst <= MAX_DROP ? 'dentro' : 'ACIMA';
    lines.push(`  queda vs 1º minuto: no fim ${fmtPct(e.drop.end)}, pior minuto ${fmtPct(e.drop.worst)} (${ok} do limite de ${fmtPct(MAX_DROP)})`);
  }
  if (e.interruptions) lines.push(`  atenção: a página foi para segundo plano ${e.interruptions} vez(es) durante o teste`);
  return lines;
}

/** Resumo em texto para o dono colar na conversa. */
export function buildSummary(d: ReportData): string {
  const cam = d.camera
    ? `${d.camera.width}x${d.camera.height}${d.camera.fps ? ` a ${nf0.format(d.camera.fps)} fps` : ''}`
    : 'não aberta';
  const memory = [
    d.memory.usedMB !== null ? `heap JS ${nf0.format(d.memory.usedMB)} MB` : null,
    d.memory.deviceGB !== null ? `aparelho ${d.memory.deviceGB} GB` : null,
  ].filter(Boolean).join(', ') || 'não exposta pelo navegador';

  return [
    'Librax W0 - teste da câmera',
    `Data: ${d.at.toLocaleString('pt-BR')}`,
    `Aparelho: ${d.device.summary || 'desconhecido'}${d.device.embedded ? ' (navegador embutido!)' : ''}`,
    `HTTPS: ${d.secure ? 'sim' : 'NÃO (a câmera não abre)'}`,
    `Câmera: ${cam}`,
    `Delegate: ${d.delegate ?? '-'} | laço: ${d.loop ?? '-'}`,
    `Detecção: ${fmt1(d.fps)} fps | p50 ${fmtMs(d.p50)} | p95 ${fmtMs(d.p95)} | mão em ${fmtPct(d.handRatio)} de ${d.frames} quadros`,
    loadLine('Carga a frio', d.cold),
    loadLine('Carga a quente', d.warm),
    `Memória: ${memory}`,
    `Wake Lock: ${WAKE_LOCK_LABEL[d.wakeLock]}`,
    ...enduranceLines(d.endurance),
    `UA: ${d.userAgent}`,
  ].join('\n');
}
