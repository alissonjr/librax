"""
Modelo de câmera dos números de 0 a 9 (forma cardinal) com os landmarks a 15 quadros por segundo
(video/rotular_numeros15.py): avalia com pessoas que o modelo nunca viu e exporta o MLP no formato
do app (mesma normalização v2, mesmas 65 entradas, mesmo MLP 128-64 e augmentation do
train_static.py).

Entrada: data/numeros15/dataset.jsonl. Cada parada traz todos os quadros do miolo; o treino usa
até --quadros-por-parada deles, a medida usa todos.

Como mede uma parada (como o app, ExerciseCameraSign): cada quadro vale o número com
probabilidade >= MIN_P (0,6, classifier.ts) que não seja "_"; o número é aceito quando a mesma
leitura se repete por 0,4 s seguidos (useStableGesture, 6 quadros a 15 por segundo; em parada mais
curta, a parada inteira). Acerto: o número certo ficou estável. Troca: outro número ficou estável.

Medidas:
1. Validação cruzada por canal (GroupKFold): os canais com números divididos em --dobras grupos,
   cada grupo julgado por um modelo treinado sem ele (canais só com "_" também caem em grupos).
2. Canais separados (--teste): nunca entram no treino do modelo exportado.
3. Alarme falso, quadro a quadro: as "_" dos canais julgados (repouso, transição e forma de
   quantidade), data/teste_negativas.json (repouso de canais separados) e as letras paradas de
   data/dataset_video.jsonl (o número lido em cada letra).

Saída (--out): model.json (librax-mlp, kind "numeros", camera_numbers com os números que passaram
em --meta nos canais separados e na validação cruzada), weights.bin e golden.json; as medidas
completas em numeros15_relatorio.json (--relatorio).

Uso:
    python train_numeros15.py --so-validacao        (só a validação cruzada)
    python train_numeros15.py --out ../apps/web-poc/public/ml/numeros \
        --negs repouso,repouso_geral,quantidade,transicao --max-nenhum 500 --quadros-por-parada 40 \
        --letras-neg ABDEFGIKLMNPQRTUVWXY       (o modelo publicado; O, S e C ficam fora das
                                                  letras: são a mesma mão do 0 e do 8)
    (LIBRAX_DATA=/caminho/data aponta para outra pasta de dados)
"""

import os

# Poucas linhas por processo (antes de importar o numpy): a máquina roda outros treinos junto
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "2")

import argparse  # noqa: E402
import collections  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import warnings  # noqa: E402

import numpy as np  # noqa: E402

from train_static import (FEATURE_DIM, augment, export_web, keras_dense_layers, mlp_forward,  # noqa: E402
                          normalize_hand, sample_vector)

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "data")
DATASET = os.path.join(DATA, "numeros15", "dataset.jsonl")
DIGITOS = [str(d) for d in range(10)]
NENHUM = "_"
MIN_P = 0.6
ESTAVEL_QUADROS = 6
# Canais separados padrão: quatro pessoas com os dez números, de vídeos de sequência diferentes
TESTE_PADRAO = [
    "UCxHcoC08d2zqpamKAkgNrPw",  # Suzana Souza Soares (vídeos de um número)
    "UCVSliGAkIIxdwJUf9g-Ru_A",  # Sabrina Pimentel
    "UCSTTahcJE-oWuDk3P7XAxdg",  # Julianno Libras
    "UCzeqFz-yv5RciPEUWSczwxA",  # Fundação Cecierj
]


LETRAS = os.path.join(DATA, "dataset_video.jsonl")
# Canais das letras guardados só para medir o alarme falso (nunca no treino), 1 em LETRAS_TESTE_A_CADA
LETRAS_TESTE_A_CADA = 4


def letra_de_teste(canal):
    return dobra(canal, LETRAS_TESTE_A_CADA) == 0


