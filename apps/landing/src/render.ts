/*
 * Monta o HTML de cada idioma da landing (gerado no build e no dev por scripts/gerar-paginas.ts).
 * Tudo que é conteúdo sai pronto no HTML: a página funciona sem JS, com o lang certo e boa
 * para buscadores. O main.ts só acrescenta a animação das mãos, as abas de instalação e a
 * sugestão de idioma.
 */
import { SYMBOLS } from '../../web-poc/src/icons/symbols';
import { tokens } from '../../web-poc/src/styles/tokens';
import numeros from './numeros.json';
import maos from './maos.json';
import telas from './telas.json';
import { COPY, fill, formatDate, formatNumber, type Copy } from './i18n';
import { LOCALES, localePath, rootRedirectScript, type Locale } from './locale';
import { appLink } from './config';
import { PLATFORMS } from './install';
import { HERO_LETTERS, bonesPath, handViewBox, type Pose } from './hands';

type IconName = keyof typeof SYMBOLS;

const esc = (s: string | number) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function icon(name: IconName, opts: { filled?: boolean; cls?: string } = {}): string {
  const sym = SYMBOLS[name];
  const d = (opts.filled && sym.fill) || sym.outline;
  return `<svg class="icon${opts.cls ? ` ${opts.cls}` : ''}" viewBox="0 -960 960 960" width="24" height="24" aria-hidden="true" focusable="false"><path d="${d}" fill="currentColor"/></svg>`;
}

/** Símbolo do Traço (o L desenhado como um movimento), igual ao BrandMark do app. */
function brandMark(size: number, cls = ''): string {
  const small = size <= 24;
  return `<svg class="brand-mark ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path class="brand-mark-trace" d="M20.0 21.0V33.0Q20.0 46.0 33.0 46.0H39.0" fill="none" stroke-width="${small ? 8 : 6.5}" stroke-linecap="round"/><path class="brand-mark-tip" d="M37.0 36.5L52.0 46.0L37.0 55.5z" stroke-width="2" stroke-linejoin="round"/><circle class="brand-mark-dot" cx="20" cy="12.5" r="${small ? 6 : 5}"/></svg>`;
}

function wordmark(size: number): string {
  return `<span class="wordmark" style="--wm:${size}px">${brandMark(Math.round(size * 1.3))}<span class="wordmark-text" aria-hidden="true">librax</span></span>`;
}

/** Desenho da mão: ossos num path (com o halo escuro por baixo) e as 21 articulações. */
function handSvg(pose: Pose, letter: string, state: string | null, cls = ''): string {
  const d = bonesPath(pose);
  const joints = Array.from({ length: 21 }, (_, i) => {
    const tip = i > 0 && i % 4 === 0;
    return `<circle class="hand-joint${tip ? ' is-tip' : ''}" cx="${pose[i * 2]}" cy="${pose[i * 2 + 1]}" r="${tip ? 0.055 : 0.045}"/>`;
  }).join('');
  const st = state ? ` data-state="${state}"` : '';
  return `<svg class="hand ${cls}"${st} viewBox="${handViewBox(letter)}" aria-hidden="true" focusable="false"><path class="hand-halo" d="${d}"/><path class="hand-bones" d="${d}"/><g class="hand-joints">${joints}</g></svg>`;
}

/**
 * Vista em 3D da abertura. Com JS, o palco abre só com esta moldura vazia (carregando) e a mão
 * aparece nela; sem JS, ou sem 3D no navegador, ficam as seis mãos desenhadas (as .tiles).
 * Quem decide é o CSS (abertura-3d.css), pela classe lx-js e pelo data-view do palco.
 */
function stage3d(): string {
  const letters = HERO_LETTERS.map((L) => `<li data-letter="${L}" data-state="idle">${L}</li>`).join('');
  return `
      <div class="stage3d" data-stage3d>
        <div class="tile stage3d-view" data-state="idle" data-stage3d-view data-loading>
          <span class="tile-guide" aria-hidden="true"></span>
          <canvas class="stage3d-canvas" data-stage3d-canvas aria-hidden="true"></canvas>
          <span class="tile-letter" aria-hidden="true" data-stage3d-letter>${HERO_LETTERS[0]}</span>
          <span class="tile-ok" aria-hidden="true">${icon('check')}</span>
        </div>
        <ol class="stage3d-letters" role="list" aria-hidden="true">${letters}</ol>
      </div>`;
}

