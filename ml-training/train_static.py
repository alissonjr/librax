"""
SPEC 01 - S4: treina o classificador estatico de handshapes (alfabeto) a partir do dataset
JSONL exportado pela ferramenta de coleta do app web (/coleta.html) e exporta:

- handshapes.tflite + labels.txt (rota antiga, Flutter congelado);
- model.json + weights.bin: o MLP que o app web roda em TypeScript puro
  (apps/web-poc/src/recognition/mlp.ts);
- golden.json: vetores dourados (landmarks brutos -> entrada normalizada -> softmax do Keras),
  para conferir que o TS da o mesmo resultado (criterio da W1: diferenca maxima < 1e-4).

Entrada: uma amostra por linha, por exemplo
    {"label":"A","person_id":"p01","platform":"ios","device_model":"iPhone",
     "browser":"Safari 17.5","normalization_version":1,"handedness":"Right",
     "aspect":1.3333,"v":[65 floats normalizados],"raw":[63 floats brutos],"ts":...}
Linhas antigas ({"label","person","v"}) sem "raw" ficam de fora: nao dao para a versao atual.

Se a amostra traz "raw" e a normalization_version for diferente da atual, o vetor e
recalculado aqui com normalize_hand (mesma conta do app). Sem "raw", amostra de outra versao
e descartada.

Pontos da SPEC 01 implementados aqui:
- SPLIT POR PESSOA (treino/val/teste sem a mesma pessoa em mais de um split).
- Augmentation sobre landmarks: ruido e a mao girada em 3D antes de normalizar.
- Meta de aceite: >= 90-95% top-1 em pessoas nao vistas.

Uso:
    pip install numpy scikit-learn tensorflow
    python train_static.py librax_dataset.jsonl [--out out/] [--epochs 60]

Depois, copie out/model.json e out/weights.bin para apps/web-poc/public/ml/classifier/:
com eles presentes o app usa o MLP; sem eles, o reconhecedor heuristico.

O modelo pequeno do teste de paridade (sem TensorFlow) sai de gerar_fixture_paridade.py.
"""

import argparse
import json
import os
import sys

import numpy as np

EXPECTED_DIM = 63  # landmarks brutos: 21 x 3
FEATURE_DIM = EXPECTED_DIM + 2  # entrada do modelo: 63 normalizados + direcao da mao

# Contrato com apps/web-poc/src/recognition/normalize.ts. Mudou a conta, sobe a versao nos dois.
NORMALIZATION_VERSION = 2
# O MediaPipe rotula a mao supondo quadro espelhado; o quadro do getUserMedia nao e espelhado.
HANDEDNESS_INVERTED = True


# ---------------------------------------------------------------------------
# Normalizacao (igual a normalizeHand do app, versao 1)
# ---------------------------------------------------------------------------

def is_left_hand(handedness):
    """True quando e a mao esquerda da pessoa (rotulo do MediaPipe vem invertido)."""
    if handedness not in ("Left", "Right"):
        return False
    return handedness == "Right" if HANDEDNESS_INVERTED else handedness == "Left"


def normalize_hand(raw, handedness=None, aspect=1.0):
    """
    raw: 21 landmarks (lista de 21 [x, y, z] ou 63 numeros) como o MediaPipe entrega.
    Passos: aspecto (x e z * largura/altura), pulso na origem, escala pela distancia 3D
    pulso -> base do medio (fator 1e6 se for zero), espelho da mao esquerda e rotacao no plano
    ate pulso -> medio apontar para (0, -1). No fim, a direcao (versao 2): vetor unitario
    pulso -> medio antes de girar, (0, -1) sem componente no plano. Devolve np.ndarray float64
    com 65 valores.
    """
    pts = np.asarray(raw, dtype=np.float64).reshape(-1, 3)[:21].copy()
    if pts.shape[0] < 21:
        return np.zeros(0)
    if not (isinstance(aspect, (int, float)) and np.isfinite(aspect) and aspect > 0):
        aspect = 1.0
    wrist = pts[0].copy()
    pts[:, 0] = (pts[:, 0] - wrist[0]) * aspect
    pts[:, 1] = pts[:, 1] - wrist[1]
    pts[:, 2] = (pts[:, 2] - wrist[2]) * aspect

    mx, my, mz = pts[9]
    scale = np.sqrt(mx * mx + my * my + mz * mz)
    f = 1e6 if scale == 0 else 1.0 / scale
    pts *= f
    if is_left_hand(handedness):
        pts[:, 0] = -pts[:, 0]

    a, b = pts[9, 0], pts[9, 1]
    n = np.sqrt(a * a + b * b)
    cos, sin = (-b / n, -a / n) if n > 1e-9 else (1.0, 0.0)
    out = np.empty_like(pts)
    out[:, 0] = pts[:, 0] * cos - pts[:, 1] * sin
    out[:, 1] = pts[:, 0] * sin + pts[:, 1] * cos
    out[:, 2] = pts[:, 2]
    direction = [a / n, b / n] if n > 1e-9 else [0.0, -1.0]
    return np.concatenate([out.reshape(-1), direction])


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

