"""
Modelo de câmera dos números de 0 a 9 (forma cardinal, paradas): avalia com pessoas que o modelo
nunca viu e treina o MLP no formato do app. Camada fina sobre o train_static.py (mesma
normalização v2, mesmas 65 entradas, mesmo MLP 128-64, mesmo augmentation e mesma exportação).
Não instala nada no app.

Entrada: data/numeros/dataset_numeros.jsonl (video/rotular_numeros.py), com os quadros dos números
e a classe "_" (mãos em repouso, video/negativas.py).

Três medidas, todas por PARADA como no teste_fixo.py (a parada vale o número mais lido nos
quadros dela com probabilidade >= MIN_P e diferente de "_"):
1. Validação cruzada por canal: cada canal é julgado por um modelo treinado sem ele (MLP do
   scikit-learn do mesmo tamanho, com o augmentation do train_static). Mostra o acerto por
   número e quantos canais tinham aquele número; número que só um canal tem não tem como acertar
   (o modelo que julga esse canal nunca viu o número).
2. Canais separados (--teste): ficam fora do treino do modelo exportado e medem o acerto dele.
3. Alarme falso: quadros de mãos em repouso de canais separados (data/teste_negativas.json) e as
   "_" dos canais de teste lidos como algum número.

Saída: model.json + weights.bin + golden.json (+ labels.txt) em --out, com as medidas no
model.json. Para usar no app seria preciso um classificador próprio dos números; ver o relatório.

Uso:
    python train_numeros.py [--out out/numeros-v1] [--teste CANAL ...] [--epochs 60]
    (LIBRAX_DATA=/caminho/data aponta para outra pasta de dados)
"""

import argparse
import collections
import json
import os
import warnings

import numpy as np

from teste_fixo import MIN_P, NENHUMA
from train_static import (FEATURE_DIM, augment, export_web, keras_dense_layers, load_raw_cases,
                          mlp_forward, normalize_hand, sample_vector)

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "data")
DATASET = os.path.join(DATA, "numeros", "dataset_numeros.jsonl")
DIGITOS = [str(d) for d in range(10)]
# Canais de teste padrão: os dois de fora dos dicionários que mostram vários números
# (Suzana Souza Soares e a aula da Fundação Cecierj, que tem de 1 a 10)
TESTE_PADRAO = ["UCxHcoC08d2zqpamKAkgNrPw", "UCzeqFz-yv5RciPEUWSczwxA"]


def carregar(path):
    """X, y, canal, parada e os landmarks brutos (para o augmentation) de cada quadro."""
    X, y, canal, parada, raws = [], [], [], [], []
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            v = sample_vector(r)
            if v is None:
                continue
            X.append(v)
            y.append(r["label"])
            canal.append(r.get("person_id", "p00"))
            # as "_" não têm parada: cada quadro conta sozinho
            parada.append(r.get("parada") or f"{r.get('session_id')}:{r.get('t')}")
            raw = r.get("raw")
            raws.append((raw, r.get("handedness"), r.get("aspect", 1.0)) if raw and len(raw) == 63 else None)
    return np.array(X, dtype=np.float32), np.array(y), np.array(canal), np.array(parada), raws


def lido(P, labels):
    """O número mais lido nos quadros de uma parada (como o app), ou None."""
    lidas = [labels[i] for i, pr in zip(P.argmax(1), P.max(1)) if pr >= MIN_P and labels[i] != NENHUMA]
    mais = collections.Counter(lidas).most_common(1)
    return mais[0][0] if mais else None


def por_parada(P, y, parada, labels):
    """[(rótulo, lido)] por parada de número; e quantos quadros "_" viraram número."""
    out = []
    for p in dict.fromkeys(parada[y != NENHUMA]):
        m = parada == p
        out.append((y[m][0], lido(P[m], labels)))
    neg = y == NENHUMA
    alarmes = int(sum(1 for i, pr in zip(P[neg].argmax(1), P[neg].max(1)) if pr >= MIN_P and labels[i] != NENHUMA))
    return out, alarmes, int(neg.sum())


