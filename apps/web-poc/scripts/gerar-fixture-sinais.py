"""
Gera o fixture do teste de paridade dos sinais com movimento (src/__tests__/sinaisParidade.test.ts).

O app monta a entrada do modelo de sinais em TypeScript (src/recognition/signFeatures.ts) e o
treino em Python (ml-training/video/rotular_sinais.py e ml-training/train_sinais.py). Este script
roda o código do treino sobre landmarks de verdade e guarda o que ele devolve:

- quadros: casos sintéticos (sem corpo, ombros juntos, sem mão, duas mãos com o mesmo rótulo,
  dominante esquerda, dominante desconhecida) e quadros reais, com a saída de features_quadro;
- trechos reais (até 2,4 s, como o buffer do app) de vídeos com o sinal: a mão dominante calculada
  só no trecho (como o app faz ao vivo), os atributos por quadro, a janela reamostrada
  (reamostrar) e a entrada compactada (compactar) das janelas de 1, 1,5 e 2 s que terminam no
  último quadro, mais uma que começa antes do primeiro quadro;
- um MLP pequeno de pesos sorteados no formato do modelo real (export_web, kind "sinais"), com o
  softmax de mlp_forward para as entradas dos trechos e algumas sorteadas.

O modelo de verdade tem o próprio golden.json (train_sinais.py treinar); o teste também o confere
quando há modelo em public/ml/sinais/ (ou em LIBRAX_SINAIS_DIR).

Uso (numpy; lê os landmarks de ml-training/data, que fica fora do git):
    python scripts/gerar-fixture-sinais.py [--ml-training ../../ml-training] [--out <pasta>]
"""

import argparse
import glob
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(AQUI)
OUT_PADRAO = os.path.join(APP, "src", "recognition", "__fixtures__", "sinais")
SEED = 20261025
# Trecho guardado de cada vídeo: o app guarda 2,5 s de quadros e avalia janelas de até 2 s
TRECHO_S = 2.4
# Pontos do corpo guardados no fixture: o atributo só usa nariz (0) e ombros (11 e 12)
POSE_PONTOS = 13


def arred(x, casas=6):
    """Lista com `casas` decimais (zero vira 0, para o JSON ficar menor)."""
    if x is None:
        return None
    return [round(float(v), casas) or 0 for v in np.asarray(x).reshape(-1)]


def quadro_fixture(f):
    pose = f.get("pose")
    return {
        "t": f["t"],
        "hands": [{"h": h["h"], "lm": h["lm"]} for h in f["hands"]],
        "pose": pose[:POSE_PONTOS * 4] if pose else None,
    }


def mao(cx, cy, escala, rng):
    """21 pontos sorteados em volta de (cx, cy), só para exercitar a conta."""
    pts = np.column_stack([
        cx + rng.normal(0, escala, 21),
        cy + rng.normal(0, escala, 21),
        rng.normal(0, escala / 3, 21),
    ])
    pts[0] = [cx, cy, 0.0]
    return [round(float(v), 5) for v in pts.reshape(-1)]


def corpo(rng, ombros=0.25):
    pose = np.zeros((POSE_PONTOS, 4))
    pose[:, 3] = 0.9
    pose[0, :2] = [0.5 + rng.normal(0, 0.01), 0.3]
    pose[11, :2] = [0.5 + ombros / 2, 0.55]
    pose[12, :2] = [0.5 - ombros / 2, 0.56]
    return [round(float(v), 5) for v in pose.reshape(-1)]