def sample_vector(r):
    """Vetor normalizado da amostra na versao atual, ou None se nao der para obter."""
    version = r.get("normalization_version")
    v = r.get("v", [])
    if version == NORMALIZATION_VERSION and len(v) == FEATURE_DIM:
        return v
    raw = r.get("raw")
    if raw is not None and len(raw) == EXPECTED_DIM:
        return normalize_hand(raw, r.get("handedness"), r.get("aspect", 1.0)).tolist()
    return None  # sem landmarks brutos nao da para recalcular (inclui o formato antigo do Flutter)


def load(path):
    """
    X (vetores na versao atual), y, pessoa e, para o augmentation, os landmarks brutos de cada
    amostra (raw, handedness, aspect; None quando a linha nao traz "raw").
    """
    X, y, persons, raws = [], [], [], []
    skipped = 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            v = sample_vector(r)
            if v is None:
                skipped += 1
                continue
            X.append(v)
            y.append(r["label"])
            persons.append(r.get("person_id", r.get("person", "p00")))
            raw = r.get("raw")
            raws.append((raw, r.get("handedness"), r.get("aspect", 1.0)) if raw and len(raw) == EXPECTED_DIM else None)
    if skipped:
        print(f"aviso: {skipped} amostra(s) sem vetor na normalization_version {NORMALIZATION_VERSION}")
    return np.array(X, dtype=np.float32), np.array(y), np.array(persons), raws


def split_by_person(persons, val_frac=0.2, test_frac=0.2, seed=42):
    """Particiona PESSOAS (nao amostras) em treino/val/teste."""
    rng = np.random.default_rng(seed)
    uniq = np.array(sorted(set(persons.tolist())))
    rng.shuffle(uniq)
    n = len(uniq)
    n_test = max(1, int(round(n * test_frac)))
    n_val = max(1, int(round(n * val_frac)))
    test_p = set(uniq[:n_test])
    val_p = set(uniq[n_test:n_test + n_val])
    train_p = set(uniq[n_test + n_val:])
    if not train_p:
        raise SystemExit(
            f"Poucas pessoas ({n}) para split por pessoa. Colete mais (SPEC 01: 15-20)."
        )
    idx = lambda S: np.array([i for i, p in enumerate(persons) if p in S])
    return idx(train_p), idx(val_p), idx(test_p)


def rotate_raw(raw, aspect, yaw, pitch, roll):
    """Gira a mao em 3D em torno do pulso (no espaco com aspecto corrigido) e volta ao formato bruto."""
    pts = np.asarray(raw, dtype=np.float64).reshape(21, 3).copy()
    pts[:, 0] *= aspect
    pts[:, 2] *= aspect
    w = pts[0].copy()
    pts -= w
    cy, sy = np.cos(yaw), np.sin(yaw)
    cp, sp = np.cos(pitch), np.sin(pitch)
    cr, sr = np.cos(roll), np.sin(roll)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    pts = pts @ (rz @ rx @ ry).T + w
    pts[:, 0] /= aspect
    pts[:, 2] /= aspect
    return pts.reshape(-1)


