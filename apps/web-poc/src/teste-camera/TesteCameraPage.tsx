import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { drawSkeleton } from '../lib/cameraUtils';
import type { Lm } from '../lib/recognizer';
import {
  detectHands, getHandLandmarker, peekHandLandmarker, recreateHandLandmarker,
  type Delegate, type LandmarkerHandle,
} from '../recognition/landmarker';
import { startFrameLoop, supportsVideoFrameCallback } from '../recognition/frameLoop';
import { describeDevice, describeDeviceDetailed, type DeviceInfo } from '../platform/device';
import { keepScreenOn, type WakeLockHandle, type WakeLockStatus } from '../platform/wakeLock';
import { DetectionStats, EnduranceTest, ENDURANCE_MS, MAX_DROP } from './metrics';
import { enlargeResourceBuffer, findResource } from './resources';
import {
  buildSummary, fmt1, fmtClock, fmtMs, fmtPct, WAKE_LOCK_LABEL,
  type LoadRecord, type ReportData,
} from './summary';

type Phase = 'idle' | 'loading' | 'running' | 'switching' | 'denied' | 'error';

/** A tela lê as métricas a 10 Hz; o laço de quadros não dispara render. */
const UI_INTERVAL_MS = 100;

interface PerfWithMemory extends Performance {
  memory?: { usedJSHeapSize: number };
}

function readMemory() {
  const used = (performance as PerfWithMemory).memory?.usedJSHeapSize;
  const device = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    usedMB: typeof used === 'number' ? used / (1024 * 1024) : null,
    deviceGB: typeof device === 'number' ? device : null,
  };
}

