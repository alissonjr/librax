"""
Mais pessoas para os sinais perto da régua da câmera e para o Z do alfabeto manual.

Os sinais que ficaram entre 60% e 70% na validação cruzada por canal (ou com poucos vídeos
aceitos) e os sinais dos exercícios de câmera com poucos canais ganham vídeos de canais novos;
o Z ganha vídeos de uma letra e alfabetos curtos de canais que ainda não estão no treino.

As listas ficam à parte (formato do fontes_sinais.json e do fontes.json; não mexe neles):
- sinais: data/sinais15/fontes_extra.json (tipo "sinal", rotulo = id do sinal, glosa);
- Z: data/letras_mov/fontes_z2.json (tipos "letra" e "alfabeto", como o fontes_xz.json).
Vídeo que já está em outra lista não entra; no Z, canal do teste fixo (data/teste_fixo.json) também
não (o teste separado continua o mesmo). Nos sinais vale primeiro canal que a glosa ainda não tem.

Títulos: os mesmos filtros de antes (titulo_do_sinal e letra_do_titulo do baixar.py,
alfabeto_do_titulo do baixar_xz.py, e o titulo_composto do rotular_sinais.py, que tiraria o vídeo do
treino de qualquer jeito), com outras buscas.

Uso:
    python video/baixar_extra.py buscar-sinais --glosas OBRIGADO,TRISTE [--n 30] [--max-por-glosa 12] [--fundo]
    python video/baixar_extra.py buscar-z [--n 30]
    python video/baixar_extra.py baixar --lista sinais|z [--max 150] [--pausa 8]
    (LIBRAX_DATA=/caminho/data aponta para a pasta de dados)
"""

import argparse
import json
import os
import shutil
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from baixar import ALFABETO, MAX_DURACAO_SINAL, buscar, letra_do_titulo, titulo_do_sinal  # noqa: E402
from baixar_xz import MAX_ALFABETO_S, MAX_LETRA_S, MIN_ALFABETO_S, alfabeto_do_titulo  # noqa: E402
from rotular_sinais import titulo_composto  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
VIDEOS = os.path.join(DATA, "videos")
LISTAS = {"sinais": os.path.join(DATA, "sinais15", "fontes_extra.json"),
          "z": os.path.join(DATA, "letras_mov", "fontes_z2.json")}
OUTRAS = [os.path.join(DATA, "fontes.json"), os.path.join(DATA, "fontes_sinais.json"),
          os.path.join(DATA, "letras_mov", "fontes_xz.json")]
CONTENT = os.path.join(AQUI, "..", "..", "apps", "web-poc", "src", "assets", "content")
MIN_LIVRE_GB = 30

# Buscas diferentes das do baixar.py ("sinal de X em libras", "X em libras", "X libras",
# "como se diz X em libras"), que já voltam quase só vídeos conhecidos
BUSCAS_SINAL = ["sinal {n} libras", "{n} libras shorts", "{n} em libras #shorts", "como fazer {n} em libras",
                "{n} língua brasileira de sinais", "aprenda {n} em libras", "{n} libras surdo", "sinal de {n} libras"]
# As do baixar.py, para ir mais fundo nos resultados (--fundo, com --n maior que os 15 de antes)
BUSCAS_ANTIGAS = ["sinal de {n} em libras", "{n} em libras", "{n} libras", "como se diz {n} em libras"]
# Outra forma da palavra no título (o sinal é o mesmo): "obrigada", "mamãe" (verbete MAMÃE1 do INES)
APELIDOS = {"OBRIGADO": ["OBRIGADA"], "MÃE": ["MAMÃE"], "PRAZER": ["MUITO-PRAZER"]}
BUSCAS_Z = ["letra z libras datilologia", "z em libras alfabeto manual", "letra Z em LIBRAS aula", "alfabeto manual z libras",
            "como fazer o z em libras", "letra z língua de sinais brasileira", "letra Z libras movimento"]
BUSCAS_ALFABETO_Z = ["alfabeto em libras para iniciantes devagar", "alfabeto libras letra a letra",
                     "alfabeto manual libras infantil", "alfabeto libras aula completa", "alfabeto manual libras com legenda",
                     "alfabeto libras vídeo curto", "ensinando o alfabeto em libras", "alfabeto datilológico em libras aula",
                     "alfabeto em libras 2024", "alfabeto em libras 2025", "alfabeto libras devagar para aprender",
                     "alfabeto libras sala de aula", "alfabeto em libras crianças surdas", "alfabeto libras bilíngue"]


