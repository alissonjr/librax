"""
Trechos das letras com movimento nos vídeos novos de video/baixar_xz.py (lista
data/letras_mov/fontes_xz.json, landmarks a 15 quadros por segundo em data/letras_mov/landmarks15_xz/),
no mesmo formato do letras_mov_trechos.json, para o train_letras_mov.py somar ao treino.

Os vídeos antigos do alfabeto têm as paradas das letras do rotular.py (data/rotulos/). Os novos não
passam por ele (o rotular.py reescreve o dataset das letras paradas inteiro); aqui as paradas saem
assim:
1. Paradas: os trechos estáveis da mão (paradas() do rotular.py, nos quadros de 15 por segundo).
2. Pontuação de cada parada contra cada letra da sequência: o modelo das letras paradas do app
   (public/ml/classifier) na forma típica da parada. As letras com movimento usam a forma que o
   modelo costuma ler nelas (FAMILIA do rotular_letras_mov: J lê I, Ç lê C ou O, Z lê D, L, G ou X).
3. Alinhamento monotônico (alinhar() do rotular.py). A parada fica aceita quando o modelo dá pelo
   menos MIN_P_ACEITA para a letra alinhada e ela dura pelo menos MIN_PARADA_ACEITA_S.
4. Com as paradas aceitas, os trechos saem como nos vídeos antigos (trechos_alfabeto() do
   rotular_letras_mov: entre a parada da letra de antes e a da letra de depois), com a mesma
   conferência de energia e de texto na tela.
Vídeos de uma letra (YouTube e Spread the Sign) seguem as regras do rotular_letras_mov: letra com
movimento pelo pedaço de maior energia, letra parada vira "_" em volta da letra.

Revisão a olho: as folhas ficam em data/letras_mov/conferir_xz/letra-<L>.jpg e os trechos que não
mostram a letra vão para letras_mov_conferencia_xz.json.

Saída: ml-training/letras_mov_trechos_xz.json (no git).

Outra lista (video/baixar_extra.py, mais vídeos do Z): --lista data/letras_mov/fontes_z2.json com
--saida, --conferencia, --conferir e --ocr próprios (sem mexer nos da primeira lista).

Uso:
    python video/rotular_xz.py [--folhas]
    python video/rotular_xz.py --lista data/letras_mov/fontes_z2.json --saida letras_mov_trechos_z2.json \
        --conferencia letras_mov_conferencia_z2.json --conferir data/letras_mov/conferir_z2 \
        --ocr data/letras_mov/ocr_z2 [--folhas]
    (LIBRAX_DATA=/caminho/data aponta para a pasta de dados)
"""

import argparse
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, ".."))
import rotular_letras_mov as rlm  # noqa: E402
from rotular import alinhar, media, paradas, quadros  # noqa: E402
from teste_fixo import carregar_modelo  # noqa: E402
from train_letras_mov import LETRAS_MOV, landmarks_de  # noqa: E402
from train_static import mlp_forward  # noqa: E402

DATA = rlm.DATA
LISTA = os.path.join(DATA, "letras_mov", "fontes_xz.json")
SAIDA = os.path.join(AQUI, "..", "letras_mov_trechos_xz.json")
CONFERENCIA = os.path.join(AQUI, "..", "letras_mov_conferencia_xz.json")
CONFERIR = os.path.join(DATA, "letras_mov", "conferir_xz")
OCR_DIR = os.path.join(DATA, "letras_mov", "ocr_xz")
SEQ = rlm.SEQ
MIN_P_ACEITA = 0.4
MIN_PARADA_ACEITA_S = 0.4
MIN_COBERTURA = 0.4  # fração das letras da sequência com parada aceita
PISO = 1e-3

_MODELO = None


def modelo():
    global _MODELO
    if _MODELO is None:
        _MODELO = carregar_modelo(rlm.CLASSIFICADOR)
    return _MODELO


def pontos(feats, seq):
    """[n_paradas, len(seq)]: probabilidade (do modelo das letras paradas) de cada parada ser cada letra."""
    labels, layers = modelo()
    P = mlp_forward(layers, np.asarray(feats))
    out = np.zeros((len(P), len(seq)))
    for j, L in enumerate(seq):
        familia = rlm.FAMILIA.get(L, L) if L in ("J", "Ç", "Z") else L
        idx = [labels.index(c) for c in familia if c in labels]
        out[:, j] = P[:, idx].sum(axis=1) if idx else 0.0
    return out


