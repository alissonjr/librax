import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { drawSkeleton } from '../lib/cameraUtils';
import type { Lm } from '../lib/recognizer';
import { detectHands, getHandLandmarker, peekHandLandmarker } from '../recognition/landmarker';
import { startFrameLoop } from '../recognition/frameLoop';
import { describeDevice, describeDeviceDetailed, type DeviceInfo } from '../platform/device';
import { keepScreenOn, type WakeLockHandle } from '../platform/wakeLock';
import { buildSample, type CaptureMeta, type CaptureSample } from '../recognition/capture/sample';
import { addSamples, allSamples, clearSamples, countByLabel, deleteSession } from '../recognition/capture/store';
import { exportSamples } from '../recognition/capture/export';
import {
  CAPTURE_LETTERS, CONSENT_PARAGRAPHS, CONSENT_TITLE, CONSENT_VERSION, TARGET_PER_LETTER, W1_LETTERS,
} from '../recognition/capture/consent';

const PROFILE_KEY = 'librax_coleta_perfil';
/** Contagem regressiva antes de gravar, para a pessoa posicionar a mão. */
const COUNTDOWN_S = 3;
const RECORD_MS = 3000;
/** No máximo 10 amostras por segundo: quadros vizinhos são quase iguais. */
const SAMPLE_GAP_MS = 100;

interface Profile {
  personId: string;
  deviceModel: string;
}

type CamState = 'off' | 'loading' | 'on' | 'denied' | 'error';
type RecState =
  | { kind: 'idle' }
  | { kind: 'countdown'; left: number }
  | { kind: 'recording'; got: number; sessionId: string };

function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function saveProfile(p: Profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* sem armazenamento */ }
}

function newSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function ColetaPage() {
  const [device, setDevice] = useState<DeviceInfo>(() => describeDevice());
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());

  useEffect(() => { describeDeviceDetailed().then(setDevice); }, []);

  if (!profile) {
    return (
      <ConsentForm
        device={device}
        onAccept={p => { saveProfile(p); setProfile(p); }}
      />
    );
  }
  return <Capture profile={profile} device={device} onChangeProfile={() => setProfile(null)} />;
}

function ConsentText() {
  return (
    <>
      <h1 className="cl-title">{CONSENT_TITLE}</h1>
      {CONSENT_PARAGRAPHS.map(p => <p key={p} className="cl-text">{p}</p>)}
    </>
  );
}

function ConsentForm({ device, onAccept }: { device: DeviceInfo; onAccept: (p: Profile) => void }) {
  const [personId, setPersonId] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [agreed, setAgreed] = useState(false);
  const id = personId.trim();
  const validId = /^[a-zA-Z0-9_-]{2,24}$/.test(id);

  return (
    <div className="cl-page">
      <section className="cl-card" aria-labelledby="cl-consent">
        <div className="cl-card-icon"><Icon name="shield" filled size="32px" /></div>
        <div id="cl-consent"><ConsentText /></div>

        <label className="cl-field">
          <span className="cl-label">Seu código</span>
          <input
            className="cl-input"
            value={personId}
            onChange={e => setPersonId(e.target.value)}
            placeholder="ex.: p07"
            autoCapitalize="off"
            autoComplete="off"
            inputMode="text"
          />
          <span className="cl-hint">Use o código que a equipe passou. Não use o seu nome.</span>
        </label>

        <label className="cl-field">
          <span className="cl-label">Modelo do celular</span>
          <input
            className="cl-input"
            value={deviceModel}
            onChange={e => setDeviceModel(e.target.value)}
            placeholder={device.model || 'ex.: iPhone 12, Galaxy A14'}
          />
          <span className="cl-hint">Detectado: {device.summary || 'não identificado'}</span>
        </label>

        <label className="cl-check">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          <span>Li e concordo em participar.</span>
        </label>

        <button
          className="btn btn-primary"
          disabled={!agreed || !validId}
          onClick={() => onAccept({ personId: id, deviceModel: deviceModel.trim() || device.model })}
        >
          Começar
        </button>
      </section>
    </div>
  );
}

