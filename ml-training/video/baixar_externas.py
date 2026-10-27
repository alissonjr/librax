"""
Vídeos de sinais de fora do YouTube (bases de pesquisa e dicionários com várias pessoas), para os
sinais do modelo de movimento. Só entram glosas que já estão no treino dos sinais (vídeos do
YouTube extraídos) e o FILHO e o AMARELO (MINDS-Libras, 8 pessoas).

Fontes (pesquisa de 2026-10-26; nenhuma pede conta ou formulário):
- V-LIBRASIL (UFPE): 3 pessoas por sinal ("Articulador1" a 3), 1920x1080, regravado em 480 linhas
  progressivo (progressivo()). O portal libras.cin.ufpe.br estava fora do ar (502); o espelho no
  Hugging Face (ibmectech/v-librasil-raw) tem os mesmos arquivos. O número do articulador não é a
  mesma pessoa em todos os sinais (na folha, o Articulador2 do LARANJA e o do ACORDAR são pessoas
  diferentes), então todos ficam num canal só (ext-vlibrasil), como o Signbank.
- Signbank Libras da UFSC: o servidor de vídeos (videos.nals.cce.ufsc.br) segue em redirecionamento
  infinito; o espelho no Kaggle (bernardinello/signbank, download público sem login) tem os
  vídeos. Uma entrada por sinal; só a forma principal (as "-2", "-3" são outras variantes). Não dá
  para saber quem sinaliza cada vídeo, então todos ficam num canal só (ext-signbank): na validação
  por canal saem juntos, o que é mais rígido do que um canal por pessoa.
- MINDS-Libras (UFMG, Zenodo 2667329): 20 sinais, 12 pessoas, 5 repetições, 1920x1080. Do curso
  só FILHO e AMARELO; o espelho no Hugging Face (ibmectech/minds-libras-raw) tem 8 das pessoas
  com arquivo solto (no Zenodo é um zip de vários GB por pessoa). Canal por pessoa: ext-minds-NN.

Não usar o prefixo "dic-": os vídeos de dicionário (video/baixar_dicionarios.py) ficam sempre no
treino e são o teste do dicionário. Estes entram na validação por canal como pessoas novas ou, com
train_sinais.py avaliar --so-treino ext-, só no treino (o teste fica o mesmo do YouTube). Em
2026-10-26 eles acertaram cerca de 40% como teste (estúdio, enquadramento e ritmo diferentes dos
vídeos do YouTube e da câmera do app) e, só no treino, subiram o acerto do YouTube em cerca de 1
ponto, mas o HOMEM caiu numa das divisões: o modelo dos sinais não foi publicado com eles.

Lista em data/fontes_externas.json (formato do fontes_sinais.json, tipo "sinal", glosa, título =
glosa); vídeos em data/videos/<id>.mp4. Para tirar um vídeo na revisão das folhas, "fora" com o
motivo na lista (o rotular_sinais.py pula).

Letras com movimento (lista data/letras_mov/fontes_externas.json, formato do fontes_xz.json):
- PEdAL (UFRGS, Plataforma Educacional do Alfabeto LIBRAS, www.ufrgs.br/pedal): cada letra com
  movimento (H, J, K, X, Z, Ç) em 3 vídeos, um de cada pessoa, só a mão sobre fundo de cor lisa
  (verde, roxo ou amarelo, uma cor por pessoa nas letras e nas palavras). Também palavras
  soletradas; entram as com Z no meio ou no fim (o rotular_xz.py precisa de uma letra antes) e o
  TÁXI. Canal pela cor do fundo: ext-pedal-verde, -roxo e -amarelo.

Uso:
    python video/baixar_externas.py listar [--letras]
    python video/baixar_externas.py baixar [--fontes vlibrasil,signbank,minds] [--pausa 1]
    python video/baixar_externas.py baixar --fontes pedal     (letras; canal pela cor do fundo)
    python video/baixar_externas.py converter     (V-LIBRASIL baixado antes da conversão para progressivo)
    (LIBRAX_DATA=/caminho/data aponta para a pasta de dados)
"""

