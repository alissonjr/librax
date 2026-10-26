/*
 * Desenha as duas mãos da dica de erro (o sinal pedido e o que a câmera leu) com os dedos que
 * mudam destacados, uma vez, em imagens 2D: o contexto 3D abre, desenha e fecha na hora. Assim a
 * dica não disputa a GPU com a câmera, que continua ligada. Quando a diferença é o movimento, os
 * quadros do movimento também viram imagens, e a dica passa as imagens (sem 3D).
 *
 * Mesma cena, mesmas poses e mesmo retargeting da mão em 3D da apresentação (src/mao3d/).
 */
import { BufferAttribute, Color, type Material, MeshPhysicalMaterial, type SkinnedMesh, Vector3 } from 'three';
import { createHandScene, sceneLandmarks } from '../mao3d/cena';
import { BONE_INDEX, clonePose, positions, retarget, solveCollisions, type HandPose } from '../mao3d/retarget';
import { clipFor } from '../mao3d/poses';
import { SKIN_TONES } from '../mao3d/disponivel';
import type { Digit } from './forma';

/** Ossos de cada dedo que acendem (a base do polegar fica de fora: é a palma). */
const DIGIT_BONES: Record<Digit, string[]> = {
  thumb: ['thumb_mcp', 'thumb_ip', 'thumb_tip'],
  index: ['index_mcp', 'index_pip', 'index_dip', 'index_tip'],
  middle: ['middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip'],
  ring: ['ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip'],
  pinky: ['pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip'],
};

/** Quanto a cor do destaque cobre a pele, e o brilho próprio (lê em qualquer tom de pele). */
const MIX = 0.85;
const GLOW = 0.3;
const MARGIN = 0.2;

export interface HandImages {
  /** Uma imagem (mão parada) ou os quadros do movimento, a 15 por segundo. */
  frames: HTMLCanvasElement[];
}

export interface DrawRequest {
  asked: string;
  read: string;
  /** Dedos a destacar nas duas mãos. */
  highlight: readonly Digit[];
  /** Qual das duas mãos mostra o movimento (os quadros todos); a outra fica no meio do movimento. */
  moving: 'asked' | 'read' | null;
  /** Tamanho de cada imagem em pixels de tela e a densidade. */
  width: number;
  height: number;
  pixelRatio: number;
  tone: number;
  /** Cor do destaque (o token stage.landmark.retry, lido do CSS). */
  color: string;
  model: ArrayBuffer;
  /** Para entre um quadro e outro (a tela continua respondendo); false cancela. */
  yieldFrame?: () => Promise<boolean>;
}

/** Peso de destaque de cada vértice: quanto da pele segue os ossos dos dedos destacados. */
function highlightWeights(mesh: SkinnedMesh, digits: readonly Digit[]): Float32Array {
  const names = new Set(digits.flatMap((d) => DIGIT_BONES[d]));
  const lit = mesh.skeleton.bones.map((b) => names.has(b.name));
  const idx = mesh.geometry.getAttribute('skinIndex');
  const wgt = mesh.geometry.getAttribute('skinWeight');
  const out = new Float32Array(idx.count);
  for (let v = 0; v < idx.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (lit[idx.getComponent(v, k)]) w += wgt.getComponent(v, k);
    // Borda nítida na junta: até 35% é pele, de 65% em diante é destaque
    const t = Math.min(1, Math.max(0, (w - 0.35) / 0.3));
    out[v] = t * t * (3 - 2 * t);
  }
  return out;
}

/** Acrescenta o destaque por vértice no material da pele (e das unhas). */
function addHighlight(material: MeshPhysicalMaterial, color: Color) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLxHighlight = { value: color };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lxHighlight;\nvarying float vLxHighlight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLxHighlight = lxHighlight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLxHighlight;\nvarying float vLxHighlight;')
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uLxHighlight, vLxHighlight * ${MIX.toFixed(2)});`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uLxHighlight * vLxHighlight * ${GLOW.toFixed(2)};`);
  };
  material.customProgramCacheKey = () => 'lx-highlight';
  material.needsUpdate = true;
}

interface Track {
  poses: HandPose[];
  offsets: Vector3[];
}

