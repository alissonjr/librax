"""
Validação cruzada por pessoa do dataset de letras: cada grupo de pessoas é testado por um
modelo treinado sem elas. Mostra o acerto geral, o acerto por letra, as confusões mais comuns e
as pessoas (canais) com pior acerto. É mais estável que o split único do train_static.py, que
testa só algumas pessoas.

O modelo aqui é um MLP do scikit-learn do mesmo tamanho do de produção, sem augmentation: serve
para comparar versões do dataset, não para exportar.

Com --limpar SAIDA, grava uma cópia do dataset sem os quadros que parecem rótulo errado
(limpeza por consenso): o modelo que não viu aquela pessoa dá menos de LIMPAR_MAX_P para a letra
do rótulo e mais de LIMPAR_OUTRA para outra letra.

Uso:
    python avaliar.py data/dataset_video.jsonl [--grupos 5] [--limpar data/dataset_limpo.jsonl]
"""

import argparse
import collections

import numpy as np

from train_static import load

LIMPAR_MAX_P = 0.15
LIMPAR_OUTRA = 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("--grupos", type=int, default=5)
    ap.add_argument("--limpar", help="grava o dataset sem os quadros com cara de rótulo errado")
    args = ap.parse_args()

    from sklearn.model_selection import GroupKFold
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    X, y, persons, _ = load(args.dataset)
    pred = np.empty(len(y), dtype=object)
    p_label = np.zeros(len(y))
    p_outra = np.zeros(len(y))
    for tr, te in GroupKFold(args.grupos).split(X, y, persons):
        sc = StandardScaler().fit(X[tr])
        m = MLPClassifier((128, 64), alpha=1e-3, max_iter=300, random_state=0).fit(sc.transform(X[tr]), y[tr])
        probs = m.predict_proba(sc.transform(X[te]))
        pred[te] = m.classes_[probs.argmax(axis=1)]
        idx = {c: i for i, c in enumerate(m.classes_)}
        for k, i in enumerate(te):
            j = idx.get(y[i])
            p_label[i] = probs[k, j] if j is not None else 0.0
            p_outra[i] = max(probs[k, jj] for jj in range(len(m.classes_)) if jj != j)

    print(f"amostras: {len(y)} | pessoas: {len(set(persons))}")
    print(f"acerto geral (pessoas não vistas): {(pred == y).mean():.3f}")
    rec = {L: (pred[y == L] == L).mean() for L in sorted(set(y))}
    print("por letra:", " ".join(f"{L}:{r:.2f}" for L, r in sorted(rec.items(), key=lambda x: x[1])))
    conf = collections.Counter((a, b) for a, b in zip(y, pred) if a != b)
    print("confusões:", " ".join(f"{a}->{b}:{n}" for (a, b), n in conf.most_common(12)))
    acc = {q: (pred[persons == q] == y[persons == q]).mean() for q in set(persons)}
    print("piores pessoas:", " ".join(f"{q}:{a:.2f}" for q, a in sorted(acc.items(), key=lambda x: x[1])[:6]))

    if args.limpar:
        ruim = (p_label < LIMPAR_MAX_P) & (p_outra > LIMPAR_OUTRA)
        with open(args.dataset) as f, open(args.limpar, "w") as out:
            linhas = [l for l in f if l.strip()]
            # load() descarta linhas sem vetor; aqui todas têm (saem do rotular.py)
            assert len(linhas) == len(y), "dataset com linhas que o load() descartou"
            for l, r in zip(linhas, ruim):
                if not r:
                    out.write(l if l.endswith("\n") else l + "\n")
        por_letra = collections.Counter(y[ruim])
        print(f"limpeza: {ruim.sum()} de {len(y)} quadros fora ({ruim.mean():.1%}) -> {args.limpar}")
        print("fora por letra:", " ".join(f"{L}:{n}" for L, n in sorted(por_letra.items())))


if __name__ == "__main__":
    main()