def mlp_sklearn(X, y, raws):
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    Xa, ya = augment(X, y, raws)
    sc = StandardScaler().fit(Xa)
    m = MLPClassifier((128, 64), alpha=1e-3, max_iter=300, random_state=0).fit(sc.transform(Xa), ya)
    return lambda Xq: m.predict_proba(sc.transform(Xq)), list(m.classes_)


def resumo(pares, titulo):
    certos = collections.Counter(a for a, b in pares if a == b)
    total = collections.Counter(a for a, _ in pares)
    n = sum(total.values())
    print(f"{titulo}: {sum(certos.values())}/{n} paradas ({sum(certos.values()) / max(n, 1):.0%})")
    print("  por número:", " ".join(f"{d}:{certos[d]}/{total[d]}" for d in DIGITOS if total[d]))
    trocas = collections.Counter((a, b or "nada") for a, b in pares if a != b)
    print("  trocas:", " ".join(f"{a}->{b}:{c}" for (a, b), c in trocas.most_common(10)) or "nenhuma")
    return {d: [certos[d], total[d]] for d in DIGITOS if total[d]}


def validacao_cruzada(X, y, canal, parada, raws):
    """Cada canal com números é julgado por um modelo treinado sem ele."""
    canais_num = sorted(set(canal[y != NENHUMA]))
    pares, canais_por_numero = [], collections.defaultdict(set)
    for c in canais_num:
        for d in set(y[(canal == c) & (y != NENHUMA)]):
            canais_por_numero[d].add(c)
    alarmes = negs = rep_a = rep_n = 0
    for c in canais_num:
        tr, te = canal != c, canal == c
        prever, labels = mlp_sklearn(X[tr], y[tr], [raws[i] for i in np.where(tr)[0]])
        pr, a, n = por_parada(prever(X[te]), y[te], parada[te], labels)
        pares += pr
        alarmes, negs = alarmes + a, negs + n
        rep = alarme_repouso(prever, labels)
        if rep:
            rep_a, rep_n = rep_a + rep[0], rep_n + rep[1]
        print(f"  canal {c}: {sum(1 for a, b in pr if a == b)}/{len(pr)} paradas", flush=True)
    por_num = resumo(pares, "validação cruzada por canal (pessoas não vistas)")
    print("  canais por número:", " ".join(f"{d}:{len(canais_por_numero[d])}" for d in DIGITOS))
    print(f"  alarme falso nas '_' dos canais julgados: {alarmes}/{negs} quadros ({alarmes / max(negs, 1):.1%})")
    if rep_n:
        print(f"  alarme falso em repouso (teste_negativas.json, somado nos {len(canais_num)} modelos): "
              f"{rep_a}/{rep_n} quadros ({rep_a / rep_n:.1%})")
    return por_num, {d: len(canais_por_numero[d]) for d in DIGITOS}


