import { tokens } from '../styles/tokens';

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  rotation: number;
  rotationSpeed: number;
}

// Paleta do Traço (tokens): tangerina da seta, petróleo da mão e ouro do XP, nos tons dos dois modos
const COLORS = [
  tokens['color.tangerina.550'],
  tokens['color.tangerina.400'],
  tokens['color.petroleo.600'],
  tokens['color.petroleo.300'],
  tokens['color.ouro.400'],
];

/** `colors` troca a paleta (ex.: a cor da liga nova na promoção, spec-05 5.2). */
export function launchConfetti(count = 60, duration = 2500, colors: readonly string[] = COLORS) {
  // Com menos movimento não há chuva de confete: o texto e o ícone já dizem que deu certo
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;width:100%;height:100%';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; } // sem canvas 2d (jsdom/headless): no-op
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -10,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 3 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 5,
      life: 0,
      maxLife: Math.random() * (duration * 0.6) + duration * 0.4,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.2,
    });
  }

  const start = performance.now();
  let raf: number;

  function draw(now: number) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const elapsed = now - start;

    for (const p of particles) {
      p.life += 16;
      if (p.life > p.maxLife) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.rotation += p.rotationSpeed;
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }

    if (elapsed < duration + 500) {
      raf = requestAnimationFrame(draw);
    } else {
      canvas.remove();
    }
  }

  raf = requestAnimationFrame(draw);
  setTimeout(() => { cancelAnimationFrame(raf); canvas.remove(); }, duration + 600);
}
