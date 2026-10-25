"""
Modelo dos sinais com movimento (piloto), a partir de data/dataset_sinais.npz (video/rotular_sinais.py).

Entrada do modelo: a janela do sinal reamostrada em PASSOS quadros (de T=24 do dataset, um a cada
T/PASSOS) com os F=140 atributos por quadro do rotular_sinais.py, achatada em PASSOS x F números.
É o mesmo MLP do classificador de letras (mlp.ts roda), só com outra entrada.

Classes: as glosas com pelo menos MIN_PESSOAS pessoas (canais) no dataset, mais "_" (nenhum sinal).

Uso:
    python train_sinais.py avaliar [--grupos 5]    validação cruzada por pessoa (scikit-learn)
    python train_sinais.py avaliar --dicionario    treina no YouTube e testa nos vídeos de dicionário
    python train_sinais.py treinar --out out/sinais-v1 [--epochs 80]
"""

import argparse
import collections
import json
import os

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(AQUI, "data", "dataset_sinais.npz")

PASSOS = 8
MIN_PESSOAS = 3
MIN_P = 0.6  # mesmo limiar das letras
NENHUM = "_"
DICIONARIO = "dic-"
POR_MAO = 70
# Atributos de posição dentro de cada mão: pulso em relação aos ombros e ao nariz
POSICOES = [k * POR_MAO + j for k in range(2) for j in range(1, 5)]


def carregar(caminho=DATASET):
    d = np.load(caminho)
    X, y, pessoa = d["X"], d["y"], d["pessoa"]
    pessoas_por_glosa = collections.defaultdict(set)
    for g, p in zip(y, pessoa):
        pessoas_por_glosa[g].add(p)
    ok = {g for g, ps in pessoas_por_glosa.items() if g == NENHUM or len(ps) >= MIN_PESSOAS}
    m = np.array([g in ok for g in y])
    fora = sorted(g for g in pessoas_por_glosa if g not in ok)
    if fora:
        print(f"glosas com menos de {MIN_PESSOAS} pessoas, fora: {' '.join(fora)}")
    return X[m], y[m], pessoa[m], d["video"][m]


def compactar(X):
    """[N, T, F] -> [N, PASSOS * F] pegando PASSOS quadros espalhados na janela."""
    idx = np.linspace(0, X.shape[1] - 1, PASSOS).round().astype(int)
    return X[:, idx, :].reshape(len(X), -1).astype(np.float32)


def aumentar(X, y, fator=4, seed=0):
    """Variações da janela: velocidade e início um pouco diferentes, corpo mais perto ou longe, ruído."""
    rng = np.random.default_rng(seed)
    T = X.shape[1]
    base = np.linspace(0, 1, T)
    out_X, out_y = [X], [y]
    for _ in range(fator):
        A = np.empty_like(X)
        for i in range(len(X)):
            a = rng.uniform(0, 0.12)
            b = rng.uniform(0.88, 1.0)
            alvo = np.linspace(a, b, T)
            for j in range(X.shape[2]):
                A[i, :, j] = np.interp(alvo, base, X[i, :, j])
            for k in range(2):
                A[i, :, k * POR_MAO] = (A[i, :, k * POR_MAO] >= 0.5).astype(np.float32)
        escala = rng.uniform(0.9, 1.1, size=(len(X), 1, 1))
        A[:, :, POSICOES] *= escala
        A[:, :, POSICOES] += rng.normal(0, 0.04, size=(len(X), 1, len(POSICOES)))
        A += rng.normal(0, 0.01, size=A.shape).astype(np.float32)
        # sem a mão, tudo zero (a presença manda)
        for k in range(2):
            ausente = A[:, :, k * POR_MAO] < 0.5
            A[:, :, k * POR_MAO:(k + 1) * POR_MAO][ausente] = 0
        out_X.append(A)
        out_y.append(y)
    return np.concatenate(out_X), np.concatenate(out_y)


def medir(y, probs, classes):
    """Acerto nos sinais (com o limiar do app) e alarme falso nas janelas sem sinal."""
    pred = classes[probs.argmax(1)]
    conf = probs.max(1)
    lida = np.where((conf >= MIN_P) & (pred != NENHUM), pred, None)
    sinal = y != NENHUM
    acerto = float(np.mean(lida[sinal] == y[sinal])) if sinal.any() else 0.0
    alarme = float(np.mean(lida[~sinal] != None)) if (~sinal).any() else 0.0  # noqa: E711
    return acerto, alarme, lida


