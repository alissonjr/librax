#!/usr/bin/env node
// Tira as telas reais do app (apps/web-poc) que aparecem nas molduras de celular da landing,
// nos três idiomas, e grava em public/img/app/<idioma>/<tela>.webp + src/telas.json (tamanhos).
//
// Precisa do app rodando (npm run dev em apps/web-poc, com public/ml e public/vlibras) e de um
// Chromium. Nenhuma pessoa aparece: a câmera é um vídeo falso escuro e o avatar é o VLibras.
//
//   APP=http://127.0.0.1:5173 CHROME=/caminho/do/chrome npm run telas
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP ?? 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME;
const OUT = resolve(AQUI, '../public/img/app');
const MANIFEST = resolve(AQUI, '../src/telas.json');
const DEBUG = process.argv.includes('--debug');
const SO = process.argv.find((a) => a.startsWith('--telas='))?.slice(8).split(',');
const IDIOMAS = (process.argv.find((a) => a.startsWith('--idiomas='))?.slice(10).split(',')) ?? ['pt-BR', 'en', 'es'];
const W = 390;
const H = 844;

// Vídeo falso da câmera: quadros escuros e lisos (Y4M), sem ninguém na frente.
function videoEscuro() {
  const file = resolve(tmpdir(), 'librax-camera-escura.y4m');
  if (existsSync(file)) return file;
  const w = 640, h = 480, frames = 30;
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([
    Buffer.from('FRAME\n'),
    Buffer.alloc(w * h, 34),
    Buffer.alloc((w / 2) * (h / 2), 126),
    Buffer.alloc((w / 2) * (h / 2), 131),
  ]);
  writeFileSync(file, Buffer.concat([header, ...Array(frames).fill(frame)]));
  return file;
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${videoEscuro()}`,
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const manifest = existsSync(MANIFEST) ? JSON.parse((await import('node:fs')).readFileSync(MANIFEST, 'utf8')) : {};

async function salvar(page, locale, nome) {
  const dir = resolve(OUT, locale);
  mkdirSync(dir, { recursive: true });
  const png = await page.screenshot({ type: 'png' });
  if (DEBUG) writeFileSync(resolve(tmpdir(), `librax-${locale}-${nome}.png`), png);
  // WebP pelo próprio Chromium (canvas), sem dependência de imagem no Node
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const url = c.toDataURL('image/webp', 0.82);
    return { data: url.split(',')[1], w: c.width, h: c.height };
  }, png.toString('base64'));
  writeFileSync(resolve(dir, `${nome}.webp`), Buffer.from(webp.data, 'base64'));
  manifest[locale] = { ...(manifest[locale] ?? {}), [nome]: { w: webp.w, h: webp.h } };
  console.log(`${locale}/${nome}.webp ${Math.round(Buffer.from(webp.data, 'base64').length / 1024)} KB`);
}

const NOMES = { 'pt-BR': 'Ana', en: 'Ana', es: 'Ana' };

for (const locale of IDIOMAS) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    locale,
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true,
    permissions: ['camera'],
    reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(([lang, nome]) => {
    if (sessionStorage.getItem('lx-capt')) return;
    sessionStorage.setItem('lx-capt', '1');
    localStorage.setItem('librax_displayName', nome);
    localStorage.setItem('librax_lang', lang);
    for (const f of ['installSuggested', 'firstCameraExercise', 'dynamicIntroSeen', 'nameFingerspellDone', 'firstCameraSuccess']) {
      localStorage.setItem(`librax_${f}`, '1');
    }
  }, [locale, NOMES[locale]]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => DEBUG && console.log('pageerror', e.message));

  // Progresso de exemplo: as unidades 1 e 2 concluídas, pelo mesmo caso de uso que o app usa
  await page.goto(`${APP}/aprender`);
  await page.waitForTimeout(3000);
  const apiRoot = resolve(AQUI, '../../../services/api/src');
  await page.evaluate(async (usecase) => {
    const [{ getDb }, { IdbRepo }, { getUserId }, { course }, { getToday }, { completeLesson }] = await Promise.all([
      import('/src/lib/db.ts'),
      import('/src/lib/idbRepo.ts'),
      import('/src/lib/auth.ts'),
      import('/src/lib/course.ts'),
      import('/src/lib/today.ts'),
      import(usecase),
    ]);
    const userId = getUserId();
    const repo = new IdbRepo(await getDb(), userId);
    const u1 = course.units[0].lessons.map((l) => l.id);
    const u2 = course.units[1].lessons.map((l) => l.id);
    for (const lessonId of [...u1, ...u2]) {
      await completeLesson(
        repo,
        { lessons: course.lessonsMap, achievementRules: course.achievementRules, signsOrder: course.signsOrder },
        { userId, lessonId, today: getToday(), score: 1, reviewed: [], signsLearnedDelta: 3, alphabetComplete: lessonId === u1[u1.length - 1] },
      );
    }
  }, `/@fs${apiRoot}/usecases/completeLesson.js`);

  const quer = (nome) => !SO || SO.includes(nome);

  if (quer('mapa')) {
    await page.goto(`${APP}/aprender`);
    await page.waitForTimeout(4000);
    // Fecha o que abrir por cima (conquista, liga)
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});
    // Lição atual (com a seta girando) no meio da tela, com a unidade 2 concluída acima
    await page.evaluate(() => {
      const atual = document.querySelector('.trace-orbit')?.closest('li') ?? document.querySelector('.trace-orbit');
      if (!atual) return;
      const r = atual.getBoundingClientRect();
      window.scrollBy(0, r.top - window.innerHeight * 0.52);
    });
    await page.waitForTimeout(1200);
    await salvar(page, locale, 'mapa');
  }

  /** Abre a lição, responde o primeiro exercício (a lição passa a guardar o andamento) e devolve os exercícios. */
  async function abrirLicao(lessonId) {
    await page.goto(`${APP}/licao/${lessonId}`);
    await page.waitForTimeout(2500);
    await page.locator('.lesson-footer button, .exercise-screen button.btn-primary').last().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    return page.evaluate((id) => {
      const k = Object.keys(localStorage).find((key) => key.startsWith('librax_lessonRun:') && key.endsWith(`:${id}`));
      return k ? { key: k, run: JSON.parse(localStorage.getItem(k)) } : null;
    }, lessonId);
  }

  async function irPara(state, index) {
    // Sai da lição antes de mexer no andamento (ao sair ela grava o próprio) e volta no índice pedido
    await page.goto(`${APP}/aprender`);
    await page.waitForTimeout(1500);
    await page.evaluate(({ key, run, index }) => {
      localStorage.setItem(key, JSON.stringify({ ...run, index, savedAt: Date.now() }));
    }, { ...state, index });
    await page.goto(`${APP}/licao/${state.run.lessonId}`);
    await page.waitForTimeout(2500);
  }


  if (DEBUG && process.env.LICOES) {
    for (const id of process.env.LICOES.split(',')) {
      const st = await abrirLicao(id);
      console.log(id, st?.run.exercises.map((e, i) => `${i}:${e.type}:${e.signId ?? ''}`).join(' '));
    }
  }

  const indice = (st, tipo) => st.run.exercises.findIndex((e, i) => i > 0 && e.type === tipo);

  if (quer('intro') || quer('escolha') || quer('frase')) {
    const st = await abrirLicao('u3-l1');
    if (!st) throw new Error('lição u3-l1 não abriu');
    if (quer('intro')) {
      // Apresentação de um sinal: espera o avatar e pega no meio do movimento
      await irPara(st, indice(st, 'sign_intro'));
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.querySelector('.trace-arrow-icon'));
        return b && !b.disabled;
      }, null, { timeout: 90000 });
      await page.waitForTimeout(1500);
      await page.locator('button:has(.trace-arrow-icon)').first().click();
      await page.waitForTimeout(Number(process.env.MEIO ?? 2000));
      await salvar(page, locale, 'intro');
    }
    if (quer('escolha')) {
      // Assistir e escolher: marca a resposta certa e verifica (painel de acerto)
      const i = indice(st, 'watch_choose_word');
      await irPara(st, i);
      await page.waitForTimeout(6000);
      const ex = st.run.exercises[i];
      const certo = await page.evaluate(async (signId) => {
        const { course } = await import('/src/lib/course.ts');
        const s = course.signs?.[signId] ?? course.signsMap?.[signId];
        return s?.gloss ?? s?.word ?? null;
      }, ex.signId);
      if (DEBUG) console.log('resposta', ex.signId, certo, ex.choices);
      const alvo = certo ?? ex.choices.find((c) => ex.signId.toUpperCase().includes(String(c).toUpperCase()));
      await page.locator('.exercise-screen button', { hasText: new RegExp(`^\\s*${alvo}\\s*$`, 'i') }).first().click({ timeout: 5000 }).catch(() => {});
      // O acerto avança sozinho depois de um instante: o print sai logo depois do toque
      await page.waitForTimeout(Number(process.env.APOS_TOQUE ?? 450));
      await salvar(page, locale, 'escolha');
    }
    if (quer('frase')) {
      // Montar a frase: os blocos prontos para tocar
      const i = indice(st, 'build_phrase');
      if (i > 0) {
        await irPara(st, i);
        await page.waitForTimeout(5000);
        // Dois blocos já tocados: a frase começando a se formar
        for (const bloco of ['O-I', 'TUDO']) {
          await page.locator('button', { hasText: new RegExp(`^\\s*${bloco}\\s*$`) }).first().click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
        await salvar(page, locale, 'frase');
      } else console.log('sem build_phrase em u3-l1');
    }
  }

  if (quer('camera')) {
    // Exercício com a câmera (palco escuro). O vídeo falso é escuro e sem ninguém.
    const st = await abrirLicao('u1-l1');
    if (!st) throw new Error('lição u1-l1 não abriu');
    await irPara(st, indice(st, 'perform_sign'));
    await page.waitForTimeout(Number(process.env.CAMERA_MS ?? 9000));
    await salvar(page, locale, 'camera');
  }

  await ctx.close();
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
await browser.close();
