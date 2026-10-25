"""
Teste fixo do modelo de letras: vídeos do alfabeto de canais que NUNCA entram no treino, com os
rótulos congelados em data/teste_fixo.json. Mede qualquer modelo exportado (model.json +
weights.bin) do mesmo jeito, para comparar versões.

O rotular.py lê este arquivo e deixa os canais do teste fora do dataset.

Como mede (igual ao app): cada quadro passa pela normalização e pelo MLP; a letra só vale com
probabilidade >= MIN_P e quando não é "_". Uma parada conta como acerto quando a letra mais lida
nos quadros dela é a do rótulo. Paradas "_" (mão em repouso, introdução) medem o alarme falso:
a parada que vira alguma letra. Se existir data/teste_negativas.json (video/negativas.py), mede
também o alarme falso quadro a quadro em mãos em repouso de canais que não entram no treino.

Uso:
    python teste_fixo.py montar ID [ID ...]    congela as paradas aceitas e algumas "_" desses vídeos
    python teste_fixo.py conferir              folhas para conferir os rótulos congelados a olho
    python teste_fixo.py avaliar PASTA_DO_MODELO [--detalhe]
"""

import argparse
import collections
import json
import os
import sys

import numpy as np

from train_static import mlp_forward, normalize_hand

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(AQUI, "data")
ARQUIVO = os.path.join(DATA, "teste_fixo.json")
MIN_P = 0.6  # MLP_MIN_PROBABILITY do app (classifier.ts)
NENHUMA = "_"
NEGATIVAS_POR_VIDEO = 8
# As 24 letras que o modelo conhece (sem J, Z e Ç, que têm movimento)
ESTATICAS = set("ABCDEFGHIKLMNOPQRSTUVWXY")


def canais_do_teste():
    """Canais que não podem entrar no treino (lido pelo rotular.py)."""
    if not os.path.exists(ARQUIVO):
        return set()
    with open(ARQUIVO) as f:
        return {v["channel_id"] for v in json.load(f)["videos"]}


def montar(ids):
    fontes = {f["id"]: f for f in json.load(open(os.path.join(DATA, "fontes.json")))}
    videos = []
    for vid in ids:
        rot = json.load(open(os.path.join(DATA, "rotulos", f"{vid}.json")))
        paradas = [{"letra": p["letra"], "ini": p["ini"], "fim": p["fim"]}
                   for p in rot["paradas"] if p.get("aceita") and p["letra"] in ESTATICAS]
        negativas = [{"letra": NENHUMA, "ini": p["ini"], "fim": p["fim"]}
                     for p in rot["paradas"] if not p["letra"] and not p.get("ocr")][:NEGATIVAS_POR_VIDEO]
        videos.append({"id": vid, "channel_id": fontes[vid]["channel_id"], "channel": fontes[vid]["channel"],
                       "paradas": paradas + negativas})
        print(f"{vid} ({fontes[vid]['channel']}): {len(paradas)} letras, {len(negativas)} sem letra")
    with open(ARQUIVO, "w") as f:
        json.dump({"min_p": MIN_P, "videos": videos}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"gravado em {ARQUIVO}")


def conferir():
    """Uma folha por vídeo do teste: a mão no meio de cada parada congelada, com o rótulo."""
    import cv2

    sys.path.insert(0, os.path.join(AQUI, "video"))
    from conferir import recorte

    fontes = {f["id"]: f for f in json.load(open(os.path.join(DATA, "fontes.json")))}
    lado, colunas = 110, 11
    for v in json.load(open(ARQUIVO))["videos"]:
        lms = json.load(open(os.path.join(DATA, "landmarks", f"{v['id']}.json")))
        tempos = np.array([f["t"] for f in lms["frames"]])
        cap = cv2.VideoCapture(os.path.join(DATA, "videos", fontes[v["id"]]["arquivo"]))
        tiles = []
        for p in v["paradas"]:
            meio = (p["ini"] + p["fim"]) / 2
            i = int(np.argmin(np.abs(tempos - meio)))
            hands = lms["frames"][i]["hands"]
            cap.set(cv2.CAP_PROP_POS_MSEC, meio * 1000)
            ok, frame = cap.read()
            if not ok or not hands:
                continue
            t = cv2.resize(recorte(frame, min(hands, key=lambda h: h["lm"][1])["lm"], lms["aspect"]), (lado, lado))
            cv2.rectangle(t, (0, 0), (28, 24), (0, 0, 0), -1)
            cv2.putText(t, p["letra"], (4, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (80, 220, 80), 2)
            tiles.append(t)
        cap.release()
        while len(tiles) % colunas:
            tiles.append(np.zeros_like(tiles[0]))
        img = np.vstack([np.hstack(tiles[i:i + colunas]) for i in range(0, len(tiles), colunas)])
        out = os.path.join(DATA, "conferir", f"teste-{v['id']}.jpg")
        cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 70])
        print(out)


