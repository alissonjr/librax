"""
Folha de conferência dos rótulos: para cada vídeo, uma imagem com a mão recortada no meio de cada
parada e a letra que o rotular.py deu (ou "-" quando virou lixo). Serve para olhar e achar
alinhamento errado antes de treinar.

Também monta a galeria de uma letra: a parada aceita dessa letra em cada vídeo, lado a lado,
para ver se todo mundo fez a mesma forma (rótulo errado aparece destoando).

Uso:
    python video/conferir.py [id ...]     (sem id: todos os vídeos rotulados)
    python video/conferir.py --letra U [--letra V ...]
    python video/conferir.py --sinal ARROZ     (início, meio e fim do trecho escolhido em cada vídeo)
        [--rotulos data/sinais15/rotulos-x] [--fontes-extra data/sinais15/fontes_extra.json] [--saida PASTA]
    python video/conferir.py --numero 6 [--numero 7 ...]   (paradas do número, de rotular_numeros.py)
    python video/conferir.py --numeros15   (galerias e folhas dos trechos do rotular_numeros15.py,
                                            em data/numeros15/conferir/)
Saída: ml-training/data/conferir/<id>.jpg, letra-<L>.jpg e sinal-<GLOSA>.jpg; as dos números em
data/numeros/conferir/numero-<N>.jpg. LIBRAX_DATA aponta para outra pasta de dados.
"""

import glob
import json
import os
import sys

import cv2
import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
LADO = 150
COLUNAS = 9


def recorte(frame, lm, aspect):
    h, w = frame.shape[:2]
    pts = np.asarray(lm).reshape(21, 3)
    xs, ys = pts[:, 0] * w, pts[:, 1] * h
    cx, cy = xs.mean(), ys.mean()
    r = max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.75 + 10
    x0, x1 = int(max(cx - r, 0)), int(min(cx + r, w))
    y0, y1 = int(max(cy - r, 0)), int(min(cy + r, h))
    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return np.zeros((LADO, LADO, 3), np.uint8)
    return cv2.resize(crop, (LADO, LADO))