interface Shot { w: number; h: number }
type ShotName = 'mapa' | 'intro' | 'escolha' | 'frase' | 'camera';

function shot(locale: Locale, name: ShotName, alt: string, eager = false): string {
  const set = (telas as unknown as Record<string, Record<string, Shot>>)[locale] ?? (telas as unknown as Record<string, Record<string, Shot>>)['pt-BR'];
  const s = set?.[name];
  const folder = (telas as unknown as Record<string, Record<string, Shot>>)[locale] ? locale : 'pt-BR';
  const inner = s
    ? `<img src="/img/app/${folder}/${name}.webp" width="${s.w}" height="${s.h}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : `<span class="phone-empty" role="img" aria-label="${esc(alt)}">${brandMark(48)}</span>`;
  return `<div class="phone"><div class="phone-screen">${inner}</div></div>`;
}

/**
 * canonical e alternate (hreflang) de cada página. Entram depois do processamento do HTML pelo
 * Vite (vite.config.ts), que senão tentaria ler "/" e "/en/" como arquivos.
 */
export function headLinks(locale: Locale, origin = ''): string {
  const alternates = LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${origin}${localePath(l)}">`).join('');
  return `<link rel="canonical" href="${origin}${localePath(locale)}">${alternates}<link rel="alternate" hreflang="x-default" href="${origin}${localePath('en')}">`;
}

/**
 * Marca o <html> com JS antes de desenhar: o palco já abre na moldura da mão em 3D, sem mostrar as
 * mãos desenhadas antes. Script inline igual nas três páginas: a CSP da landing libera pelo hash
 * (infra/lib/landing.ts, LANDING_INLINE_SCRIPT_HASHES).
 */
export const JS_CLASS_SCRIPT = "document.documentElement.classList.add('lx-js')";

