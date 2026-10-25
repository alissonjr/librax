"""
Busca e baixa vídeos do YouTube para treinar o reconhecimento pela câmera.

Os vídeos ficam em ml-training/data/videos/ (fora do git) e não vão para o app: a página
treino-video.html do app web (só no servidor de desenvolvimento) passa cada um pelo mesmo
HandLandmarker do app e grava os landmarks em ml-training/data/landmarks/.

Duas buscas:
- "letra": um vídeo curto por letra ("letra B em libras"). O título dá o rótulo.
- "alfabeto": o alfabeto inteiro em sequência. O rótulo sai da ordem (rotular.py).

- "sinal" (lista separada, data/fontes_sinais.json): um vídeo curto por sinal do curso com
  exercício de câmera ("sinal de OBRIGADO em libras"). O título dá o rótulo.

Uso:
    python video/baixar.py buscar [--por-letra 12] [--alfabeto 40]
    python video/baixar.py buscar-sinais [--por-sinal 15]
    python video/baixar.py [--lista sinais] baixar [--max 400]
"""

import argparse
import glob
import json
import os
import re
import sys
import unicodedata

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(AQUI, "..", "data")
VIDEOS = os.path.join(DATA, "videos")
FONTES = os.path.join(DATA, "fontes.json")
CONTENT = os.path.join(AQUI, "..", "..", "apps", "web-poc", "src", "assets", "content")
MAX_DURACAO_SINAL = 75

# Ordem do alfabeto manual de Libras (o Ç vem depois do C).
ALFABETO = list("ABCÇDEFGHIJKLMNOPQRSTUVWXYZ")

# Vídeo curto de uma letra: mais que isso costuma ser o alfabeto inteiro ou uma aula.
MAX_DURACAO_LETRA = 90
MIN_DURACAO_ALFABETO, MAX_DURACAO_ALFABETO = 25, 600