def carregar(path, negs, quadros_parada, max_nenhum, letras_neg=(), max_letras=0, seed=0):
    """
    Linhas do dataset: números (todos os quadros) e as "_" das origens pedidas. letras_neg: letras
    paradas (dataset_video.jsonl) que entram como "_" (neg "letra"), menos as dos canais de teste
    das letras.
    """
    rng = np.random.default_rng(seed)
    rows = []
    if letras_neg and os.path.exists(LETRAS):
        for k, line in enumerate(open(LETRAS)):
            r = json.loads(line)
            if r["label"] not in letras_neg or letra_de_teste(r["person_id"]):
                continue
            v = sample_vector(r)
            raw = r.get("raw")
            if v is not None:
                rows.append({"x": v, "y": NENHUM, "canal": r["person_id"], "parada": f"letra:{k}", "t": 0.0,
                             "neg": "letra", "raw": (raw, r.get("handedness"), r.get("aspect", 1.0))
                             if raw and len(raw) == 63 else None})
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            if r["label"] == NENHUM and r.get("neg", "repouso_geral") not in negs:
                continue
            v = sample_vector(r)
            if v is None:
                continue
            raw = r.get("raw")
            rows.append({"x": v, "y": r["label"], "canal": r.get("person_id", "p00"),
                         "parada": r.get("parada") or f"{r.get('session_id')}:{r.get('t')}", "t": r.get("t", 0.0),
                         "neg": r.get("neg"), "raw": (raw, r.get("handedness"), r.get("aspect", 1.0))
                         if raw and len(raw) == 63 else None})
    # treino: até quadros_parada quadros por parada de número e, com max_nenhum, uma amostra das
    # "_" (a classe engole as formas fechadas); a medida usa todos os quadros
    por = collections.defaultdict(list)
    for i, r in enumerate(rows):
        if r["y"] != NENHUM:
            por[r["parada"]].append(i)
    treino = np.ones(len(rows), dtype=bool)
    neg = [i for i, r in enumerate(rows) if r["y"] == NENHUM and r["neg"] != "letra"]
    if max_nenhum and len(neg) > max_nenhum:
        for i in rng.choice(neg, len(neg) - max_nenhum, replace=False):
            treino[i] = False
    letras = [i for i, r in enumerate(rows) if r["neg"] == "letra"]
    if max_letras and len(letras) > max_letras:
        for i in rng.choice(letras, len(letras) - max_letras, replace=False):
            treino[i] = False
    for idx in por.values():
        if len(idx) > quadros_parada:
            fica = set(rng.choice(idx, quadros_parada, replace=False).tolist())
            for i in idx:
                treino[i] = i in fica
    return rows, treino


def arrays(rows, idx):
    X = np.array([rows[i]["x"] for i in idx], dtype=np.float32)
    y = np.array([rows[i]["y"] for i in idx])
    return X, y, [rows[i]["raw"] for i in idx]


def leituras(P, labels):
    """Leitura de cada quadro como o app: número com p >= MIN_P, senão None."""
    out = []
    for k, p in zip(P.argmax(1), P.max(1)):
        out.append(labels[k] if p >= MIN_P and labels[k] != NENHUM else None)
    return out


def estaveis(lidas, n):
    """Números que ficam iguais por n quadros seguidos."""
    out, atual, run = set(), None, 0
    for L in lidas:
        run = run + 1 if L == atual else 1
        atual = L
        if L is not None and run >= n:
            out.add(L)
    return out


def avaliar_paradas(prever, labels, rows, idx):
    """[(rótulo, acertou, trocas)] por parada de número e os quadros "_" lidos como número."""
    por = collections.defaultdict(list)
    negs = []
    for i in idx:
        (negs if rows[i]["y"] == NENHUM else por[rows[i]["parada"]]).append(i)
    pares = []
    if por:
        todos = [i for p in por.values() for i in p]
        P = prever(np.array([rows[i]["x"] for i in todos], dtype=np.float32))
        lidas = dict(zip(todos, leituras(P, labels)))
        for p, ii in por.items():
            ii.sort(key=lambda i: rows[i]["t"])
            est = estaveis([lidas[i] for i in ii], min(ESTAVEL_QUADROS, len(ii)))
            alvo = rows[ii[0]]["y"]
            mais = collections.Counter(lidas[i] or "nada" for i in ii).most_common(1)[0][0]
            pares.append((alvo, alvo in est, sorted(est - {alvo}), rows[ii[0]]["canal"], mais))
    alarmes = collections.Counter()
    total = collections.Counter()
    if negs:
        P = prever(np.array([rows[i]["x"] for i in negs], dtype=np.float32))
        for i, L in zip(negs, leituras(P, labels)):
            total[rows[i]["neg"]] += 1
            if L:
                alarmes[rows[i]["neg"]] += 1
    return pares, alarmes, total