import argparse
import json
import os
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
VIDEOS = os.path.join(DATA, "videos")
LISTA = os.path.join(DATA, "fontes_externas.json")
LISTA_LETRAS = os.path.join(DATA, "letras_mov", "fontes_externas.json")
CONTENT = os.path.join(AQUI, "..", "..", "apps", "web-poc", "src", "assets", "content")
MIN_LIVRE_GB = 30
UA = {"User-Agent": "Mozilla/5.0 (librax-treino)"}

URL_VLIBRASIL = "https://huggingface.co/datasets/ibmectech/v-librasil-raw/resolve/main/videos/{nome}_Articulador{n}.mp4"
URL_SIGNBANK = "https://www.kaggle.com/api/v1/datasets/download/bernardinello/signbank?file_name={caminho}"
URL_MINDS = "https://huggingface.co/datasets/ibmectech/minds-libras-raw/resolve/main/videos/{nome}Sinalizador{p:02d}-{r}.mp4"

# Glosa do curso -> nome do sinal no V-LIBRASIL (TERÇA-FEIRA só tem 2 pessoas)
VLIBRASIL = {
    "ACORDAR": "Acordar (alarme)", "ALMOÇO": "Almoço", "AMARELO": "Amarelo", "AMIGO": "Amigo", "BRANCO": "Branco",
    "CAMA": "Cama", "CANSADO": "Cansado", "CASA": "Casa", "COMER": "Comer", "CULTURA": "Cultura", "DOENTE": "Doente",
    "DORMIR": "Dormir", "ENCONTRAR": "Encontrar", "ESCOLA": "Escola", "FAMÍLIA": "Família", "FELIZ": "Feliz",
    "FILHO": "Filho", "FRUTA": "Fruta", "HOMEM": "Homem", "HOSPITAL": "Hospital", "IR": "Ir", "LARANJA": "Laranja",
    "MANHÃ": "Manhã", "MEIO-DIA": "Meio-dia", "MÃE": "Mãe", "NERVOSO": "Nervoso", "NOME": "Nome", "NÃO": "Não",
    "OBRIGADO": "Obrigado", "OI": "Oi", "ONTEM": "Ontem", "PAGAR": "Pagar", "POR-FAVOR": "Por favor",
    "RESTAURANTE": "Restaurante", "SEGUNDA-FEIRA": "Segunda-feira", "SIM": "Sim", "TERÇA-FEIRA": "Terça-feira",
    "TIA": "Tia", "TIO": "Tio", "TRISTE": "Triste", "VERDE": "Verde",
}
VLIBRASIL_FALTA = {("TERÇA-FEIRA", 3)}