export function renderPage(locale: Locale): string {
  const c: Copy = COPY[locale];
  const n = (v: number, d = 0) => formatNumber(locale, v, d);
  const N = numeros;
  const vals = {
    unidades: N.curso.unidades,
    licoes: N.curso.licoes,
    sinais: N.curso.sinais,
    animacoes: N.offline.animacoes,
    letras: N.letras.letras_estaticas,
    testes: n(N.testes_app),
  };
  const f = (s: string, extra: Record<string, string | number> = {}) => esc(fill(s, { ...vals, ...extra }));
  const pessoas = N.treino.pessoas_alfabeto + N.treino.pessoas_sinais;
  const pessoasMin = Math.floor(pessoas / 10) * 10;
  const canonical = localePath(locale);

  const langMenu = `
    <details class="lang" data-lang-menu>
      <summary class="lang-btn" aria-label="${esc(c.lang.label)}: ${esc(c.lang.names[locale])}">${icon('language')}<span>${esc(c.lang.short[locale])}</span></summary>
      <ul class="lang-list">
        ${LOCALES.map(
          (l) =>
            `<li><a href="${localePath(l)}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === locale ? ' aria-current="true"' : ''}>${esc(c.lang.names[l])}${l === locale ? icon('check') : ''}</a></li>`,
        ).join('')}
      </ul>
    </details>`;

  const navItems: [string, string][] = [
    ['recursos', c.nav.features],
    ['licoes', c.nav.lessons],
    ['privacidade', c.nav.privacy],
    ['offline', c.nav.offline],
    ['numeros', c.nav.numbers],
    ['instalar', c.nav.install],
    ['duvidas', c.nav.faq],
  ];

  const tiles = HERO_LETTERS.map((L, i) => {
    const poses = (maos.letras as Record<string, { poses: number[][] }>)[L].poses;
    return `<li class="tile" data-letter="${L}" data-state="correct" style="--i:${i}">
        <span class="tile-guide" aria-hidden="true"></span>
        ${handSvg(poses[0], L, null)}
        <span class="tile-letter" aria-hidden="true">${L}</span>
        <span class="tile-ok" aria-hidden="true">${icon('check')}</span>
      </li>`;
  }).join('');

  const featureCards = c.features.items
    .map(
      (it) => `<li class="card feature">
        <span class="feature-icon">${icon(it.icon as IconName, { filled: true })}</span>
        <span class="chip">${f(it.badge)}</span>
        <h3>${esc(it.title)}</h3>
        <p>${f(it.text)}</p>
      </li>`,
    )
    .join('');

  const shotNames: ShotName[] = ['mapa', 'intro', 'escolha', 'frase', 'camera'];
  const shotAlts = [c.lessons.shots.map, c.lessons.shots.intro, c.lessons.shots.choose, c.lessons.shots.phrase, c.lessons.shots.camera];
  const lessonSteps = c.lessons.steps
    .map(
      (s, i) => `<li class="lesson-step">
        ${shot(locale, shotNames[i], shotAlts[i])}
        <div class="lesson-step-text">
          <span class="step-num" aria-hidden="true">${i + 1}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.text)}</p>
        </div>
      </li>`,
    )
    .join('');

  const privacyIcons: IconName[] = ['videocam', 'sign_language', 'memory', 'check_circle'];
  const lPose = (maos.letras as Record<string, { poses: number[][] }>).L.poses[1] ?? maos.letras.L.poses[0];
  const privacySteps = c.privacy.steps
    .map((s, i) => {
      const art =
        i === 1
          ? handSvg(lPose, 'L', 'tracking', 'mini')
          : i === 3
            ? `<span class="flow-letter">L ${icon('check_circle', { filled: true })}</span>`
            : icon(privacyIcons[i], { filled: true, cls: 'flow-icon' });
      return `<li class="flow-step"><span class="flow-art">${art}</span><span class="flow-text"><strong>${esc(s.title)}</strong> ${esc(s.text)}</span></li>`;
    })
    .join('');

  const offlineSteps = c.offline.steps
    .map((s, i) => `<li class="track-step"><span class="track-node" aria-hidden="true">${i + 1}</span><div><h3>${esc(s.title)}</h3><p>${f(s.text)}</p></div></li>`)
    .join('');

  const T = N.treino;
  const pctAlfa = (T.horas_alfabeto / T.horas_total) * 100;

  const installPanels = PLATFORMS.map(
    (p) => `<div class="install-panel" id="instalar-${p}" role="tabpanel" aria-labelledby="aba-${p}" data-platform="${p}">
        <h3 class="install-panel-title">${esc(c.install.platforms[p])}</h3>
        <ol class="install-steps">${c.install.steps[p].map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>`,
  ).join('');

  const faq = c.faq.items
    .map((q) => `<details class="faq-item"><summary><span>${esc(q.q)}</span>${icon('chevron_right', { cls: 'faq-chevron' })}</summary><p>${f(q.a)}</p></details>`)
    .join('');


  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${locale === 'pt-BR' ? `<script>${rootRedirectScript()}</script>\n` : ''}<title>${esc(c.meta.title)}</title>
<meta name="description" content="${esc(c.meta.description)}">
<meta name="theme-color" content="${tokens['theme.light.bg.canvas']}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${tokens['theme.dark.bg.canvas']}" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<!--lx:links:${locale}-->
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(c.meta.title)}">
<meta property="og:description" content="${esc(c.meta.description)}">
<meta property="og:locale" content="${c.meta.ogLocale}">
<meta property="og:image" content="/icon-512.png">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/Anybody-latin-wdth-wght.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Figtree-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
<script>${JS_CLASS_SCRIPT}</script>
<link rel="stylesheet" href="/src/style.css">
<script type="module" src="/src/main.ts"></script>
</head>
<body>
<svg width="0" height="0" class="sr-defs" aria-hidden="true" focusable="false"><defs><marker id="lx-tip" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="trace-tip"/></marker></defs></svg>
<a class="skip" href="#conteudo">${esc(c.skip)}</a>

<header class="site-header">
  <div class="wrap header-row">
    <a class="home-link" href="${canonical}" aria-label="${esc(c.nav.home)}">${wordmark(22)}</a>
    <nav class="site-nav" aria-label="${esc(c.nav.label)}">
      <ul>${navItems.map(([id, label]) => `<li><a href="#${id}">${esc(label)}</a></li>`).join('')}</ul>
    </nav>
    <div class="header-actions">
      ${langMenu}
      <a class="btn btn-primary btn-sm" href="${appLink('', locale)}">${esc(c.nav.open)}</a>
    </div>
  </div>
</header>

<div class="lang-suggest" data-lang-suggest hidden data-texts="${esc(JSON.stringify(Object.fromEntries(LOCALES.map((l) => [l, { suggest: COPY[l].lang.suggest, action: COPY[l].lang.suggestAction }]))))}" data-dismiss="${esc(c.lang.dismiss)}">
  <div class="wrap lang-suggest-row">
    ${icon('language')}
    <p data-lang-suggest-text></p>
    <a class="btn-text" href="/" data-lang-suggest-link></a>
    <button class="icon-btn" type="button" data-lang-suggest-close aria-label="">${icon('close')}</button>
  </div>
</div>

<main id="conteudo" tabindex="-1">

<section class="hero" aria-labelledby="hero-title">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="chip chip-hand">${icon('sign_language', { filled: true })}${esc(c.hero.eyebrow)}</p>
      <h1 id="hero-title"><span>${esc(c.hero.titleA)}</span> <span class="hero-accent">${esc(c.hero.titleB)}</span></h1>
      <p class="lead">${esc(c.hero.lead)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${appLink('', locale)}">${esc(c.hero.cta)}${icon('arrow_forward')}</a>
        <a class="btn btn-secondary" href="#instalar">${icon('mobile_arrow_down')}${esc(c.hero.install)}</a>
      </div>
      <p class="hero-note">${icon('shield', { filled: true })}${esc(c.hero.privacy)}</p>
    </div>
    <figure class="stage" data-stage aria-label="${esc(c.hero.stageLabel)}">
      <div class="stage-bar">
        <span class="stage-pill"><span class="rec-dot" aria-hidden="true"></span>${esc(c.hero.stageStatus)}</span>
        <span class="stage-pill stage-status" aria-hidden="true" data-stage-status data-reading="${esc(c.hero.stageReading)}" data-done="${esc(c.hero.stageDone)}">${icon('check_circle', { filled: true })}<span class="stage-word-loading">${esc(c.hero.stageReading)}...</span><span data-stage-word>${esc(c.hero.stageDone)}: LIBRAX</span></span>
      </div>
      <ol class="tiles" role="list">${tiles}</ol>${stage3d()}
      <figcaption class="stage-caption">
        <span>${esc(c.hero.stageCaption)}</span>
        <button class="stage-toggle" type="button" data-stage-toggle hidden data-pause="${esc(c.hero.pause)}" data-play="${esc(c.hero.play)}" aria-label="${esc(c.hero.pause)}">${icon('pause', { filled: true, cls: 'when-playing' })}${icon('play_arrow', { filled: true, cls: 'when-paused' })}</button>
      </figcaption>
    </figure>
  </div>
</section>

<section class="section" id="recursos" aria-labelledby="recursos-title">
  <div class="wrap">
    <header class="section-head">
      <h2 id="recursos-title">${esc(c.features.title)}</h2>
      <p class="lead">${esc(c.features.lead)}</p>
    </header>
    <ul class="features" role="list">${featureCards}</ul>
    <div class="topics">
      <h3 class="eyebrow">${esc(c.features.topicsTitle)}</h3>
      <ul class="chips" role="list">${c.features.topics.map((t) => `<li class="chip chip-trace">${esc(t)}</li>`).join('')}</ul>
    </div>
  </div>
</section>

<section class="section section-alt" id="licoes" aria-labelledby="licoes-title">
  <div class="wrap">
    <header class="section-head">
      <h2 id="licoes-title">${esc(c.lessons.title)}</h2>
      <p class="lead">${esc(c.lessons.lead)}</p>
    </header>
    <ol class="lesson-steps" role="list">${lessonSteps}</ol>
    <div class="topics">
      <h3 class="eyebrow">${esc(c.lessons.typesTitle)}</h3>
      <ul class="chips" role="list">${c.lessons.types.map((t) => `<li class="chip">${esc(t)}</li>`).join('')}</ul>
    </div>
  </div>
</section>

<section class="section" id="privacidade" aria-labelledby="privacidade-title">
  <div class="wrap privacy-grid">
    <header class="section-head">
      <h2 id="privacidade-title">${esc(c.privacy.title)}</h2>
      <p class="lead">${esc(c.privacy.lead)}</p>
      <p class="note">${icon('shield', { filled: true })}${esc(c.privacy.note)}</p>
    </header>
    <div class="flow">
      <div class="flow-device">
        <span class="flow-device-label">${icon('mobile_arrow_down')}${esc(c.privacy.device)}</span>
        <ol class="flow-steps" role="list">${privacySteps}</ol>
      </div>
      <div class="flow-cloud">
        <span class="flow-cut" aria-hidden="true"></span>
        <span class="flow-cloud-pill">${icon('cloud_off', { filled: true })}<span><strong>${esc(c.privacy.cloud)}</strong> ${esc(c.privacy.cloudText)}</span></span>
      </div>
    </div>
  </div>
</section>

<section class="section section-alt" id="offline" aria-labelledby="offline-title">
  <div class="wrap offline-grid">
    <div>
      <header class="section-head">
        <h2 id="offline-title">${esc(c.offline.title)}</h2>
        <p class="lead">${esc(c.offline.lead)}</p>
      </header>
      <ol class="track" role="list">${offlineSteps}</ol>
    </div>
    <aside class="card offline-card" aria-labelledby="offline-card-title">
      <span class="chip chip-hand">${icon('cloud_off', { filled: true })}${esc(c.nav.offline)}</span>
      <h3 id="offline-card-title">${esc(c.offline.cardTitle)}</h3>
      <ul class="checks" role="list">${c.offline.can.map((t) => `<li>${icon('check_circle', { filled: true })}${esc(t)}</li>`).join('')}</ul>
      <p class="note">${esc(c.offline.cardNote)}</p>
    </aside>
  </div>
</section>

<section class="section numbers" id="numeros" aria-labelledby="numeros-title">
  <div class="wrap">
    <header class="section-head">
      <h2 id="numeros-title">${esc(c.numbers.title)}</h2>
      <p class="lead">${esc(c.numbers.lead)}</p>
    </header>

    <h3 class="group-title">${esc(c.numbers.lettersTitle)}</h3>
    <div class="stats stats-letters">
      <div class="card stat stat-hero">
        <p class="stat-value">${n(N.letras.acerto_pct, 1)}<small>%</small></p>
        <p class="stat-label">${esc(c.numbers.accuracy)}</p>
        <span class="chip chip-stage">${icon('check_circle', { filled: true })}${esc(c.numbers.fixedTest)}</span>
      </div>
      <div class="card stat">
        <p class="stat-value stat-value-md">${f(c.numbers.lettersCount, { n: N.letras.letras_estaticas })}</p>
        <p class="stat-label">${esc(c.numbers.lettersCountText)}</p>
      </div>
    </div>

    <h3 class="group-title">${esc(c.numbers.dataTitle)}</h3>
    <div class="stats stats-data">
      <div class="card stat stat-wide">
        <p class="stat-value">${n(T.horas_total, 1)}<small>h</small></p>
        <p class="stat-label">${esc(c.numbers.hours)}</p>
        <div class="split" role="img" aria-label="${esc(c.numbers.hoursAlphabet)}: ${n(T.horas_alfabeto, 1)} h. ${esc(c.numbers.hoursSigns)}: ${n(T.horas_sinais, 1)} h.">
          <span class="split-bar"><span class="split-a" style="--w:${pctAlfa}%"></span><span class="split-b"></span></span>
          <span class="split-legend"><span><i class="swatch swatch-a"></i>${esc(c.numbers.hoursAlphabet)} <b>${n(T.horas_alfabeto, 1)} h</b></span><span><i class="swatch swatch-b"></i>${esc(c.numbers.hoursSigns)} <b>${n(T.horas_sinais, 1)} h</b></span></span>
        </div>
      </div>
      <div class="card stat"><p class="stat-value stat-value-md">${n(T.videos)}</p><p class="stat-label">${esc(c.numbers.videos)}</p></div>
      <div class="card stat"><p class="stat-value stat-value-md">${n(pessoasMin)}+</p><p class="stat-label">${esc(c.numbers.people)}</p></div>
      <div class="card stat"><p class="stat-value stat-value-md">${n(T.quadros_mil)}<small>${esc(c.numbers.framesUnit)}</small></p><p class="stat-label">${esc(c.numbers.frames)}</p></div>
      <div class="card stat"><p class="stat-value stat-value-md">${n(T.sinais_dicionario)}</p><p class="stat-label">${esc(c.numbers.dictSigns)}</p></div>
    </div>
    <p class="note">${icon('sign_language', { filled: true })}${esc(c.numbers.landmarksNote)}</p>

    <div class="card motion-card">
      <span class="chip chip-warn">${icon('schedule', { filled: true })}${esc(c.numbers.motionBadge)}</span>
      <h3>${esc(c.numbers.motionTitle)}</h3>
      <p>${f(c.numbers.motionText, { n: N.sinais_movimento.piloto_sinais })}</p>
    </div>

    <p class="updated">${f(c.numbers.updated, { data: formatDate(locale, N.atualizado_em) })}</p>
  </div>
</section>

<section class="section section-alt" id="instalar" aria-labelledby="instalar-title">
  <div class="wrap install-grid">
    <div>
      <header class="section-head">
        <h2 id="instalar-title">${esc(c.install.title)}</h2>
        <p class="lead">${esc(c.install.lead)}</p>
      </header>
      <div class="install" data-install>
        <div class="tabs" role="tablist" aria-label="${esc(c.install.tabsLabel)}" hidden data-tabs>
          ${PLATFORMS.map((p) => `<button class="tab" role="tab" type="button" id="aba-${p}" aria-controls="instalar-${p}" aria-selected="false" tabindex="-1" data-tab="${p}">${esc(c.install.platforms[p])}<span class="tab-detected" hidden data-detected>${esc(c.install.detected)}</span></button>`).join('')}
        </div>
        ${installPanels}
      </div>
      <div class="cta-row">
        <a class="btn btn-primary" href="${appLink('', locale)}">${esc(c.install.cta)}${icon('arrow_forward')}</a>
      </div>
      <div class="stores">
        <h3 class="eyebrow">${esc(c.install.storesTitle)}</h3>
        <ul class="store-list" role="list">
          <li class="store"><span class="store-name">Google Play</span><span class="chip chip-muted">${esc(c.install.soon)}</span></li>
          <li class="store"><span class="store-name">App Store</span><span class="chip chip-muted">${esc(c.install.soon)}</span></li>
        </ul>
      </div>
    </div>
    <div class="homescreen" aria-hidden="true">
      <div class="phone phone-home">
        <div class="phone-screen home-grid">
          <svg class="home-trace" viewBox="0 0 244 528" focusable="false"><circle class="trace-start" cx="44" cy="452" r="6"/><path class="trace-line" d="M44 452 C 40 330, 110 250, 166 214" fill="none" stroke-linecap="round" marker-end="url(#lx-tip)"/></svg>
          ${Array.from({ length: 11 }, (_, i) => `<span class="home-app${i === 5 ? ' is-librax' : ''}">${i === 5 ? `${brandMark(56, 'brand-mark--tile')}<small>Librax</small>` : ''}</span>`).join('')}
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section" id="projeto" aria-labelledby="projeto-title">
  <div class="wrap">
    <header class="section-head">
      <h2 id="projeto-title">${esc(c.project.title)}</h2>
      <p class="lead">${esc(c.project.lead)}</p>
    </header>
    <ul class="project" role="list">
      ${c.project.items.map((it, i) => `<li class="card"><span class="feature-icon">${icon((['check_circle', 'shield', 'description'] as IconName[])[i], { filled: true })}</span><h3>${esc(it.title)}</h3><p>${f(it.text)}</p></li>`).join('')}
    </ul>
  </div>
</section>

<section class="section section-alt" id="duvidas" aria-labelledby="duvidas-title">
  <div class="wrap">
    <header class="section-head">
      <h2 id="duvidas-title">${esc(c.faq.title)}</h2>
    </header>
    <div class="faq">${faq}</div>
  </div>
</section>

</main>

<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      ${wordmark(26)}
      <p>${esc(c.footer.tagline)}</p>
      <p class="footer-libras">${esc(c.footer.libras)}</p>
    </div>
    <nav aria-label="${esc(c.footer.app)}">
      <h2 class="footer-title">${esc(c.footer.app)}</h2>
      <ul>
        <li><a href="${appLink('', locale)}">${esc(c.footer.open)}</a></li>
        <li><a href="#instalar">${esc(c.footer.install)}</a></li>
      </ul>
    </nav>
    <nav aria-label="${esc(c.footer.legal)}">
      <h2 class="footer-title">${esc(c.footer.legal)}</h2>
      <ul>
        <li><a href="${appLink('privacidade', locale)}">${esc(c.footer.privacy)}</a></li>
        <li><a href="${appLink('termos', locale)}">${esc(c.footer.terms)}</a></li>
      </ul>
    </nav>
    <nav aria-label="${esc(c.lang.label)}">
      <h2 class="footer-title">${esc(c.lang.label)}</h2>
      <ul>${LOCALES.map((l) => `<li><a href="${localePath(l)}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === locale ? ' aria-current="true"' : ''}>${esc(c.lang.names[l])}</a></li>`).join('')}</ul>
    </nav>
    <div class="footer-credits">
      <h2 class="footer-title">${esc(c.footer.credits)}</h2>
      <p>${esc(c.footer.creditsText)}</p>
      <p>${esc(c.footer.creditsHand)}</p>
      <p class="footer-rights">${esc(c.footer.rights)}</p>
    </div>
  </div>
</footer>
</body>
</html>
`;
}
