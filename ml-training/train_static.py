"""
SPEC 01 - S4: treina o classificador estatico de handshapes (alfabeto) a partir
do dataset JSONL capturado pela ferramenta S2 do app, e exporta um modelo .tflite
para rodar on-device via tflite_flutter.

Entrada: librax_dataset.jsonl (uma amostra por linha):
    {"label":"A","person":"p01","hand":"Right","ts":...,"v":[63 floats]}

Pontos da SPEC 01 implementados aqui:
- SPLIT POR PESSOA (treino/val/teste sem a mesma pessoa em mais de um split),
  senao a acuracia mente.
- Augmentation leve sobre landmarks (ruido) para robustez.
- Meta de aceite: >= 90-95% top-1 em pessoas nao vistas.

Uso:
    pip install numpy scikit-learn tensorflow
    python train_static.py librax_dataset.jsonl

NAO testado neste ambiente (sem Python/TF aqui); revisar ao rodar.
"""

import json
import sys
from collections import defaultdict

import numpy as np

EXPECTED_DIM = 63  # 21 landmarks x 3


def load(path):
    X, y, persons = [], [], []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            v = r.get("v", [])
            if len(v) != EXPECTED_DIM:
                continue
            X.append(v)
            y.append(r["label"])
            persons.append(r.get("person", "p00"))
    return np.array(X, dtype=np.float32), np.array(y), np.array(persons)


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


def augment(X, y, factor=3, noise=0.02, seed=0):
    rng = np.random.default_rng(seed)
    Xs, ys = [X], [y]
    for _ in range(factor):
        Xs.append(X + rng.normal(0, noise, X.shape).astype(np.float32))
        ys.append(y)
    return np.concatenate(Xs), np.concatenate(ys)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("uso: python train_static.py <dataset.jsonl>")
    from sklearn.preprocessing import LabelEncoder
    import tensorflow as tf

    X, y_raw, persons = load(sys.argv[1])
    print(f"amostras: {len(X)} | classes: {sorted(set(y_raw))} | pessoas: {len(set(persons))}")

    le = LabelEncoder()
    y = le.fit_transform(y_raw)
    n_classes = len(le.classes_)

    tr, va, te = split_by_person(persons)
    Xtr, ytr = augment(X[tr], y[tr])
    Xva, yva = X[va], y[va]
    Xte, yte = X[te], y[te]

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(EXPECTED_DIM,)),
        tf.keras.layers.Dense(128, activation="relu"),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(64, activation="relu"),
        tf.keras.layers.Dense(n_classes, activation="softmax"),
    ])
    model.compile(optimizer="adam",
                  loss="sparse_categorical_crossentropy",
                  metrics=["accuracy"])
    model.fit(Xtr, ytr, validation_data=(Xva, yva), epochs=60, batch_size=64, verbose=2)

    loss, acc = model.evaluate(Xte, yte, verbose=0)
    print(f"\nACURACIA em pessoas NAO vistas (teste): {acc:.3f}  <-- criterio GO/NO-GO (S6)")

    # exporta .tflite para o app (tflite_flutter)
    conv = tf.lite.TFLiteConverter.from_keras_model(model)
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite = conv.convert()
    with open("handshapes.tflite", "wb") as f:
        f.write(tflite)
    with open("labels.txt", "w") as f:
        f.write("\n".join(le.classes_))
    print("gerado: handshapes.tflite + labels.txt")


if __name__ == "__main__":
    main()
