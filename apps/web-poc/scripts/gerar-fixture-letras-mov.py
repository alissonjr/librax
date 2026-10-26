"""
Gera o fixture do teste de paridade das letras com movimento (src/__tests__/letrasMovParidade.test.ts).

O app monta a entrada do modelo das letras com movimento em TypeScript
(src/recognition/letterMotion.ts) e o treino em Python (ml-training/train_letras_mov.py: janela,
mao_do_quadro, rotulo_janela e compactar). Este script roda o código do treino e guarda o que ele
devolve:

- casos sintéticos da mão de cada quadro e do rótulo da janela (duas mãos, empate, sem mão);
- trechos reais (2 s, como o buffer do app) de letras com movimento nos vídeos do alfabeto a 15
  quadros por segundo, um com cada rótulo do MediaPipe (se só houver um, o outro é o mesmo trecho
  espelhado), mais uma cópia com quadros sem mão e outra com uma segunda mão mais baixa: as
  janelas de 0,8, 1,2 e 1,6 s que terminam no último quadro, uma que começa antes do primeiro
  quadro e, no trecho quase sem mão, uma que não é avaliada (null), com o movimento de cada uma
  (movimento do train_letras_mov.py, o portão de movimento das regras de leitura) e o desenho da
  janela inteira (desenho, as regras por letra);
- entradas sorteadas com a mão presente em alguns passos, com o movimento;
- um MLP pequeno de pesos sorteados no formato do modelo real (export_web, kind "letras-mov"), com
  o softmax de mlp_forward para as entradas dos trechos e duas sorteadas.

O modelo de verdade tem o próprio golden.json (train_letras_mov.py treinar); o teste também o
confere quando há modelo em public/ml/letras-mov/ (ou em LIBRAX_LETRAS_MOV_DIR).

Uso (numpy; lê os landmarks de ml-training/data/letras_mov, que fica fora do git):
    LIBRAX_DATA=/caminho/data python scripts/gerar-fixture-letras-mov.py [--ml-training ../../ml-training] [--out <pasta>]
"""

import argparse
import copy
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(AQUI)
OUT_PADRAO = os.path.join(APP, "src", "recognition", "__fixtures__", "letras-mov")
SEED = 20261025
TRECHO_S = 2.0


def arred(x, casas=6):
    if x is None:
        return None
    return [round(float(v), casas) or 0 for v in np.asarray(x).reshape(-1)]


def mao(cx, cy, escala, rng):
    pts = np.column_stack([cx + rng.normal(0, escala, 21), cy + rng.normal(0, escala, 21), rng.normal(0, escala / 3, 21)])
    pts[0] = [cx, cy, 0.0]
    return [round(float(v), 5) for v in pts.reshape(-1)]


def quadro(t, maos):
    return {"t": t, "hands": [{"h": h, "lm": lm} for h, lm in maos]}


def casos_mao(lm_mod, rng):
    """mao_do_quadro e rotulo_janela em listas pequenas."""
    q = [
        quadro(0.0, [("Left", mao(0.4, 0.6, 0.03, rng)), ("Right", mao(0.6, 0.4, 0.03, rng))]),
        quadro(0.1, [("Right", mao(0.6, 0.45, 0.03, rng))]),
        quadro(0.2, []),
        quadro(0.3, [("Left", mao(0.4, 0.3, 0.03, rng)), ("Left", mao(0.6, 0.5, 0.03, rng))]),
        quadro(0.4, [("Left", mao(0.42, 0.3, 0.03, rng))]),
    ]
    maos = [{"name": f"quadro {i}", "frame": f, "expected": (lambda h: None if h is None else f["hands"].index(h))(lm_mod.mao_do_quadro(f["hands"]))}
            for i, f in enumerate(q)]
    rotulos = [
        {"name": "a mais vista", "frames": q, "t0": 0.0, "t1": 0.4, "expected": lm_mod.rotulo_janela(q, 0.0, 0.4)},
        {"name": "empate fica com a primeira", "frames": q[:2] + q[3:4], "t0": 0.0, "t1": 0.3,
         "expected": lm_mod.rotulo_janela(q[:2] + q[3:4], 0.0, 0.3)},
        {"name": "só dentro da janela", "frames": q, "t0": 0.25, "t1": 0.4, "expected": lm_mod.rotulo_janela(q, 0.25, 0.4)},
        {"name": "sem mão", "frames": [q[2]], "t0": 0.0, "t1": 0.4, "expected": lm_mod.rotulo_janela([q[2]], 0.0, 0.4)},
    ]
    return maos, rotulos