function toLoadRecord(handle: LandmarkerHandle): LoadRecord {
  const { load } = handle;
  return {
    kind: load.kind,
    requested: load.requested,
    delegate: load.delegate,
    importMs: load.importMs,
    createMs: load.createMs,
    wasm: findResource(/\/wasm\/vision_wasm[a-z_]*\.wasm$/, load.startedAt),
    model: findResource(/hand_landmarker\.task$/, load.startedAt),
    firstDetectMs: null,
    readyMs: null,
    gpuError: load.gpuError,
  };
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sem permissão da Clipboard API: cai para a seleção de um textarea
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function TesteCameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  const statsRef = useRef(new DetectionStats());
  const enduranceRef = useRef(new EnduranceTest());
  /** Carga em andamento esperando o primeiro resultado. */
  const pendingLoadRef = useRef<LoadRecord | null>(null);
  const loadStartRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [delegate, setDelegate] = useState<Delegate | null>(null);
  const [cold, setCold] = useState<LoadRecord | null>(null);
  const [warm, setWarm] = useState<LoadRecord | null>(null);
  const [wakeLock, setWakeLock] = useState<WakeLockStatus>('pending');
  const [device, setDevice] = useState<DeviceInfo>(() => describeDevice());
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [, setTick] = useState(0);

  const secure = typeof window !== 'undefined' ? window.isSecureContext : true;
  const loopKind = useMemo(
    () => (typeof document !== 'undefined' && supportsVideoFrameCallback(document.createElement('video'))
      ? 'requestVideoFrameCallback' as const
      : 'requestAnimationFrame' as const),
    [],
  );

  useEffect(() => {
    enlargeResourceBuffer();
    describeDeviceDetailed().then(setDevice);
  }, []);

  // Atualização da tela a 10 Hz enquanto a câmera roda
  useEffect(() => {
    if (phase !== 'running' && phase !== 'switching') return;
    const id = window.setInterval(() => {
      enduranceRef.current.update(performance.now());
      setTick(t => t + 1);
    }, UI_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  // Segundo plano no meio do teste de 10 minutos invalida a medida: fica registrado
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && enduranceRef.current.running) {
        enduranceRef.current.interruptions += 1;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const finishLoad = useCallback((record: LoadRecord) => {
    if (record.kind === 'cold') setCold({ ...record });
    else setWarm({ ...record });
  }, []);

  const onFrame = useCallback((now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const handle = peekHandLandmarker();
    if (!video || !canvas || !handle || video.readyState < 2) return;

    if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const { result, ms } = detectHands(handle, video);
    const pending = pendingLoadRef.current;
    if (pending) {
      pending.firstDetectMs = ms;
      pending.readyMs = performance.now() - loadStartRef.current;
      pendingLoadRef.current = null;
      finishLoad(pending);
    }

    const hand = result.landmarks.length > 0;
    statsRef.current.record(now, ms, hand);
    enduranceRef.current.record(now, ms);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (hand) drawSkeleton(ctx, result.landmarks[0] as Lm[], canvas.width, canvas.height, 0, 'tracking');
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [finishLoad]);

  const startLoop = useCallback(() => {
    stopLoopRef.current?.();
    if (videoRef.current) stopLoopRef.current = startFrameLoop(videoRef.current, onFrame, { maxFps: 15 });
  }, [onFrame]);

  const start = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    loadStartRef.current = performance.now();
    try {
      // Na página de teste modelo e câmera carregam juntos; o tempo de cada um é medido à parte
      const [handle, stream] = await Promise.all([
        getHandLandmarker(),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        }),
      ]);
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try { await video.play(); } catch (err) { if (!isAbortError(err)) throw err; }
      }
      setDelegate(handle.delegate);
      pendingLoadRef.current = toLoadRecord(handle);
      wakeRef.current?.release();
      wakeRef.current = keepScreenOn(setWakeLock);
      statsRef.current.reset();
      setPhase('running');
      startLoop();
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'NotAllowedError') {
        setPhase('denied');
      } else {
        setErrorMsg(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        setPhase('error');
      }
    }
  }, [startLoop]);

  const reload = useCallback(async (next: Delegate) => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    setPhase('switching');
    loadStartRef.current = performance.now();
    try {
      const handle = await recreateHandLandmarker(next);
      setDelegate(handle.delegate);
      pendingLoadRef.current = toLoadRecord(handle);
      statsRef.current.reset();
      setPhase('running');
      startLoop();
    } catch (err) {
      setErrorMsg(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      setPhase('error');
    }
  }, [startLoop]);

  // Desmontou: solta câmera, laço e Wake Lock (o landmarker fica, é da sessão)
  useEffect(() => () => {
    stopLoopRef.current?.();
    streamRef.current?.getTracks().forEach(t => t.stop());
    wakeRef.current?.release();
  }, []);

  const now = performance.now();
  const stats = statsRef.current;
  const endurance = enduranceRef.current;
  const video = videoRef.current;
  const track = streamRef.current?.getVideoTracks()[0];
  const trackFps = track?.getSettings?.().frameRate ?? null;
  const camera = video && video.videoWidth > 0
    ? { width: video.videoWidth, height: video.videoHeight, fps: trackFps ?? null }
    : null;
  const fps = stats.fps(now);
  const memory = readMemory();
  const minutes = endurance.minutes(now);
  const drop = endurance.drop(now);
  const enduranceState: ReportData['endurance']['state'] = !endurance.started
    ? 'idle' : endurance.running ? 'running' : endurance.completed ? 'done' : 'stopped';

  const report = (): ReportData => ({
    at: new Date(),
    device,
    userAgent: navigator.userAgent,
    secure,
    delegate,
    loop: phase === 'idle' ? null : loopKind,
    camera,
    fps,
    p50: stats.p50(),
    p95: stats.p95(),
    handRatio: stats.handRatio(),
    frames: stats.totalFrames(),
    cold,
    warm,
    memory,
    wakeLock: phase === 'idle' ? 'pending' : wakeLock,
    endurance: {
      state: enduranceState,
      elapsedMs: endurance.elapsed(now),
      minutes,
      drop,
      interruptions: endurance.interruptions,
    },
  });

  async function onCopy() {
    const text = buildSummary(report());
    setSummaryText(text);
    const ok = await copyText(text);
    setCopied(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopied(null), 2500);
  }

  function toggleEndurance() {
    const t = performance.now();
    if (endurance.running) endurance.stop(t);
    else endurance.start(t);
    setTick(n => n + 1);
  }

  const active = phase === 'running' || phase === 'switching';
  const otherDelegate: Delegate = delegate === 'GPU' ? 'CPU' : 'GPU';
  const fpsLevel = fps >= 14 ? 'ok' : fps >= 10 ? 'warn' : 'bad';

  return (
    <div className="tc-page">
      <header className="tc-header">
        <h1 className="tc-title">Teste da câmera</h1>
        <p className="tc-subtitle">Mede se este celular aguenta o reconhecimento. Nada é gravado nem enviado.</p>
      </header>

      {!secure && (
        <p className="tc-banner tc-banner--warn" role="alert">
          <Icon name="warning" filled /> Esta página não está em HTTPS, então o navegador não libera a câmera.
          Abra pelo endereço https mostrado pelo <code>npm run dev:celular</code>.
        </p>
      )}
      {device.embedded && (
        <p className="tc-banner tc-banner--warn" role="alert">
          <Icon name="warning" filled /> Aberto dentro do {device.embedded}. Toque nos três pontos e escolha
          abrir no Safari ou no Chrome.
        </p>
      )}

      <section className="tc-stage" aria-label="Câmera">
        {/* O vídeo nunca começa com display:none (o iPhone pode não tocar): fica sob o aviso */}
        <video ref={videoRef} className="tc-video" playsInline muted aria-label="Imagem da câmera frontal" />
        <canvas ref={canvasRef} className="tc-canvas" aria-hidden="true" />

        {active && (
          <div className="tc-hud" aria-live="off">
            <span className={`tc-pill tc-pill--${fpsLevel}`}>{fmt1(fps)} fps</span>
            <span className="tc-pill">{delegate ?? '-'}</span>
            {phase === 'switching' && (
              <span className="tc-pill"><Icon name="progress_activity" spin /> trocando</span>
            )}
          </div>
        )}

        {!active && (
          <div className="tc-stage-cover">
            {phase === 'loading' ? (
              <>
                <Icon name="progress_activity" spin size="40px" />
                <p>Carregando o modelo e abrindo a câmera...</p>
              </>
            ) : phase === 'denied' ? (
              <>
                <Icon name="videocam_off" size="40px" />
                <p>A câmera foi bloqueada. Libere nas permissões do navegador e tente de novo.</p>
                <button className="btn btn-primary btn-inline" onClick={start}>Tentar de novo</button>
              </>
            ) : phase === 'error' ? (
              <>
                <Icon name="videocam_off" size="40px" />
                <p>Não deu para abrir. {errorMsg}</p>
                <button className="btn btn-primary btn-inline" onClick={start}>Tentar de novo</button>
              </>
            ) : (
              <>
                <Icon name="videocam" size="40px" />
                <p>Mostre a mão para a câmera frontal. O teste mede fps, tempo por detecção e carga.</p>
                <button className="btn btn-primary btn-inline" onClick={start}>
                  <Icon name="videocam" /> Abrir câmera
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <div className="tc-actions">
        <button
          className="btn btn-secondary"
          onClick={() => reload(otherDelegate)}
          disabled={!active || phase === 'switching'}
        >
          <Icon name="swap_horiz" /> Usar {otherDelegate}
        </button>
        <button className="btn btn-primary" onClick={onCopy}>
          <Icon name={copied === 'ok' ? 'check' : 'content_copy'} />
          {copied === 'ok' ? 'Copiado' : 'Copiar resultado'}
        </button>
      </div>
      {copied === 'fail' && (
        <p className="tc-note" role="status">Não deu para copiar sozinho. Segure o texto abaixo e copie.</p>
      )}

      <section className="tc-section" aria-labelledby="tc-det">
        <h2 id="tc-det" className="tc-section-title">Detecção</h2>
        <dl className="tc-grid">
          <div className="tc-tile">
            <dt>fps de detecção</dt>
            <dd className={`tc-value tc-value--${active ? fpsLevel : 'none'}`}>{active ? fmt1(fps) : '-'}</dd>
          </div>
          <div className="tc-tile">
            <dt>ms por detecção</dt>
            <dd className="tc-value">{fmtMs(stats.p50())}<span className="tc-unit"> p50</span></dd>
            <dd className="tc-sub">p95 {fmtMs(stats.p95())}</dd>
          </div>
          <div className="tc-tile">
            <dt>Delegate</dt>
            <dd className="tc-value">{delegate ?? '-'}</dd>
            {cold?.gpuError && <dd className="tc-sub">GPU falhou, caiu para CPU</dd>}
          </div>
          <div className="tc-tile">
            <dt>Resolução</dt>
            <dd className="tc-value">{camera ? `${camera.width}x${camera.height}` : '-'}</dd>
            {camera?.fps ? <dd className="tc-sub">câmera a {Math.round(camera.fps)} fps</dd> : null}
          </div>
          <div className="tc-tile">
            <dt>Mão nos quadros</dt>
            <dd className="tc-value">{stats.totalFrames() ? fmtPct(stats.handRatio()) : '-'}</dd>
            <dd className="tc-sub">{stats.totalFrames()} quadros</dd>
          </div>
          <div className="tc-tile">
            <dt>Laço</dt>
            <dd className="tc-value tc-value--sm">{loopKind === 'requestVideoFrameCallback' ? 'rVFC' : 'rAF'}</dd>
            <dd className="tc-sub">limite de 15 fps</dd>
          </div>
        </dl>
      </section>

      <section className="tc-section" aria-labelledby="tc-load">
        <h2 id="tc-load" className="tc-section-title">Carregamento</h2>
        <div className="tc-table-wrap">
          <table className="tc-table">
            <thead>
              <tr><th scope="col" /><th scope="col">A frio</th><th scope="col">A quente</th></tr>
            </thead>
            <tbody>
              <LoadRow label="WASM" cold={cold?.wasm ? `${fmtMs(cold.wasm.ms)} · ${cold.wasm.source}` : '-'} warm={warm?.wasm ? `${fmtMs(warm.wasm.ms)} · ${warm.wasm.source}` : '-'} />
              <LoadRow label="Modelo" cold={cold?.model ? `${fmtMs(cold.model.ms)} · ${cold.model.source}` : '-'} warm={warm?.model ? `${fmtMs(warm.model.ms)} · ${warm.model.source}` : '-'} />
              <LoadRow label="Init total" cold={fmtMs(cold?.createMs)} warm={fmtMs(warm?.createMs)} />
              <LoadRow label="1ª detecção" cold={fmtMs(cold?.firstDetectMs)} warm={fmtMs(warm?.firstDetectMs)} />
              <LoadRow label="Pronto em" cold={fmtMs(cold?.readyMs)} warm={fmtMs(warm?.readyMs)} />
            </tbody>
          </table>
        </div>
        <div className="tc-row">
          <p className="tc-note">A quente: recria o modelo com o WASM e o arquivo já baixados.</p>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => delegate && reload(delegate)}
            disabled={!active || phase === 'switching'}
          >
            <Icon name="restart_alt" /> Medir a quente
          </button>
        </div>
      </section>

      <section className="tc-section" aria-labelledby="tc-endurance">
        <h2 id="tc-endurance" className="tc-section-title">Teste de 10 minutos</h2>
        <div className="tc-endurance">
          <div className="tc-clock" aria-live="off">
            <Icon name="timer" />
            <span className="tc-clock-time">{fmtClock(endurance.elapsed(now))}</span>
            <span className="tc-clock-total">/ {fmtClock(ENDURANCE_MS)}</span>
          </div>
          <button
            className={`btn btn-sm ${endurance.running ? 'btn-secondary' : 'btn-primary'}`}
            onClick={toggleEndurance}
            disabled={!active && !endurance.running}
          >
            <Icon name={endurance.running ? 'stop' : 'play_arrow'} />
            {endurance.running ? 'Parar' : endurance.started ? 'Recomeçar' : 'Iniciar'}
          </button>
        </div>
        <p className="tc-note">
          Deixe o celular parado com a mão na frente da câmera e a tela ligada. A meta é cair no máximo {fmtPct(MAX_DROP)} do 1º ao último minuto.
        </p>
        {minutes.length > 0 && (
          <ol className="tc-minutes">
            {minutes.map(m => (
              <li key={m.minute} className={m.partial ? 'tc-minute tc-minute--partial' : 'tc-minute'}>
                <span className="tc-minute-label">min {m.minute}</span>
                <span className="tc-minute-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (m.fps / 15) * 100)}%` }} />
                </span>
                <span className="tc-minute-fps">{fmt1(m.fps)} fps</span>
              </li>
            ))}
          </ol>
        )}
        {drop && (
          <p className={`tc-badge ${drop.worst <= MAX_DROP ? 'tc-badge--ok' : 'tc-badge--bad'}`}>
            <Icon name={drop.worst <= MAX_DROP ? 'check_circle' : 'warning'} filled />
            Queda: {fmtPct(drop.end)} no fim, {fmtPct(drop.worst)} no pior minuto
          </p>
        )}
        {endurance.interruptions > 0 && (
          <p className="tc-badge tc-badge--warn">
            <Icon name="warning" filled /> A página saiu da tela {endurance.interruptions} vez(es): refaça o teste.
          </p>
        )}
      </section>

      <section className="tc-section" aria-labelledby="tc-device">
        <h2 id="tc-device" className="tc-section-title">Aparelho</h2>
        <dl className="tc-list">
          <div><dt>Navegador</dt><dd>{device.summary || 'desconhecido'}</dd></div>
          <div>
            <dt>Memória</dt>
            <dd>
              {[
                memory.usedMB !== null ? `heap JS ${Math.round(memory.usedMB)} MB` : null,
                memory.deviceGB !== null ? `aparelho ${memory.deviceGB} GB` : null,
              ].filter(Boolean).join(' · ') || 'não exposta pelo navegador'}
            </dd>
          </div>
          <div>
            <dt>Wake Lock</dt>
            <dd>
              <span className={`tc-badge tc-badge--inline tc-badge--${wakeLock === 'active' ? 'ok' : wakeLock === 'pending' ? 'neutral' : 'warn'}`}>
                {phase === 'idle' ? 'abre com a câmera' : WAKE_LOCK_LABEL[wakeLock]}
              </span>
            </dd>
          </div>
          <div><dt>HTTPS</dt><dd>{secure ? 'sim' : 'não'}</dd></div>
        </dl>
      </section>

      {summaryText && (
        <section className="tc-section" aria-labelledby="tc-summary">
          <h2 id="tc-summary" className="tc-section-title">Resultado copiado</h2>
          <textarea className="tc-summary" readOnly value={summaryText} rows={12} />
        </section>
      )}
    </div>
  );
}

function LoadRow({ label, cold, warm }: { label: string; cold: string; warm: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{cold}</td>
      <td>{warm}</td>
    </tr>
  );
}