def avaliar(grupos, caminho, dicionario):
    from sklearn.model_selection import GroupKFold
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    X, y, pessoa, _ = carregar(caminho)
    print(f"janelas: {len(y)} | glosas: {len(set(y)) - (NENHUM in y)} | pessoas: {len(set(pessoa))}")
    classes = np.array(sorted(set(y)))
    probs = np.zeros((len(y), len(classes)))
    if dicionario:
        # treina no YouTube e testa nos dicionários, que mostram só o sinal (rótulo confiável)
        dic = np.array([p.startswith(DICIONARIO) for p in pessoa])
        divisoes = [(np.where(~dic)[0], np.where(dic)[0])]
        print(f"teste nos dicionários: {dic.sum()} janelas")
    else:
        divisoes = GroupKFold(grupos).split(X, y, pessoa)
    for tr, te in divisoes:
        Xa, ya = aumentar(X[tr], y[tr])
        Xa, Xt = compactar(Xa), compactar(X[te])
        sc = StandardScaler().fit(Xa)
        m = MLPClassifier((256, 128), alpha=1e-2, max_iter=300, early_stopping=True,
                          random_state=0).fit(sc.transform(Xa), ya)
        p = m.predict_proba(sc.transform(Xt))
        cols = [int(np.where(classes == c)[0][0]) for c in m.classes_]
        probs[np.ix_(te, cols)] = p
    if dicionario:
        X, y, probs = X[dic], y[dic], probs[dic]
    acerto, alarme, lida = medir(y, probs, classes)
    print(f"sinais certos (pessoas não vistas, p >= {MIN_P}): {acerto:.1%}")
    print(f"alarme falso (janela sem sinal lida como sinal): {alarme:.1%}")
    por = {g: float(np.mean(lida[y == g] == g)) for g in classes if g != NENHUM}
    print("por sinal:", " ".join(f"{g}:{r:.2f}({(y == g).sum()})" for g, r in sorted(por.items(), key=lambda x: x[1])))
    trocas = collections.Counter((a, b or "nada") for a, b in zip(y, lida) if a != NENHUM and a != b)
    print("trocas:", " ".join(f"{a}->{b}:{n}" for (a, b), n in trocas.most_common(12)))


def treinar(out, epochs):
    import tensorflow as tf
    from train_static import export_web, keras_dense_layers, mlp_forward

    X, y, pessoa, _ = carregar()
    classes = np.array(sorted(set(y)))
    idx = {c: i for i, c in enumerate(classes)}
    Xa, ya = aumentar(X, y)
    Xa = compactar(Xa)
    media, desvio = Xa.mean(0), Xa.std(0) + 1e-6
    # A normalização entra na primeira camada: o app passa a janela crua
    yi = np.array([idx[c] for c in ya])
    tf.keras.utils.set_random_seed(0)
    model = tf.keras.Sequential([
        tf.keras.Input((Xa.shape[1],)),
        tf.keras.layers.Dense(256, activation="relu"),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(128, activation="relu"),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(len(classes), activation="softmax"),
    ])
    model.compile("adam", "sparse_categorical_crossentropy", metrics=["accuracy"])
    model.fit((Xa - media) / desvio, yi, epochs=epochs, batch_size=64, verbose=0)
    layers = keras_dense_layers(model)
    k0, b0, a0 = layers[0]
    k = k0 / desvio[:, None]
    b = b0 - (media / desvio) @ k0
    layers[0] = (k, b, a0)

    Xc = compactar(X)
    p = mlp_forward(layers, Xc)
    acerto, alarme, _ = medir(y, p, classes)
    print(f"no próprio treino: sinais {acerto:.1%}, alarme falso {alarme:.1%} (não vale como medida)")
    export_web(out, layers, classes, [], extra={
        "kind": "sinais", "frames": PASSOS, "features_per_frame": int(X.shape[2]),
        "window_frames": int(X.shape[1]), "people": int(len(set(pessoa))),
    })
    # vetores dourados próprios: entrada já compactada e o softmax esperado
    picks = np.linspace(0, len(Xc) - 1, min(12, len(Xc))).round().astype(int)
    with open(os.path.join(out, "golden.json"), "w") as f:
        json.dump({"labels": classes.tolist(), "cases": [
            {"input": Xc[i].tolist(), "probs": model.predict(((Xc[i:i + 1] - media) / desvio), verbose=0)[0].tolist()}
            for i in picks]}, f)
    print(f"modelo em {out} ({len(classes) - 1} sinais e '_')")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("avaliar")
    a.add_argument("--grupos", type=int, default=5)
    a.add_argument("--dataset", default=DATASET)
    a.add_argument("--dicionario", action="store_true", help="treina no YouTube e testa nos dicionários")
    t = sub.add_parser("treinar")
    t.add_argument("--out", required=True)
    t.add_argument("--epochs", type=int, default=80)
    args = ap.parse_args()
    if args.cmd == "avaliar":
        avaliar(args.grupos, args.dataset, args.dicionario)
    else:
        treinar(args.out, args.epochs)


if __name__ == "__main__":
    main()
