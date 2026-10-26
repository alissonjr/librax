"""
Mais vídeos do X e do Z do alfabeto manual, com o movimento à vista, para o modelo das letras com
movimento (train_letras_mov.py). Nos vídeos do alfabeto que já estavam no treino o X quase sempre
aparece parado e o Z varia muito; aqui entram vídeos de uma letra só, alfabetos curtos e lentos e
o alfabeto do Spread the Sign (pt.br).

A lista fica em data/letras_mov/fontes_xz.json (formato do fontes.json; não mexe no fontes.json
nem no fontes_sinais.json). Vídeo de canal do teste fixo (data/teste_fixo.json) não entra: o teste
separado continua o mesmo de antes. Vídeo que já está em data/videos/ não é baixado de novo.

Tipos:
- "letra": um vídeo curto de uma letra (título "letra X em libras" etc.), rotulo = a letra;
- "alfabeto": o alfabeto inteiro em sequência (até MAX_ALFABETO_S), sequencia = ordem das letras;
- "varias": algumas letras (as com movimento, "W, X, Y e Z"), sem ordem conhecida;
- Spread the Sign: uma pessoa, uma letra por vídeo (tipo "letra", channel_id "dic-spreadthesign").

Uso:
    python video/baixar_xz.py buscar [--n 25] [--rodada 2]
    python video/baixar_xz.py baixar [--max 150] [--pausa 8]
    python video/baixar_xz.py spreadthesign
    (LIBRAX_DATA=/caminho/data aponta para a pasta de dados)
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from baixar import ALFABETO, buscar, excluido, letra_do_titulo, sem_acento  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
VIDEOS = os.path.join(DATA, "videos")
LISTA = os.path.join(DATA, "letras_mov", "fontes_xz.json")
MIN_LIVRE_GB = 30
MAX_LETRA_S = 90
MIN_ALFABETO_S, MAX_ALFABETO_S = 20, 180

BUSCAS_LETRA = {
    "X": ["letra X em libras", "letra X libras", "X em libras", "letra X alfabeto manual libras",
          "libras letra x shorts", "como fazer a letra X em libras", "x libras alfabeto"],
    "Z": ["letra Z em libras", "letra Z libras", "Z em libras", "letra Z alfabeto manual libras",
          "libras letra z shorts", "como fazer a letra Z em libras", "z libras alfabeto"],
}
BUSCAS_ALFABETO = ["alfabeto manual libras devagar", "alfabeto em libras lento", "datilologia libras letra por letra",
                   "alfabeto em libras", "alfabeto manual em libras", "alfabeto libras shorts",
                   "alfabeto em libras para crianças", "aprenda o alfabeto em libras", "alfabeto datilológico libras",
                   "soletrar em libras alfabeto", "alfabeto libras de A a Z", "alfabeto libras completo",
                   "alfabeto manual libras para iniciantes", "ABC em libras", "alfabeto libras tutorial",
                   "como fazer o alfabeto em libras", "datilologia em libras", "alfabeto em libras #shorts",
                   "alfabeto manual língua brasileira de sinais", "alfabeto em libras surdo", "alfabeto libras rápido"]
# Segunda rodada (a primeira devolveu poucos vídeos novos)
BUSCAS_LETRA_2 = {
    "X": ["letra x libras surdo", "X em língua de sinais", "como sinalizar a letra X libras", "letra X LIBRAS #shorts"],
    "Z": ["letra z libras surdo", "Z em língua de sinais", "como sinalizar a letra Z libras", "letra Z LIBRAS #shorts"],
}
BUSCAS_ALFABETO_2 = ["alfabeto libras aula 1", "libras básico alfabeto", "alfabeto manual libras curso",
                     "alfabeto de libras completo devagar", "alfabeto libras para treinar", "abecedário em libras",
                     "letras do alfabeto em libras de A a Z", "alfabeto libras rapidinho", "alfabeto em libras música",
                     "alfabeto em libras professora", "alfabeto manual libras inclusão", "alfabeto em libras escola"]

# Vídeos de algumas letras (as com movimento, "W, X, Y e Z"): sem sequência conhecida, o trecho sai
# do modelo das letras paradas e da revisão das folhas (video/rotular_xz.py)
BUSCAS_VARIAS = ["letras com movimento libras", "letras que tem movimento em libras", "letras H J K X Y Z Ç libras",
                 "alfabeto manual letras com movimento", "letras W X Y Z libras", "letras X Y Z em libras"]

# Spread the Sign (pt.br): página do alfabeto 11, letra A = 233 ... Z = 258, Ç = 1033
STS_URL = "https://media.spreadthesign.com/video/mp4/14/alphabet-letter-{n}-1.mp4"
STS_IDS = {**{L: 233 + i for i, L in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")}, "Ç": 1033}


def carregar(path, padrao):
    if not os.path.exists(path):
        return padrao
    with open(path) as f:
        return json.load(f)


def salvar(lista):
    os.makedirs(os.path.dirname(LISTA), exist_ok=True)
    tmp = LISTA + ".tmp"
    with open(tmp, "w") as f:
        json.dump(lista, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, LISTA)


def canais_do_teste():
    return {v["channel_id"] for v in carregar(os.path.join(DATA, "teste_fixo.json"), {"videos": []})["videos"]}


def alfabeto_do_titulo(title):
    t = sem_acento(title)
    return ("libras" in t and ("alfabeto" in t or "datilolog" in t) and not excluido(title)
            and "vogais" not in t)


def cmd_buscar(args):
    lista = carregar(LISTA, [])
    ja = {x["id"] for x in lista}
    ja |= {x["id"] for x in carregar(os.path.join(DATA, "fontes.json"), [])}
    teste = canais_do_teste()
    novos = 0
    letra_qs, alfabeto_qs, varias_qs = ((BUSCAS_LETRA, BUSCAS_ALFABETO, BUSCAS_VARIAS) if args.rodada == 1
                                        else (BUSCAS_LETRA_2, BUSCAS_ALFABETO_2, []))
    for L, qs in letra_qs.items():
        for q in qs:
            for e in buscar(q, args.n):
                if e["id"] in ja or e["channel_id"] in teste or not e["duration"] or e["duration"] > MAX_LETRA_S:
                    continue
                if not letra_do_titulo(e["title"], L):
                    continue
                lista.append({**e, "tipo": "letra", "rotulo": L, "busca": q})
                ja.add(e["id"])
                novos += 1
            time.sleep(2)
    for q in alfabeto_qs:
        for e in buscar(q, args.n):
            if e["id"] in ja or e["channel_id"] in teste:
                continue
            if not (MIN_ALFABETO_S <= (e["duration"] or 0) <= MAX_ALFABETO_S) or not alfabeto_do_titulo(e["title"]):
                continue
            lista.append({**e, "tipo": "alfabeto", "rotulo": None, "sequencia": "".join(ALFABETO), "busca": q})
            ja.add(e["id"])
            novos += 1
        time.sleep(2)
    for q in varias_qs:
        for e in buscar(q, args.n):
            if e["id"] in ja or e["channel_id"] in teste or not e["duration"] or e["duration"] > MAX_ALFABETO_S:
                continue
            t = sem_acento(e["title"])
            if "libras" not in t or excluido(e["title"]) or not (re.search(r"\bx\b", t) or re.search(r"\bz\b", t)
                                                                or "movimento" in t):
                continue
            lista.append({**e, "tipo": "varias", "rotulo": None, "busca": q})
            ja.add(e["id"])
            novos += 1
        time.sleep(2)
    salvar(lista)
    print(f"{novos} novo(s), {len(lista)} na lista {LISTA}")


def livre_gb():
    return shutil.disk_usage("/").free / 1e9


def cmd_baixar(args):
    import yt_dlp

    lista = carregar(LISTA, [])
    pendentes = [x for x in lista if not x.get("arquivo") and not x.get("erro") and not x.get("fora")
                 and not x["id"].startswith("sts-")][: args.max]
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bv*[height<=480][vcodec^=avc1][ext=mp4]/b[height<=480][ext=mp4]/bv*[height<=480]",
        "outtmpl": os.path.join(VIDEOS, "%(id)s.%(ext)s"),
        "nooverwrites": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        for i, x in enumerate(pendentes, 1):
            if livre_gb() < MIN_LIVRE_GB:
                print(f"menos de {MIN_LIVRE_GB} GB livres: parei")
                break
            existente = [a for a in os.listdir(VIDEOS) if a.startswith(x["id"] + ".")]
            if existente:
                x["arquivo"] = existente[0]
                print(f"[{i}/{len(pendentes)}] já existe {x['id']}")
                continue
            try:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={x['id']}", download=True)
                x["arquivo"] = os.path.basename(ydl.prepare_filename(info))
                x["width"], x["height"], x["fps"] = info.get("width"), info.get("height"), info.get("fps")
                print(f"[{i}/{len(pendentes)}] ok {x['id']} {x['title'][:60]}", flush=True)
            except Exception as err:
                x["erro"] = str(err)[:200]
                print(f"[{i}/{len(pendentes)}] erro {x['id']}: {x['erro']}", flush=True)
            salvar(lista)
            time.sleep(args.pausa)
    salvar(lista)


def cmd_spreadthesign(args):
    lista = carregar(LISTA, [])
    ja = {x["id"] for x in lista}
    for L, n in STS_IDS.items():
        vid = f"sts-{L}"
        arq = f"sts-alphabet-letter-{n}-1.mp4"
        destino = os.path.join(VIDEOS, arq)
        if not os.path.exists(destino):
            req = urllib.request.Request(STS_URL.format(n=n), headers={"User-Agent": "Mozilla/5.0 (librax-treino)"})
            with urllib.request.urlopen(req, timeout=30) as r, open(destino + ".tmp", "wb") as f:
                f.write(r.read())
            os.replace(destino + ".tmp", destino)
            time.sleep(1.5)
        if vid not in ja:
            lista.append({"id": vid, "title": f"Spread the Sign pt.br letra {L}", "channel": "Spread the Sign",
                          "channel_id": "dic-spreadthesign", "duration": 0, "tipo": "letra", "rotulo": L,
                          "arquivo": arq, "url": STS_URL.format(n=n)})
    salvar(lista)
    print(f"Spread the Sign: {len(STS_IDS)} letras em {VIDEOS}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("buscar")
    b.add_argument("--n", type=int, default=25)
    b.add_argument("--rodada", type=int, default=1, choices=[1, 2])
    d = sub.add_parser("baixar")
    d.add_argument("--max", type=int, default=150)
    d.add_argument("--pausa", type=float, default=8)
    sub.add_parser("spreadthesign")
    args = ap.parse_args()
    {"buscar": cmd_buscar, "baixar": cmd_baixar, "spreadthesign": cmd_spreadthesign}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