def resumo(pares, titulo):
    certos = collections.Counter(a for a, ok, *_ in pares if ok)
    total = collections.Counter(a for a, *_ in pares)
    trocas = collections.Counter((a, b) for a, _, tr, *_ in pares for b in tr)
    erros = collections.Counter((a, m) for a, ok, _, _, m in pares if not ok)
    canais = collections.defaultdict(set)
    for a, _, _, c, _ in pares:
        canais[a].add(c)
    n = sum(total.values())
    print(f"{titulo}: {sum(certos.values())}/{n} paradas ({sum(certos.values()) / max(n, 1):.0%})")
    print("  por número:", " ".join(f"{d}:{certos[d]}/{total[d]}({certos[d] / total[d]:.0%})" for d in DIGITOS if total[d]))
    print("  trocas (certo->lido):", " ".join(f"{a}->{b}:{c}" for (a, b), c in trocas.most_common(12)) or "nenhuma")
    print("  paradas erradas, leitura mais comum dos quadros:",
          " ".join(f"{a}->{b}:{c}" for (a, b), c in sorted(erros.items())) or "nenhuma")
    return {d: {"acertos": certos[d], "paradas": total[d], "canais": len(canais[d]),
                "trocas": {b: c for (a, b), c in trocas.items() if a == d}} for d in DIGITOS if total[d]}


def fmt_alarmes(alarmes, total):
    return " ".join(f"{k}: {alarmes[k]}/{total[k]} ({alarmes[k] / max(total[k], 1):.1%})" for k in sorted(total))


def mlp_sklearn(X, y, raws, seed=0):
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    Xa, ya = augment(X, y, raws, seed=seed)
    sc = StandardScaler().fit(Xa)
    m = MLPClassifier((128, 64), alpha=1e-3, max_iter=300, random_state=seed).fit(sc.transform(Xa), ya)
    return lambda Xq: m.predict_proba(sc.transform(Xq)), list(m.classes_)


def dobra(canal, k):
    return int(hashlib.sha1(canal.encode()).hexdigest(), 16) % k


def validacao_cruzada(rows, treino, dobras, fora):
    """GroupKFold por canal (fora: canais que não entram em nada aqui, os de teste)."""
    canais_num = sorted({r["canal"] for r in rows if r["y"] != NENHUM} - set(fora))
    # dobras equilibradas: canais com números em ordem de tamanho, um por dobra
    tam = collections.Counter(r["canal"] for r in rows if r["y"] != NENHUM)
    grupo = {}
    for j, c in enumerate(sorted(canais_num, key=lambda c: -tam[c])):
        grupo[c] = j % dobras
    pares, alarmes, total = [], collections.Counter(), collections.Counter()
    for g in range(dobras):
        no_grupo = lambda c: grupo[c] == g if c in grupo else dobra(c, dobras) == g  # noqa: E731
        tr = [i for i, r in enumerate(rows) if treino[i] and r["canal"] not in fora and not no_grupo(r["canal"])]
        te = [i for i, r in enumerate(rows) if r["canal"] not in fora and no_grupo(r["canal"])]
        X, y, raws = arrays(rows, tr)
        prever, labels = mlp_sklearn(X, y, raws)
        pr, a, t = avaliar_paradas(prever, labels, rows, te)
        pares += pr
        alarmes.update(a)
        total.update(t)
        print(f"  dobra {g}: {sum(1 for p in pr if p[1])}/{len(pr)} paradas de "
              f"{len({p[3] for p in pr})} canais", flush=True)
    rel = resumo(pares, f"validação cruzada ({dobras} dobras por canal, pessoas não vistas)")
    print("  alarme falso nas '_' julgadas:", fmt_alarmes(alarmes, total))
    return rel, {k: [alarmes[k], total[k]] for k in total}


def alarme_repouso(prever, labels, fora_canais):
    path = os.path.join(DATA, "teste_negativas.json")
    if not os.path.exists(path):
        return None
    casos = [c for c in json.load(open(path))["casos"] if c["canal"] not in fora_canais]
    Xn = np.array([normalize_hand(c["raw"], c["handedness"], c["aspect"]) for c in casos], dtype=np.float32)
    a = sum(1 for L in leituras(prever(Xn), labels) if L)
    return a, len(casos)


