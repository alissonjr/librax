"""
Baixa os vídeos de dicionários de Libras que o conteúdo do curso já cita (signs.json: "source" e
"notes" com link direto para .mp4 do INES, do Spread the Sign e do Signbank da UFSC) e acrescenta
cada um em data/fontes_sinais.json, com a glosa do sinal, para entrar no treino de movimento.

Vídeo de dicionário mostra só o sinal, sem introdução nem fala. Cada dicionário tem uma pessoa
(ou poucas) sinalizando, então o canal vale como pessoa: channel_id = "dic-<site>".

Com --buscar, procura também no Spread the Sign (pt.br), para os sinais com exercício de
câmera: busca pelo nome e usa só a palavra de nome idêntico, variante 0.
INES fica só com os links do conteúdo: lá o número no nome do arquivo é a variante do sinal.
Signbank UFSC fica de fora da busca: em 2026-10-25 o servidor de vídeos entrava em redirecionamento
infinito (e não envia o certificado intermediário), então os links dele falham.

Uso:
    python video/baixar_dicionarios.py [--pausa 1.5] [--buscar]
"""

import argparse
import hashlib
import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(AQUI, "..", "data")
VIDEOS = os.path.join(DATA, "videos")
FONTES = os.path.join(DATA, "fontes_sinais.json")
SIGNS = os.path.join(AQUI, "..", "..", "apps", "web-poc", "src", "assets", "content", "signs.json")

SITES = {
    "dicionario.ines.gov.br": "ines",
    "media.spreadthesign.com": "spreadthesign",
    "videos.nals.cce.ufsc.br": "signbank",
}


def links_por_sinal():
    with open(SIGNS) as f:
        raw = json.load(f)
    signs = raw if isinstance(raw, list) else list(raw.values())
    out = []
    for s in signs:
        texto = json.dumps([s.get("source"), s.get("notes")], ensure_ascii=False)
        for url in sorted(set(re.findall(r'https?://[^\s"\']+?\.mp4', texto))):
            host = url.split("/")[2]
            if host in SITES:
                out.append((s, url, SITES[host]))
    return out


UA = {"User-Agent": "Mozilla/5.0 (librax-treino)"}


def _get(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def _slug(texto):
    t = unicodedata.normalize("NFKD", texto.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def buscar_spreadthesign(gloss):
    palavra = gloss.replace("-", " ").lower()
    try:
        html = _get("https://www.spreadthesign.com/pt.br/search/?q=" + urllib.parse.quote(palavra)).decode("utf-8", "ignore")
    except Exception:
        return None
    alvo = _slug(palavra)
    for wid, slug in re.findall(r'href="/pt\.br/word/(\d+)/([^/]+)/0/', html):
        if slug == alvo:
            try:
                pag = _get(f"https://www.spreadthesign.com/pt.br/word/{wid}/{slug}/0/").decode("utf-8", "ignore")
            except Exception:
                return None
            m = re.search(r"https://media\.spreadthesign\.com/video/mp4/[^\"']+\.mp4", pag)
            return m.group(0) if m else None
    return None


def links_buscados(pausa):
    import sys
    sys.path.insert(0, AQUI)
    from baixar import sinais_com_camera

    out = []
    for sign in sinais_com_camera():
        url = buscar_spreadthesign(sign["gloss"])
        if url:
            out.append((sign, url, "spreadthesign"))
        time.sleep(pausa)
        print(f"busca: {sign['gloss']} ok", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pausa", type=float, default=1.5, help="segundos entre downloads (servidores públicos)")
    ap.add_argument("--buscar", action="store_true", help="procura também no Signbank e no Spread the Sign")
    args = ap.parse_args()

    with open(FONTES) as f:
        fontes = json.load(f)
    vistos = {x["id"] for x in fontes}
    os.makedirs(VIDEOS, exist_ok=True)
    novos = ok = erros = 0
    links = links_por_sinal()
    if args.buscar:
        conhecidos = {u for _, u, _ in links}
        links += [x for x in links_buscados(args.pausa) if x[1] not in conhecidos]
    for sign, url, site in links:
        vid = f"dic-{site}-{hashlib.sha1(url.encode()).hexdigest()[:10]}"
        if vid in vistos:
            continue
        item = {"id": vid, "title": f"{site}: {sign['gloss']}", "channel": site, "channel_id": f"dic-{site}",
                "duration": 0, "tipo": "sinal", "rotulo": sign["id"], "glosa": sign["gloss"], "url": url}
        arquivo = os.path.join(VIDEOS, f"{vid}.mp4")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (librax-treino)"})
            with urllib.request.urlopen(req, timeout=60) as r, open(arquivo, "wb") as out:
                out.write(r.read())
            item["arquivo"] = os.path.basename(arquivo)
            ok += 1
        except Exception as err:  # link quebrado, servidor fora do ar
            item["erro"] = str(err)[:200]
            erros += 1
        fontes.append(item)
        vistos.add(vid)
        novos += 1
        if novos % 20 == 0:
            with open(FONTES, "w") as f:
                json.dump(fontes, f, indent=1, ensure_ascii=False)
            print(f"{novos} processados ({ok} ok, {erros} erro)", flush=True)
        time.sleep(args.pausa)
    with open(FONTES, "w") as f:
        json.dump(fontes, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{novos} novo(s): {ok} baixados, {erros} com erro")


if __name__ == "__main__":
    main()