export async function drawHands(req: DrawRequest): Promise<{ asked: HandImages; read: HandImages } | null> {
  const askedClip = clipFor(req.asked);
  const readClip = clipFor(req.read);
  if (!askedClip || !readClip) return null;

  const canvas = document.createElement('canvas');
  const pxW = Math.max(1, Math.round(req.width * req.pixelRatio));
  const pxH = Math.max(1, Math.round(req.height * req.pixelRatio));
  canvas.width = pxW;
  canvas.height = pxH;
  const three = await createHandScene(canvas, req.model, { maxPixelRatio: 1 });
  try {
    const { renderer, scene, camera, rig, hand } = three;
    renderer.setPixelRatio(1);
    renderer.setSize(pxW, pxH, false);
    camera.aspect = pxW / pxH;
    camera.updateProjectionMatrix();
    three.tone.set(SKIN_TONES[req.tone] ?? SKIN_TONES[2]);

    const meshes: SkinnedMesh[] = [];
    scene.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
    });
    const color = new Color(req.color);
    for (const m of meshes) {
      m.geometry.setAttribute('lxHighlight', new BufferAttribute(highlightWeights(m, req.highlight), 1));
      const mat = m.material as Material;
      if (mat instanceof MeshPhysicalMaterial) addHighlight(mat, color);
    }

    const track = (clip: NonNullable<ReturnType<typeof clipFor>>): Track => {
      const p = clip.people[0];
      return {
        poses: p.frames.map((f) => retarget(rig, sceneLandmarks((i) => f[i * 3], (i) => f[i * 3 + 1], (i) => f[i * 3 + 2]))),
        offsets: p.wrist.map(([x, y]) => new Vector3(x, -y, 0)),
      };
    };

    /** Imagens de uma mão: todos os quadros (movimento) ou só o do meio. */
    const shoot = async (t: Track, all: boolean): Promise<HandImages | null> => {
      const ks = all ? t.poses.map((_, k) => k) : [Math.floor((t.poses.length - 1) / 2)];
      // Enquadramento: esfera em volta das articulações dos quadros mostrados (como no motor.ts)
      const local = ks.map((k) => solveCollisions(rig, clonePose(t.poses[k])));
      const pts: Vector3[] = [];
      ks.forEach((k, j) => {
        const joints = positions(rig, local[j]).map((q) => q.divideScalar(rig.palmLen).add(t.offsets[k]));
        pts.push(...joints);
        const wrist = joints[BONE_INDEX.wrist];
        pts.push(wrist.clone().sub(joints[BONE_INDEX.middle_mcp]).multiplyScalar(0.35).add(wrist));
      });
      const lo = new Vector3(Infinity, Infinity, Infinity);
      const hi = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const q of pts) {
        lo.min(q);
        hi.max(q);
      }
      const center = lo.clone().add(hi).multiplyScalar(0.5);
      const radius = Math.max(...pts.map((q) => q.distanceTo(center))) + MARGIN;
      const v = (camera.fov * Math.PI) / 180;
      const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
      const dist = radius / Math.sin(Math.min(v, h) / 2);
      camera.position.set(0, 0, dist);
      camera.near = Math.max(0.05, dist - radius * 2);
      camera.far = dist + radius * 2;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);

      const frames: HTMLCanvasElement[] = [];
      for (let j = 0; j < ks.length; j++) {
        three.setPose(local[j]);
        hand.position.copy(t.offsets[ks[j]]).sub(center);
        renderer.render(scene, camera);
        const out = document.createElement('canvas');
        out.width = pxW;
        out.height = pxH;
        out.getContext('2d')?.drawImage(canvas, 0, 0);
        frames.push(out);
        if (req.yieldFrame && !(await req.yieldFrame())) return null;
      }
      return { frames };
    };

    await renderer.compileAsync(scene, camera);
    const asked = await shoot(track(askedClip), req.moving === 'asked' && askedClip.moving);
    if (!asked) return null;
    const read = await shoot(track(readClip), req.moving === 'read' && readClip.moving);
    if (!read) return null;
    return { asked, read };
  } finally {
    three.dispose();
  }
}

