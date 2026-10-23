import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { HAND_CONNECTIONS, type Lm } from '../lib/recognizer';

/**
 * Esqueleto de mao 3D estilo neon/holograma, dirigido pelos 21 landmarks do
 * MediaPipe.
 *
 * Nao mostra o feed da camera: desenha em three.js as conexoes como linhas
 * brilhantes (nucleo claro + halo aditivo) e as juntas como pontos luminosos
 * (sprite radial + nucleo), que imitam em tempo real a posicao, rotacao e
 * flexao da mao real.
 *
 * Le `landmarksRef.current` a cada frame (sem re-render do React) num loop
 * proprio de requestAnimationFrame.
 */

// Peso de tamanho por landmark (pulso maior, ponta dos dedos menor).
const JOINT_WEIGHT = [
  1.5, // 0 wrist
  1.0, 0.92, 0.84, 0.72, // polegar 1-4
  1.05, 0.9, 0.82, 0.7, // indicador 5-8
  1.05, 0.9, 0.82, 0.7, // medio 9-12
  1.0, 0.88, 0.8, 0.68, // anelar 13-16
  0.95, 0.84, 0.78, 0.66, // mindinho 17-20
];

const SPREAD = 4; // escala mundo: x,y normalizados [0,1] -> [-2,2]

// Paleta neon (ciano da marca).
const NEON = 0x00e5ff; // halo / linhas
const CORE = 0xd6fbff; // nucleo quase branco

/** Landmark normalizado -> posicao no mundo 3D (espelhado no X, camera frontal). */
function toWorld(lm: Lm, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    (0.5 - lm.x) * SPREAD, // espelha + centraliza
    (0.5 - lm.y) * SPREAD, // imagem (y p/ baixo) -> mundo (y p/ cima)
    -lm.z * SPREAD,        // mais perto da camera -> +Z
  );
}

/** Textura radial branca (transparente nas bordas) p/ o glow das juntas. */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

interface Props {
  landmarksRef: React.RefObject<Lm[] | null>;
  className?: string;
}

export function HandAvatar3DCanvas({ landmarksRef, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // WebGL pode nao existir (jsdom/headless, GPU bloqueada): falha silenciosa.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    // Neon = MeshBasicMaterial (sem luz): cor constante e brilhante.
    const coreMat = new THREE.MeshBasicMaterial({ color: CORE });
    const glowMat = new THREE.MeshBasicMaterial({
      color: NEON,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowTex = makeGlowTexture();
    const spriteMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: NEON,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    const hand = new THREE.Group();
    hand.visible = false;
    scene.add(hand);

    // Geometrias unitarias reaproveitadas (transformadas por frame).
    const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12);

    // Ossos: nucleo (fino, claro) + halo (largo, aditivo) por conexao.
    const boneCores: THREE.Mesh[] = [];
    const boneGlows: THREE.Mesh[] = [];
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const core = new THREE.Mesh(cylGeo, coreMat);
      const glow = new THREE.Mesh(cylGeo, glowMat);
      hand.add(glow);
      hand.add(core);
      boneCores.push(core);
      boneGlows.push(glow);
    }

    // Juntas: nucleo (esfera clara) + glow (sprite radial sempre de frente).
    const jointCores: THREE.Mesh[] = [];
    const jointGlows: THREE.Sprite[] = [];
    for (let i = 0; i < 21; i++) {
      const core = new THREE.Mesh(sphereGeo, coreMat);
      const glow = new THREE.Sprite(spriteMat);
      hand.add(glow);
      hand.add(core);
      jointCores.push(core);
      jointGlows.push(glow);
    }

    // Buffers reaproveitados por frame.
    const P: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
    const dir = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();

    function resize() {
      const w = canvas!.clientWidth || 1;
      const h = canvas!.clientHeight || 1;
      if (canvas!.width !== w || canvas!.height !== h) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    }

    let raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      resize();

      const lms = landmarksRef.current;
      if (!lms || lms.length < 21) {
        if (hand.visible) hand.visible = false;
        renderer.render(scene, camera);
        return;
      }
      hand.visible = true;

      for (let i = 0; i < 21; i++) toWorld(lms[i], P[i]);

      // Escala geral derivada do tamanho da mao na tela (pulso -> base do medio).
      const unit = Math.max(0.02, P[0].distanceTo(P[9]));
      const lineCore = unit * 0.05;
      const lineGlow = unit * 0.16;

      // Ossos
      for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
        const [a, b] = HAND_CONNECTIONS[i];
        dir.subVectors(P[b], P[a]);
        const len = dir.length();
        const core = boneCores[i];
        const glow = boneGlows[i];
        if (len < 1e-4) { core.scale.set(0, 0, 0); glow.scale.set(0, 0, 0); continue; }
        mid.addVectors(P[a], P[b]).multiplyScalar(0.5);
        quat.setFromUnitVectors(up, dir.divideScalar(len));
        core.position.copy(mid);
        core.quaternion.copy(quat);
        core.scale.set(lineCore, len, lineCore);
        glow.position.copy(mid);
        glow.quaternion.copy(quat);
        glow.scale.set(lineGlow, len, lineGlow);
      }

      // Juntas
      for (let i = 0; i < 21; i++) {
        const w = JOINT_WEIGHT[i];
        jointCores[i].position.copy(P[i]);
        jointCores[i].scale.setScalar(unit * 0.09 * w);
        jointGlows[i].position.copy(P[i]);
        jointGlows[i].scale.setScalar(unit * 0.55 * w);
      }

      renderer.render(scene, camera);
    }
    frame();

    return () => {
      cancelAnimationFrame(raf);
      sphereGeo.dispose();
      cylGeo.dispose();
      coreMat.dispose();
      glowMat.dispose();
      spriteMat.dispose();
      glowTex.dispose();
      renderer.dispose();
    };
  }, [landmarksRef]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
