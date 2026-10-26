/*
 * Motor da mão em 3D da apresentação (Mao3DView.tsx): a cena (cena.ts), as mãos reais do sinal
 * (poses.ts) viradas em ângulos (retarget.ts), a linha do tempo do movimento e a vista que gira.
 *
 * - Letra ou número parado: a mão gira devagar de um lado para o outro (tocando) para mostrar a
 *   forma; "outra mão" troca de pessoa com uma transição curta.
 * - Letra com movimento: o movimento real em volta (linhaDoTempo.ts), em 1x ou 0,5x.
 * - Desenha só quando precisa: tocando, numa transição ou quando a vista muda. Fora da tela, com a
 *   aba do navegador escondida ou pausada, não gasta nada.
 * - Enquadramento: uma esfera em volta de todas as poses do sinal (de todas as pessoas, com o
 *   deslocamento do pulso), então girar a vista nunca corta a mão.
 */
import { Object3D, type Quaternion, Vector3 } from 'three';
import { createHandScene, sceneLandmarks, SKIN_TONES } from './cena';
import { BONE_INDEX, clonePose, mixPose, positions, retarget, solveCollisions, type HandPose } from './retarget';
import type { Clip } from './poses';
import { easeStandard, sampleAt } from './linhaDoTempo';

/** Giro dos botões (rad) e limite da inclinação para cima e para baixo. */
export const ROTATE_STEP = Math.PI / 6;
const PITCH_LIMIT = 1.1;
/** Giro automático das mãos paradas: amplitude (rad) e o tempo de uma ida e volta (ms). */
const AUTO_TURN = 0.55;
const AUTO_TURN_MS = 9000;
const SWITCH_MS = 450;
/** Folga em volta das articulações (grossura dos dedos e ponta além da última articulação), em palmos. */
const MARGIN = 0.22;
/** Quanto do antebraço do modelo (em palmos, além do pulso) cabe no quadro. */
const FOREARM = 0.45;

export interface MotorOptions {
  reduced: boolean;
  tone: number;
  playing: boolean;
  speed: number;
  /** O contexto 3D se perdeu (GPU reiniciada, memória): a tela volta para o avatar. */
  onLost: () => void;
}

export interface Motor {
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  setPerson(index: number): void;
  setTone(index: number): void;
  /** Gira a vista (yaw para os lados, pitch para cima e para baixo), em radianos. */
  rotateBy(yaw: number, pitch: number): void;
  resetView(): void;
  /** Leva o movimento para um instante da volta (ms) e desenha (fotos e testes). */
  seek(ms: number): void;
  dispose(): void;
}