def augment(X, y, raws=None, factor=3, noise=0.02, max_deg=(20, 20, 12), seed=0):
    """
    Copias com ruido nos vetores e, quando ha landmarks brutos, a mao girada em 3D (camera um
    pouco de lado, acima ou abaixo e inclinada) antes de normalizar de novo. Assim o modelo nao
    depende do angulo exato da gravacao.
    """
    rng = np.random.default_rng(seed)
    Xs, ys = [X], [y]
    lim = np.radians(max_deg)
    for _ in range(factor):
        Xa = X.copy()
        if raws is not None:
            for i, r in enumerate(raws):
                if r is None:
                    continue
                raw, hand, aspect = r
                yaw, pitch, roll = rng.uniform(-lim, lim)
                Xa[i] = normalize_hand(rotate_raw(raw, aspect, yaw, pitch, roll), hand, aspect)
        Xs.append(Xa + rng.normal(0, noise, X.shape).astype(np.float32))
        ys.append(y)
    return np.concatenate(Xs), np.concatenate(ys)


# ---------------------------------------------------------------------------
# Exportacao para o app web (model.json + weights.bin + golden.json)
# ---------------------------------------------------------------------------

def mlp_forward(layers, X):
    """
    Forward pass de referencia em numpy (float64), igual ao mlp.ts.
    layers: lista de (kernel [in, out], bias [out], ativacao).
    """
    h = np.asarray(X, dtype=np.float64)
    for kernel, bias, act in layers:
        h = h @ np.asarray(kernel, dtype=np.float64) + np.asarray(bias, dtype=np.float64)
        if act == "relu":
            h = np.maximum(h, 0.0)
        elif act == "softmax":
            h = h - h.max(axis=-1, keepdims=True)
            h = np.exp(h)
            h = h / h.sum(axis=-1, keepdims=True)
    return h


def export_web(out_dir, layers, labels, golden_cases, extra=None):
    """
    Grava model.json, weights.bin (float32 little-endian; por camada: kernel [in][out] linha a
    linha e depois o bias) e golden.json.

    golden_cases: lista de dicts com raw, handedness, aspect, input (vetor normalizado) e
    probs (softmax esperado, de preferencia vindo do Keras).
    """
    os.makedirs(out_dir, exist_ok=True)
    chunks, specs = [], []
    expected_in = layers[0][0].shape[0]
    for kernel, bias, act in layers:
        kernel = np.asarray(kernel, dtype="<f4")
        bias = np.asarray(bias, dtype="<f4")
        assert kernel.shape[0] == expected_in and bias.shape == (kernel.shape[1],)
        specs.append({"in": int(kernel.shape[0]), "out": int(kernel.shape[1]), "activation": act})
        chunks.append(np.ascontiguousarray(kernel).tobytes())
        chunks.append(bias.tobytes())
        expected_in = kernel.shape[1]
    blob = b"".join(chunks)
    with open(os.path.join(out_dir, "weights.bin"), "wb") as f:
        f.write(blob)

    model = {
        "format": "librax-mlp",
        "format_version": 1,
        "normalization_version": NORMALIZATION_VERSION,
        "input_dim": int(layers[0][0].shape[0]),
        "labels": list(labels),
        "layers": specs,
        "weights": {"file": "weights.bin", "dtype": "float32", "byte_length": len(blob)},
    }
    if extra:
        model.update(extra)
    with open(os.path.join(out_dir, "model.json"), "w") as f:
        json.dump(model, f, indent=2, ensure_ascii=False)
        f.write("\n")

    golden = {
        "normalization_version": NORMALIZATION_VERSION,
        "labels": list(labels),
        "cases": [
            {
                "raw": [float(v) for v in c["raw"]],
                "handedness": c.get("handedness"),
                "aspect": float(c.get("aspect", 1.0)),
                "input": [float(v) for v in c["input"]],
                "probs": [float(v) for v in c["probs"]],
            }
            for c in golden_cases
        ],
    }
    with open(os.path.join(out_dir, "golden.json"), "w") as f:
        json.dump(golden, f, indent=1)
        f.write("\n")
    return model


