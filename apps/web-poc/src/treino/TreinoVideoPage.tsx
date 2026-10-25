import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { Icon } from '../components/Icon';
import { drawSkeleton } from '../lib/cameraUtils';
import { recognizeGesture, type Lm } from '../lib/recognizer';
import { HAND_MODEL_URL, MEDIAPIPE_WASM_DIR } from '../recognition/mlAssets';

/**
 * Passa os vídeos baixados por ml-training/video/baixar.py pelo HandLandmarker (o mesmo modelo e a
 * mesma versão do app) e grava os landmarks de cada quadro em ml-training/data/landmarks/<id>.json.
 * O rótulo de cada trecho sai depois, no ml-training/video/rotular.py.
 *
 * Diferenças para a câmera do app: duas mãos (a que sinaliza é escolhida no Python), todos os
 * quadros do vídeo (sem o limite de 15 fps) e vídeo sem espelhar.
 *
 * Modo sinais (?lista=sinais&glosas=A,B): lê data/fontes_sinais.json, roda também o
 * PoseLandmarker lite (onde a mão está em relação ao corpo) e grava em data/landmarks_sinais/.
 */

/** Parâmetros da URL: qual lista de vídeos e, no modo sinais, quais glosas. */
const PARAMS = new URLSearchParams(window.location.search);
const MODO_SINAIS = PARAMS.get('lista') === 'sinais';
const GLOSAS = new Set((PARAMS.get('glosas') ?? '').split(',').map(g => g.trim()).filter(Boolean));
const FONTES_URL = MODO_SINAIS ? '/treino-dados/fontes_sinais.json' : '/treino-dados/fontes.json';
const SAIDA = MODO_SINAIS ? 'landmarks_sinais' : 'landmarks';
const POSE_MODEL_URL = '/treino-dados/modelos/pose_landmarker_lite.task';
/** Pontos do corpo guardados: rosto, ombros, braços, mãos do modelo de pose e quadril (0 a 24). */
const POSE_PONTOS = 25;

interface Fonte {
  id: string;
  title: string;
  channel: string;
  channel_id: string;
  tipo: 'letra' | 'alfabeto' | 'sinal';
  rotulo: string | null;
  glosa?: string;
  arquivo?: string;
}

interface FrameHand {
  /** categoryName do MediaPipe ('Left'/'Right', no quadro não espelhado vem invertido). */
  h: string | null;
  s: number;
  lm: number[];
}

interface Frame {
  t: number;
  hands: FrameHand[];
  /** Modo sinais: POSE_PONTOS pontos [x, y, z, visibilidade] em sequência, ou null sem corpo. */
  pose?: number[] | null;
}

interface Status {
  done: number;
  total: number;
  frames: number;
  withHand: number;
  current: string | null;
  running: boolean;
  log: string[];
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback(handle: number): void;
};

const round = (n: number) => Math.round(n * 1e5) / 1e5;

async function createLandmarker(): Promise<HandLandmarker> {
  const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_DIR);
  const build = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  try {
    return await build('GPU');
  } catch {
    return build('CPU');
  }
}

async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_DIR);
  const build = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  try {
    return await build('GPU');
  } catch {
    return build('CPU');
  }
}

async function alreadyDone(id: string): Promise<boolean> {
  const res = await fetch(`/treino-dados/${SAIDA}/${id}.json`, { method: 'HEAD' });
  return res.ok;
}