def folha(vid):
    rot_path = os.path.join(DATA, "rotulos", f"{vid}.json")
    lm_path = os.path.join(DATA, "landmarks", f"{vid}.json")
    fontes = {f["id"]: f for f in json.load(open(os.path.join(DATA, "fontes.json")))}
    rot = json.load(open(rot_path))
    lms = json.load(open(lm_path))
    video = os.path.join(DATA, "videos", fontes[vid]["arquivo"])
    cap = cv2.VideoCapture(video)
    tempos = [f["t"] for f in lms["frames"]]
    tiles = []
    for p in rot["paradas"]:
        i = int(np.argmin(np.abs(np.array(tempos) - p["meio"])))
        hands = lms["frames"][i]["hands"]
        cap.set(cv2.CAP_PROP_POS_MSEC, p["meio"] * 1000)
        ok, frame = cap.read()
        if not ok or not hands:
            continue
        hand = min(hands, key=lambda h: h["lm"][1])
        tile = recorte(frame, hand["lm"], lms["aspect"])
        txt = p["letra"] or "-"
        cor = (40, 200, 40) if p["letra"] else (90, 90, 90)
        cv2.rectangle(tile, (0, 0), (LADO, 30), (0, 0, 0), -1)
        cv2.putText(tile, txt, (6, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.8, cor, 2)
        cv2.putText(tile, f"{p['meio']:.1f}s", (LADO - 62, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)
        tiles.append(tile)
    cap.release()
    if not tiles:
        return None
    while len(tiles) % COLUNAS:
        tiles.append(np.zeros_like(tiles[0]))
    linhas = [np.hstack(tiles[i:i + COLUNAS]) for i in range(0, len(tiles), COLUNAS)]
    img = np.vstack(linhas)
    os.makedirs(os.path.join(DATA, "conferir"), exist_ok=True)
    out = os.path.join(DATA, "conferir", f"{vid}.jpg")
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return out


def galeria(letra):
    fontes = {f["id"]: f for f in json.load(open(os.path.join(DATA, "fontes.json")))}
    tiles = []
    for rot_path in sorted(glob.glob(os.path.join(DATA, "rotulos", "*.json"))):
        rot = json.load(open(rot_path))
        ps = [p for p in rot["paradas"] if p["letra"] == letra and p.get("aceita")]
        if not ps:
            continue
        vid = rot["id"]
        lms = json.load(open(os.path.join(DATA, "landmarks", f"{vid}.json")))
        tempos = np.array([f["t"] for f in lms["frames"]])
        cap = cv2.VideoCapture(os.path.join(DATA, "videos", fontes[vid]["arquivo"]))
        for p in ps[:2]:
            i = int(np.argmin(np.abs(tempos - p["meio"])))
            hands = lms["frames"][i]["hands"]
            cap.set(cv2.CAP_PROP_POS_MSEC, p["meio"] * 1000)
            ok, frame = cap.read()
            if not ok or not hands:
                continue
            tile = recorte(frame, min(hands, key=lambda h: h["lm"][1])["lm"], lms["aspect"])
            cv2.rectangle(tile, (0, 0), (LADO, 22), (0, 0, 0), -1)
            cv2.putText(tile, vid[:9], (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)
            tiles.append(tile)
        cap.release()
    if not tiles:
        return None
    while len(tiles) % COLUNAS:
        tiles.append(np.zeros_like(tiles[0]))
    img = np.vstack([np.hstack(tiles[i:i + COLUNAS]) for i in range(0, len(tiles), COLUNAS)])
    os.makedirs(os.path.join(DATA, "conferir"), exist_ok=True)
    out = os.path.join(DATA, "conferir", f"letra-{letra}.jpg")
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 75])
    return out


def galeria_sinal(glosa, rotulos=None, extras=(), saida=None):
    """
    Início, meio e fim do trecho escolhido em cada vídeo do sinal. `rotulos`: pasta dos rótulos (padrão
    data/rotulos_sinais); `extras`: outras listas de vídeos (os vídeos delas saem com o id em amarelo).
    """
    fontes = {f["id"]: f for f in json.load(open(os.path.join(DATA, "fontes_sinais.json")))}
    novos = set()
    for path in extras:
        lista = json.load(open(path))
        fontes.update({f["id"]: f for f in lista})
        novos |= {f["id"] for f in lista}
    linhas = []
    for rot_path in sorted(glob.glob(os.path.join(rotulos or os.path.join(DATA, "rotulos_sinais"), "*.json"))):
        rot = json.load(open(rot_path))
        if rot["glosa"] != glosa or not rot["sinal"]:
            continue
        cap = cv2.VideoCapture(os.path.join(DATA, "videos", fontes[rot["id"]]["arquivo"]))
        t0, t1 = rot["sinal"][0]
        tiles = []
        for t in (t0, (t0 + t1) / 2, t1):
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                frame = np.zeros((LADO, LADO, 3), np.uint8)
            h, w = frame.shape[:2]
            tile = cv2.resize(frame, (int(LADO * w / h), LADO))
            cv2.putText(tile, f"{t:.1f}s", (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
            tiles.append(tile)
        cap.release()
        linha = np.hstack(tiles)
        cor = (0, 230, 255) if rot["id"] in novos else (80, 220, 80)
        cv2.putText(linha, rot["id"][:11], (4, LADO - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, cor, 1)
        linhas.append(linha)
    if not linhas:
        return None
    larg = max(l.shape[1] for l in linhas)
    linhas = [np.pad(l, ((0, 0), (0, larg - l.shape[1]), (0, 0))) for l in linhas]
    # duas colunas de vídeos para a folha não ficar comprida demais
    if len(linhas) % 2:
        linhas.append(np.zeros_like(linhas[0]))
    meio = len(linhas) // 2
    img = np.hstack([np.vstack(linhas[:meio]), np.vstack(linhas[meio:])])
    out = os.path.join(saida or os.path.join(DATA, "conferir"), f"sinal-{glosa}.jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return out


def galeria_numero(numero, base="numeros", so_aceitas=False):
    """
    As paradas que o rotular_numeros.py deu como o número, uma por quadro: aceitas com o rótulo em
    verde, recusadas na checagem em cinza. Embaixo, o vídeo, o canal e o tempo.
    base "numeros15": as do rotular_numeros15.py (data/numeros15/rotulos, landmarks a 15 por segundo).
    """
    tiles = []
    for rot_path in sorted(glob.glob(os.path.join(DATA, base, "rotulos", "*.json"))):
        rot = json.load(open(rot_path))
        ps = [p for p in rot["paradas"] if p["numero"] == numero and (p["aceita"] or not so_aceitas)]
        if not ps or not rot.get("arquivo"):
            continue
        lms = json.load(open(os.path.join(DATA, rot["pasta"], f"{rot.get('video', rot['id'])}.json")))
        tempos = np.array([f["t"] for f in lms["frames"]])
        cap = cv2.VideoCapture(os.path.join(DATA, "videos", rot["arquivo"]))
        for p in ps:
            i = int(np.argmin(np.abs(tempos - p["meio"])))
            hands = lms["frames"][i]["hands"]
            cap.set(cv2.CAP_PROP_POS_MSEC, p["meio"] * 1000)
            ok, frame = cap.read()
            if not ok or not hands:
                continue
            # a mão que o rótulo usou (pulso gravado no rótulo); sem ele, a mais alta
            alvo = p.get("pulso")
            mao = min(hands, key=lambda h: (h["lm"][0] - alvo[0]) ** 2 + (h["lm"][1] - alvo[1]) ** 2 if alvo
                      else h["lm"][1])
            tile = recorte(frame, mao["lm"], lms["aspect"])
            cor = (40, 200, 40) if p["aceita"] else (140, 140, 140)
            cv2.rectangle(tile, (0, 0), (LADO, 26), (0, 0, 0), -1)
            cv2.putText(tile, numero if p["aceita"] else f"{numero}?", (6, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.7, cor, 2)
            cv2.putText(tile, f"{p['meio']:.1f}s", (LADO - 56, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)
            cv2.rectangle(tile, (0, LADO - 20), (LADO, LADO), (0, 0, 0), -1)
            cv2.putText(tile, f"{rot['id'][:11]} {(rot.get('channel') or '')[:6]}", (3, LADO - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, (220, 220, 220), 1)
            tiles.append(tile)
        cap.release()
    if not tiles:
        return None
    while len(tiles) % COLUNAS:
        tiles.append(np.zeros_like(tiles[0]))
    img = np.vstack([np.hstack(tiles[i:i + COLUNAS]) for i in range(0, len(tiles), COLUNAS)])
    out = os.path.join(DATA, base, "conferir", f"numero-{numero}.jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return out


def folha_numeros15(item):
    """Todas as paradas de um item do rotular_numeros15.py, em ordem, com o rótulo (verde: aceita;
    cinza: recusada ou lixo; laranja: forma de quantidade) e o texto lido na tela."""
    rot = json.load(open(os.path.join(DATA, "numeros15", "rotulos", f"{item}.json")))
    if not rot["paradas"] or not rot.get("arquivo"):
        return None
    lms = json.load(open(os.path.join(DATA, rot["pasta"], f"{rot['video']}.json")))
    tempos = np.array([f["t"] for f in lms["frames"]])
    cap = cv2.VideoCapture(os.path.join(DATA, "videos", rot["arquivo"]))
    tiles = []
    for p in rot["paradas"]:
        i = int(np.argmin(np.abs(tempos - p["meio"])))
        hands = lms["frames"][i]["hands"]
        cap.set(cv2.CAP_PROP_POS_MSEC, p["meio"] * 1000)
        ok, frame = cap.read()
        if not ok or not hands:
            continue
        alvo = p["pulso"]
        mao = min(hands, key=lambda h: (h["lm"][0] - alvo[0]) ** 2 + (h["lm"][1] - alvo[1]) ** 2)
        tile = recorte(frame, mao["lm"], lms["aspect"])
        txt = p.get("posicao") or "-"
        cor = (40, 200, 40) if p["aceita"] else (0, 140, 255) if txt.startswith("q") else (140, 140, 140)
        cv2.rectangle(tile, (0, 0), (LADO, 26), (0, 0, 0), -1)
        cv2.putText(tile, txt, (6, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.7, cor, 2)
        cv2.putText(tile, f"{p['meio']:.1f}s", (LADO - 56, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)
        cv2.rectangle(tile, (0, LADO - 20), (LADO, LADO), (0, 0, 0), -1)
        cv2.putText(tile, f"ocr {p.get('ocr') or '-'} {p['fim'] - p['ini']:.1f}s", (3, LADO - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (220, 220, 220), 1)
        tiles.append(tile)
    cap.release()
    if not tiles:
        return None
    while len(tiles) % COLUNAS:
        tiles.append(np.zeros_like(tiles[0]))
    img = np.vstack([np.hstack(tiles[i:i + COLUNAS]) for i in range(0, len(tiles), COLUNAS)])
    out = os.path.join(DATA, "numeros15", "conferir", f"{item}.jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return out


def main():
    if "--numeros15" in sys.argv:
        # galerias dos dez números (só as aceitas) e uma folha por item de sequência
        for n in [str(d) for d in range(10)]:
            print(galeria_numero(n, "numeros15", so_aceitas=True) or f"{n}: nenhuma parada")
        for path in sorted(glob.glob(os.path.join(DATA, "numeros15", "rotulos", "*@*.json"))):
            print(folha_numeros15(os.path.basename(path)[:-5]))
        return
    if "--numero" in sys.argv:
        for n in [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--numero"]:
            print(galeria_numero(n) or f"{n}: nenhuma parada")
        return
    if "--sinal" in sys.argv:
        def valores(nome):
            return [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == nome]
        rotulos, saida = (valores("--rotulos") or [None])[0], (valores("--saida") or [None])[0]
        for g in valores("--sinal"):
            print(galeria_sinal(g, rotulos, valores("--fontes-extra"), saida) or f"{g}: nenhum vídeo aceito")
        return
    if "--letra" in sys.argv:
        letras = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--letra"]
        for L in letras:
            print(galeria(L) or f"{L}: nenhuma parada aceita")
        return
    ids = sys.argv[1:] or [os.path.basename(p)[:-5] for p in sorted(glob.glob(os.path.join(DATA, "rotulos", "*.json")))]
    for vid in ids:
        out = folha(vid)
        print(out or f"{vid}: sem paradas")


if __name__ == "__main__":
    main()