def alarme_repouso(prever, labels):
    """Quadros de mãos em repouso de canais separados (video/negativas.py) lidos como número."""
    path = os.path.join(DATA, "teste_negativas.json")
    if not os.path.exists(path):
        return None
    casos = json.load(open(path))["casos"]
    Xn = np.array([normalize_hand(c["raw"], c["handedness"], c["aspect"]) for c in casos], dtype=np.float32)
    P = prever(Xn)
    a = int(sum(1 for i, pr in zip(P.argmax(1), P.max(1)) if pr >= MIN_P and labels[i] != NENHUMA))
    return a, len(casos), len({c["canal"] for c in casos})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", default=DATASET)
    ap.add_argument("--out", default=os.path.join(AQUI, "out", "numeros-v1"))
    ap.add_argument("--teste", nargs="*", default=TESTE_PADRAO, help="canais fora do treino do modelo exportado")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--max-nenhum", type=int, default=0, help="limite de quadros '_' (0: todos)")
    ap.add_argument("--so-validacao", action="store_true", help="só a validação cruzada (para escolher opções)")
    args = ap.parse_args()
    warnings.filterwarnings("ignore", message=".*(converge|Maximum iterations).*")

    X, y, canal, parada, raws = carregar(args.dataset)
    if args.max_nenhum and (y == NENHUMA).sum() > args.max_nenhum:
        # a classe "_" tem quatro vezes mais quadros que os números juntos e engole as formas
        # fechadas (0, 1, 5, 8): fica uma amostra espalhada, escolhida antes de qualquer medida
        neg = np.where(y == NENHUMA)[0]
        fica = np.concatenate([np.where(y != NENHUMA)[0],
                               np.random.default_rng(0).choice(neg, args.max_nenhum, replace=False)])
        fica.sort()
        X, y, canal, parada, raws = X[fica], y[fica], canal[fica], parada[fica], [raws[i] for i in fica]
    num = y != NENHUMA
    print(f"quadros: {num.sum()} de números ({len(set(parada[num]))} paradas, {len(set(canal[num]))} canais) "
          f"+ {(~num).sum()} de '_' ({len(set(canal[~num]))} canais)")

    print("\n1. Validação cruzada por canal")
    cv, canais_por_numero = validacao_cruzada(X, y, canal, parada, raws)
    if args.so_validacao:
        return

    print("\n2. Modelo exportado, sem os canais de teste:", ", ".join(args.teste))
    import tensorflow as tf
    from sklearn.preprocessing import LabelEncoder

    tr = ~np.isin(canal, args.teste)
    te = np.isin(canal, args.teste)
    le = LabelEncoder().fit(y)
    Xtr, ytr = augment(X[tr], le.transform(y[tr]), [raws[i] for i in np.where(tr)[0]])
    tf.keras.utils.set_random_seed(0)
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(FEATURE_DIM,)),
        tf.keras.layers.Dense(128, activation="relu"),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(64, activation="relu"),
        tf.keras.layers.Dense(len(le.classes_), activation="softmax"),
    ])
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    model.fit(Xtr, ytr, epochs=args.epochs, batch_size=64, verbose=0)
    layers = keras_dense_layers(model)
    labels = list(le.classes_)

    def prever(Xq):
        return mlp_forward(layers, Xq)

    pares, alarmes, negs = por_parada(prever(X[te]), y[te], parada[te], labels)
    teste = resumo(pares, "canais de teste (nunca vistos no treino)")
    print(f"  alarme falso nas '_' dos canais de teste: {alarmes}/{negs} quadros ({alarmes / max(negs, 1):.1%})")
    rep = alarme_repouso(prever, labels)
    if rep:
        print(f"  alarme falso em repouso (teste_negativas.json, {rep[2]} canais): {rep[0]}/{rep[1]} quadros "
              f"({rep[0] / max(rep[1], 1):.1%})")

    # exporta no formato do app, com vetores dourados do próprio Keras
    cases = load_raw_cases(args.dataset)
    inputs = np.array([normalize_hand(c["raw"], c["handedness"], c["aspect"]) for c in cases])
    keras_probs = model.predict(inputs.astype(np.float32), verbose=0)
    diff = np.abs(mlp_forward(layers, inputs) - keras_probs).max()
    if diff >= 1e-4:
        raise SystemExit("forward em numpy não bate com o Keras: confira a ordem dos pesos")
    for c, x, p in zip(cases, inputs, keras_probs):
        c["input"], c["probs"] = x, p
    n_teste = sum(t for _, t in teste.values())
    export_web(args.out, layers, labels, cases, extra={
        "source": "keras",
        "task": "numeros-0-9",
        "test_channels": list(args.teste),
        "test_accuracy": sum(c for c, _ in teste.values()) / max(n_teste, 1),
        "test_holds": n_teste,
        "test_per_number": teste,
        "cv_per_number": cv,
        "channels_per_number": canais_por_numero,
        "false_alarm_rest": (rep[0] / max(rep[1], 1)) if rep else None,
        "persons": int(len(set(canal[tr & num]))),
    })
    with open(os.path.join(args.out, "labels.txt"), "w") as f:
        f.write("\n".join(labels))
    print(f"\ngerado em {args.out}/: model.json, weights.bin, golden.json, labels.txt "
          f"(diferença numpy x Keras {diff:.1e})")


if __name__ == "__main__":
    main()