export async function createMotor(canvas: HTMLCanvasElement, observed: HTMLElement, clip: Clip, model: ArrayBuffer, opts: MotorOptions): Promise<Motor> {
  const three = await createHandScene(canvas, model, { maxPixelRatio: 2 });
  const { renderer, scene, camera, rig, hand } = three;
  const pivot = new Object3D();
  scene.add(pivot);
  pivot.add(hand);

  // Ângulos de cada quadro de cada pessoa e o deslocamento do pulso na cena (y para cima)
  const people = clip.people.map((p) => ({
    poses: p.frames.map((f) => retarget(rig, sceneLandmarks((i) => f[i * 3], (i) => f[i * 3 + 1], (i) => f[i * 3 + 2]))),
    offsets: p.wrist.map(([x, y]) => new Vector3(x, -y, 0)),
  }));
  const solve = (p: HandPose): Quaternion[] => solveCollisions(rig, clonePose(p));

  // Enquadramento: esfera em volta das articulações de todas as poses do sinal
  const pts: Vector3[] = [];
  for (const p of people) {
    p.poses.forEach((pose, k) => {
      const joints = positions(rig, solve(pose)).map((q) => q.divideScalar(rig.palmLen).add(p.offsets[k]));
      pts.push(...joints);
      // O modelo segue um pouco além do pulso (o começo do antebraço): entra no quadro também
      const wrist = joints[BONE_INDEX.wrist];
      pts.push(wrist.clone().sub(joints[BONE_INDEX.middle_mcp]).multiplyScalar(FOREARM).add(wrist));
    });
  }
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const q of pts) {
    lo.min(q);
    hi.max(q);
  }
  const center = lo.clone().add(hi).multiplyScalar(0.5);
  const radius = Math.max(...pts.map((q) => q.distanceTo(center))) + MARGIN;

  let playing = opts.playing;
  let speed = opts.speed;
  let person = 0;
  let clock = 0;
  let autoPhase = 0;
  let yaw = 0;
  let pitch = 0;
  let visible = true;
  let raf = 0;
  let last = 0;
  let blend: { pose: HandPose; off: Vector3; start: number } | null = null;
  let shownPose: HandPose = people[0].poses[0];
  const shownOff = people[0].offsets[0].clone();
  three.tone.set(SKIN_TONES[opts.tone] ?? SKIN_TONES[2]);

  function fit() {
    if (!three.resize()) return false;
    const v = (camera.fov * Math.PI) / 180;
    const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    const dist = radius / Math.sin(Math.min(v, h) / 2);
    camera.position.set(0, 0, dist);
    camera.near = Math.max(0.05, dist - radius * 2);
    camera.far = dist + radius * 2;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    return true;
  }

  function target(): { pose: HandPose; off: Vector3 } {
    const p = people[person];
    const s = sampleAt(p.poses.length, clock);
    if (s.from === s.to || s.t === 0) return { pose: p.poses[s.from], off: p.offsets[s.from].clone() };
    return {
      pose: mixPose(p.poses[s.from], p.poses[s.to], s.t),
      off: p.offsets[s.from].clone().lerp(p.offsets[s.to], s.t),
    };
  }

  function draw(now: number) {
    let { pose, off } = target();
    if (blend) {
      const k = (now - blend.start) / SWITCH_MS;
      if (k >= 1 || opts.reduced) {
        blend = null;
      } else {
        const e = easeStandard(k);
        pose = mixPose(blend.pose, pose, e);
        off = blend.off.clone().lerp(off, e);
      }
    }
    shownPose = pose;
    shownOff.copy(off);
    three.setPose(solve(pose));
    hand.position.copy(off).sub(center);
    const auto = clip.moving ? 0 : Math.sin((autoPhase / AUTO_TURN_MS) * Math.PI * 2) * AUTO_TURN;
    pivot.rotation.set(pitch, yaw + auto, 0, 'YXZ');
    renderer.render(scene, camera);
  }

  const looping = () => visible && !document.hidden && (playing || blend !== null);

  function frame(now: number) {
    raf = 0;
    const dt = Math.min(now - last, 100);
    last = now;
    if (playing) {
      if (clip.moving) clock += dt * speed;
      else autoPhase += dt * speed;
    }
    draw(now);
    if (looping()) raf = requestAnimationFrame(frame);
  }

  function invalidate() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const resizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (fit()) invalidate(); }) : null;
  resizeObs?.observe(canvas);
  const interObs = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) invalidate();
    }, { threshold: 0.05 })
    : null;
  interObs?.observe(observed);
  const onVisibility = () => { if (!document.hidden) invalidate(); };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = (e: Event) => {
    e.preventDefault();
    opts.onLost();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  fit();
  await renderer.compileAsync(scene, camera);
  draw(performance.now());
  invalidate();

  return {
    setPlaying(value) {
      playing = value;
      invalidate();
    },
    setSpeed(value) {
      speed = value;
    },
    setPerson(index) {
      if (index === person || !people[index]) return;
      blend = { pose: shownPose, off: shownOff.clone(), start: performance.now() };
      person = index;
      clock = 0;
      invalidate();
    },
    setTone(index) {
      three.tone.set(SKIN_TONES[index] ?? SKIN_TONES[2]);
      invalidate();
    },
    rotateBy(dYaw, dPitch) {
      yaw += dYaw;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + dPitch));
      invalidate();
    },
    resetView() {
      yaw = 0;
      pitch = 0;
      autoPhase = 0;
      invalidate();
    },
    seek(ms) {
      clock = ms;
      blend = null;
      draw(performance.now());
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObs?.disconnect();
      interObs?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      three.dispose();
    },
  };
}