def espelhar(frames):
    out = copy.deepcopy(frames)
    for f in out:
        for h in f["hands"]:
            h["h"] = "Right" if h["h"] == "Left" else "Left"
            lm = h["lm"]
            for i in range(0, len(lm), 3):
                lm[i] = round(1.0 - lm[i], 5)
    return out


def escolher_trechos(lm_mod):
    """Um trecho de letra com movimento por rótulo do MediaPipe (o que faltar sai espelhado)."""
    with open(lm_mod.TRECHOS) as f:
        trechos = json.load(f)["trechos"]
    achados = {}
    for tr in trechos:
        if not tr["ok"] or tr["fonte"] != "alfabeto" or tr["letra"] not in lm_mod.LETRAS_MOV:
            continue
        path = os.path.join(lm_mod.LANDMARKS, f"{tr['id']}.json")
        if not os.path.exists(path):
            continue
        with open(path) as f:
            v = json.load(f)
        t_fim = tr["fim"] + 0.2
        frames = [fr for fr in v["frames"] if t_fim - TRECHO_S < fr["t"] <= t_fim]
        if len(frames) < 20 or sum(1 for fr in frames if fr["hands"]) < 18:
            continue
        rot = lm_mod.rotulo_janela(frames, frames[0]["t"], frames[-1]["t"])
        maos = [lm_mod.mao_do_quadro(fr["hands"]) for fr in frames if fr["hands"]]
        # trecho de pessoa com o rótulo estável (no desenho animado o rótulo troca)
        if sum(1 for h in maos if h["h"] == rot) < 0.9 * len(maos):
            continue
        if rot not in achados:
            achados[rot] = (tr, v["aspect"], frames)
        if len(achados) == 2:
            break
    if not achados:
        raise SystemExit("nenhum trecho com landmarks a 15 quadros por segundo")
    out = list(achados.values())
    if len(out) == 1:
        tr, asp, frames = out[0]
        out.append(({**tr, "id": tr["id"] + "-espelhado"}, asp, espelhar(frames)))
    return out