export function TreinoVideoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2Ref = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const stopRef = useRef(false);
  /** Timestamps do MediaPipe precisam crescer sempre, mesmo trocando de vídeo. */
  const clockRef = useRef(0);

  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [rate, setRate] = useState(2);
  const [redo, setRedo] = useState(false);
  const [now, setNow] = useState<Fonte | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>({
    done: 0, total: 0, frames: 0, withHand: 0, current: null, running: false, log: [],
  });

  useEffect(() => {
    fetch(FONTES_URL)
      .then(r => (r.ok ? r.json() : []))
      // Alfabeto inteiro primeiro: é dele que sai a maior parte dos rótulos
      .then((list: Fonte[]) => setFontes(
        list
          .filter(f => f.arquivo && (GLOSAS.size === 0 || GLOSAS.has(f.glosa ?? '')))
          .sort((a, b) => Number(a.tipo !== 'alfabeto') - Number(b.tipo !== 'alfabeto')),
      ))
      .catch(() => setFontes([]));
  }, []);

  // Estado legível de fora (o agente acompanha o andamento pelo console do Chrome)
  useEffect(() => {
    (window as unknown as { __treino: Status }).__treino = status;
  }, [status]);

  const log = (line: string) =>
    setStatus(s => ({ ...s, log: [line, ...s.log].slice(0, 200) }));

  const processOne = useCallback(async (fonte: Fonte, landmarker: HandLandmarker): Promise<number> => {
    const video = videoRef.current as VideoWithRvfc;
    const frames: Frame[] = [];
    video.src = `/treino-dados/videos/${fonte.arquivo}`;
    video.muted = true;
    await new Promise<void>((ok, fail) => {
      video.onloadedmetadata = () => ok();
      video.onerror = () => fail(new Error('vídeo não abriu'));
    });
    const w = video.videoWidth;
    const h = video.videoHeight;
    for (const c of [canvasRef.current, canvas2Ref.current]) {
      if (c) { c.width = w; c.height = h; }
    }
    const base = clockRef.current + 1000;

    await new Promise<void>((ok) => {
      let handle = 0;
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (stopRef.current) { video.pause(); ok(); return; }
        const ts = Math.max(base + meta.mediaTime * 1000, clockRef.current + 1);
        clockRef.current = ts;
        const result = landmarker.detectForVideo(video, ts);
        const hands: FrameHand[] = result.landmarks.map((pts, i) => {
          const lm: number[] = [];
          for (const p of pts) lm.push(round(p.x), round(p.y), round(p.z));
          const cat = result.handedness[i]?.[0];
          return { h: cat?.categoryName ?? null, s: round(cat?.score ?? 0), lm };
        });
        let pose: number[] | null | undefined;
        const poseLm = poseRef.current;
        if (poseLm) {
          const pr = poseLm.detectForVideo(video, ts);
          const pts = pr.landmarks[0];
          pose = pts ? pts.slice(0, POSE_PONTOS).flatMap(q => [round(q.x), round(q.y), round(q.z), round(q.visibility ?? 0)]) : null;
        }
        frames.push(pose === undefined ? { t: round(meta.mediaTime), hands } : { t: round(meta.mediaTime), hands, pose });

        const ctx1 = canvasRef.current?.getContext('2d');
        const ctx2 = canvas2Ref.current?.getContext('2d');
        ctx1?.clearRect(0, 0, w, h);
        ctx2?.clearRect(0, 0, w, h);
        if (result.landmarks[0] && ctx1) drawSkeleton(ctx1, result.landmarks[0] as Lm[], w, h, 0.8);
        if (result.landmarks[1] && ctx2) drawSkeleton(ctx2, result.landmarks[1] as Lm[], w, h, 0, 'reference');
        // Corpo (modo sinais): pontos dos ombros, cotovelos, pulsos e rosto
        if (pose && ctx2) {
          ctx2.fillStyle = 'rgba(255,255,255,0.85)';
          for (const i of [0, 9, 10, 11, 12, 13, 14, 15, 16]) {
            ctx2.beginPath();
            ctx2.arc(pose[i * 4] * w, pose[i * 4 + 1] * h, Math.max(3, w / 160), 0, Math.PI * 2);
            ctx2.fill();
          }
        }
        // Prévia ao vivo com o reconhecedor heurístico (só para quem assiste; o rótulo é outro)
        const g = result.landmarks[0] ? recognizeGesture(result.landmarks[0] as Lm[]) : null;
        setLive(g?.letter ?? null);
        if (video.duration) setProgress(meta.mediaTime / video.duration);
        handle = video.requestVideoFrameCallback(onFrame);
      };
      video.onended = () => { video.cancelVideoFrameCallback(handle); ok(); };
      handle = video.requestVideoFrameCallback(onFrame);
      video.currentTime = 0;
      video.playbackRate = rate;
      video.play().catch(() => ok());
    });
    if (stopRef.current) return -1;

    const body = JSON.stringify({
      id: fonte.id,
      tipo: fonte.tipo,
      rotulo: fonte.rotulo,
      glosa: fonte.glosa,
      channel_id: fonte.channel_id,
      title: fonte.title,
      width: w,
      height: h,
      aspect: w / h,
      duration: video.duration,
      mediapipe: '1.1.1',
      frames,
    });
    await fetch(`/treino-dados/${SAIDA}/${fonte.id}.json`, { method: 'PUT', body });
    const comMao = frames.filter(f => f.hands.length > 0).length;
    setStatus(s => ({ ...s, frames: s.frames + frames.length, withHand: s.withHand + comMao }));
    return frames.length;
  }, [rate]);

  const start = useCallback(async () => {
    stopRef.current = false;
    setStatus(s => ({ ...s, running: true, total: fontes.length }));
    if (!landmarkerRef.current) {
      log('carregando o detector de mão...');
      landmarkerRef.current = await createLandmarker();
    }
    if (MODO_SINAIS && !poseRef.current) {
      log('carregando o detector de corpo...');
      poseRef.current = await createPoseLandmarker();
    }
    const landmarker = landmarkerRef.current;
    let done = 0;
    for (const fonte of fontes) {
      if (stopRef.current) break;
      if (!redo && await alreadyDone(fonte.id)) {
        done += 1;
        setStatus(s => ({ ...s, done }));
        continue;
      }
      setNow(fonte);
      setStatus(s => ({ ...s, current: fonte.id }));
      try {
        const n = await processOne(fonte, landmarker);
        if (n < 0) break;
        log(`${fonte.glosa ?? fonte.rotulo ?? 'alfabeto'} · ${fonte.title.slice(0, 50)} · ${n} quadros`);
      } catch (err) {
        log(`erro em ${fonte.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      done += 1;
      setStatus(s => ({ ...s, done }));
    }
    setNow(null);
    setStatus(s => ({ ...s, running: false, current: null }));
    log(stopRef.current ? 'pausado' : 'terminou');
  }, [fontes, redo, processOne]);

  const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <div className="cl-page tr-page">
      <header className="cl-header">
        <div>
          <h1 className="cl-title">Treino por vídeo</h1>
          <p className="cl-sub">
            {fontes.length} vídeo(s) baixado(s){MODO_SINAIS ? ' de sinais' : ''}. Cada um passa pelo detector de mão do
            app{MODO_SINAIS ? ' e pelo de corpo' : ''} e os pontos vão para ml-training/data/{SAIDA}.
          </p>
        </div>
      </header>

      <div className="cl-stage tr-stage">
        <video ref={videoRef} className="cl-video" playsInline muted aria-label="Vídeo em análise" />
        <canvas ref={canvas2Ref} className="cl-canvas" aria-hidden="true" />
        <canvas ref={canvasRef} className="cl-canvas" aria-hidden="true" />
        <div className="cl-hud">
          {now && (
            <span className="cl-pill">
              {now.tipo === 'alfabeto' ? 'alfabeto inteiro' : now.tipo === 'sinal' ? `sinal ${now.glosa}` : `letra ${now.rotulo}`}
            </span>
          )}
          {now && <span className="cl-pill">{now.channel || now.id}</span>}
          <span className="cl-pill">{status.done}/{status.total || fontes.length} vídeos</span>
        </div>
        {now && <div className="tr-label" aria-live="polite">{live ?? '·'}</div>}
        {!now && (
          <div className="cl-stage-cover">
            <Icon name="videocam" size="40px" />
            <p>{status.running ? 'Preparando...' : 'Aperte Começar para analisar os vídeos.'}</p>
          </div>
        )}
      </div>

      <div className="tr-bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>

      <div className="tr-row">
        {status.running ? (
          <button className="btn btn-secondary" onClick={() => { stopRef.current = true; }}>
            <Icon name="pause" /> Pausar
          </button>
        ) : (
          <button className="btn btn-primary" disabled={fontes.length === 0} onClick={start}>
            <Icon name="play_arrow" /> Começar
          </button>
        )}
        <label className="cl-check">
          <span>Velocidade</span>
          <select className="cl-input" value={rate} onChange={e => setRate(Number(e.target.value))} disabled={status.running}>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </label>
        <label className="cl-check">
          <input type="checkbox" checked={redo} onChange={e => setRedo(e.target.checked)} disabled={status.running} />
          <span>Refazer os já analisados</span>
        </label>
      </div>

      <section className="cl-card cl-card--flat">
        <p className="cl-text">
          {pct}% dos vídeos · {status.frames} quadros analisados · mão encontrada em {status.withHand}
        </p>
        <div className="tr-list">
          {status.log.map((l, i) => (
            <div key={`${i}-${l}`} className={`tr-item${i === 0 && status.running ? ' tr-item--now' : ''}`}>
              <span className="tr-title">{l}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
