import { cameraFiles, signModelPublished, simdSupported, type AssetFile } from './assetDownload';
import { VLIBRAS_BUNDLES_PATH, VLIBRAS_PLAYER_FILES, VLIBRAS_PLAYER_PATH } from './vlibras';
import handModelUrl from '../mao3d/mao-3d.glb?url';

/**
 * Lista do "Baixar para usar offline" (Configurações): os arquivos da câmera e do avatar VLibras,
 * motor e as animações das glosas do curso. Só a tela de Configurações carrega este módulo.
 */

/** Tamanho médio de uma animação (as 252 glosas do curso somam cerca de 6 MB). */
export const SIGN_BUNDLE_BYTES = 24_000;

interface AvatarSign {
  avatar?: { provider: string; gloss: string | null } | null;
}

/** Glosas do avatar nos sinais do curso: a mesma regra de scripts/vlibras-assets.mjs. */
export function courseGlosses(signs: Iterable<AvatarSign>): string[] {
  const glosses = new Set<string>();
  for (const s of signs) {
    if (s.avatar?.provider === 'vlibras' && s.avatar.gloss) {
      for (const g of s.avatar.gloss.split(' ')) if (g) glosses.add(g);
    }
  }
  return [...glosses].sort();
}

/**
 * Player e animações. Cada animação no endereço que o SignDemo confere antes de tocar
 * (encodeURIComponent, em vlibras.ts) e, quando a glosa tem caractere reservado (o "&" de
 * ACORDAR&DESPERTAR), também como o Unity pede (a glosa crua, só com os acentos codificados):
 * o cache do service worker guarda por endereço. Animação que falhar não derruba o resto: sem
 * ela o avatar cai na descrição em texto, como já acontece online.
 */
export function vlibrasFiles(glosses: readonly string[]): AssetFile[] {
  const files: AssetFile[] = VLIBRAS_PLAYER_FILES.map(f => ({ url: VLIBRAS_PLAYER_PATH + f.name, bytes: f.bytes }));
  for (const gloss of glosses) {
    const checked = VLIBRAS_BUNDLES_PATH + encodeURIComponent(gloss);
    files.push({ url: checked, bytes: SIGN_BUNDLE_BYTES, optional: true });
    const raw = new URL(VLIBRAS_BUNDLES_PATH + gloss, 'http://librax.local').pathname;
    if (raw !== checked) files.push({ url: raw, bytes: SIGN_BUNDLE_BYTES, optional: true });
  }
  return files;
}

/**
 * Mão em 3D das letras e dos números (src/mao3d/): o modelo. Já vem no precache do service worker
 * (com o pedaço do motor 3D); fica na lista para o caso de o precache ter falhado, e aí o download
 * pula o que já está guardado.
 */
export function hand3dFiles(): AssetFile[] {
  return [{ url: handModelUrl, bytes: 153_344, optional: true }];
}

/**
 * Tudo o que "usar offline" baixa: câmera (WASM certo para o aparelho; corpo e sinais com movimento
 * só quando há modelo de sinais), avatar com as glosas do curso e a mão em 3D.
 */
export async function offlineFiles(): Promise<AssetFile[]> {
  const [{ signsMap }, simd, signs] = await Promise.all([import('./content'), simdSupported(), signModelPublished()]);
  return [...cameraFiles(simd, signs), ...vlibrasFiles(courseGlosses(Object.values(signsMap))), ...hand3dFiles()];
}
