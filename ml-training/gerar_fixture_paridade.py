"""
Gera o fixture do teste de paridade TS x Python (apps/web-poc/src/__tests__/paridade.test.ts).

Por que existe: o teste precisa de um model.json + weights.bin + golden.json de verdade, mas o
dataset real ainda nao foi coletado e este ambiente nao tem TensorFlow. Entao:
- cria maos sinteticas de 3 formas (A = punho, B = mao aberta, L = indicador e polegar),
  com rotacao, escala, posicao, ruido, mao esquerda e direita e quadro em pe ou deitado;
- normaliza com normalize_hand (a mesma do train_static.py);
- treina um MLP pequeno (63 -> 16 -> 8 -> 3, ReLU e softmax) em numpy puro;
- exporta com export_web (o mesmo caminho do modelo real) e grava os vetores dourados com o
  softmax calculado por mlp_forward (numpy, float64).

O modelo e so para o teste: nao reconhece Libras de verdade. Com TensorFlow e dados reais, o
train_static.py faz o mesmo e o golden.json passa a vir do softmax do Keras.

Uso (so precisa de numpy):
    python gerar_fixture_paridade.py [pasta de saida]
Padrao: apps/web-poc/src/recognition/__fixtures__/paridade/
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_static import export_web, mlp_forward, normalize_hand  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "apps/web-poc/src/recognition/__fixtures__/paridade")
LABELS = ["A", "B", "L"]
SEED = 20261023

# Mao direita de frente, unidades de palma (pulso -> base do medio ~ 1), y para baixo.
MCP = {"index": (-0.30, -0.95), "middle": (-0.05, -1.00), "ring": (0.18, -0.92), "pinky": (0.38, -0.80)}
FINGERS = ["index", "middle", "ring", "pinky"]


def finger(mcp, extended, rng):
    mx, my = mcp
    d = np.array([mx * 0.25, -1.0])
    d /= np.linalg.norm(d)
    base = np.array([mx, my, 0.0])
    if extended:
        steps = [0.45, 0.30, 0.25]
        pts, p = [], base
        for s in steps:
            p = p + np.array([d[0] * s, d[1] * s, -0.02])
            pts.append(p)
    else:
        # dobrado: sobe pouco e volta para baixo, perto da camera (z negativo)
        pip = base + np.array([d[0] * 0.25, d[1] * 0.25, -0.20])
        dip = pip + np.array([0.0, 0.22, -0.10])
        tip = dip + np.array([0.0, 0.15, 0.05])
        pts = [pip, dip, tip]
    return [base] + pts


def thumb(kind):
    cmc = np.array([-0.30, -0.22, 0.0])
    if kind == "side":      # A: polegar encostado ao lado do indicador
        rest = [(-0.48, -0.45, -0.05), (-0.55, -0.68, -0.08), (-0.55, -0.88, -0.10)]
    elif kind == "across":  # B: polegar dobrado sobre a palma
        rest = [(-0.40, -0.45, -0.10), (-0.22, -0.55, -0.18), (-0.02, -0.58, -0.20)]
    else:                   # L: polegar aberto para o lado
        rest = [(-0.58, -0.38, -0.02), (-0.82, -0.45, -0.03), (-1.05, -0.50, -0.04)]
    return [cmc] + [np.array(p) for p in rest]


def hand(label, rng):
    pts = [np.zeros(3)]
    pts += thumb({"A": "side", "B": "across", "L": "out"}[label])
    for name in FINGERS:
        ext = label == "B" or (label == "L" and name == "index")
        jitter = rng.normal(0, 0.03, 2)
        pts += finger((MCP[name][0] + jitter[0], MCP[name][1] + jitter[1]), ext, rng)
    pts = np.array(pts)
    return pts + rng.normal(0, 0.025, pts.shape)


def to_mediapipe(canon, rng, left):
    """Leva a mao canonica para coordenadas do MediaPipe num quadro nao espelhado."""
    pts = canon.copy()
    if left:
        pts[:, 0] = -pts[:, 0]
    ang = np.deg2rad(rng.uniform(-35, 35))
    c, s = np.cos(ang), np.sin(ang)
    x = pts[:, 0] * c - pts[:, 1] * s
    y = pts[:, 0] * s + pts[:, 1] * c
    size = rng.uniform(0.12, 0.28)            # palma em fracao da altura do quadro
    aspect = 4 / 3 if rng.random() < 0.5 else 3 / 4
    cx, cy = rng.uniform(0.35, 0.65), rng.uniform(0.55, 0.8)
    raw = np.empty_like(pts)
    raw[:, 0] = cx + x * size / aspect        # x do MediaPipe e fracao da largura
    raw[:, 1] = cy + y * size
    raw[:, 2] = pts[:, 2] * size / aspect     # z na mesma escala de x
    raw[:, 2] -= raw[0, 2]
    # rotulo do MediaPipe vem invertido no quadro nao espelhado
    handedness = "Right" if left else "Left"
    return raw.reshape(-1), handedness, aspect


def make_dataset(n_per_class, rng):
    raws, hands, aspects, ys = [], [], [], []
    for yi, label in enumerate(LABELS):
        for _ in range(n_per_class):
            raw, hd, asp = to_mediapipe(hand(label, rng), rng, left=rng.random() < 0.4)
            raws.append(raw)
            hands.append(hd)
            aspects.append(asp)
            ys.append(yi)
    X = np.array([normalize_hand(r, h, a) for r, h, a in zip(raws, hands, aspects)])
    return raws, hands, aspects, X, np.array(ys)


def train_numpy(X, y, sizes=(16, 8), steps=600, lr=0.01, seed=0):
    """MLP com ReLU e softmax, Adam em lote cheio. Pequeno e deterministico."""
    rng = np.random.default_rng(seed)
    dims = [X.shape[1], *sizes, int(y.max()) + 1]
    W = [rng.normal(0, np.sqrt(2.0 / dims[i]), (dims[i], dims[i + 1])) for i in range(len(dims) - 1)]
    b = [np.zeros(dims[i + 1]) for i in range(len(dims) - 1)]
    m = [np.zeros_like(p) for p in W + b]
    v = [np.zeros_like(p) for p in W + b]
    Y = np.eye(dims[-1])[y]
    for t in range(1, steps + 1):
        hs = [X]
        for i in range(len(W)):
            z = hs[-1] @ W[i] + b[i]
            if i < len(W) - 1:
                hs.append(np.maximum(z, 0))
            else:
                z = z - z.max(axis=1, keepdims=True)
                e = np.exp(z)
                hs.append(e / e.sum(axis=1, keepdims=True))
        grad = (hs[-1] - Y) / len(X)
        gW, gb = [None] * len(W), [None] * len(W)
        for i in reversed(range(len(W))):
            gW[i] = hs[i].T @ grad
            gb[i] = grad.sum(axis=0)
            if i > 0:
                grad = (grad @ W[i].T) * (hs[i] > 0)
        params, grads = W + b, gW + gb
        for k, (p, g) in enumerate(zip(params, grads)):
            m[k] = 0.9 * m[k] + 0.1 * g
            v[k] = 0.999 * v[k] + 0.001 * g * g
            mh = m[k] / (1 - 0.9 ** t)
            vh = v[k] / (1 - 0.999 ** t)
            p -= lr * mh / (np.sqrt(vh) + 1e-8)
    acts = ["relu"] * (len(W) - 1) + ["softmax"]
    # pesos em float32, como no arquivo; o forward de referencia usa esses mesmos valores
    return [(Wi.astype(np.float32), bi.astype(np.float32), a) for Wi, bi, a in zip(W, b, acts)]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    rng = np.random.default_rng(SEED)
    raws, hands, aspects, X, y = make_dataset(120, rng)
    order = rng.permutation(len(X))
    train_idx, test_idx = order[:280], order[280:]
    layers = train_numpy(X[train_idx], y[train_idx])

    pred = mlp_forward(layers, X[test_idx]).argmax(axis=1)
    acc = float((pred == y[test_idx]).mean())
    print(f"acuracia no conjunto separado (sintetico): {acc:.3f}")

    picks = list(test_idx[:14])
    cases = [{"raw": raws[i], "handedness": hands[i], "aspect": aspects[i]} for i in picks]
    # Casos de borda do contrato: sem rotulo de mao, aspecto padrao e escala zero
    cases.append({"raw": raws[picks[0]], "handedness": None, "aspect": 1.0})
    degenerate = np.array(raws[picks[1]]).reshape(21, 3).copy()
    degenerate[9] = degenerate[0]  # pulso == base do medio: fator 1e6
    cases.append({"raw": degenerate.reshape(-1), "handedness": "Left", "aspect": 4 / 3})
    cases.append({"raw": np.tile(np.array(raws[picks[2]])[:3], 21), "handedness": "Right", "aspect": 3 / 4})
    # Misturas de duas formas: softmax longe de 0 e 1, que e onde erro numerico apareceria
    by_class = {k: [i for i in test_idx if y[i] == k] for k in range(len(LABELS))}
    for (ka, kb), w in [((0, 1), 0.5), ((0, 2), 0.45), ((1, 2), 0.55), ((0, 1), 0.35), ((1, 2), 0.42)]:
        ia, ib = by_class[ka][0], by_class[kb][1]
        mix = (1 - w) * np.asarray(raws[ia]) + w * np.asarray(raws[ib])
        cases.append({"raw": mix, "handedness": hands[ia], "aspect": aspects[ia]})

    for c in cases:
        c["input"] = normalize_hand(c["raw"], c["handedness"], c["aspect"])
        c["probs"] = mlp_forward(layers, c["input"][None, :])[0]

    export_web(out, layers, LABELS, cases, extra={
        "source": "numpy-sintetico (fixture de teste, nao reconhece Libras)",
        "test_accuracy": acc,
        "seed": SEED,
    })
    print(f"fixture gravado em {out}")


if __name__ == "__main__":
    main()