def keras_dense_layers(model):
    """(kernel, bias, ativacao) das camadas Dense do Keras; Dropout fica de fora."""
    import tensorflow as tf

    layers = []
    for layer in model.layers:
        if isinstance(layer, tf.keras.layers.Dense):
            kernel, bias = layer.get_weights()
            act = layer.get_config()["activation"]
            layers.append((kernel, bias, act if act in ("relu", "softmax") else "linear"))
    return layers


def load_raw_cases(path, limit=24):
    """Amostras com landmarks brutos para os vetores dourados (testam a normalizacao tambem)."""
    cases = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get("raw") is not None and len(r["raw"]) == EXPECTED_DIM:
                cases.append({"raw": r["raw"], "handedness": r.get("handedness"), "aspect": r.get("aspect", 1.0)})
    if len(cases) <= limit:
        return cases
    # espalhado pelo arquivo, para pegar letras e pessoas diferentes
    picks = np.linspace(0, len(cases) - 1, limit).round().astype(int)
    return [cases[i] for i in picks]


def main():
    parser = argparse.ArgumentParser(description="Treina o classificador estatico do Librax")
    parser.add_argument("dataset", help="arquivo JSONL exportado pela coleta")
    parser.add_argument("--out", default="out", help="pasta de saida (padrao: out/)")
    parser.add_argument("--epochs", type=int, default=60)
    args = parser.parse_args()

    from sklearn.preprocessing import LabelEncoder
    import tensorflow as tf

    X, y_raw, persons, raws = load(args.dataset)
    print(f"amostras: {len(X)} | classes: {sorted(set(y_raw))} | pessoas: {len(set(persons))}")

    le = LabelEncoder()
    y = le.fit_transform(y_raw)
    n_classes = len(le.classes_)

    tr, va, te = split_by_person(persons)
    Xtr, ytr = augment(X[tr], y[tr], [raws[i] for i in tr])
    Xva, yva = X[va], y[va]
    Xte, yte = X[te], y[te]

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(FEATURE_DIM,)),
        tf.keras.layers.Dense(128, activation="relu"),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(64, activation="relu"),
        tf.keras.layers.Dense(n_classes, activation="softmax"),
    ])
    model.compile(optimizer="adam",
                  loss="sparse_categorical_crossentropy",
                  metrics=["accuracy"])
    model.fit(Xtr, ytr, validation_data=(Xva, yva), epochs=args.epochs, batch_size=64, verbose=2)

    loss, acc = model.evaluate(Xte, yte, verbose=0)
    print(f"\nACURACIA em pessoas NAO vistas (teste): {acc:.3f}  <-- criterio GO/NO-GO (S6)")

    os.makedirs(args.out, exist_ok=True)

    # exporta .tflite (rota antiga do Flutter, congelada)
    conv = tf.lite.TFLiteConverter.from_keras_model(model)
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite = conv.convert()
    with open(os.path.join(args.out, "handshapes.tflite"), "wb") as f:
        f.write(tflite)
    with open(os.path.join(args.out, "labels.txt"), "w") as f:
        f.write("\n".join(le.classes_))

    # exporta o MLP do app web + vetores dourados com o softmax do proprio Keras
    layers = keras_dense_layers(model)
    cases = load_raw_cases(args.dataset)
    if cases:
        inputs = np.array([normalize_hand(c["raw"], c["handedness"], c["aspect"]) for c in cases])
    else:
        inputs = Xte[:24].astype(np.float64)
        cases = [{"raw": [], "handedness": None, "aspect": 1.0} for _ in inputs]
    keras_probs = model.predict(inputs.astype(np.float32), verbose=0)
    diff = np.abs(mlp_forward(layers, inputs) - keras_probs).max()
    print(f"diferenca maxima numpy x Keras nos vetores dourados: {diff:.2e}")
    if diff >= 1e-4:
        raise SystemExit("forward em numpy nao bate com o Keras: confira a ordem dos pesos")
    for c, x, p in zip(cases, inputs, keras_probs):
        c["input"], c["probs"] = x, p
    export_web(args.out, layers, le.classes_, cases, extra={
        "source": "keras",
        "test_accuracy": float(acc),
        "persons": int(len(set(persons))),
    })
    print(f"gerado em {args.out}/: handshapes.tflite, labels.txt, model.json, weights.bin, golden.json")


if __name__ == "__main__":
    main()
