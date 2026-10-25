"""
Folha de conferência dos rótulos: para cada vídeo, uma imagem com a mão recortada no meio de cada
parada e a letra que o rotular.py deu (ou "-" quando virou lixo). Serve para olhar e achar
alinhamento errado antes de treinar.

Também monta a galeria de uma letra: a parada aceita dessa letra em cada vídeo, lado a lado,
para ver se todo mundo fez a mesma forma (rótulo errado aparece destoando).

Uso:
    python video/conferir.py [id ...]     (sem id: todos os vídeos rotulados)
    python video/conferir.py --letra U [--letra V ...]
Saída: ml-training/data/conferir/<id>.jpg e ml-training/data/conferir/letra-<L>.jpg
"""

import glob
import json
import os
import sys

import cv2
import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(AQUI, "..", "data")
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


def main():
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