def carregar_modelo(pasta):
    m = json.load(open(os.path.join(pasta, "model.json")))
    w = np.fromfile(os.path.join(pasta, m["weights"]["file"]), dtype="<f4")
    layers, o = [], 0
    for L in m["layers"]:
        k = w[o:o + L["in"] * L["out"]].reshape(L["in"], L["out"])
        o += L["in"] * L["out"]
        b = w[o:o + L["out"]]
        o += L["out"]
        layers.append((k, b, L["activation"]))
    return m["labels"], layers


def avaliar(pasta, detalhe):
    labels, layers = carregar_modelo(pasta)
    teste = json.load(open(ARQUIVO))
    acertos = collections.Counter()
    total = collections.Counter()
    trocas = collections.Counter()
    alarmes = negativas = 0
    for v in teste["videos"]:
        lms = json.load(open(os.path.join(DATA, "landmarks", f"{v['id']}.json")))
        aspect = lms["aspect"]
        for p in v["paradas"]:
            X = []
            for f in lms["frames"]:
                if p["ini"] <= f["t"] <= p["fim"] and f["hands"]:
                    h = min(f["hands"], key=lambda h: h["lm"][1])
                    X.append(normalize_hand(h["lm"], h["h"], aspect))
            if not X:
                continue
            P = mlp_forward(layers, np.array(X))
            lidas = [labels[i] for i, pr in zip(P.argmax(1), P.max(1)) if pr >= MIN_P and labels[i] != NENHUMA]
            mais = collections.Counter(lidas).most_common(1)
            lida = mais[0][0] if mais else None
            if p["letra"] == NENHUMA:
                negativas += 1
                alarmes += lida is not None
                continue
            total[p["letra"]] += 1
            if lida == p["letra"]:
                acertos[p["letra"]] += 1
            else:
                trocas[(p["letra"], lida or "nada")] += 1
    # Repouso de canais separados (video/negativas.py): cada quadro que vira letra é alarme falso
    rep_alarmes = rep_total = 0
    rep_path = os.path.join(DATA, "teste_negativas.json")
    if os.path.exists(rep_path):
        casos = json.load(open(rep_path))["casos"]
        if casos:
            X = np.array([normalize_hand(c["raw"], c["handedness"], c["aspect"]) for c in casos])
            P = mlp_forward(layers, X)
            rep_total = len(casos)
            rep_alarmes = int(sum(1 for i, pr in zip(P.argmax(1), P.max(1)) if pr >= MIN_P and labels[i] != NENHUMA))

    n = sum(total.values())
    print(f"modelo: {pasta}")
    print(f"letras certas: {sum(acertos.values())}/{n} ({sum(acertos.values()) / max(n, 1):.1%}) em "
          f"{len(teste['videos'])} canais fora do treino")
    print(f"alarme falso (mão sem letra lida como letra): {alarmes}/{negativas} ({alarmes / max(negativas, 1):.1%})")
    if rep_total:
        print(f"alarme falso em repouso (mãos juntas ou baixas, canais separados): {rep_alarmes}/{rep_total} "
              f"({rep_alarmes / rep_total:.1%})")
    print("trocas:", " ".join(f"{a}->{b}:{c}" for (a, b), c in trocas.most_common(12)) or "nenhuma")
    if detalhe:
        print("por letra:", " ".join(f"{L}:{acertos[L]}/{total[L]}" for L in sorted(total)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("montar")
    m.add_argument("ids", nargs="+")
    sub.add_parser("conferir")
    a = sub.add_parser("avaliar")
    a.add_argument("pasta")
    a.add_argument("--detalhe", action="store_true")
    args = ap.parse_args()
    if args.cmd == "montar":
        montar(args.ids)
    elif args.cmd == "conferir":
        conferir()
    else:
        avaliar(args.pasta, args.detalhe)


if __name__ == "__main__":
    sys.exit(main())
