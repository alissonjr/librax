/*
 * Cena da mão em 3D, a mesma na abertura da landing (apps/landing/src/mao3d.ts) e na apresentação
 * das letras e dos números no app (Mao3DView.tsx): renderizador, luz de estúdio neutra, o modelo
 * (mao-3d.glb, modelo próprio do Librax, gerado no Blender por apps/landing/scripts/mao3d/gerar.py)
 * com pele e unhas no tom escolhido. A pose vem de retarget.ts (21 landmarks -> ângulos, com a
 * colisão entre os dedos).
 *
 * O modelo vem comprimido (meshopt) com o mapa de normais dentro do GLB: a CSP da página precisa de
 * 'wasm-unsafe-eval' (descompressor) e blob: em img-src e connect-src (textura).
 */
import {
  Bone,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Material,
  MeshPhysicalMaterial,
  type MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  type Quaternion,
  Scene,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BONES, makeRig, type Rig } from './retarget';
import { SKIN_TONES } from './disponivel';

export { SKIN_TONES };

/** O z do MediaPipe sai achatado: com 1,8 o comprimento de cada osso varia menos entre as poses. */
export const DEPTH = 1.8;

/** Unha: o mesmo tom, clareado e rosado. */
const NAIL_TINT = new Color('#f2d4cc');

/** Pontos (x de quem olha, y para baixo, z do MediaPipe) -> cena: x para a direita, y para cima, z para quem olha. */
export function sceneLandmarks(x: (i: number) => number, y: (i: number) => number, z: (i: number) => number): Vector3[] {
  return Array.from({ length: 21 }, (_, i) => new Vector3(x(i), -y(i), -z(i) * DEPTH));
}

export interface HandScene {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  rig: Rig;
  /** A mão inteira, na escala dos dados (palma = 1), com o pulso na origem. */
  hand: Object3D;
  /** Tom da pele (aplicado no próximo setPose). */
  tone: Color;
  /** Rotações locais dos ossos (as do solveCollisions) e o tom atual na pele e nas unhas. */
  setPose(local: readonly Quaternion[]): void;
  /** Ajusta o tamanho do desenho ao do canvas; false quando o canvas ainda não tem tamanho. */
  resize(): boolean;
  dispose(): void;
}

export interface HandSceneOptions {
  /** Teto da densidade de pixels (celular com 3x desenha 2x: o mesmo para o olho, bem mais leve). */
  maxPixelRatio?: number;
}

export async function createHandScene(canvas: HTMLCanvasElement, model: ArrayBuffer, opts: HandSceneOptions = {}): Promise<HandScene> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
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

  let gltf;
  try {
    gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(model, '');
  } catch (e) {
    envTexture.dispose();
    renderer.dispose();
    throw e;
  }
  const bones = new Map<string, Bone>();
  const meshes: SkinnedMesh[] = [];
  gltf.scene.traverse((o: Object3D) => {
    if ((o as Bone).isBone) bones.set(o.name, o as Bone);
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
  });
  const rig = makeRig(
    [...bones.values()].map((b) => ({ name: b.name, position: b.position.clone(), quaternion: b.quaternion.clone() })),
  );
  const jointBones = BONES.map((n) => bones.get(n)!);
  const skinMesh = meshes.find((m) => (m.material as Material).name === 'pele');
  const nailMesh = meshes.find((m) => (m.material as Material).name === 'unha');
  if (!skinMesh || !nailMesh) throw new Error('modelo da mão sem pele ou unhas');
  const baked = skinMesh.material as MeshStandardMaterial;
  // Pele: o tom vem daqui (o modelo é branco); dobras e unhas vêm do mapa de normais do modelo
  const skin = new MeshPhysicalMaterial({
    color: new Color(SKIN_TONES[0]),
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
    color: new Color(SKIN_TONES[0]),
    vertexColors: true,
    roughness: 0.48,
    metalness: 0,
    specularIntensity: 0.5,
    clearcoat: 0.12,
    clearcoatRoughness: 0.4,
  });
  const oldNail = nailMesh.material as Material;
  skinMesh.material = skin;
  nailMesh.material = nail;
  for (const m of meshes) m.frustumCulled = false;
  baked.dispose();
  oldNail.dispose();

  // Mesma escala dos dados: palma (pulso -> base do médio) = 1
  const hand = new Object3D();
  gltf.scene.scale.setScalar(1 / rig.palmLen);
  hand.add(gltf.scene);
  scene.add(hand);

  const tone = new Color(SKIN_TONES[0]);

  return {
    renderer,
    scene,
    camera,
    rig,
    hand,
    tone,
    setPose(local) {
      jointBones.forEach((b, j) => b.quaternion.copy(local[j]));
      skin.color.copy(tone);
      // a cor por vértice do modelo (0,74 a 0,9) escurece um pouco; aqui volta ao nível da pele
      nail.color.copy(tone).lerp(NAIL_TINT, 0.1).multiplyScalar(1.1);
    },
    resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return false;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      return true;
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      skin.normalMap?.dispose();
      skin.dispose();
      nail.dispose();
      envTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