def casos_sinteticos(rq, rng):
    aspect = 16 / 9
    casos = []

    def caso(nome, frame, dominante, asp=aspect):
        x = rq.features_quadro(frame, asp, dominante)
        casos.append({"name": nome, "aspect": asp, "dominant": dominante,
                      "frame": frame, "expected": arred(x)})

    caso("sem corpo", {"t": 0, "hands": [{"h": "Left", "lm": mao(0.4, 0.5, 0.03, rng)}], "pose": None}, "Left")
    caso("ombros juntos", {"t": 0, "hands": [{"h": "Left", "lm": mao(0.4, 0.5, 0.03, rng)}],
                           "pose": corpo(rng, ombros=0.0002)}, "Left")
    caso("corpo sem mão", {"t": 0, "hands": [], "pose": corpo(rng)}, "Left")
    caso("só a dominante", {"t": 0, "hands": [{"h": "Left", "lm": mao(0.35, 0.45, 0.03, rng)}],
                            "pose": corpo(rng)}, "Left")
    caso("só a outra", {"t": 0, "hands": [{"h": "Right", "lm": mao(0.6, 0.7, 0.03, rng)}],
                        "pose": corpo(rng)}, "Left")
    caso("dominante é a esquerda da pessoa (espelha)", {"t": 0, "hands": [
        {"h": "Right", "lm": mao(0.62, 0.42, 0.03, rng)},
        {"h": "Left", "lm": mao(0.38, 0.75, 0.03, rng)},
    ], "pose": corpo(rng)}, "Right")
    caso("duas mãos com o rótulo da dominante", {"t": 0, "hands": [
        {"h": "Left", "lm": mao(0.35, 0.45, 0.03, rng)},
        {"h": "Left", "lm": mao(0.65, 0.5, 0.03, rng)},
    ], "pose": corpo(rng)}, "Left")
    caso("duas mãos com o rótulo da outra", {"t": 0, "hands": [
        {"h": "Right", "lm": mao(0.35, 0.45, 0.03, rng)},
        {"h": "Right", "lm": mao(0.65, 0.5, 0.03, rng)},
    ], "pose": corpo(rng)}, "Left")
    caso("dominante desconhecida", {"t": 0, "hands": [{"h": "Left", "lm": mao(0.35, 0.45, 0.03, rng)}],
                                    "pose": corpo(rng)}, None)
    caso("quadro em pé", {"t": 0, "hands": [{"h": "Left", "lm": mao(0.35, 0.45, 0.03, rng)}],
                          "pose": corpo(rng)}, "Left", 9 / 16)
    return casos


def casos_dominante(rq, rng):
    """mao_dominante em listas pequenas (empate, sem movimento, rótulo repetido no quadro)."""
    def q(*maos):
        return {"t": 0, "hands": [{"h": h, "lm": mao(x, y, 0.02, rng)} for h, x, y in maos], "pose": None}

    listas = {
        "sem mão": [q(), q()],
        "um quadro só": [q(("Left", 0.4, 0.5))],
        "a que mais anda": [q(("Left", 0.4, 0.5), ("Right", 0.6, 0.5)), q(("Left", 0.41, 0.5), ("Right", 0.7, 0.4)),
                            q(("Right", 0.6, 0.5))],
        "rótulo repetido no quadro": [q(("Left", 0.4, 0.5), ("Left", 0.6, 0.5)), q(("Right", 0.5, 0.5)),
                                      q(("Right", 0.52, 0.5))],
        "empate fica com a primeira": [q(("Right", 0.5, 0.5), ("Left", 0.5, 0.5)),
                                       q(("Right", 0.6, 0.5), ("Left", 0.6, 0.5))],
    }
    return [{"name": nome, "aspect": 16 / 9, "frames": frames, "expected": rq.mao_dominante(frames, 16 / 9)}
            for nome, frames in listas.items()]


def escolher_trechos(rq, ml, n_por_lado=1):
    """Vídeos aceitos pelo rotular_sinais com a dominante de cada lado e duas mãos no trecho."""
    rotulos = sorted(glob.glob(os.path.join(ml, "data", "rotulos_sinais", "*.json")))
    achados = {"Left": [], "Right": []}
    for path in rotulos:
        with open(path) as f:
            r = json.load(f)
        if not r.get("aceito") or not r["sinal"]:
            continue
        lm = os.path.join(ml, "data", "landmarks_sinais", f"{r['id']}.json")
        if not os.path.exists(lm):
            continue
        with open(lm) as f:
            v = json.load(f)
        t_fim = r["sinal"][0][1] + 0.3
        frames = [fr for fr in v["frames"] if t_fim - TRECHO_S < fr["t"] <= t_fim]
        if len(frames) < 20:
            continue
        dom = rq.mao_dominante(frames, v["aspect"])
        duas = any(len(fr["hands"]) >= 2 for fr in frames)
        if dom in achados and len(achados[dom]) < n_por_lado and duas:
            achados[dom].append((r, v, frames))
        if all(len(x) >= n_por_lado for x in achados.values()):
            break
    return [t for lado in ("Left", "Right") for t in achados[lado]]