def alarme_letras(prever, labels, so_teste):
    """Quadro a quadro: o número lido em cada letra parada (dataset_video.jsonl); com so_teste, só
    nos canais de letras que nunca entram no treino."""
    if not os.path.exists(LETRAS):
        return None
    X, ys = [], []
    for line in open(LETRAS):
        r = json.loads(line)
        v = sample_vector(r)
        if v is not None and r["label"] != NENHUM and (not so_teste or letra_de_teste(r["person_id"])):
            X.append(v)
            ys.append(r["label"])
    lidas = leituras(prever(np.array(X, dtype=np.float32)), labels)
    por = collections.defaultdict(collections.Counter)
    for L, n in zip(ys, lidas):
        por[L][n or "-"] += 1
    return {L: dict(c) for L, c in sorted(por.items())}


def mostrar_letras(por_letra, titulo):
    tot = sum(sum(c.values()) for c in por_letra.values())
    alarmes = sum(n for c in por_letra.values() for k, n in c.items() if k != "-")
    print(f"{titulo}: {alarmes}/{tot} quadros de letras lidos como número ({alarmes / max(tot, 1):.1%})")
    linhas = []
    for L, c in por_letra.items():
        n = sum(c.values())
        nums = sorted(((k, v) for k, v in c.items() if k != "-"), key=lambda kv: -kv[1])
        if nums and nums[0][1] / n >= 0.05:
            linhas.append(f"{L}->" + ",".join(f"{k}:{v / n:.0%}" for k, v in nums[:3] if v / n >= 0.05))
    print("  letras que viram número (>= 5% dos quadros):", " ".join(linhas) or "nenhuma")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", default=DATASET)
    ap.add_argument("--out", default=os.path.join(AQUI, "out", "numeros15"))
    ap.add_argument("--teste", nargs="*", default=TESTE_PADRAO)
    ap.add_argument("--negs", default="repouso,transicao,quantidade,repouso_geral",
                    help="origens das '_' no treino (repouso, transicao, quantidade, repouso_geral)")
    ap.add_argument("--letras-neg", default="", help="letras paradas que entram como '_' (ex.: ABDV)")
    ap.add_argument("--max-letras", type=int, default=400, help="limite de quadros de letras no treino")
    ap.add_argument("--max-nenhum", type=int, default=0, help="limite de quadros '_' no treino (0: todos)")
    ap.add_argument("--quadros-por-parada", type=int, default=12)
    ap.add_argument("--dobras", type=int, default=5)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--relatorio", default=os.path.join(AQUI, "numeros15_relatorio.json"))
    ap.add_argument("--meta", type=float, default=0.7, help="acerto mínimo por número nos canais separados")
    ap.add_argument("--so-validacao", action="store_true")
    ap.add_argument("--sem-validacao", action="store_true")
    args = ap.parse_args()
    warnings.filterwarnings("ignore", message=".*(converge|Maximum iterations).*")

    letras_neg = set(args.letras_neg)
    rows, treino = carregar(args.dataset, set(args.negs.split(",")), args.quadros_por_parada, args.max_nenhum,
                            letras_neg, args.max_letras)
    num = [r for r in rows if r["y"] != NENHUM]
    print(f"quadros: {len(num)} de números ({len({r['parada'] for r in num})} paradas, "
          f"{len({r['canal'] for r in num})} canais) + {len(rows) - len(num)} de '_' "
          f"({collections.Counter(r['neg'] for r in rows if r['y'] == NENHUM)})")
    canais_num = collections.defaultdict(set)
    for r in num:
        canais_num[r["y"]].add(r["canal"])
    print("  canais por número:", " ".join(f"{d}:{len(canais_num[d])}" for d in DIGITOS))
    relatorio = {"canais_por_numero": {d: len(canais_num[d]) for d in DIGITOS}, "negs": args.negs}

    if not args.sem_validacao:
        print("\n1. Validação cruzada por canal (sem os canais de teste)")
        relatorio["cv"], relatorio["cv_alarmes"] = validacao_cruzada(rows, treino, args.dobras, set(args.teste))
    if args.so_validacao:
        return

    print("\n2. Modelo exportado, sem os canais de teste:", ", ".join(args.teste))
    import tensorflow as tf
    from sklearn.preprocessing import LabelEncoder

    tr = [i for i, r in enumerate(rows) if treino[i] and r["canal"] not in args.teste]
    te = [i for i, r in enumerate(rows) if r["canal"] in args.teste]
    X, y, raws = arrays(rows, tr)
    le = LabelEncoder().fit(y)
    Xtr, ytr = augment(X, le.transform(y), raws)
    tf.config.threading.set_intra_op_parallelism_threads(2)
    tf.config.threading.set_inter_op_parallelism_threads(1)
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

    pares, alarmes, total = avaliar_paradas(prever, labels, rows, te)
    teste = resumo(pares, "canais de teste (nunca vistos no treino)")
    print("  alarme falso nas '_' dos canais de teste:", fmt_alarmes(alarmes, total))
    rep = alarme_repouso(prever, labels, {rows[i]["canal"] for i in tr})
    if rep:
        print(f"  alarme falso em repouso (teste_negativas.json): {rep[0]}/{rep[1]} quadros ({rep[0] / max(rep[1], 1):.1%})")
    letras = alarme_letras(prever, labels, bool(letras_neg))
    if letras:
        mostrar_letras(letras, "  letras paradas (dataset_video.jsonl" + (", canais fora do treino)" if letras_neg else ")"))

    # passa o número que acerta >= meta nos canais separados E na validação cruzada (quando rodou):
    # os canais separados têm de 3 a 5 paradas por número, pouco para decidir sozinhos
    def acerto(rel, d):
        return rel[d]["acertos"] / rel[d]["paradas"] if d in rel else 0.0
    cv = relatorio.get("cv")
    passam = [d for d in DIGITOS if acerto(teste, d) >= args.meta and (cv is None or acerto(cv, d) >= args.meta)]
    print(f"\nnúmeros com acerto >= {args.meta:.0%} nos canais de teste"
          f"{' e na validação cruzada' if cv else ''}: {', '.join(passam) or 'nenhum'}")
    relatorio.update({"teste_canais": args.teste, "teste": teste,
                      "teste_alarmes": {k: [alarmes[k], total[k]] for k in total},
                      "alarme_repouso": list(rep) if rep else None, "letras": letras, "camera_numbers": passam})

    # golden: quadros de números e de "_" espalhados
    golden_idx = np.linspace(0, len(rows) - 1, 24).round().astype(int)
    cases = [{"raw": rows[i]["raw"][0], "handedness": rows[i]["raw"][1], "aspect": rows[i]["raw"][2]}
             for i in golden_idx if rows[i]["raw"]]
    inputs = np.array([normalize_hand(c["raw"], c["handedness"], c["aspect"]) for c in cases])
    keras_probs = model.predict(inputs.astype(np.float32), verbose=0)
    diff = np.abs(mlp_forward(layers, inputs) - keras_probs).max()
    if diff >= 1e-4:
        raise SystemExit("forward em numpy não bate com o Keras: confira a ordem dos pesos")
    for c, x, p in zip(cases, inputs, keras_probs):
        c["input"], c["probs"] = x, p
    n_teste = sum(v["paradas"] for v in teste.values())
    export_web(args.out, layers, labels, cases, extra={
        "source": "keras",
        "kind": "numeros",
        "camera_numbers": passam,
        "min_probability": MIN_P,
        "test_channels": list(args.teste),
        "test_accuracy": sum(v["acertos"] for v in teste.values()) / max(n_teste, 1),
        "test_holds": n_teste,
        "test_per_number": {d: [v["acertos"], v["paradas"]] for d, v in teste.items()},
        "cv_per_number": {d: [v["acertos"], v["paradas"]] for d, v in relatorio.get("cv", {}).items()},
        "channels_per_number": relatorio["canais_por_numero"],
        "false_alarm_rest": (rep[0] / max(rep[1], 1)) if rep else None,
        "persons": len({rows[i]["canal"] for i in tr if rows[i]["y"] != NENHUM}),
    })
    with open(args.relatorio, "w") as f:
        json.dump(relatorio, f, indent=1, ensure_ascii=False)
    print(f"gerado em {args.out}/ (diferença numpy x Keras {diff:.1e})")


if __name__ == "__main__":
    main()