# Glosa do curso -> arquivo no espelho do Signbank (forma principal do verbete)
SIGNBANK = {
    "ACORDAR": "videos/ACORDAR.mp4", "AMARELO": "videos/AMARELO.mp4", "AMIGO": "videos/AMIGO.mp4",
    "ARROZ": "videos/ARROZ.mp4", "BEBER": "videos/BEBER.mp4", "BRANCO": "videos/BRANCO.mp4", "CAMA": "videos/CAMA.mp4",
    "CASA": "videos/CASA.mp4", "COMER": "videos/COMER.mp4", "COMUNIDADE": "videos/COMUNIDADE.mp4",
    "CULTURA": "videos/CULTURA.mp4", "DOENTE": "videos/DOENTE.mp4", "DORMIR": "videos/DORMIR.mp4",
    "ENCONTRAR": "videos/3d0JhE105vRR2DalX6ll1y6qoJRcdqNioKGXEIue.mp4", "ESCOLA": "videos/ESCOLA.mp4",
    "ESTUDAR": "videos/ESTUDAR.mp4", "FAMÍLIA": "videos/1xWlfoCmTcNzbN0Z0tNTXFbtSOjUo3TyMROcZj9a.mp4",
    "FARMÁCIA": "videos/FARMÁCIA.mp4", "FEIJÃO": "videos/FEIJÃO.mp4", "FELIZ": "videos/FELIZ.mp4",
    "FEVEREIRO": "videos/FEVEREIRO.mp4", "FILHO": "videos/FILHO.mp4", "HOJE": "videos/HOJE.mp4",
    "HOMEM": "videos/HOMEM.mp4", "HOSPITAL": "videos/HOSPITAL.mp4", "IDADE": "videos/IDADE.mp4",
    "IR": "videos/rJgpCEHWA8GqTFfBXUR6dnRHCl4AlSsbnD8ZwvtU.mp4", "IRMÃO": "videos/IRMÃO.mp4",
    "JANEIRO": "videos/JANEIRO.mp4", "JUNHO": "videos/JUNHO.mp4", "MAIO": "videos/MAIO.mp4", "MANHÃ": "videos/MANHÃ.mp4",
    "MEIO-DIA": "videos/MEIO-DIA.mp4", "MESA": "videos/MESA.mp4", "MÃE": "videos/MÃE.mp4",
    "NERVOSO": "videos/NERVOSO.mp4", "NOME": "videos/NOME.mp4", "NÃO": "videos/NÃO.mp4", "OI": "videos/OI.mp4",
    "ONTEM": "videos/ONTEM.mp4", "OUTUBRO": "videos/OUTUBRO.mp4", "OVO": "videos/OVO.mp4", "PAGAR": "videos/PAGAR.mp4",
    "PERGUNTAR": "videos/PERGUNTAR.mp4", "POR-FAVOR": "videos/POR-FAVOR.mp4", "QUARTO": "videos/QUARTO.mp4",
    "RESPONDER": "videos/RESPONDER.mp4", "SEGUNDA-FEIRA": "videos/SEGUNDA-FEIRA.mp4", "SEMANA": "videos/SEMANA.mp4",
    "SETEMBRO": "videos/SETEMBRO.mp4", "SIM": "videos/SIM.mp4", "SINAL": "videos/SINAL.mp4", "TCHAU": "videos/TCHAU.mp4",
    "TERÇA-FEIRA": "videos/TERÇA-FEIRA.mp4", "TIO": "videos/TIO.mp4", "TRABALHAR": "videos/TRABALHAR.mp4",
    "TRISTE": "videos/TRISTE.mp4", "VERDE": "videos/VERDE.mp4", "VIR": "videos/VIR-INDICADOR.mp4",
}

# MINDS-Libras: glosa -> prefixo do arquivo; pessoas com arquivo no espelho do Hugging Face
MINDS = {"FILHO": "14Filho", "AMARELO": "03Amarelo"}
MINDS_PESSOAS = [1, 2, 5, 6, 8, 10, 11, 12]
MINDS_REPETICOES = 5

URL_PEDAL = "https://www.ufrgs.br/pedal/videos/{pasta}/{nome}.mp4"
PEDAL_LETRAS = "HJKXZÇ"
PEDAL_PALAVRAS = ["AZEITE", "AZUL", "LUZ", "LUZES", "PAZ", "TÁXI"]
SEQ = "ABCÇDEFGHIJKLMNOPQRSTUVWXYZ"
# Cor do fundo (BGR do canto de cima do quadro) -> pessoa
PEDAL_CORES = {"verde": (158, 195, 133), "roxo": (201, 149, 153), "amarelo": (165, 244, 252)}


def slug(texto):
    t = unicodedata.normalize("NFKD", texto.lower()).encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() else "-" for c in t).strip("-")


