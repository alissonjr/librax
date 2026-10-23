#!/usr/bin/env node
// Gera os efeitos sonoros do Librax por síntese (nenhum som de terceiros).
//
// 1. Sintetiza cada evento de `sound.*` (docs/design-tokens.json) com apps/web-poc/src/lib/sfxSynth.js,
//    o mesmo código que o app usa como reserva em tempo de execução.
// 2. Grava WAV PCM 16 bits mono 44,1 kHz numa pasta temporária.
// 3. Converte para AAC em .m4a (toca no Safari iOS e no Chrome Android; OGG falha no Safari)
//    em apps/web-poc/public/audio/<file>.m4a, com o primeiro conversor que existir:
//    - ffmpeg (encoder aac nativo);
//    - gst-launch-1.0 com avenc_aac (o mesmo encoder AAC do FFmpeg, via gst-libav) e mp4mux.
//    Sem nenhum dos dois, avisa e sai com código 0: o app sintetiza os sons em tempo de execução
//    (src/lib/sound.ts), então nada quebra.
//
// Uso: node tools/audio/build.mjs   (ou "npm run sounds" em apps/web-poc)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { synthesize } from '../../apps/web-poc/src/lib/sfxSynth.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = resolve(ROOT, 'apps/web-poc/public/audio');
const TOKENS = JSON.parse(readFileSync(resolve(ROOT, 'docs/design-tokens.json'), 'utf8'));
const SAMPLE_RATE = 44100;

/** PCM 16 bits mono -> bytes de um arquivo WAV. */
function wav(samples, sr) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

function pickConverter() {
  if (has('ffmpeg', ['-hide_banner', '-version'])) {
    return {
      name: 'ffmpeg (aac)',
      run: (src, dst) => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'aac', '-b:a', '96k', dst]),
    };
  }
  if (has('gst-inspect-1.0', ['avenc_aac']) && has('gst-inspect-1.0', ['mp4mux'])) {
    return {
      name: 'GStreamer (avenc_aac + mp4mux)',
      run: (src, dst) =>
        spawnSync('gst-launch-1.0', [
          '-q', 'filesrc', `location=${src}`, '!', 'wavparse', '!', 'audioconvert', '!', 'audioresample', '!',
          'avenc_aac', 'bitrate=96000', '!', 'mp4mux', '!', 'filesink', `location=${dst}`,
        ]),
    };
  }
  return null;
}

const events = Object.entries(TOKENS.sound)
  .filter(([key]) => !key.startsWith('$'))
  .map(([key, t]) => ({ key, ...t.$value }));

const converter = pickConverter();
if (!converter) {
  console.warn('Nem ffmpeg nem GStreamer com avenc_aac encontrados: nenhum .m4a gerado.');
  console.warn('O app segue sintetizando os sons em tempo de execução (src/lib/sound.ts).');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'librax-sfx-'));
mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
try {
  for (const ev of events) {
    const samples = synthesize(ev.key, SAMPLE_RATE, ev.durationMs);
    const src = join(tmp, `${ev.file}.wav`);
    const dst = join(OUT_DIR, `${ev.file}.m4a`);
    writeFileSync(src, wav(samples, SAMPLE_RATE));
    const r = converter.run(src, dst);
    if (r.status !== 0) {
      throw new Error(`Falha ao converter ${ev.file}: ${r.stderr?.toString() ?? ''}`);
    }
    total += statSync(dst).size;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`Sons: ${events.length} arquivos (${(total / 1024).toFixed(1)} KB) via ${converter.name} -> ${relative(ROOT, OUT_DIR)}`);