function Capture({ profile, device, onChangeProfile }: { profile: Profile; device: DeviceInfo; onChangeProfile: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  /** Gravação em andamento: o laço de quadros junta aqui e salva no fim. */
  const recordingRef = useRef<{ label: string; sessionId: string; until: number; last: number; buffer: CaptureSample[] } | null>(null);
  const handRef = useRef(false);

  const [cam, setCam] = useState<CamState>('off');
  const [label, setLabel] = useState('A');
  const [rec, setRec] = useState<RecState>({ kind: 'idle' });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hand, setHand] = useState(false);
  const [lastSession, setLastSession] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);

  const meta: CaptureMeta = {
    personId: profile.personId,
    platform: device.platform,
    deviceModel: profile.deviceModel || device.model,
    browser: device.browser,
    consent: CONSENT_VERSION,
  };
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const refreshCounts = useCallback(() => { countByLabel().then(setCounts).catch(() => {}); }, []);
  useEffect(refreshCounts, [refreshCounts]);

  const finishRecording = useCallback(async () => {
    const r = recordingRef.current;
    recordingRef.current = null;
    if (!r) return;
    try {
      await addSamples(r.buffer);
      setLastSession(r.buffer.length ? r.sessionId : null);
      setMessage(r.buffer.length
        ? `${r.buffer.length} amostras da letra ${r.label} guardadas.`
        : 'Nenhuma amostra: a mão não apareceu na câmera.');
    } catch {
      setMessage('Não deu para guardar neste aparelho (armazenamento cheio ou bloqueado).');
    }
    setRec({ kind: 'idle' });
    refreshCounts();
  }, [refreshCounts]);

  const onFrame = useCallback((now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const handle = peekHandLandmarker();
    if (!video || !canvas || !handle || video.readyState < 2) return;
    if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const { result } = detectHands(handle, video);
    const lms = result.landmarks[0] as Lm[] | undefined;
    const ctx = canvas.getContext('2d');
    const r = recordingRef.current;

    if (lms) {
      if (ctx) drawSkeleton(ctx, lms, canvas.width, canvas.height, 0, r ? 'ready' : 'tracking');
      if (r && now - r.last >= SAMPLE_GAP_MS) {
        r.last = now;
        const sample = buildSample(lms, {
          handedness: result.handedness?.[0]?.[0]?.categoryName ?? null,
          aspect: video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1,
          label: r.label,
          sessionId: r.sessionId,
        }, metaRef.current);
        if (sample) r.buffer.push(sample);
      }
    } else {
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }

    // A tela só muda quando a presença da mão muda (nunca um setState por quadro)
    if (handRef.current !== !!lms) {
      handRef.current = !!lms;
      setHand(!!lms);
    }
    if (r && now >= r.until) finishRecording();
  }, [finishRecording]);

  const openCamera = useCallback(async () => {
    setCam('loading');
    try {
      await getHandLandmarker();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try { await video.play(); } catch (err) { if ((err as { name?: string }).name !== 'AbortError') throw err; }
        stopLoopRef.current?.();
        stopLoopRef.current = startFrameLoop(video, onFrame, { maxFps: 15 });
      }
      wakeRef.current?.release();
      wakeRef.current = keepScreenOn();
      setCam('on');
    } catch (err) {
      setCam((err as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }, [onFrame]);

  useEffect(() => () => {
    stopLoopRef.current?.();
    streamRef.current?.getTracks().forEach(t => t.stop());
    wakeRef.current?.release();
  }, []);

  // Contagem regressiva -> gravação
  useEffect(() => {
    if (rec.kind !== 'countdown') return;
    const t = window.setTimeout(() => {
      if (rec.left > 1) {
        setRec({ kind: 'countdown', left: rec.left - 1 });
      } else {
        const sessionId = newSessionId();
        const now = performance.now();
        recordingRef.current = { label, sessionId, until: now + RECORD_MS, last: -Infinity, buffer: [] };
        setRec({ kind: 'recording', got: 0, sessionId });
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [rec, label]);

  // Progresso da gravação na tela a 10 Hz
  useEffect(() => {
    if (rec.kind !== 'recording') return;
    const id = window.setInterval(() => {
      const r = recordingRef.current;
      if (r) setRec(prev => (prev.kind === 'recording' ? { ...prev, got: r.buffer.length } : prev));
    }, 100);
    return () => window.clearInterval(id);
  }, [rec.kind]);

  async function onUndo() {
    if (!lastSession) return;
    await deleteSession(lastSession);
    setLastSession(null);
    setMessage('Última gravação apagada.');
    refreshCounts();
  }

  async function onExport() {
    const samples = await allSamples();
    const result = await exportSamples(samples, profile.personId);
    setMessage({
      shared: 'Arquivo compartilhado.',
      downloaded: 'Arquivo baixado. Envie para a equipe do Librax.',
      cancelled: 'Compartilhamento cancelado.',
      empty: 'Ainda não há amostras para exportar.',
    }[result]);
  }

  async function onClear() {
    if (!window.confirm('Apagar todas as amostras guardadas neste aparelho?')) return;
    await clearSamples();
    setLastSession(null);
    setMessage('Tudo apagado deste aparelho.');
    refreshCounts();
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const busy = rec.kind !== 'idle';

  return (
    <div className="cl-page">
      <header className="cl-header">
        <div>
          <h1 className="cl-title">Coleta de letras</h1>
          <p className="cl-sub">Código {profile.personId} · {meta.deviceModel || device.summary}</p>
        </div>
        <button className="btn btn-text btn-inline" onClick={onChangeProfile} disabled={busy}>Trocar</button>
      </header>

      <section className="cl-stage" aria-label="Câmera">
        <video ref={videoRef} className="cl-video" playsInline muted aria-label="Imagem da câmera frontal" />
        <canvas ref={canvasRef} className="cl-canvas" aria-hidden="true" />
        {cam === 'on' && (
          <div className="cl-hud">
            <span className={`cl-pill${hand ? ' cl-pill--ok' : ''}`}>
              <Icon name="sign_language" /> {hand ? 'mão na câmera' : 'sem mão'}
            </span>
            {rec.kind === 'recording' && (
              <span className="cl-pill cl-pill--rec"><Icon name="fiber_manual_record" filled /> gravando {rec.got}</span>
            )}
          </div>
        )}
        {rec.kind === 'countdown' && (
          <div className="cl-countdown" aria-live="assertive">{rec.left}</div>
        )}
        {cam !== 'on' && (
          <div className="cl-stage-cover">
            {cam === 'loading' ? (
              <><Icon name="progress_activity" spin size="40px" /><p>Abrindo a câmera...</p></>
            ) : (
              <>
                <Icon name={cam === 'off' ? 'videocam' : 'videocam_off'} size="40px" />
                <p>
                  {cam === 'off' && 'Só os pontos da mão são guardados, nunca a imagem.'}
                  {cam === 'denied' && 'A câmera foi bloqueada. Libere nas permissões do navegador.'}
                  {cam === 'error' && 'Não deu para abrir a câmera.'}
                </p>
                <button className="btn btn-primary btn-inline" onClick={openCamera}>
                  <Icon name="videocam" /> {cam === 'off' ? 'Abrir câmera' : 'Tentar de novo'}
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="cl-section" aria-labelledby="cl-letters">
        <h2 id="cl-letters" className="cl-section-title">Escolha a letra</h2>
        <div className="cl-letters" role="radiogroup" aria-label="Letra">
          {CAPTURE_LETTERS.map(l => {
            const n = counts[l] ?? 0;
            const done = n >= TARGET_PER_LETTER;
            return (
              <button
                key={l}
                role="radio"
                aria-checked={label === l}
                className={`cl-letter${label === l ? ' cl-letter--on' : ''}${done ? ' cl-letter--done' : ''}`}
                onClick={() => setLabel(l)}
                disabled={busy}
              >
                <span className="cl-letter-name">{l}</span>
                <span className="cl-letter-count">{n}</span>
                {W1_LETTERS.has(l) && <span className="cl-letter-tag">W1</span>}
              </button>
            );
          })}
        </div>
        <p className="cl-hint">
          Comece pelas marcadas com W1. Durante a gravação, mexa a mão devagar: aproxime, afaste e gire um pouco. Meta: {TARGET_PER_LETTER} por letra.
        </p>
      </section>

      <div className="cl-actions">
        <button
          className="btn btn-primary"
          onClick={() => { setMessage(null); setRec({ kind: 'countdown', left: COUNTDOWN_S }); }}
          disabled={cam !== 'on' || busy}
        >
          <Icon name="fiber_manual_record" filled /> Gravar letra {label} (3 s)
        </button>
        {message && <p className="cl-message" role="status">{message}</p>}
        {lastSession && !busy && (
          <button className="btn btn-text btn-inline" onClick={onUndo}>
            <Icon name="replay" /> Desfazer a última gravação
          </button>
        )}
      </div>

      <section className="cl-section" aria-labelledby="cl-export">
        <h2 id="cl-export" className="cl-section-title">Enviar para a equipe</h2>
        <p className="cl-text">{total} amostras guardadas neste aparelho.</p>
        <div className="cl-row">
          <button className="btn btn-secondary" onClick={onExport} disabled={busy || total === 0}>
            <Icon name="share" /> Exportar arquivo
          </button>
          <button className="btn btn-text btn-inline" onClick={onClear} disabled={busy || total === 0}>
            <Icon name="delete" /> Apagar tudo
          </button>
        </div>
        <button className="btn btn-text btn-inline cl-terms" onClick={() => setShowConsent(v => !v)}>
          <Icon name="info" /> {showConsent ? 'Esconder o termo' : 'Ver o termo de participação'}
        </button>
        {showConsent && <div className="cl-card cl-card--flat"><ConsentText /></div>}
      </section>
    </div>
  );
}