def trecho_fixture(rq, ts_mod, r, v, frames, com_reamostrada):
    aspect = v["aspect"]
    dom = rq.mao_dominante(frames, aspect)
    ts = np.array([fr["t"] for fr in frames])
    feats = []
    for fr in frames:
        x = rq.features_quadro(fr, aspect, dom)
        feats.append(np.full(rq.F, np.nan) if x is None else x)
    feats = np.array(feats)
    t_fim = float(ts[-1])
    janelas = [(t_fim - d, t_fim) for d in rq.JANELAS_S] + [(float(ts[0]) - 0.2, float(ts[0]) + 0.8)]
    saida = []
    for i, (t0, t1) in enumerate(janelas):
        win = rq.reamostrar(ts, feats, t0, t1)
        item = {"t0": t0, "t1": t1, "input": arred(ts_mod.compactar(win[None])[0])}
        if i == 0 and com_reamostrada:
            item["resampled"] = arred(win)
        saida.append(item)
    return {
        "id": r["id"], "glosa": r["glosa"], "aspect": aspect, "dominant": dom,
        "frames": [quadro_fixture(fr) for fr in frames],
        # atributos de um quadro em cada quatro (o resto é conferido pelas janelas)
        "features": [{"index": i, "expected": arred(rq.features_quadro(fr, aspect, dom))}
                     for i, fr in enumerate(frames) if i % 4 == 0],
        "windows": saida,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ml-training", default=os.path.join(APP, "..", "..", "ml-training"))
    ap.add_argument("--out", default=OUT_PADRAO)
    args = ap.parse_args()
    ml = os.path.abspath(args.ml_training)
    sys.path.insert(0, ml)
    sys.path.insert(0, os.path.join(ml, "video"))
    import rotular_sinais as rq  # noqa: E402
    import train_sinais as ts_mod  # noqa: E402
    from train_static import NORMALIZATION_VERSION, export_web, mlp_forward  # noqa: E402

    rng = np.random.default_rng(SEED)
    trechos = [trecho_fixture(rq, ts_mod, *t, com_reamostrada=(i == 0)) for i, t in enumerate(escolher_trechos(rq, ml))]
    if len(trechos) < 2:
        raise SystemExit("não achei trechos com a dominante dos dois lados")

    # MLP pequeno no formato do modelo real: 1120 -> 8 -> rótulos, pesos sorteados
    labels = ["ARROZ", "MESA", "FELIZ", "_"]
    dim = ts_mod.PASSOS * rq.F
    layers = [
        (rng.normal(0, 0.15, (dim, 8)), rng.normal(0, 0.1, 8), "relu"),
        (rng.normal(0, 0.8, (8, len(labels))), rng.normal(0, 0.1, len(labels)), "softmax"),
    ]
    # Os pesos vão em float32 para o weights.bin: o softmax de referência sai dos mesmos float32
    layers = [(k.astype(np.float32), b.astype(np.float32), a) for k, b, a in layers]
    os.makedirs(args.out, exist_ok=True)
    export_web(args.out, layers, labels, [], extra={
        "kind": "sinais", "frames": ts_mod.PASSOS, "features_per_frame": rq.F,
        "window_frames": rq.T, "people": 0,
    })
    # Casos dos trechos apontam para a janela em features.json (clip, window); dois sorteados à parte
    casos = [({"clip": i, "window": j}, np.array(w["input"]))
             for i, t in enumerate(trechos) for j, w in enumerate(t["windows"])]
    casos += [({"input": arred(x, 4)}, np.array(arred(x, 4))) for x in rng.normal(0, 1, (2, dim))]
    golden = {"labels": labels, "cases": [
        {**ref, "probs": arred(mlp_forward(layers, x[None])[0], 9)} for ref, x in casos]}
    with open(os.path.join(args.out, "golden.json"), "w") as f:
        json.dump(golden, f, ensure_ascii=False)

    fixture = {
        "contract": {
            "normalization_version": NORMALIZATION_VERSION, "T": rq.T, "F": rq.F, "frames": ts_mod.PASSOS,
            "per_hand": rq.POR_MAO, "windows_s": list(rq.JANELAS_S), "min_p": ts_mod.MIN_P, "none": ts_mod.NENHUM,
        },
        "frameCases": casos_sinteticos(rq, rng),
        "dominantCases": casos_dominante(rq, rng),
        "clips": trechos,
    }
    with open(os.path.join(args.out, "features.json"), "w") as f:
        json.dump(fixture, f, ensure_ascii=False, separators=(",", ":"))
    print(f"fixture em {args.out}: {len(fixture['frameCases'])} quadros, {len(trechos)} trechos "
          f"({', '.join(t['glosa'] + '/' + str(t['dominant']) for t in trechos)}), {len(golden['cases'])} casos do MLP")


if __name__ == "__main__":
    main()
