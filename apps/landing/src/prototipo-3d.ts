/*
 * Entrada do protótipo da abertura com a mão em 3D (prototipo-3d.html): tudo da landing
 * (main.ts) e, depois que a página carrega, a mão em 3D (mao3d.ts, com o motor 3D e o modelo
 * da mão) sob demanda. Até lá, ou sem suporte a 3D no navegador, ficam as seis mãos desenhadas.
 */
import './main';
import './prototipo-3d.css';

function canDraw3d(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function start() {
  const stage = document.querySelector<HTMLElement>('[data-stage]');
  if (!stage || !canDraw3d()) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const debug = new URLSearchParams(location.search).has('esqueleto');
  import('./mao3d')
    .then((m) => m.startHand3d(stage, { reduced, debug }))
    .catch((e) => {
      // Sem a mão em 3D, a abertura desenhada continua no lugar
      console.warn('abertura em 3D indisponível', e);
      delete stage.dataset.view;
    });
}

if (document.readyState === 'complete') start();
else window.addEventListener('load', start, { once: true });