def rotulos_alfabeto(v, seq):
    """Paradas alinhadas à sequência no formato de data/rotulos/<id>.json (letra, ini, fim, aceita)."""
    qs = quadros(v)
    ps = paradas(qs)
    if not ps:
        return None
    feats = np.stack([media(qs, p) for p in ps])
    prob = pontos(feats, seq)
    al = alinhar(np.log(np.maximum(prob, PISO)))
    out = []
    for i, (p, j) in enumerate(zip(ps, al)):
        ini, fim = qs[p[0]]["t"], qs[p[-1]]["t"]
        letra = seq[j] if j >= 0 else None
        pj = float(prob[i, j]) if j >= 0 else 0.0
        out.append({"letra": letra, "ini": round(ini, 3), "fim": round(fim, 3), "p": round(pj, 3),
                    "aceita": bool(letra and pj >= MIN_P_ACEITA and fim - ini >= MIN_PARADA_ACEITA_S)})
    aceitas = {p["letra"] for p in out if p["aceita"]}
    return {"paradas": out, "qualidade": len(aceitas) / len(seq)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folhas", action="store_true", help="gera as folhas de conferência")
    ap.add_argument("--lista", default=LISTA)
    ap.add_argument("--saida", default=SAIDA)
    ap.add_argument("--conferencia", default=CONFERENCIA)
    ap.add_argument("--conferir", default=CONFERIR)
    ap.add_argument("--ocr", default=OCR_DIR)
    args = ap.parse_args()
    LISTA_, SAIDA_, CONFERENCIA_, CONFERIR_, OCR_DIR_ = args.lista, args.saida, args.conferencia, args.conferir, args.ocr

    with open(LISTA_) as f:
        fontes = {x["id"]: x for x in json.load(f) if x.get("arquivo") and not x.get("fora")}
    arquivos = {vid: os.path.join(DATA, "videos", x["arquivo"]) for vid, x in fontes.items()}
    fora = {}
    if os.path.exists(CONFERENCIA_):
        with open(CONFERENCIA_) as f:
            fora = {(x["id"], x["letra"]): x.get("motivo", "") for x in json.load(f)["fora"]}
    os.makedirs(OCR_DIR_, exist_ok=True)
    trechos, videos, resumo_alf = [], [], []
    for vid, fonte in sorted(fontes.items()):
        path = landmarks_de(vid)
        if not path:
            continue
        with open(path) as f:
            v = json.load(f)
        ts, es = rlm.energia(v)
        cache_path = os.path.join(OCR_DIR_, f"{vid}.json")
        cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
        canal = fonte.get("channel", "")
        if fonte["tipo"] == "alfabeto":
            seq = fonte.get("sequencia") or SEQ
            rot = rotulos_alfabeto(v, seq)
            if rot is None:
                continue
            resumo_alf.append((vid, round(rot["qualidade"], 2)))
            if rot["qualidade"] < MIN_COBERTURA:
                continue
            achados, estaticas, inicio, fim = rlm.trechos_alfabeto(vid, fonte, rot)
            videos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": "alfabeto",
                           "inicio": inicio, "fim": fim, "paradas": estaticas})
        elif fonte["tipo"] == "letra" and fonte.get("rotulo") in LETRAS_MOV:
            if any(w in fonte["title"].lower() for w in rlm.TITULO_FORA):
                continue
            ab = rlm.trecho_letra(v, ts, es, fonte["rotulo"])
            achados = [{"letra": fonte["rotulo"], "ini": round(ab[0], 3), "fim": round(ab[1], 3),
                        "como": "maior energia", "parada": None}] if ab else []
            videos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": "letra",
                           "inicio": None, "fim": None, "paradas": []})
        elif fonte["tipo"] == "letra" and fonte.get("rotulo") in SEQ:
            regiao = rlm.regiao_parada(v, fonte["rotulo"])
            if regiao:
                videos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": "letra-parada",
                               "letra": fonte["rotulo"], "regioes": [regiao], "paradas": []})
            continue
        else:
            continue
        for tr in achados:
            e = rlm.energia_em(ts, es, tr["ini"], tr["fim"])
            pontos_ocr = [rlm.ocr_letras(vid, arquivos[vid], round(tr["ini"] + frac * (tr["fim"] - tr["ini"]), 2), cache)
                          for frac in (0.25, 0.5, 0.9)]
            letras = {k: c for p in pontos_ocr for k, c in p.items()}
            aceitas_ocr = rlm.OCR_ACEITA.get(tr["letra"], tr["letra"])
            j = SEQ.index(tr["letra"])
            vizinhas = set(SEQ[max(j - 1, 0):j + 2])
            confirma = any(c in letras for c in aceitas_ocr)
            outra = bool(pontos_ocr[1]) and not set(pontos_ocr[1]) <= vizinhas
            ok = e >= rlm.MIN_ENERGIA and (confirma or not outra)
            motivo = None if ok else ("sem movimento" if e < rlm.MIN_ENERGIA else f"tela mostra {''.join(sorted(pontos_ocr[1]))}")
            if ok and (vid, tr["letra"]) in fora:
                ok, motivo = False, f"conferência: {fora[(vid, tr['letra'])]}"
            trechos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": videos[-1]["fonte"],
                            **tr, "energia": round(e, 2), "ocr": "".join(sorted(letras)), "ok": ok,
                            **({"motivo": motivo} if motivo else {})})
        with open(cache_path, "w") as f:
            json.dump(cache, f)

    saida = {
        "_sobre": f"Trechos das letras com movimento nos vídeos de data/letras_mov/{os.path.basename(LISTA_)} "
                  "(video/rotular_xz.py), no formato do letras_mov_trechos.json; o train_letras_mov.py soma os "
                  "dois. ok=false fica fora. A revisão a olho das folhas fica em "
                  f"{os.path.basename(CONFERENCIA_)}.",
        "trechos": trechos,
        "ines": [],
        "videos": videos,
    }
    with open(SAIDA_, "w") as f:
        json.dump(saida, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("cobertura dos alfabetos:", " ".join(f"{a}:{b}" for a, b in resumo_alf))
    for L in LETRAS_MOV:
        ts_L = [t for t in trechos if t["letra"] == L]
        ok = [t for t in ts_L if t["ok"]]
        print(f"{L}: {len(ok)}/{len(ts_L)} trechos ok, {len({t['channel_id'] for t in ok})} canais "
              f"(alfabeto {sum(t['fonte'] == 'alfabeto' for t in ok)}, letra {sum(t['fonte'] == 'letra' for t in ok)})")
    print(f"gravado em {SAIDA_}")
    if args.folhas:
        rlm.CONFERIR = CONFERIR_
        rlm.carregar = lambda vid: json.load(open(landmarks_de(vid))) if landmarks_de(vid) else None
        for out in rlm.folhas(trechos, arquivos):
            print(out)


if __name__ == "__main__":
    sys.exit(main())
