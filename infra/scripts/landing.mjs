#!/usr/bin/env node
// Build e publicacao da landing (apps/landing) no bucket e no CloudFront dela (lib/landing.ts).
//
//   node scripts/landing.mjs build      build com os enderecos do contexto do CDK (sem AWS)
//   node scripts/landing.mjs hash       hashes do script inline do build (LANDING_INLINE_SCRIPT_HASHES)
//   node scripts/landing.mjs publicar   build com os outputs da stack, confere o hash da CSP,
//                                       sync no bucket e invalida as tres paginas
//
// O publicar chama a AWS: rodar pelo npm run landing:publicar (scripts/aws.sh e trava da conta).
// VITE_APP_URL e SITE_ORIGIN no ambiente valem mais que o contexto no build.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const infraDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const landingDir = join(infraDir, '..', 'apps', 'landing');
const distDir = join(landingDir, 'dist');
const PAGINAS = ['index.html', 'en/index.html', 'es/index.html'];
const STACK = 'LibraxStack';

/** Contexto do CDK: o cdk.context.json (local) vale mais que o cdk.json. */
export function contexto(dir = infraDir) {
  let ctx = {};
  for (const arquivo of ['cdk.json', 'cdk.context.json']) {
    const caminho = join(dir, arquivo);
    if (!existsSync(caminho)) continue;
    const json = JSON.parse(readFileSync(caminho, 'utf8'));
    ctx = { ...ctx, ...(arquivo === 'cdk.json' ? json.context : json) };
  }
  return ctx;
}

/** Enderecos do build da landing, com os mesmos padroes de lib/config.ts. */
export function enderecos(ctx) {
  const str = (chave, padrao) => {
    const v = ctx[`librax:${chave}`];
    return v === undefined || v === null || v === '' ? padrao : String(v);
  };
  const dominio = str('domainName', 'librax.example');
  return {
    appUrl: `https://${str('appDomainName', `app.${dominio}`)}/`,
    siteOrigin: `https://${str('landingDomainName', dominio)}`,
  };
}

/** Mesma conta de inlineScriptHashes (lib/landing.ts). */
export function hashesDoHtml(html) {
  const hashes = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, attrs, corpo] = m;
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const tipo = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1].toLowerCase();
    if (tipo && tipo !== 'module' && tipo !== 'text/javascript') continue;
    hashes.push(`sha256-${createHash('sha256').update(corpo, 'utf8').digest('base64')}`);
  }
  return hashes;
}

export function hashesDoBuild(dir = distDir) {
  const hashes = new Set();
  for (const pagina of PAGINAS) {
    const arquivo = join(dir, pagina);
    if (existsSync(arquivo)) for (const h of hashesDoHtml(readFileSync(arquivo, 'utf8'))) hashes.add(h);
  }
  return [...hashes].sort();
}

/** Devolve a mensagem de erro, ou null quando a CSP publicada libera o script do build. */
export function erroDosHashes(doBuild, daStack) {
  const publicados = daStack === '(nenhum)' ? [] : daStack.split(/\s+/).filter(Boolean);
  const faltando = doBuild.filter((h) => !publicados.includes(h));
  if (!faltando.length) return null;
  return (
    `A CSP publicada nao libera o script inline deste build (${faltando.join(' ')}). ` +
    'Rode npm run deploy (o synth recalcula o hash do dist/) e depois publique a landing de novo.'
  );
}

function rodar(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function build({ appUrl, siteOrigin }) {
  if (!existsSync(join(landingDir, 'package.json'))) {
    console.error(`Landing nao encontrada em ${landingDir}.`);
    process.exit(1);
  }
  if (!existsSync(join(landingDir, 'node_modules'))) rodar('npm', ['ci'], { cwd: landingDir });
  console.log(`landing: VITE_APP_URL=${appUrl} SITE_ORIGIN=${siteOrigin}`);
  rodar('npm', ['run', 'build'], {
    cwd: landingDir,
    env: { ...process.env, VITE_APP_URL: appUrl, SITE_ORIGIN: siteOrigin },
  });
}

function outputsDaStack() {
  const saida = execFileSync(
    'aws',
    ['cloudformation', 'describe-stacks', '--stack-name', STACK, '--query', 'Stacks[0].Outputs', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return Object.fromEntries(JSON.parse(saida).map((o) => [o.OutputKey, o.OutputValue]));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const comando = process.argv[2];
  if (comando === 'build') {
    const padrao = enderecos(contexto());
    build({
      appUrl: process.env.VITE_APP_URL || padrao.appUrl,
      siteOrigin: process.env.SITE_ORIGIN || padrao.siteOrigin,
    });
  } else if (comando === 'hash') {
    if (!existsSync(join(distDir, 'index.html'))) {
      console.error('Sem build da landing: rode npm run landing:build antes.');
      process.exit(1);
    }
    const hashes = hashesDoBuild();
    console.log(hashes.map((h) => `'${h}'`).join(', ') || '(nenhum script inline)');
  } else if (comando === 'publicar') {
    const out = outputsDaStack();
    for (const chave of ['AppUrl', 'LandingUrl', 'LandingBucketName', 'LandingDistributionId', 'LandingScriptHashes']) {
      if (!out[chave]) {
        console.error(`A stack ${STACK} nao tem o output ${chave}: rode npm run deploy antes.`);
        process.exit(1);
      }
    }
    build({ appUrl: `${out.AppUrl.replace(/\/$/, '')}/`, siteOrigin: out.LandingUrl });
    const erro = erroDosHashes(hashesDoBuild(), out.LandingScriptHashes);
    if (erro) {
      console.error(erro);
      process.exit(1);
    }
    rodar('aws', ['s3', 'sync', distDir, `s3://${out.LandingBucketName}`, '--delete']);
    // /assets/* tem hash no nome; as paginas tem cache curto, mas a invalidacao mostra na hora
    rodar('aws', [
      'cloudfront', 'create-invalidation', '--distribution-id', out.LandingDistributionId,
      '--paths', ...PAGINAS.map((p) => `/${p}`),
    ]);
    console.log(`Landing publicada em ${out.LandingUrl}`);
  } else {
    console.error('uso: node scripts/landing.mjs build | hash | publicar');
    process.exit(2);
  }
}
