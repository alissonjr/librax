/*
 * Protótipo da abertura com uma mão em 3D (carregado sob demanda por src/prototipo-3d.ts).
 *
 * Uma mão só, no palco, soletra L, I, B, R, A, X com as mesmas poses reais do maos.json (e a
 * profundidade delas, maos-z.json). A cada volta a mão de cada letra é de outra pessoa, com a
 * transição suave entre as poses e um tom de pele diferente por pessoa.
 *
 * Modelo da mão: "generic-hand" do pacote npm @webxr-input-profiles/assets 1.0.20
 * (https://github.com/immersive-web/webxr-input-profiles), Copyright (c) 2019 Amazon, licença
 * MIT (LICENSE.md do pacote). As articulações seguem os nomes do WebXR Hand Input; o
 * retargeting dos 21 landmarks está em src/retarget.ts.
 */
import {
  AmbientLight,
  Bone,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import handUrl from '@webxr-input-profiles/assets/dist/profiles/generic-hand/right.glb?url';
import maos from './maos.json';
import maosZ from './maos-z.json';
import { HAND_LINKS, HERO_LETTERS, easeStandard } from './hands';
import { JOINTS, SPECS, makeRest, positions, retarget, slerpPose, type Rest } from './retarget';

/**
 * Tons de pele (sRGB), do mais claro ao mais escuro. Ilustrativos: os dados da mão não dizem
 * a cor de ninguém; variam só para mostrar que cada letra é de uma pessoa.
 */
const SKIN = ['#F3CDB0', '#E2AE8A', '#C98F68', '#A86F4C', '#86553A', '#5E3B29'];
/** Ordem dos tons ao longo de LIBRAX: vizinhos sempre bem diferentes. */
const SKIN_ORDER = [0, 3, 1, 4, 2, 5];

/** O z do MediaPipe sai achatado: com 1,8 o comprimento de cada osso varia menos entre as 48 poses. */
const DEPTH = 1.8;
/**
 * Os dedos do modelo são curtos e grossos perto dos dados (o dedo médio dos landmarks mede ~1,2
 * palma; o do modelo, ~0,95): as falanges ficam mais longas e um pouco mais finas.
 */
const FINGER_LENGTH = 1.14;
const FINGER_WIDTH = 0.9;
const MOVE_MS = 950;
const READY_MS = 260;
const HOLD_MS = 1150;
const DONE_MS = 1900;

type State = 'idle' | 'tracking' | 'ready' | 'correct';
type Letter = (typeof HERO_LETTERS)[number];

interface Options {
  reduced: boolean;
  debug?: boolean;
}

const letras = maos.letras as Record<string, { centro: number[]; poses: number[][] }>;
const profundidade = maosZ.letras as Record<string, number[][]>;

/** Os 21 pontos de uma pose no espaço da cena: x para a direita, y para cima, z para quem olha. */
function landmarks(letter: Letter, k: number): Vector3[] {
  const p = letras[letter].poses[k];
  const z = profundidade[letter][k];
  return Array.from({ length: 21 }, (_, i) => new Vector3(p[i * 2], -p[i * 2 + 1], -z[i] * DEPTH));
}

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export async function startHand3d(stage: HTMLElement, opts: Options): Promise<void> {
  const root = stage.querySelector<HTMLElement>('[data-stage3d]');
  const view = stage.querySelector<HTMLElement>('[data-stage3d-view]');
  const canvas = stage.querySelector<HTMLCanvasElement>('[data-stage3d-canvas]');
  const letterEl = stage.querySelector<HTMLElement>('[data-stage3d-letter]');
  const word = stage.querySelector<HTMLElement>('[data-stage-word]');
  const status = stage.querySelector<HTMLElement>('[data-stage-status]');
  const toggle = stage.querySelector<HTMLButtonElement>('[data-stage-toggle]');
  if (!root || !view || !canvas) return;
  const chips = [...root.querySelectorAll<HTMLElement>('.stage3d-letters li')];

  // ---------- cena ----------
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  const stageColor = (state: State) =>
    new Color(cssVar(stage, `--lx-stage-landmark-${state === 'idle' ? 'idle' : state}`, '#74DE9B').slice(0, 7));
  scene.add(new HemisphereLight(0xfff1e6, 0x2b2018, 0.9));
  scene.add(new AmbientLight(0xffffff, 0.15));
  const key = new DirectionalLight(0xfff6ee, 2.4);
  key.position.set(-1.2, 1.6, 3);
  const fill = new DirectionalLight(0xffe2cc, 0.6);
  fill.position.set(2, -0.5, 2);
  // Luz de recorte por trás, na cor do estado da câmera (como os ossos do esqueleto)
  const rim = new DirectionalLight(stageColor('tracking'), 1.6);
  rim.position.set(1.5, 1.2, -2.5);
  scene.add(key, fill, rim);

  const camera = new PerspectiveCamera(16, 4 / 3, 0.1, 100);

  // ---------- modelo ----------
  const gltf = await new GLTFLoader().loadAsync(handUrl);
  const bones = new Map<string, Bone>();
  let mesh: SkinnedMesh | null = null;
  gltf.scene.traverse((o: Object3D) => {
    if ((o as Bone).isBone) bones.set(o.name, o as Bone);
    if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  const joints = JOINTS.map((n) => bones.get(n));
  if (!mesh || joints.some((b) => !b)) throw new Error('modelo da mão sem as articulações esperadas');
  const handMesh = mesh as SkinnedMesh;
  const jointBones = joints as Bone[];
  const skin = new MeshPhysicalMaterial({
    color: new Color(SKIN[0]),
    roughness: 0.62,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.55,
    sheenColor: new Color('#f2a48c'),
  });
  handMesh.material = skin;
  handMesh.frustumCulled = false;

  const rest: Rest = makeRest(
    jointBones.map((b) => b.position.clone()),
    jointBones.map((b) => b.quaternion.clone()),
  );
  // Falanges (tudo que não é pulso nem metacarpo dos quatro dedos) e as pontas
  const stretch = SPECS.map((sp, j) => (j > 0 && !(sp.kind === 'palm') ? FINGER_LENGTH : 1));
  jointBones.forEach((b, j) => {
    if (stretch[j] !== 1) b.scale.set(FINGER_WIDTH, FINGER_WIDTH, stretch[j]);
  });
  // Mesma escala dos dados: palma (pulso -> base do médio) = 1
  const palmLen = rest.pos[11].distanceTo(rest.pos[0]);
  const hand = new Object3D();
  gltf.scene.scale.setScalar(1 / palmLen);
  hand.add(gltf.scene);
  scene.add(hand);

  // Poses de todas as letras, já como rotações
  const poses = Object.fromEntries(
    HERO_LETTERS.map((L) => [L, letras[L].poses.map((_, k) => retarget(rest, landmarks(L, k)))]),
  ) as Record<Letter, Quaternion[][]>;

  // Esqueleto dos dados por cima (só com ?esqueleto), para comparar com o desenho 2D
  let debugLines: LineSegments | null = null;
  let jointLines: LineSegments | null = null;
  if (opts.debug) {
    debugLines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: stageColor('correct'), depthTest: false, transparent: true, opacity: 0.85 }),
    );
    debugLines.renderOrder = 10;
    debugLines.frustumCulled = false;
    hand.add(debugLines);
    jointLines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0xff3344, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    jointLines.renderOrder = 11;
    jointLines.frustumCulled = false;
    gltf.scene.add(jointLines);
  }
  const showDebug = (lm: Vector3[]) => {
    if (!debugLines) return;
    const arr: number[] = [];
    for (const [a, b] of HAND_LINKS) arr.push(...lm[a].toArray(), ...lm[b].toArray());
    debugLines.geometry.setAttribute('position', new Float32BufferAttribute(arr, 3));
  };

  // ---------- estado ----------
  const current: Quaternion[] = poses.L[0].map((q) => q.clone());
  const tone = new Color(SKIN[SKIN_ORDER[0]]);
  // Enquadramento: caixa das articulações de todas as poses de cada letra (mais a grossura dos
  // dedos); o lado é o mesmo em todas as letras, como no desenho 2D, e o centro muda com a letra
  const boxes = Object.fromEntries(
    HERO_LETTERS.map((L) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of poses[L]) {
        for (const p of positions(rest, q, stretch)) {
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
      }
      // Folga para a grossura dos dedos e a ponta além da última articulação; embaixo, o pulso
      // pode encostar na borda (esmaece no fundo)
      const m = palmLen;
      return [L, { x0: x0 - 0.22 * m, x1: x1 + 0.22 * m, y0: y0 - 0.12 * m, y1: y1 + 0.32 * m }];
    }),
  ) as Record<Letter, { x0: number; x1: number; y0: number; y1: number }>;
  const side = Math.max(...HERO_LETTERS.map((L) => Math.max(boxes[L].x1 - boxes[L].x0, boxes[L].y1 - boxes[L].y0))) / palmLen;
  let sway = 0;

  const centerOf = (L: Letter) =>
    new Vector3((boxes[L].x0 + boxes[L].x1) / 2, (boxes[L].y0 + boxes[L].y1) / 2, 0).divideScalar(palmLen);

  const camCenter = centerOf(HERO_LETTERS[0]);

  function applyPose() {
    const pos = positions(rest, current, stretch);
    jointBones.forEach((b, j) => {
      b.position.copy(pos[j]);
      b.quaternion.copy(current[j]);
    });
    if (jointLines) {
      const arr: number[] = [];
      SPECS.forEach((sp, j) => { if (sp.parent >= 0) arr.push(...pos[sp.parent].toArray(), ...pos[j].toArray()); });
      jointLines.geometry.setAttribute('position', new Float32BufferAttribute(arr, 3));
    }
    skin.color.copy(tone);
    hand.rotation.set(Math.sin(sway / 2300) * 0.05, Math.sin(sway / 1700) * 0.12, 0);
  }

  function resize() {
    const w = canvas!.clientWidth;
    const h = canvas!.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render() {
    const vFov = (camera.fov * Math.PI) / 180;
    // Cabe a caixa da letra (mesmo lado em todas, como no 2D) na menor dimensão da vista
    const fit = (camera.aspect < 1 ? side / camera.aspect : side) * 1.06;
    const dist = fit / 2 / Math.tan(vFov / 2);
    camera.position.set(camCenter.x, camCenter.y, dist);
    camera.lookAt(camCenter);
    applyPose();
    renderer.render(scene, camera);
  }

  const setState = (s: State) => {
    view.dataset.state = s;
    rim.color.copy(stageColor(s));
  };

  new ResizeObserver(() => {
    resize();
    render();
  }).observe(canvas);
  resize();

  // ---------- menos movimento: o estado final, parado ----------
  const last = HERO_LETTERS[HERO_LETTERS.length - 1];
  if (opts.reduced) {
    await renderer.compileAsync(scene, camera);
    poses[last][0].forEach((q, j) => current[j].copy(q));
    tone.set(SKIN[SKIN_ORDER[HERO_LETTERS.length - 1]]);
    camCenter.copy(centerOf(last));
    if (letterEl) letterEl.textContent = last;
    chips.forEach((c) => (c.dataset.state = 'correct'));
    setState('correct');
    showDebug(landmarks(last, 0));
    stage.dataset.view = '3d';
    root.hidden = false;
    resize();
    render();
    return;
  }

  // ---------- relógio que só anda com a animação ativa ----------
  let visible = true;
  const paused = () => toggle?.getAttribute('aria-pressed') === 'true';
  const active = () => visible && !paused() && !document.hidden;
  let clock = 0;
  let lastFrame = 0;
  let ticking = false;
  const waiters: { at: number; done: () => void }[] = [];
  let onFrame: (() => void) | null = null;

  function frame(now: number) {
    if (!active()) {
      ticking = false;
      return;
    }
    clock += Math.min(now - lastFrame, 100);
    lastFrame = now;
    sway = clock;
    onFrame?.();
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (clock >= waiters[i].at) waiters.splice(i, 1)[0].done();
    }
    render();
    requestAnimationFrame(frame);
  }
  function kick() {
    if (ticking || !active()) return;
    ticking = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
  const sleep = (ms: number) => new Promise<void>((done) => waiters.push({ at: clock + ms, done }));

  async function tween(ms: number, step: (t: number) => void) {
    const start = clock;
    onFrame = () => step(easeStandard(Math.min(1, (clock - start) / ms)));
    await sleep(ms);
    step(1);
    onFrame = null;
  }

  async function moveTo(L: Letter, k: number, toneIndex: number) {
    const from = current.map((q) => q.clone());
    const to = poses[L][k];
    const fromTone = tone.clone();
    const toTone = new Color(SKIN[toneIndex]);
    const fromCam = camCenter.clone();
    const toCam = centerOf(L);
    showDebug(landmarks(L, k));
    await tween(MOVE_MS, (t) => {
      slerpPose(from, to, t, current);
      tone.lerpColors(fromTone, toTone, t);
      camCenter.lerpVectors(fromCam, toCam, t);
    });
  }

  const reading = status?.dataset.reading ?? '';
  const done = status?.dataset.done ?? '';

  async function loop() {
    for (let cycle = 0; ; cycle++) {
      stage.dataset.phase = 'reading';
      chips.forEach((c) => (c.dataset.state = 'idle'));
      if (word) word.textContent = `${reading}...`;
      let spelled = '';
      for (let li = 0; li < HERO_LETTERS.length; li++) {
        const L = HERO_LETTERS[li];
        const k = cycle % letras[L].poses.length;
        if (letterEl) letterEl.textContent = L;
        chips[li].dataset.state = 'tracking';
        setState('tracking');
        await moveTo(L, k, SKIN_ORDER[(li + cycle) % SKIN_ORDER.length]);
        setState('ready');
        await sleep(READY_MS);
        setState('correct');
        chips[li].dataset.state = 'correct';
        spelled += L;
        if (word) word.textContent = `${reading}: ${spelled}`;
        await sleep(HOLD_MS);
      }
      stage.dataset.phase = 'done';
      if (word) word.textContent = `${done}: ${spelled}`;
      await sleep(DONE_MS);
    }
  }

  // Prepara os shaders antes de trocar, para a vista não abrir vazia
  await renderer.compileAsync(scene, camera);

  // Assume o palco: as seis mãos desenhadas param (main.ts) e somem
  stage.dataset.view = '3d';
  root.hidden = false;
  resize();
  setState('tracking');
  render();

  toggle?.addEventListener('click', () => setTimeout(kick));
  document.addEventListener('visibilitychange', kick);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    kick();
  }, { threshold: 0.15 }).observe(stage);
  kick();
  void loop();
}