def trecho_fixture(lm_mod, tr, aspect, frames, com_reamostrada):
    t_ini, t_fim = frames[0]["t"], frames[-1]["t"]
    janelas = [(t_fim - d, t_fim) for d in lm_mod.JANELAS_S] + [(t_ini - 0.2, t_ini + 0.8)]
    saida = []
    for i, (t0, t1) in enumerate(janelas):
        w = lm_mod.janela(frames, aspect, t0, t1)
        item = {"t0": t0, "t1": t1, "input": None if w is None else arred(lm_mod.compactar(w)[0]),
                "motion": None if w is None else float(lm_mod.movimento(lm_mod.compactar(w))[0])}
        if w is not None:
            med = lm_mod.desenho(w)
            item["drawing"] = {"displacement": float(med["deslocamento"][0]), "shapeChange": float(med["mudanca_forma"][0]),
                               "shapeOscillation": float(med["vaivem_forma"][0])}
        if i == 0 and com_reamostrada and w is not None:
            item["resampled"] = arred(w)
        saida.append(item)
    return {"id": tr["id"], "letra": tr["letra"], "aspect": aspect, "frames": frames, "windows": saida}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ml-training", default=os.path.join(APP, "..", "..", "ml-training"))
    ap.add_argument("--out", default=OUT_PADRAO)
    args = ap.parse_args()
    ml = os.path.abspath(args.ml_training)
    sys.path.insert(0, ml)
    import train_letras_mov as lm_mod  # noqa: E402
    from train_static import NORMALIZATION_VERSION, export_web, mlp_forward  # noqa: E402

    rng = np.random.default_rng(SEED)
    base = escolher_trechos(lm_mod)
    trechos = [trecho_fixture(lm_mod, tr, asp, fr, com_reamostrada=(i == 0)) for i, (tr, asp, fr) in enumerate(base)]

    # Variações do primeiro trecho: quadros sem mão no meio e uma segunda mão mais baixa
    tr, asp, fr = base[0]
    buracos = copy.deepcopy(fr)
    for i in range(3, len(buracos), 4):
        buracos[i]["hands"] = []
    trechos.append(trecho_fixture(lm_mod, {**tr, "id": tr["id"] + "-buracos"}, asp, buracos, com_reamostrada=True))
    duas = copy.deepcopy(fr)
    for f in duas:
        if f["hands"]:
            outra = "Right" if f["hands"][0]["h"] == "Left" else "Left"
            f["hands"].append({"h": outra, "lm": mao(0.5, 0.97, 0.02, rng)})
    trechos.append(trecho_fixture(lm_mod, {**tr, "id": tr["id"] + "-duas-maos"}, asp, duas, com_reamostrada=False))
    quase_sem = copy.deepcopy(fr)
    for i, f in enumerate(quase_sem):
        if i % 3:
            f["hands"] = []
    trechos.append(trecho_fixture(lm_mod, {**tr, "id": tr["id"] + "-quase-sem-mao"}, asp, quase_sem, com_reamostrada=False))
    if any(w["input"] is not None for w in trechos[-1]["windows"][:3]):
        raise SystemExit("o trecho quase sem mão devia ficar sem janela avaliável")

    labels = ["H", "J", "K", "_"]
    dim = lm_mod.PASSOS * lm_mod.F
    layers = [
        (rng.normal(0, 0.15, (dim, 8)), rng.normal(0, 0.1, 8), "relu"),
        (rng.normal(0, 0.8, (8, len(labels))), rng.normal(0, 0.1, len(labels)), "softmax"),
    ]
    layers = [(k.astype(np.float32), b.astype(np.float32), a) for k, b, a in layers]
    os.makedirs(args.out, exist_ok=True)
    export_web(args.out, layers, labels, [], extra={
        "kind": "letras-mov", "frames": lm_mod.PASSOS, "features_per_frame": lm_mod.F,
        "window_frames": lm_mod.T, "windows_s": list(lm_mod.JANELAS_S), "min_presence": lm_mod.MIN_PRESENCA,
        "channels": 0,
    })
    casos = [({"clip": i, "window": j}, np.array(w["input"]))
             for i, t in enumerate(trechos) for j, w in enumerate(t["windows"]) if w["input"] is not None]
    casos += [({"input": arred(x, 4)}, np.array(arred(x, 4))) for x in rng.normal(0, 1, (2, dim))]
    golden = {"labels": labels, "cases": [{**ref, "probs": arred(mlp_forward(layers, x[None])[0], 9)} for ref, x in casos]}
    with open(os.path.join(args.out, "golden.json"), "w") as f:
        json.dump(golden, f, ensure_ascii=False)

    maos, rotulos = casos_mao(lm_mod, rng)
    # Movimento em entradas sorteadas, com a mão em alguns passos (sorteio à parte, para não mudar o resto)
    rng_mov = np.random.default_rng(SEED + 2)
    movimentos = []
    for _ in range(6):
        x = rng_mov.normal(0, 0.5, (lm_mod.PASSOS, lm_mod.F))
        x[:, 0] = (rng_mov.random(lm_mod.PASSOS) < 0.6).astype(float)
        x = np.array(arred(x, 4)).reshape(1, -1)
        movimentos.append({"input": arred(x[0], 4), "motion": float(lm_mod.movimento(x)[0])})
    fixture = {
        "contract": {
            "normalization_version": NORMALIZATION_VERSION, "T": lm_mod.T, "F": lm_mod.F, "frames": lm_mod.PASSOS,
            "windows_s": list(lm_mod.JANELAS_S), "min_presence": lm_mod.MIN_PRESENCA, "min_p": lm_mod.MIN_P,
            "none": lm_mod.NENHUMA, "buffer_s": lm_mod.BUFFER_S, "eval_s": lm_mod.AVALIA_S, "confirm": lm_mod.CONFIRMA,
            "motion_shape_weight": lm_mod.PESO_FORMA,
        },
        "motionCases": movimentos,
        "handCases": maos,
        "labelCases": rotulos,
        "clips": trechos,
    }
    with open(os.path.join(args.out, "features.json"), "w") as f:
        json.dump(fixture, f, ensure_ascii=False, separators=(",", ":"))
    print(f"fixture em {args.out}: {len(trechos)} trechos ({', '.join(t['letra'] + '/' + t['id'] for t in trechos)}), "
          f"{len(golden['cases'])} casos do MLP")


if __name__ == "__main__":
    main()
