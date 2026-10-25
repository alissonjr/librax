import { describe, it, expect } from 'vitest';
import { decodeSignUrl, rejectHtmlPlugin } from '../lib/vlibrasServing';
import { VLIBRAS_BUNDLES_PATH } from '../lib/vlibras';

const keep = ({ type }: { type: string }) =>
  rejectHtmlPlugin.cacheWillUpdate({ response: new Response('x', { headers: { 'content-type': type } }) });

describe('cache do service worker para o VLibras', () => {
  it('não guarda a página do app no lugar da animação', async () => {
    expect(await keep({ type: 'text/html' })).toBeNull();
    expect(await keep({ type: 'text/html; charset=utf-8' })).toBeNull();
  });

  it('guarda animação e arquivos do player', async () => {
    expect(await keep({ type: 'application/octet-stream' })).not.toBeNull();
    expect(await keep({ type: 'binary/octet-stream' })).not.toBeNull();
    expect(await keep({ type: 'application/javascript' })).not.toBeNull();
    const semTipo = new Response('x');
    semTipo.headers.delete('content-type');
    expect(await rejectHtmlPlugin.cacheWillUpdate({ response: semTipo })).toBe(semTipo);
  });

  // O sw.js recebe a função como texto: ela não pode depender de nada de fora
  it('a regra funciona sozinha, recriada a partir do texto', async () => {
    const source = String(rejectHtmlPlugin.cacheWillUpdate);
    const rebuilt = new Function(`return (${source});`)() as typeof rejectHtmlPlugin.cacheWillUpdate;
    expect(await rebuilt({ response: new Response('x', { headers: { 'content-type': 'text/html' } }) })).toBeNull();
  });
});

describe('decodeSignUrl (servidores do Vite)', () => {
  it('troca o %26 pelo "&" do nome do arquivo, como o app pede (encodeURIComponent)', () => {
    const url = VLIBRAS_BUNDLES_PATH + encodeURIComponent('ACORDAR&DESPERTAR');
    expect(decodeSignUrl(url)).toBe(`${VLIBRAS_BUNDLES_PATH}ACORDAR&DESPERTAR`);
  });

  it('mantém acentos codificados (o Vite já decodifica) e a query', () => {
    const url = VLIBRAS_BUNDLES_PATH + encodeURIComponent('LÍNGUA&LINGUAGEM') + '?v=1';
    expect(decodeSignUrl(url)).toBe(`${VLIBRAS_BUNDLES_PATH}L%C3%8DNGUA&LINGUAGEM?v=1`);
  });

  it('não mexe no que não precisa', () => {
    expect(decodeSignUrl(VLIBRAS_BUNDLES_PATH + encodeURIComponent('MÃE'))).toBeNull();
    expect(decodeSignUrl(`${VLIBRAS_BUNDLES_PATH}ACORDAR&DESPERTAR`)).toBeNull();
    expect(decodeSignUrl('/aprender?a%26b')).toBeNull();
    expect(decodeSignUrl('/ml/1.1.1/a%26b')).toBeNull();
  });

  it('barra, "?", "#" e "%" continuam codificados', () => {
    expect(decodeSignUrl(`${VLIBRAS_BUNDLES_PATH}..%2F..%2Fx%3Fy%23z%25`)).toBeNull();
  });
});
