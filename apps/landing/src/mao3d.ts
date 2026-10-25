/*
 * Abertura com a mão em 3D (carregada sob demanda por src/main.ts, depois que a página carrega).
 *
 * Uma mão só, no palco, soletra L, I, B, R, A, X com as mesmas poses reais do maos.json (e a
 * profundidade delas, maos-z.json). A cada volta a mão de cada letra é de outra pessoa, com a
 * transição suave entre as poses e um tom de pele diferente por pessoa.
 *
 * Modelo da mão: nosso (src/mao-3d.glb, gerado no Blender por scripts/mao3d/gerar.py), com
 * unhas, dobras da pele num mapa de normais e um osso por segmento do MediaPipe. O retargeting
 * dos 21 landmarks e a colisão entre os dedos estão em src/retarget.ts. Luz de estúdio neutra: a
 * cor do estado da câmera fica só na moldura, na letra e nos selos, nunca na pele.
 *
 * Até a mão aparecer, o palco mostra só a moldura vazia (main.ts e abertura-3d.css); com menos
 * movimento ela fica parada no estado final. Sem 3D no navegador, se o 3D falhar ou demorar, ou sem
 * JS, a abertura fica nas seis mãos desenhadas.
 */
import {
  Bone,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Material,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
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
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import maos from './maos.json';
import maosZ from './maos-z.json';
import { HERO_LETTERS, easeStandard } from './hands';
import { BONES, clonePose, makeRig, mixPose, positions, retarget, solveCollisions, type HandPose, type Rig } from './retarget';

/**
 * Tons de pele (sRGB), do mais claro ao mais escuro. Ilustrativos: os dados da mão não dizem
 * a cor de ninguém; variam só para mostrar que cada letra é de uma pessoa.
 */
const SKIN = ['#F3CDB0', '#E2AE8A', '#C98F68', '#A86F4C', '#86553A', '#5E3B29'];
/** Ordem dos tons ao longo de LIBRAX: vizinhos sempre bem diferentes. */
const SKIN_ORDER = [0, 3, 1, 4, 2, 5];

/** O z do MediaPipe sai achatado: com 1,8 o comprimento de cada osso varia menos entre as 48 poses. */
const DEPTH = 1.8;
const MOVE_MS = 950;
const READY_MS = 260;
const HOLD_MS = 1150;
const DONE_MS = 1900;

type State = 'idle' | 'tracking' | 'ready' | 'correct';
type Letter = (typeof HERO_LETTERS)[number];

interface Options {
  /** O modelo (src/mao-3d.glb), já pedido pelo main.ts junto com este código. */
  model: Promise<ArrayBuffer>;
  /** Menos movimento: a mão fica parada no estado final (o X de LIBRAX). */
  reduced: boolean;
  /**
   * Pede o palco na hora de aparecer: false se a abertura já ficou nas mãos desenhadas (demorou
   * demais), e aí a mão em 3D desiste sem aparecer.
   */
  claim: () => boolean;
  /** Pose fixa (para comparar com o desenho 2D, ?letra=A&pessoa=3): letra e pessoa. */
  still?: { letter: string; person: number };
}

const letras = maos.letras as Record<string, { centro: number[]; poses: number[][] }>;
const profundidade = maosZ.letras as Record<string, number[][]>;

/** Os 21 pontos de uma pose no espaço da cena: x para a direita, y para cima, z para quem olha. */
function landmarks(letter: Letter, k: number): Vector3[] {
  const p = letras[letter].poses[k];
  const z = profundidade[letter][k];
  return Array.from({ length: 21 }, (_, i) => new Vector3(p[i * 2], -p[i * 2 + 1], -z[i] * DEPTH));
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

  // Estúdio: céu quente e chão escuro, luz principal suave do alto à esquerda, preenchimento
  // do outro lado e um contorno branco fraco por trás (sem cor na pele)
  scene.add(new HemisphereLight(0xfff4ec, 0x3a2c24, 1.1));
  const key = new DirectionalLight(0xfff3ea, 2.1);
  key.position.set(-1.4, 1.8, 3);
  const fill = new DirectionalLight(0xffeee4, 0.75);
  fill.position.set(2.2, 0.2, 2.2);
  const back = new DirectionalLight(0xffffff, 0.55);
  back.position.set(0.8, 1.5, -2.5);
  scene.add(key, fill, back);

  const camera = new PerspectiveCamera(16, 4 / 3, 0.1, 100);

  // ---------- modelo ----------
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(await opts.model, '');
  const bones = new Map<string, Bone>();
  const meshes: SkinnedMesh[] = [];
  gltf.scene.traverse((o: Object3D) => {
    if ((o as Bone).isBone) bones.set(o.name, o as Bone);
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
  });
  const rig: Rig = makeRig(
    [...bones.values()].map((b) => ({ name: b.name, position: b.position.clone(), quaternion: b.quaternion.clone() })),
  );
  const jointBones = BONES.map((n) => bones.get(n)!);
  const skinMesh = meshes.find((m) => (m.material as Material).name === 'pele');
  const nailMesh = meshes.find((m) => (m.material as Material).name === 'unha');
  if (!skinMesh || !nailMesh) throw new Error('modelo da mão sem pele ou unhas');
  const baked = skinMesh.material as MeshStandardMaterial;
  // Pele: o tom vem daqui (o modelo é branco); dobras e unhas vêm do mapa de normais do modelo
  const skin = new MeshPhysicalMaterial({
    color: new Color(SKIN[0]),
    roughness: 0.56,
    metalness: 0,
    normalMap: baked.normalMap,
    normalScale: baked.normalScale.clone().multiplyScalar(0.9),
    specularIntensity: 0.45,
    sheen: 0.4,
    sheenRoughness: 0.5,
    sheenColor: new Color('#ff9f87'),
  });
  const nail = new MeshPhysicalMaterial({
    color: new Color(SKIN[0]),
    vertexColors: true,
    roughness: 0.48,
    metalness: 0,
    specularIntensity: 0.5,
    clearcoat: 0.12,
    clearcoatRoughness: 0.4,
  });
  skinMesh.material = skin;
  nailMesh.material = nail;
  for (const m of meshes) m.frustumCulled = false;
  baked.dispose();

  // Mesma escala dos dados: palma (pulso -> base do médio) = 1
  const palmLen = rig.palmLen;
  const hand = new Object3D();
  gltf.scene.scale.setScalar(1 / palmLen);
  hand.add(gltf.scene);
  scene.add(hand);

  // Poses de todas as letras, já como ângulos (a colisão entre dedos é resolvida a cada quadro)
  const poses = Object.fromEntries(
    HERO_LETTERS.map((L) => [L, letras[L].poses.map((_, k) => retarget(rig, landmarks(L, k)))]),
  ) as Record<Letter, HandPose[]>;
  /** Rotações locais sem pele atravessando pele (a pose de entrada não muda). */
  const solve = (p: HandPose) => solveCollisions(rig, clonePose(p));

  // ---------- estado ----------
  let currentPose: HandPose = poses.L[0];
  let current: Quaternion[] = solve(currentPose);
  const tone = new Color(SKIN[SKIN_ORDER[0]]);
  /** Unha: o mesmo tom, clareado e rosado. */
  const NAIL_TINT = new Color('#f2d4cc');
  // Enquadramento: caixa das articulações de todas as poses de cada letra (mais a grossura dos
  // dedos); o lado é o mesmo em todas as letras, como no desenho 2D, e o centro muda com a letra
  const boxes = Object.fromEntries(
    HERO_LETTERS.map((L) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const pose of poses[L]) {
        for (const p of positions(rig, solve(pose))) {
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
    jointBones.forEach((b, j) => b.quaternion.copy(current[j]));
    skin.color.copy(tone);
    // a cor por vértice do modelo (0,74 a 0,9) escurece um pouco; aqui volta ao nível da pele
    nail.color.copy(tone).lerp(NAIL_TINT, 0.1).multiplyScalar(1.1);
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
  };

  new ResizeObserver(() => {
    resize();
    render();
  }).observe(canvas);
  resize();

  // ---------- parada: menos movimento (estado final) ou ?letra=A&pessoa=3 (comparar com o 2D) ----------
  /** Assume o palco (as mãos desenhadas nunca aparecem); false se ele já ficou com elas. */
  const takeStage = () => {
    if (!opts.claim()) {
      renderer.dispose();
      return false;
    }
    stage.dataset.view = '3d';
    view.removeAttribute('data-loading');
    return true;
  };

  const stillLetter = HERO_LETTERS.find((L) => L === opts.still?.letter);
  if (stillLetter || opts.reduced) {
    const last = stillLetter ?? HERO_LETTERS[HERO_LETTERS.length - 1];
    const li = HERO_LETTERS.indexOf(last);
    const k = stillLetter ? Math.abs(opts.still!.person) % letras[last].poses.length : 0;
    await renderer.compileAsync(scene, camera);
    currentPose = poses[last][k];
    current = solve(currentPose);
    tone.set(SKIN[SKIN_ORDER[(li + k) % SKIN_ORDER.length]]);
    camCenter.copy(centerOf(last));
    if (letterEl) letterEl.textContent = last;
    chips.forEach((c, i) => (c.dataset.state = i <= li ? 'correct' : 'idle'));
    setState('correct');
    if (!takeStage()) return;
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
    const from = currentPose;
    const to = poses[L][k];
    const fromTone = tone.clone();
    const toTone = new Color(SKIN[toneIndex]);
    const fromCam = camCenter.clone();
    const toCam = centerOf(L);
    await tween(MOVE_MS, (t) => {
      // Mistura os ângulos e resolve a colisão de novo a cada quadro da transição
      currentPose = mixPose(from, to, t);
      current = solve(currentPose);
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

  // Assume o palco (até aqui ele mostrava só a moldura vazia, carregando)
  if (!takeStage()) return;
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