def carregar(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def salvar(path, lista):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(lista, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def ja_vistos():
    ids = set()
    for p in OUTRAS + list(LISTAS.values()):
        ids |= {x["id"] for x in carregar(p)}
    return ids


def sinais_por_glosa():
    with open(os.path.join(CONTENT, "signs.json")) as f:
        return {s["gloss"]: s for s in json.load(f)}


def cmd_buscar_sinais(args):
    lista = carregar(LISTAS["sinais"])
    vistos = ja_vistos()
    signs = sinais_por_glosa()
    # canais que cada glosa já tem (lista antiga e a nova)
    canais = {}
    for x in carregar(os.path.join(DATA, "fontes_sinais.json")) + lista:
        if x.get("tipo") == "sinal" and not x["id"].startswith("dic-"):
            canais.setdefault(x.get("glosa"), set()).add(x.get("channel_id") or x["id"])
    for g in [g for g in args.glosas.split(",") if g]:
        sign = signs[g]
        achados = []
        buscas = BUSCAS_SINAL + (BUSCAS_ANTIGAS if args.fundo else [])
        for apelido in [g] + APELIDOS.get(g, []):
            nome = apelido.replace("-", " ").lower()
            como = {**sign, "gloss": apelido}
            for q in buscas:
                for e in buscar(q.format(n=nome), args.n):
                    if e["id"] in vistos or not e["duration"] or e["duration"] > MAX_DURACAO_SINAL:
                        continue
                    # "Feliz Natal", "Mãe x Pai": o rotular_sinais deixaria de fora (titulo_composto)
                    if not titulo_do_sinal(e["title"], como) or titulo_composto(apelido, e["title"]):
                        continue
                    achados.append({**e, "tipo": "sinal", "rotulo": sign["id"], "glosa": g, "busca": q.format(n=nome)})
                    vistos.add(e["id"])
                time.sleep(2)
        # canal novo primeiro; no máximo um vídeo por canal novo e max_por_glosa por glosa
        novos, tem = [], set(canais.get(g, set()))
        for e in achados:
            c = e["channel_id"] or e["id"]
            if c not in tem:
                novos.append(e)
                tem.add(c)
        novos = novos[:args.max_por_glosa]
        lista += novos
        salvar(LISTAS["sinais"], lista)
        print(f"{g}: {len(achados)} achado(s), {len(novos)} de canal novo na lista "
              f"({len(canais.get(g, set()))} canais antes)", flush=True)
    print(f"{len(lista)} na lista {LISTAS['sinais']}")


def cmd_buscar_z(args):
    from baixar_xz import canais_do_teste

    lista = carregar(LISTAS["z"])
    vistos = ja_vistos()
    teste = canais_do_teste()
    # canais que já têm Z no treino (vídeos de alfabeto ou do Z nas listas antigas)
    antigos = {x.get("channel_id") for p in OUTRAS for x in carregar(p)
               if x.get("tipo") == "alfabeto" or x.get("rotulo") == "Z"}
    tem = antigos | {x.get("channel_id") for x in lista}
    n_letra = n_alf = 0
    for q in BUSCAS_Z:
        for e in buscar(q, args.n):
            if e["id"] in vistos or e["channel_id"] in teste or not e["duration"] or e["duration"] > MAX_LETRA_S:
                continue
            if not letra_do_titulo(e["title"], "Z"):
                continue
            lista.append({**e, "tipo": "letra", "rotulo": "Z", "busca": q})
            vistos.add(e["id"])
            tem.add(e["channel_id"])
            n_letra += 1
        time.sleep(2)
    for q in BUSCAS_ALFABETO_Z:
        for e in buscar(q, args.n):
            if e["id"] in vistos or e["channel_id"] in teste or e["channel_id"] in tem:
                continue
            if not (MIN_ALFABETO_S <= (e["duration"] or 0) <= MAX_ALFABETO_S) or not alfabeto_do_titulo(e["title"]):
                continue
            lista.append({**e, "tipo": "alfabeto", "rotulo": None, "sequencia": "".join(ALFABETO), "busca": q})
            vistos.add(e["id"])
            tem.add(e["channel_id"])
            n_alf += 1
        time.sleep(2)
    salvar(LISTAS["z"], lista)
    print(f"Z: {n_letra} vídeo(s) do Z e {n_alf} alfabeto(s) de canal novo; {len(lista)} na lista {LISTAS['z']}")


def livre_gb():
    return shutil.disk_usage(VIDEOS).free / 1e9


def cmd_baixar(args):
    import yt_dlp

    path = LISTAS[args.lista]
    lista = carregar(path)
    pendentes = [x for x in lista if not x.get("arquivo") and not x.get("erro") and not x.get("fora")][: args.max]
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bv*[height<=480][vcodec^=avc1][ext=mp4]/b[height<=480][ext=mp4]/bv*[height<=480]",
        "outtmpl": os.path.join(VIDEOS, "%(id)s.%(ext)s"),
        "nooverwrites": True,
        "noprogress": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        for i, x in enumerate(pendentes, 1):
            if livre_gb() < MIN_LIVRE_GB:
                print(f"menos de {MIN_LIVRE_GB} GB livres: parei", flush=True)
                break
            existente = [a for a in os.listdir(VIDEOS) if a.startswith(x["id"] + ".")]
            if existente:
                x["arquivo"] = existente[0]
                print(f"[{i}/{len(pendentes)}] já existe {x['id']}", flush=True)
                continue
            try:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={x['id']}", download=True)
                x["arquivo"] = os.path.basename(ydl.prepare_filename(info))
                x["width"], x["height"], x["fps"] = info.get("width"), info.get("height"), info.get("fps")
                print(f"[{i}/{len(pendentes)}] ok {x['id']} {x.get('glosa') or x.get('rotulo') or x['tipo']} "
                      f"{x['title'][:60]}", flush=True)
            except Exception as err:  # vídeo removido, privado, com restrição de idade...
                x["erro"] = str(err)[:200]
                print(f"[{i}/{len(pendentes)}] erro {x['id']}: {x['erro']}", flush=True)
            salvar(path, lista)
            time.sleep(args.pausa)
    salvar(path, lista)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("buscar-sinais")
    s.add_argument("--glosas", required=True)
    s.add_argument("--n", type=int, default=30)
    s.add_argument("--max-por-glosa", type=int, default=12)
    s.add_argument("--fundo", action="store_true", help="também as buscas do baixar.py (use --n maior)")
    z = sub.add_parser("buscar-z")
    z.add_argument("--n", type=int, default=30)
    d = sub.add_parser("baixar")
    d.add_argument("--lista", choices=sorted(LISTAS), required=True)
    d.add_argument("--max", type=int, default=150)
    d.add_argument("--pausa", type=float, default=8)
    args = ap.parse_args()
    {"buscar-sinais": cmd_buscar_sinais, "buscar-z": cmd_buscar_z, "baixar": cmd_baixar}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