def sem_acento(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def buscar(query, n):
    import yt_dlp

    opts = {"quiet": True, "extract_flat": True, "skip_download": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    out = []
    for e in info.get("entries") or []:
        if not e or not e.get("id"):
            continue
        out.append({
            "id": e["id"],
            "title": e.get("title") or "",
            "channel": e.get("channel") or e.get("uploader") or "",
            "channel_id": e.get("channel_id") or e.get("uploader_id") or "",
            "duration": e.get("duration") or 0,
        })
    return out


# Título com isto é aula de palavras ou comparação com outra língua, não a letra em si.
EXCLUIR = ("palavra", "sinais com", "sinal com", "sinal para", "verbo", "profiss", "nomes", "ditado",
           "libras x", "e so alfabeto", "ingl", "asl", "lgp", "frase")


def excluido(title):
    t = sem_acento(title)
    return any(x in t for x in EXCLUIR)


def letra_do_titulo(title, letra):
    """True se o título fala da letra sozinha ("Letra B", "letra b em libras", "B em Libras")."""
    t = sem_acento(title)
    if "libras" not in t or excluido(title):
        return False
    if letra == "Ç":
        return "cedilha" in t or "ç" in title.lower()
    l = sem_acento(letra)
    padroes = [rf"\bletra\s+{l}\b", rf"^\s*{l}\s*(-|\||:|em\b)", rf"\b{l}\s+em\s+libras\b"]
    return any(re.search(p, t) for p in padroes)


def cmd_buscar(args):
    fontes = carregar_fontes()
    vistos = {f["id"] for f in fontes}
    novos = 0
    for letra in ALFABETO:
        for q in (f"letra {letra} em libras", f"letra {letra} libras alfabeto manual"):
            for e in buscar(q, args.por_letra):
                if e["id"] in vistos or not e["duration"] or e["duration"] > MAX_DURACAO_LETRA:
                    continue
                if not letra_do_titulo(e["title"], letra):
                    continue
                fontes.append({**e, "tipo": "letra", "rotulo": letra})
                vistos.add(e["id"])
                novos += 1
        print(f"{letra}: {sum(1 for f in fontes if f.get('rotulo') == letra)} vídeo(s)", flush=True)
    for q in ("alfabeto em libras", "alfabeto manual libras", "alfabeto libras datilologia"):
        for e in buscar(q, args.alfabeto):
            if e["id"] in vistos or not (MIN_DURACAO_ALFABETO <= (e["duration"] or 0) <= MAX_DURACAO_ALFABETO):
                continue
            if "alfabeto" not in sem_acento(e["title"]) or "libras" not in sem_acento(e["title"]):
                continue
            if excluido(e["title"]):
                continue
            fontes.append({**e, "tipo": "alfabeto", "rotulo": None, "sequencia": "".join(ALFABETO)})
            vistos.add(e["id"])
            novos += 1
    # Vogais: a busca por "letra A" quase só devolve vídeo de vogais, então elas entram em sequência
    for q in ("vogais em libras", "vogais libras alfabeto manual"):
        for e in buscar(q, args.alfabeto // 2):
            if e["id"] in vistos or not (5 <= (e["duration"] or 0) <= 180):
                continue
            t = sem_acento(e["title"])
            if "vogais" not in t or "libras" not in t or excluido(e["title"]):
                continue
            fontes.append({**e, "tipo": "alfabeto", "rotulo": None, "sequencia": "AEIOU"})
            vistos.add(e["id"])
            novos += 1
    # Rodada anterior: tira o que o filtro de agora recusaria
    antes = len(fontes)
    fontes = [f for f in fontes if not excluido(f["title"])]
    for f in fontes:
        if f["tipo"] == "alfabeto" and not f.get("sequencia"):
            f["sequencia"] = "".join(ALFABETO)
    salvar_fontes(fontes)
    print(f"{antes - len(fontes)} removido(s) pelo filtro")
    print(f"{novos} novo(s), {len(fontes)} no total em {FONTES}")


def sinais_com_camera():
    """Sinais do curso (fora o alfabeto) que têm exercício perform_sign."""
    with open(os.path.join(CONTENT, "signs.json")) as f:
        raw = json.load(f)
    signs = {s["id"]: s for s in (raw if isinstance(raw, list) else raw.values())}
    ids = set()
    for path in glob.glob(os.path.join(CONTENT, "lessons", "*.json")):
        with open(path) as f:
            for e in json.load(f).get("exercises", []):
                if e["type"] == "perform_sign":
                    ids.add(e["payload"]["sign_id"])
    return [signs[i] for i in sorted(ids) if signs[i]["category"] != "alfabeto"]


def titulo_do_sinal(title, sign):
    """True se o título fala do sinal: todas as palavras da glosa e "libras", sem aula longa."""
    t = sem_acento(title)
    if "libras" not in t or excluido(title):
        return False
    palavras = sem_acento(sign["gloss"]).replace("-", " ").split()
    if sign["category"] == "numeros":
        return re.search(rf"(numero|n[ºo°]?)\s*{palavras[0]}\b", t) is not None or re.search(rf"\b{palavras[0]}\s+em\s+libras", t) is not None
    return all(re.search(rf"\b{re.escape(w)}\b", t) for w in palavras)


def cmd_buscar_sinais(args):
    fontes = carregar_fontes()
    vistos = {f["id"] for f in fontes}
    for sign in sinais_com_camera():
        nome = sign["gloss"].replace("-", " ").lower()
        queries = ([f"número {nome} em libras", f"numero {nome} libras"] if sign["category"] == "numeros"
                   else [f"sinal de {nome} em libras", f"{nome} em libras"])
        n = 0
        for q in queries:
            for e in buscar(q, args.por_sinal):
                if e["id"] in vistos or not e["duration"] or e["duration"] > MAX_DURACAO_SINAL:
                    continue
                if not titulo_do_sinal(e["title"], sign):
                    continue
                fontes.append({**e, "tipo": "sinal", "rotulo": sign["id"], "glosa": sign["gloss"]})
                vistos.add(e["id"])
                n += 1
        print(f"{sign['gloss']}: {n} vídeo(s)", flush=True)
        salvar_fontes(fontes)
    print(f"{len(fontes)} no total em {FONTES}")


def cmd_baixar(args):
    import yt_dlp

    os.makedirs(VIDEOS, exist_ok=True)
    fontes = carregar_fontes()
    pendentes = [f for f in fontes if not f.get("arquivo") and not f.get("erro")][: args.max]
    opts = {
        "quiet": True,
        "no_warnings": True,
        # Só vídeo, H.264 até 480p: o Chrome toca sem conversão e não precisa do ffmpeg
        "format": "bv*[height<=480][vcodec^=avc1][ext=mp4]/b[height<=480][ext=mp4]/bv*[height<=480]",
        "outtmpl": os.path.join(VIDEOS, "%(id)s.%(ext)s"),
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        for i, f in enumerate(pendentes, 1):
            try:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={f['id']}", download=True)
                f["arquivo"] = os.path.basename(ydl.prepare_filename(info))
                f["width"], f["height"], f["fps"] = info.get("width"), info.get("height"), info.get("fps")
                print(f"[{i}/{len(pendentes)}] ok {f['id']} {f['title'][:60]}", flush=True)
            except Exception as err:  # vídeo removido, privado, com restrição de idade...
                f["erro"] = str(err)[:200]
                print(f"[{i}/{len(pendentes)}] erro {f['id']}: {f['erro']}", flush=True)
            if i % 10 == 0:
                salvar_fontes(fontes)
    salvar_fontes(fontes)


def carregar_fontes():
    if not os.path.exists(FONTES):
        return []
    with open(FONTES) as f:
        return json.load(f)


def salvar_fontes(fontes):
    os.makedirs(DATA, exist_ok=True)
    with open(FONTES, "w") as f:
        json.dump(fontes, f, indent=1, ensure_ascii=False)
        f.write("\n")


def main():
    global FONTES
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lista", choices=["letras", "sinais"], default="letras")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("buscar")
    b.add_argument("--por-letra", type=int, default=12)
    b.add_argument("--alfabeto", type=int, default=40)
    bs = sub.add_parser("buscar-sinais")
    bs.add_argument("--por-sinal", type=int, default=15)
    d = sub.add_parser("baixar")
    d.add_argument("--max", type=int, default=1000)
    args = p.parse_args()
    if args.cmd == "buscar-sinais" or args.lista == "sinais":
        FONTES = os.path.join(DATA, "fontes_sinais.json")
    {"buscar": cmd_buscar, "buscar-sinais": cmd_buscar_sinais, "baixar": cmd_baixar}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