def carregar(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def salvar(path, lista):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(lista, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def sinal_id(glosa):
    with open(os.path.join(CONTENT, "signs.json")) as f:
        ids = {s["gloss"]: s["id"] for s in json.load(f)}
    return ids[glosa]


def item(vid, fonte, canal, glosa, url, **mais):
    return {"id": vid, "title": glosa, "channel": fonte, "channel_id": canal, "duration": 0, "tipo": "sinal",
            "rotulo": sinal_id(glosa), "glosa": glosa, "fonte": fonte, "url": url, **mais}


def montar():
    out = []
    for g, nome in sorted(VLIBRASIL.items()):
        for n in (1, 2, 3):
            if (g, n) in VLIBRASIL_FALTA:
                continue
            url = URL_VLIBRASIL.format(nome=urllib.parse.quote(nome), n=n)
            out.append(item(f"ext-vlibrasil-{slug(g)}-{n}", "vlibrasil", "ext-vlibrasil", g, url, articulador=n))
    for g, caminho in sorted(SIGNBANK.items()):
        url = URL_SIGNBANK.format(caminho=urllib.parse.quote(caminho, safe=""))
        out.append(item(f"ext-signbank-{slug(g)}", "signbank", "ext-signbank", g, url))
    for g, nome in sorted(MINDS.items()):
        for p in MINDS_PESSOAS:
            for r in range(1, MINDS_REPETICOES + 1):
                url = URL_MINDS.format(nome=nome, p=p, r=r)
                out.append(item(f"ext-minds-{slug(g)}-{p:02d}-{r}", "minds", f"ext-minds-{p:02d}", g, url,
                                pessoa=p, repeticao=r))
    return out


def sem_acento(palavra):
    """Letras do alfabeto manual da palavra (Á vira A; o Ç fica)."""
    return "".join(c if c == "Ç" else unicodedata.normalize("NFKD", c).encode("ascii", "ignore").decode()
                   for c in palavra.upper())


def montar_letras():
    out = []
    for L in PEDAL_LETRAS:
        for n in (1, 2, 3):
            url = URL_PEDAL.format(pasta="alfabeto", nome=urllib.parse.quote(f"{L.lower()}-{n}"))
            out.append({"id": f"ext-pedal-{slug(L) if L != 'Ç' else 'cedilha'}-{n}", "title": f"Letra {L}",
                        "channel": "pedal", "channel_id": None, "duration": 0, "tipo": "letra", "rotulo": L,
                        "fonte": "pedal", "url": url})
    for p in PEDAL_PALAVRAS:
        url = URL_PEDAL.format(pasta="palavras", nome=urllib.parse.quote(p.lower()))
        out.append({"id": f"ext-pedal-{slug(p)}", "title": p, "channel": "pedal", "channel_id": None, "duration": 0,
                    "tipo": "alfabeto", "rotulo": None, "sequencia": sem_acento(p), "fonte": "pedal", "url": url})
    return out


def cor_do_fundo(path):
    """Pessoa do PEdAL pela cor do canto de cima do primeiro quadro (a mais perto em PEDAL_CORES)."""
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(path)
    ok, f = cap.read()
    cap.release()
    if not ok:
        return None
    m = f[:20, :20].reshape(-1, 3).mean(0)
    cor, dist = min(((c, float(np.linalg.norm(m - np.array(v)))) for c, v in PEDAL_CORES.items()), key=lambda x: x[1])
    return cor if dist < 25 else None


def cmd_listar(args):
    for path, novos in ((LISTA_LETRAS, montar_letras()),) if args.letras else ((LISTA, montar()),):
        antigos = {x["id"]: x for x in carregar(path)}
        guardar = ("arquivo", "erro", "fora", "channel_id", "progressivo")
        # o canal só vem da lista antiga no PEdAL (sai da cor do fundo no download)
        lista = [{**x, **{k: v for k, v in antigos.get(x["id"], {}).items() if k in guardar and v is not None
                          and (k != "channel_id" or x["fonte"] == "pedal")}}
                 for x in novos]
        salvar(path, lista)
        por = {}
        for x in lista:
            por.setdefault(x["fonte"], set()).add(x.get("glosa") or x.get("rotulo") or x["title"])
        print(f"{len(lista)} vídeos em {path}: " + " | ".join(f"{f} {len(g)} glosas" for f, g in por.items()))


def progressivo(path):
    """
    Regrava o vídeo do V-LIBRASIL em H.264 progressivo de 480 linhas (ffmpeg do imageio-ffmpeg). Parte
    dos arquivos vem marcada como entrelaçada e o OpenCV lê esses quadros pretos (sem mão nem corpo).
    """
    import subprocess

    import imageio_ffmpeg

    tmp = path + ".conv.mp4"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", path,
                    "-vf", "yadif=deint=interlaced,setfield=prog,scale=-2:480", "-c:v", "libx264", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-an", tmp], check=True)
    os.replace(tmp, path)


def cmd_converter(args):
    lista = carregar(LISTA)
    for x in lista:
        if x["fonte"] == "vlibrasil" and x.get("arquivo") and not x.get("progressivo"):
            progressivo(os.path.join(VIDEOS, x["arquivo"]))
            x["progressivo"] = True
            print(f"convertido {x['id']}", flush=True)
    salvar(LISTA, lista)


def livre_gb():
    return shutil.disk_usage(VIDEOS).free / 1e9


def cmd_baixar(args):
    fontes = set(args.fontes.split(","))
    path_lista = LISTA_LETRAS if fontes == {"pedal"} else LISTA
    lista = carregar(path_lista)
    pendentes = [x for x in lista if x["fonte"] in fontes and not x.get("arquivo") and not x.get("fora")]
    print(f"{len(pendentes)} para baixar", flush=True)
    for i, x in enumerate(pendentes, 1):
        if livre_gb() < MIN_LIVRE_GB:
            print(f"menos de {MIN_LIVRE_GB} GB livres: parei", flush=True)
            break
        destino = os.path.join(VIDEOS, f"{x['id']}.mp4")
        if os.path.exists(destino):
            x["arquivo"] = os.path.basename(destino)
            continue
        tmp = destino + ".part"
        try:
            for tentativa in range(5):  # o servidor da UFRGS recusa conexões de vez em quando
                try:
                    with urllib.request.urlopen(urllib.request.Request(x["url"], headers=UA), timeout=120) as r, \
                            open(tmp, "wb") as f:
                        shutil.copyfileobj(r, f)
                    break
                except urllib.error.URLError as err:
                    if tentativa == 4 or isinstance(err, urllib.error.HTTPError):
                        raise
                    time.sleep(5)
            with open(tmp, "rb") as f:
                cabeca = f.read(12)
            if cabeca[4:8] != b"ftyp":
                raise ValueError("não é mp4")
            os.replace(tmp, destino)
            x["arquivo"] = os.path.basename(destino)
            x.pop("erro", None)
            if x["fonte"] == "vlibrasil":
                progressivo(destino)
                x["progressivo"] = True
            if x["fonte"] == "pedal":
                cor = cor_do_fundo(destino)
                x["channel_id"] = f"ext-pedal-{cor}" if cor else f"ext-pedal-{x['id']}"
            print(f"[{i}/{len(pendentes)}] ok {x['id']} ({os.path.getsize(destino) / 1e6:.1f} MB)", flush=True)
        except Exception as err:  # arquivo que falta no espelho, servidor fora
            x["erro"] = str(err)[:200]
            if os.path.exists(tmp):
                os.remove(tmp)
            print(f"[{i}/{len(pendentes)}] erro {x['id']}: {x['erro']}", flush=True)
        if i % 10 == 0:
            salvar(path_lista, lista)
        time.sleep(args.pausa)
    salvar(path_lista, lista)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    lst = sub.add_parser("listar")
    lst.add_argument("--letras", action="store_true", help="a lista das letras (PEdAL) em vez da dos sinais")
    sub.add_parser("converter", help="regrava os vídeos do V-LIBRASIL já baixados (progressivo, 480 linhas)")
    d = sub.add_parser("baixar")
    d.add_argument("--fontes", default="vlibrasil,signbank,minds")
    d.add_argument("--pausa", type=float, default=1.0)
    args = ap.parse_args()
    {"listar": cmd_listar, "baixar": cmd_baixar, "converter": cmd_converter}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
