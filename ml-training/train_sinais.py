"""
Modelo dos sinais com movimento, a partir do dataset do video/rotular_sinais.py.

Entrada do modelo: a janela do sinal reamostrada em PASSOS quadros (de T=24 do dataset, um a cada
T/PASSOS) com os F=140 atributos por quadro do rotular_sinais.py, achatada em PASSOS x F números.
É o mesmo MLP do classificador de letras (mlp.ts roda), só com outra entrada. O MLP é o do
scikit-learn (o mesmo da avaliação), exportado com a padronização dentro da primeira camada.

Classes: as glosas com pelo menos MIN_PESSOAS canais do YouTube no dataset, mais "_" (nenhum
sinal: negativas e, com o dataset do --paradas, mão levantada e parada). Com --congeladas N, cada
janela de sinal também gera N janelas "_" com a mão congelada num quadro dela (a forma e o lugar
do sinal sem o movimento; lição das letras com movimento); N fracionário dá o peso parcial (0,3:
uma congelada a cada três janelas, em média). Com --negativas-paradas N (só no avaliar), até N
janelas ao vivo de mão parada de cada vídeo de treino também entram como "_".

Avaliação como no app (signRecognizer.ts e useSignCameraRecognizer.ts): a cada AVALIA_S, com o
buffer de BUFFER_S segundos e a mão dominante do buffer, as janelas de JANELAS_S que terminam no
quadro mais recente (cobertura de 90% e alguma mão levantada); vale o sinal mais provável de
alguma janela com p >= MIN_P, e a leitura só conta com CONFIRMA avaliações seguidas iguais.
Regras de leitura (REGRAS; vão para o reading_rules do model.json e o app segue as mesmas): o
limiar (--min-p), o portão de movimento (--min-movimento: janela com movimento() abaixo dele não é
lida, a mão levantada e parada) e o teto do "_" (--max-p-nenhum: sem leitura quando p("_") passa
dele). O portão e o teto não mudam o modelo: o varrer mede várias regras sobre as probabilidades
guardadas pelo avaliar --probs, sem treinar de novo.
- Validação cruzada por canal (GroupKFold nos canais do YouTube; os dicionários ficam sempre no
  treino). Por vídeo deixado de fora: "no trecho" quando a glosa é confirmada perto da janela que
  o rotular_sinais escolheu (vídeos aceitos) e "no vídeo" quando é confirmada em qualquer ponto
  (todos os vídeos da glosa que passaram no filtro de título, aceitos ou não).
- Teste nos dicionários: treina só no YouTube e roda nos vídeos de dicionário (só o sinal):
  acerto quando a glosa é confirmada no vídeo.
- Alarmes: janelas "_" e "parada" lidas como sinal (janela a janela) e, nos vídeos, trechos de mão
  parada por pelo menos a janela mais longa com alguma leitura confirmada.

Uso:
    python train_sinais.py avaliar --dataset data/sinais15/dataset.npz --landmarks data/sinais15/landmarks \\
        --rotulos data/sinais15/rotulos [--passos 8] [--ocultas 256,128] [--congeladas 2] [--salvar res.json]
    python train_sinais.py treinar --out PASTA (mesmas opções) [--resultados res.json ...]
        com --resultados (o --salvar do avaliar), o model.json leva em camera_signs só os sinais que
        passaram na validação cruzada e no dicionário (MIN_ACERTO_CAMERA); com mais de um arquivo
        (avaliar --semente N muda a divisão dos canais), só os que passaram em todos
    python train_sinais.py avaliar ... --probs probs.pkl [--min-movimento 0.17]
    python train_sinais.py varrer probs-s0.pkl probs-s1.pkl --min-movimento 0 0.15 0.17 [--por-sinal A,B]
        uma linha por regra: acerto no trecho, alarmes e a câmera (sinais que passam em todas as divisões)
    python train_sinais.py regras --modelo PASTA --min-movimento 0.17
        grava as regras de leitura no model.json de um modelo já exportado (os pesos ficam)
    (LIBRAX_DATA=/caminho/data aponta para a pasta de dados)
"""

import argparse
import collections
import hashlib
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, "video"))
import rotular_sinais as rq  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "data")
DATASET = os.path.join(DATA, "dataset_sinais.npz")

PASSOS = 8
MIN_PESSOAS = 6
MIN_P = 0.6  # mesmo limiar das letras
NENHUM = "_"
DICIONARIO = "dic-"
POR_MAO = 70
# Atributos de posição dentro de cada mão: pulso em relação aos ombros e ao nariz
POSICOES = [k * POR_MAO + j for k in range(2) for j in range(1, 5)]

# Como o app (signRecognizer.ts e useSignCameraRecognizer.ts)
AVALIA_S = 0.25
BUFFER_S = rq.BUFFER_S
JANELAS_S = rq.JANELAS_S
MIN_COBERTURA = 0.9
CONFIRMA = 2
# Leitura "no trecho": avaliação entre o meio da janela escolhida e FOLGA_S depois do fim
FOLGA_S = 1.0

# MLP e treino
OCULTAS = (256, 128)
ALPHA = 1e-2
AUMENTO = 3
MAX_NENHUM = 3.0

# Portão de movimento (contrato com o signRecognizer.ts, windowMotion): janela que se mexe menos que
# min_movimento não é lida (mão levantada e parada não vira sinal). 0 desliga. Ver movimento().
# 0,17 (2026-10-25, varrer nas duas divisões dos canais): alarme em janelas de mão parada de 33,9%
# para 8,6% e trechos parados de 2 s com leitura de 13/43 para 0,5/43, com o acerto no trecho de
# 52,2% para 51,6% e nenhum sinal da câmera mudando de acerto
PESO_FORMA = 1.0
MIN_MOVIMENTO = 0.17

# Sinal só ganha câmera no app com pelo menos esta fração certa nos vídeos deixados de fora da
# validação cruzada (no trecho, com pelo menos MIN_TESTE vídeos) e, quando há pelo menos
# MIN_DIC vídeos de dicionário, pelo menos MIN_ACERTO_DIC neles
MIN_ACERTO_CAMERA = 0.7
MIN_TESTE = 8
MIN_DIC = 3
MIN_ACERTO_DIC = 0.5


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

def carregar(caminho=DATASET, min_pessoas=MIN_PESSOAS):
    """X [N, T, F], y, pessoa, video, tipo das glosas com pelo menos min_pessoas canais do YouTube."""
    d = np.load(caminho)
    X, y, pessoa, video = d["X"], d["y"].astype(str), d["pessoa"].astype(str), d["video"].astype(str)
    tipo = d["tipo"].astype(str) if "tipo" in d else np.where(y == NENHUM, "outro", "sinal")
    pessoas_por_glosa = collections.defaultdict(set)
    for g, p in zip(y, pessoa):
        if not p.startswith(DICIONARIO):
            pessoas_por_glosa[g].add(p)
    ok = {g for g, ps in pessoas_por_glosa.items() if g == NENHUM or len(ps) >= min_pessoas}
    m = np.array([g in ok for g in y])
    fora = sorted(g for g in set(y) if g not in ok)
    if fora:
        print(f"glosas com menos de {min_pessoas} canais, fora: {' '.join(fora)}")
    return X[m], y[m], pessoa[m], video[m], tipo[m]


def compactar(X, passos=PASSOS):
    """[N, T, F] -> [N, passos * F] pegando `passos` quadros espalhados na janela."""
    X = np.asarray(X)
    idx = np.linspace(0, X.shape[1] - 1, passos).round().astype(int)
    return X[:, idx, :].reshape(len(X), -1).astype(np.float32)


def movimento(Xc, passos=PASSOS):
    """
    Quanto as mãos se mexem em cada janela compactada [N, passos * F] (a entrada do modelo). Em
    cada vaga de mão (dominante e outra), entre dois passos quaisquer com a mão: a distância do
    pulso (larguras de ombro, a partir dos ombros) mais PESO_FORMA vezes a distância dos 65 da
    normalize_hand dividida por raiz de 21 (os dedos em relação ao pulso, em palmos, e a direção da
    mão). Vale o maior valor das duas vagas; vaga com a mão em menos de dois passos conta 0.
    Contrato com o signRecognizer.ts (windowMotion).
    """
    C = np.asarray(Xc, dtype=np.float64).reshape(len(Xc), passos, -1)
    out = np.zeros(len(C))
    for k in range(2):
        b = k * POR_MAO
        tem = C[:, :, b] > 0.5
        w = C[:, :, b + 1:b + 3]
        h = C[:, :, b + 5:b + POR_MAO]
        dw = np.sqrt(((w[:, :, None] - w[:, None]) ** 2).sum(-1))
        dh = np.sqrt(((h[:, :, None] - h[:, None]) ** 2).sum(-1)) / np.sqrt(21)
        par = tem[:, :, None] & tem[:, None]
        out = np.maximum(out, np.where(par, dw + PESO_FORMA * dh, 0.0).max((1, 2)))
    return out


def aumentar(X, y, fator=AUMENTO, seed=0):
    """Variações da janela: velocidade e início um pouco diferentes, corpo mais perto ou longe, ruído."""
    rng = np.random.default_rng(seed)
    T = X.shape[1]
    base = np.linspace(0, 1, T)
    out_X, out_y = [X], [y]
    for _ in range(fator):
        A = np.empty_like(X)
        a = rng.uniform(0, 0.12, len(X))
        b = rng.uniform(0.88, 1.0, len(X))
        for i in range(len(X)):
            alvo = np.linspace(a[i], b[i], T)
            pos = np.clip(np.searchsorted(base, alvo, side="right") - 1, 0, T - 2)
            w = ((alvo - base[pos]) / (base[pos + 1] - base[pos]))[:, None]
            A[i] = X[i, pos] * (1 - w) + X[i, pos + 1] * w
        for k in range(2):
            A[:, :, k * POR_MAO] = (A[:, :, k * POR_MAO] >= 0.5).astype(np.float32)
        escala = rng.uniform(0.9, 1.1, size=(len(X), 1, 1)).astype(np.float32)
        A[:, :, POSICOES] *= escala
        A[:, :, POSICOES] += rng.normal(0, 0.04, size=(len(X), 1, len(POSICOES))).astype(np.float32)
        A += rng.normal(0, 0.01, size=A.shape).astype(np.float32)
        # sem a mão, tudo zero (a presença manda)
        for k in range(2):
            ausente = A[:, :, k * POR_MAO] < 0.5
            A[:, :, k * POR_MAO:(k + 1) * POR_MAO][ausente] = 0
        out_X.append(A)
        out_y.append(y)
    return np.concatenate(out_X), np.concatenate(out_y)


def congelar(X, y, n, rng):
    """
    n janelas "_" por janela de sinal: um quadro dela (com mão) repetido, com um pouco de ruído.
    Com n fracionário (0,3 por exemplo), cada janela de sinal gera a parte inteira e mais uma com
    probabilidade igual à parte fracionária (peso parcial das congeladas no "_").
    """
    sinais = np.where(y != NENHUM)[0]
    if n <= 0 or not len(sinais):
        return X[:0], y[:0]
    inteiro, fracao = int(n), n - int(n)
    out = []
    for i in sinais:
        com_mao = np.where(X[i, :, 0] > 0)[0]
        if not len(com_mao):
            continue
        quantas = inteiro + (1 if fracao > 0 and rng.random() < fracao else 0)
        if not quantas:
            continue
        for j in rng.choice(com_mao, min(quantas, len(com_mao)), replace=False):
            w = np.repeat(X[i, j][None], X.shape[1], axis=0)
            w[:, POSICOES] += rng.normal(0, 0.01, size=(X.shape[1], len(POSICOES)))
            out.append(w)
    W = np.array(out, dtype=np.float32).reshape(-1, X.shape[1], X.shape[2])
    return W, np.full(len(W), NENHUM)


def equilibrar(X, y, rng, max_nenhum=MAX_NENHUM):
    """Repete as janelas dos sinais até cada um ter a média deles; "_" fica com até max_nenhum x os sinais."""
    idx = {c: np.where(y == c)[0] for c in set(y)}
    sinais = [c for c in idx if c != NENHUM]
    alvo = int(np.mean([len(idx[c]) for c in sinais])) if sinais else 0
    pega = []
    for c in sinais:
        pega.append(rng.choice(idx[c], max(alvo, len(idx[c])), replace=len(idx[c]) < alvo))
    if NENHUM in idx:
        n = min(len(idx[NENHUM]), int(max_nenhum * alvo * len(sinais)))
        pega.append(rng.choice(idx[NENHUM], n, replace=False))
    pega = np.concatenate(pega)
    return X[pega], y[pega]


def ajustar(X, y, cfg, seed=0, extra=None):
    """
    MLP do scikit-learn (o da avaliação e o exportado). `extra`: janelas [n, T, F] a mais como "_"
    (as negativas da mão parada ao vivo, --negativas-paradas). Devolve prever(Xc) -> (rótulos,
    probs), com .modelo.
    """
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    rng = np.random.default_rng(seed)
    Xa, ya = aumentar(X, y, cfg["aumento"], seed)
    Wc, yc = congelar(X, y, cfg["congeladas"], rng)
    if extra is None or not len(extra):
        extra = X[:0]
    Xc = compactar(np.concatenate([Xa, Wc, extra.astype(np.float32)]), cfg["passos"])
    yy = np.concatenate([ya, yc, np.full(len(extra), NENHUM)])
    del Xa, Wc
    Xb, yb = equilibrar(Xc, yy, rng, cfg["max_nenhum"])
    sc = StandardScaler().fit(Xb)
    m = MLPClassifier(cfg["ocultas"], alpha=cfg["alpha"], max_iter=200, early_stopping=True, random_state=seed)
    m.fit(sc.transform(Xb), yb)
    labels = [str(c) for c in m.classes_]

    def prever(Z):
        return labels, m.predict_proba(sc.transform(Z))

    prever.modelo = (m, sc)
    return prever


def camadas_sklearn(m, sc):
    """Camadas no formato do mlp.ts, com a padronização dentro da primeira (o app passa a janela crua)."""
    escala = np.where(sc.scale_ > 0, sc.scale_, 1.0)
    layers = []
    for i, (k, b) in enumerate(zip(m.coefs_, m.intercepts_)):
        if i == 0:
            k, b = k / escala[:, None], b - (sc.mean_ / escala) @ k
        layers.append((k, b, "softmax" if i == len(m.coefs_) - 1 else "relu"))
    return layers


# ---------------------------------------------------------------------------
# Avaliação janela a janela (a medida antiga)
# ---------------------------------------------------------------------------

def medir(y, probs, classes, E=None, regras=None):
    """
    Acerto nos sinais e alarme falso nas janelas sem sinal, com as regras de leitura do app (limiar,
    portão de movimento com o movimento E de cada janela e teto do "_"; sem regras, só o limiar).
    """
    regras = regras or REGRAS
    classes = list(classes)
    pred = np.asarray(classes)[probs.argmax(1)]
    conf = probs.max(1)
    ok = (conf >= regras["min_p"]) & (pred != NENHUM)
    if E is not None:
        ok &= np.asarray(E) >= regras["min_movimento"]
    if NENHUM in classes:
        ok &= probs[:, classes.index(NENHUM)] <= regras["max_p_nenhum"]
    lida = np.where(ok, pred, None)
    sinal = y != NENHUM
    acerto = float(np.mean(lida[sinal] == y[sinal])) if sinal.any() else 0.0
    alarme = float(np.mean(lida[~sinal] != None)) if (~sinal).any() else 0.0  # noqa: E711
    return acerto, alarme, lida


# ---------------------------------------------------------------------------
# Avaliação como no app
# ---------------------------------------------------------------------------

def janelas_ao_vivo(video):
    """
    As janelas que o app avalia num vídeo (JSON de landmarks). Devolve (tempos das avaliações,
    janelas [n, T, F], índice da avaliação de cada janela).
    """
    frames, aspect = video["frames"], video["aspect"]
    q = rq.Quadros(video, "video")
    ts = q.ts
    tempos, wins, donos = [], [], []
    if len(ts) < 2:
        return np.zeros(0), np.zeros((0, rq.T, rq.F), np.float16), np.zeros(0, int)
    te = ts[0] + AVALIA_S
    while te <= ts[-1] + 1e-9:
        i1 = int(np.searchsorted(ts, te, side="right"))
        tend = ts[i1 - 1]
        i0 = int(np.searchsorted(ts, tend - BUFFER_S, side="left"))
        tempos.append(te)
        if i1 - i0 >= 2:
            dom = rq.dominante_ao_vivo(frames[i0:i1], aspect)
            feats = q.feats(dom)[i0:i1]
            tb = ts[i0:i1]
            span = tend - tb[0]
            for D in JANELAS_S:
                if span < D * MIN_COBERTURA:
                    continue
                t0 = tend - D
                dentro = feats[tb >= t0]
                alto = False
                for k in range(2):
                    p = np.nan_to_num(dentro[:, k * POR_MAO])
                    yy = np.nan_to_num(dentro[:, k * POR_MAO + 2], nan=np.inf)
                    alto |= bool(np.any((p > 0) & (yy < rq.ATIVO_ABAIXO_OMBRO)))
                if not alto:
                    continue
                wins.append(rq.reamostrar(tb, feats, t0, tend))
                donos.append(len(tempos) - 1)
        te += AVALIA_S
    W = np.array(wins, dtype=np.float16) if wins else np.zeros((0, rq.T, rq.F), np.float16)
    return np.array(tempos), W, np.array(donos, dtype=int)


def _ao_vivo_job(args):
    vid, landmarks, pasta = args
    path = os.path.join(pasta, f"aovivo-{vid}.npz")
    if not os.path.exists(path):
        with open(os.path.join(landmarks, f"{vid}.json")) as f:
            video = json.load(f)
        tempos, W, donos = janelas_ao_vivo(video)
        tmp = path + ".tmp.npz"
        np.savez(tmp, tempos=tempos, W=W, donos=donos)
        os.replace(tmp, path)
    return vid


def pasta_cache(landmarks):
    """Cache das janelas ao vivo: depende só dos landmarks e das regras do app."""
    chave = hashlib.sha1(json.dumps([os.path.abspath(landmarks), rq.T, rq.F, JANELAS_S, BUFFER_S, AVALIA_S,
                                     MIN_COBERTURA, rq.ATIVO_ABAIXO_OMBRO]).encode()).hexdigest()[:10]
    return os.path.join(DATA, "sinais15", "cache", f"aovivo-{chave}")


def preparar_ao_vivo(ids, landmarks, processos=4):
    from multiprocessing import Pool

    pasta = pasta_cache(landmarks)
    os.makedirs(pasta, exist_ok=True)
    faltam = [v for v in sorted(ids) if not os.path.exists(os.path.join(pasta, f"aovivo-{v}.npz"))]
    if faltam:
        print(f"janelas ao vivo: {len(faltam)} vídeo(s) para preparar", flush=True)
        with Pool(processos) as pool:
            for _ in pool.imap_unordered(_ao_vivo_job, [(v, landmarks, pasta) for v in faltam], chunksize=4):
                pass
    return pasta


def probs_ao_vivo(vid, pasta, prever, passos):
    """
    Probabilidades de todas as janelas que o app avalia num vídeo, com o movimento de cada uma
    (não dependem das regras de leitura, então dá para variar as regras sem treinar de novo).
    """
    d = np.load(os.path.join(pasta, f"aovivo-{vid}.npz"))
    tempos, W, donos = d["tempos"], d["W"], d["donos"]
    if len(W):
        Xc = compactar(W.astype(np.float32), passos)
        labels, P = prever(Xc)
        E = movimento(Xc, passos)
    else:
        labels, P, E = [], np.zeros((0, 0)), np.zeros(0)
    return {"tempos": tempos, "donos": donos, "labels": list(labels), "P": np.asarray(P, np.float32),
            "E": np.asarray(E, np.float32)}


def regras_de(args):
    """Regras de leitura do app (as do model.json): limiar, portão de movimento e teto do "_"."""
    return {"min_p": args.min_p, "min_movimento": args.min_movimento, "max_p_nenhum": args.max_p_nenhum}


REGRAS = {"min_p": MIN_P, "min_movimento": MIN_MOVIMENTO, "max_p_nenhum": 1.0}


def leituras(pv, regras=REGRAS):
    """
    Simula o app num vídeo (pv do probs_ao_vivo): em cada avaliação, a leitura (sinal mais provável
    de alguma janela, não "_", com p >= min_p, movimento >= min_movimento e p("_") <= max_p_nenhum;
    vale a de maior p) e a confirmada (CONFIRMA leituras seguidas iguais). Devolve [(t, lida, confirmada)].
    """
    tempos, donos, labels, P, E = pv["tempos"], pv["donos"], pv["labels"], pv["P"], pv["E"]
    lidas = [None] * len(tempos)
    melhor = [0.0] * len(tempos)
    if len(P):
        nenhum = labels.index(NENHUM)
        j = P.argmax(1)
        ok = ((np.asarray(labels)[j] != NENHUM) & (P[np.arange(len(P)), j] >= regras["min_p"])
              & (E >= regras["min_movimento"]) & (P[:, nenhum] <= regras["max_p_nenhum"]))
        for k, jj, p in zip(donos[ok], j[ok], P[ok]):
            if p[jj] > melhor[k]:
                lidas[k], melhor[k] = labels[jj], float(p[jj])
    out, ant, n = [], None, 0
    for t, L in zip(tempos, lidas):
        n = n + 1 if (L is not None and L == ant) else (1 if L is not None else 0)
        ant = L
        out.append((float(t), L, L if n >= CONFIRMA else None))
    return out


def medir_video(rot, pv, regras=REGRAS):
    """Resultado de um vídeo (rótulo do rotular_sinais): acertos e leituras de outros sinais."""
    g = rot["glosa"]
    lido = leituras(pv, regras)
    conf = [(t, L) for t, _, L in lido if L]
    res = {"id": rot["id"], "glosa": g, "aceito": bool(rot.get("aceito")),
           "no_video": any(L == g for _, L in conf),
           "primeira": conf[0][1] if conf else None,
           "outros": sorted({L for _, L in conf if L != g})}
    if rot.get("aceito") and rot.get("sinal"):
        res["no_trecho"] = any(L == g and any((a + b) / 2 <= t <= b + FOLGA_S for a, b in rot["sinal"])
                               for t, L in conf)
    # mão parada por pelo menos a janela mais longa: qualquer leitura confirmada é alarme
    maxD = max(JANELAS_S)
    paradas = []
    for a, b in rot.get("trechos_parados", []):
        avaliadas = [L for t, _, L in lido if a <= t - maxD and t <= b]
        if avaliadas:
            paradas.append([L for L in avaliadas if L][:1] or [None])
    res["paradas"] = [p[0] for p in paradas]
    return res


def resumo_videos(res, titulo, classes, imprime=True):
    """Imprime (com imprime) e devolve o acerto por sinal."""
    por = collections.defaultdict(lambda: {"trecho": [0, 0], "video": [0, 0], "primeira": [0, 0]})
    trocas = collections.Counter()
    outros, paradas = [], []
    for r in res:
        g = r["glosa"]
        if g not in classes:
            continue
        por[g]["video"][0] += r["no_video"]
        por[g]["video"][1] += 1
        por[g]["primeira"][0] += r["primeira"] == g
        por[g]["primeira"][1] += 1
        if "no_trecho" in r:
            por[g]["trecho"][0] += r["no_trecho"]
            por[g]["trecho"][1] += 1
            if not r["no_trecho"]:
                p = r["primeira"]
                trocas[(g, "fora do trecho" if p == g else (p or "nada"))] += 1
        outros.append(len(r["outros"]))
        paradas += r["paradas"]
    alarmes = [p for p in paradas if p]
    resultado = ({g: dict(v) for g, v in por.items()},
                 {"alarmes_parada": len(alarmes), "paradas": len(paradas),
                  "videos_com_outro": sum(1 for o in outros if o), "videos": len(outros)})
    if not imprime:
        return resultado

    def tot(k):
        a = sum(v[k][0] for v in por.values())
        b = sum(v[k][1] for v in por.values())
        return a, b, a / max(b, 1)

    print(f"== {titulo}")
    for k, nome in (("trecho", "confirmado no trecho do sinal (vídeos aceitos)"),
                    ("video", "confirmado em algum ponto do vídeo (todos)"),
                    ("primeira", "primeira leitura confirmada é o sinal (todos)")):
        a, b, r = tot(k)
        if b:
            print(f"{nome}: {a}/{b} ({r:.1%})")
    print(f"vídeos com leitura confirmada de outro sinal: {sum(1 for o in outros if o)}/{len(outros)}")
    print(f"mão parada (>= {max(JANELAS_S):.0f} s) com leitura confirmada: {len(alarmes)}/{len(paradas)}",
          " ".join(f"{a}:{c}" for a, c in collections.Counter(alarmes).most_common(6)))
    ordem = sorted(por, key=lambda g: -(por[g]["trecho"][0] / max(por[g]["trecho"][1], 1)))
    print("por sinal (trecho | vídeo):", " ".join(
        f"{g}:{por[g]['trecho'][0]}/{por[g]['trecho'][1]}|{por[g]['video'][0]}/{por[g]['video'][1]}" for g in ordem))
    print("trocas:", " ".join(f"{a}->{b}:{c}" for (a, b), c in trocas.most_common(12)) or "nenhuma")
    return resultado


def carregar_rotulos(pasta, classes, fontes):
    """Rótulos por vídeo do rotular_sinais (só as glosas das classes), com o canal."""
    out = []
    for nome in sorted(os.listdir(pasta)):
        if not nome.endswith(".json"):
            continue
        with open(os.path.join(pasta, nome)) as f:
            r = json.load(f)
        if r["glosa"] not in classes:
            continue
        r["canal"] = (fontes.get(r["id"], {}).get("channel_id")) or r["id"]
        out.append(r)
    return out


def cfg_de(args):
    return {"passos": args.passos, "ocultas": tuple(int(x) for x in args.ocultas.split(",")), "alpha": args.alpha,
            "aumento": args.aumento, "congeladas": args.congeladas, "max_nenhum": args.max_nenhum,
            "negativas_paradas": args.negativas_paradas}


def janelas_paradas_ao_vivo(rots, pasta, n_por_video, rng):
    """
    Negativas da mão parada como o app vê: janelas ao vivo inteiras dentro de um trecho parado dos
    vídeos (trechos_parados do rotular_sinais), até n_por_video por vídeo. Só as avaliações em que
    a janela mais longa cabe no trecho (o cache das janelas ao vivo não guarda a duração de cada
    uma). Devolve [n, T, F].
    """
    out = []
    for r in rots:
        trechos = r.get("trechos_parados", [])
        if not trechos:
            continue
        d = np.load(os.path.join(pasta, f"aovivo-{r['id']}.npz"))
        tempos, W, donos = d["tempos"], d["W"], d["donos"]
        if not len(W):
            continue
        # todas as janelas da avaliação dentro do trecho parado (a mais longa cabe nele)
        maxD = max(JANELAS_S)
        cand = [i for i, k in enumerate(donos) if any(a <= tempos[k] - maxD and tempos[k] <= b for a, b in trechos)]
        if cand:
            pega = rng.choice(cand, min(n_por_video, len(cand)), replace=False)
            out.append(W[np.sort(pega)].astype(np.float32))
    return np.concatenate(out) if out else np.zeros((0, rq.T, rq.F), np.float32)


def medir_janelas(y, tipo, probs, classes, E, regras):
    """Janela a janela (canais deixados de fora): acerto nos sinais e alarmes em "_" e na mão parada."""
    acerto, _, lida = medir(y, probs, classes, E, regras)
    al_outro = float(np.mean(lida[tipo == "outro"] != None)) if (tipo == "outro").any() else 0.0  # noqa: E711
    al_parada = float(np.mean(lida[tipo == "parada"] != None)) if (tipo == "parada").any() else 0.0  # noqa: E711
    return acerto, al_outro, al_parada


def relatorio(sim, regras, imprime=True):
    """Métricas de uma simulação (o que o avaliar guarda com --probs) com as regras de leitura dadas."""
    classes, glosas = sim["classes"], set(sim["glosas"])
    acerto, al_outro, al_parada = medir_janelas(sim["y"], sim["tipo"], sim["probs"], classes, sim["E"], regras)
    if imprime:
        print(f"== janela a janela (canais deixados de fora): sinais certos {acerto:.1%} | alarme em \"_\" "
              f"{al_outro:.1%} | alarme em mão parada {al_parada:.1%}")
    res_cv = [medir_video(r, sim["pv"][r["id"]], regras) for r in sim["rots_cv"]]
    por_cv, al_cv = resumo_videos(res_cv, f"validação cruzada por canal ({sim['grupos']} grupos)", glosas, imprime)
    acerto_dic, _, _ = medir(sim["y_dic"], sim["probs_dic"], classes, sim["E_dic"], regras)
    if imprime:
        print(f"== dicionários janela a janela: sinais certos {acerto_dic:.1%}")
    res_dic = [medir_video(r, sim["pv_dic"][r["id"]], regras) for r in sim["rots_dic"]]
    por_dic, al_dic = resumo_videos(res_dic, f"dicionários ({len(res_dic)} vídeos, modelo só do YouTube)", glosas, imprime)
    return {"janela": {"acerto": acerto, "alarme_outro": al_outro, "alarme_parada": al_parada, "acerto_dic": acerto_dic},
            "cv": por_cv, "cv_alarmes": al_cv, "dic": por_dic, "dic_alarmes": al_dic,
            "videos_cv": res_cv, "videos_dic": res_dic}


def avaliar(args):
    import pickle

    from sklearn.model_selection import GroupKFold

    cfg = cfg_de(args)
    regras = regras_de(args)
    X, y, pessoa, video, tipo = carregar(args.dataset, args.min_pessoas)
    classes = sorted(set(y))
    glosas = [c for c in classes if c != NENHUM]
    print(f"config: {cfg} | regras: {regras}")
    print(f"janelas: {len(y)} ({collections.Counter(tipo).most_common()}) | glosas: {len(glosas)} | "
          f"canais: {len(set(pessoa))}")
    with open(os.path.join(DATA, "fontes_sinais.json")) as f:
        fontes = {x["id"]: x for x in json.load(f)}
    rots = carregar_rotulos(args.rotulos, set(glosas), fontes)
    pasta = preparar_ao_vivo({r["id"] for r in rots}, args.landmarks, args.processos)
    dic_win = np.array([p.startswith(DICIONARIO) for p in pessoa])
    yt_rots = [r for r in rots if not r["id"].startswith(DICIONARIO)]
    dic_rots = [r for r in rots if r["id"].startswith(DICIONARIO)]
    E = movimento(compactar(X, cfg["passos"]), cfg["passos"])

    def extras(rots_treino, seed):
        """Negativas da mão parada ao vivo dos vídeos de treino (--negativas-paradas)."""
        if cfg["negativas_paradas"] <= 0:
            return None
        return janelas_paradas_ao_vivo(rots_treino, pasta, cfg["negativas_paradas"], np.random.default_rng(1000 + seed))

    # Validação cruzada por canal do YouTube (os dicionários ficam sempre no treino)
    canais = np.array([r["canal"] for r in yt_rots])
    pv = {}
    probs = np.zeros((len(y), len(classes)))
    testado = np.zeros(len(y), dtype=bool)
    # --semente: outra divisão dos canais em grupos (confere se o acerto por sinal se repete)
    gk = GroupKFold(args.grupos, shuffle=True, random_state=args.semente) if args.semente else GroupKFold(args.grupos)
    for k, (_, te) in enumerate(gk.split(canais, groups=canais)):
        fora = set(canais[te])
        tr = np.array([p not in fora for p in pessoa])
        treino_rots = [r for r in rots if r["canal"] not in fora]
        prever = ajustar(X[tr], y[tr], cfg, seed=k, extra=extras(treino_rots, k))
        labels, p = prever(compactar(X[~tr], cfg["passos"]))
        cols = [classes.index(c) for c in labels]
        idx = np.where(~tr)[0]
        probs[np.ix_(idx, cols)] = p
        testado[idx] = True
        for i in te:
            pv[yt_rots[i]["id"]] = probs_ao_vivo(yt_rots[i]["id"], pasta, prever, cfg["passos"])
        print(f"  grupo {k + 1}/{args.grupos}: {len(te)} vídeos", flush=True)
    m = testado & ~dic_win

    # Dicionários: treina só no YouTube
    prever = ajustar(X[~dic_win], y[~dic_win], cfg, seed=99, extra=extras(yt_rots, 99))
    labels, p = prever(compactar(X[dic_win], cfg["passos"]))
    pd = np.zeros((dic_win.sum(), len(classes)))
    pd[:, [classes.index(c) for c in labels]] = p
    pv_dic = {r["id"]: probs_ao_vivo(r["id"], pasta, prever, cfg["passos"]) for r in dic_rots}

    sim = {"classes": classes, "glosas": glosas, "grupos": args.grupos, "cfg": cfg, "dataset": args.dataset,
           "y": y[m], "tipo": tipo[m], "probs": probs[m].astype(np.float32), "E": E[m],
           "y_dic": y[dic_win], "probs_dic": pd.astype(np.float32), "E_dic": E[dic_win],
           "rots_cv": yt_rots, "pv": pv, "rots_dic": dic_rots, "pv_dic": pv_dic}
    if args.probs:
        with open(args.probs, "wb") as f:
            pickle.dump(sim, f, protocol=pickle.HIGHEST_PROTOCOL)
        print(f"probabilidades em {args.probs} (para o varrer)")
    rel = relatorio(sim, regras)
    if args.salvar:
        with open(args.salvar, "w") as f:
            json.dump({"cfg": {k: list(v) if isinstance(v, tuple) else v for k, v in cfg.items()}, "regras": regras,
                       "dataset": args.dataset, "glosas": glosas, **rel}, f, ensure_ascii=False)
        print(f"resultados em {args.salvar}")


def varrer(args):
    """
    Varre as regras de leitura do app (limiar, portão de movimento, teto do "_") sobre as
    probabilidades guardadas pelo avaliar --probs, sem treinar de novo. Com mais de um arquivo
    (divisões diferentes dos canais), a câmera é a dos sinais que passam em todos.
    """
    import itertools
    import pickle

    sims = []
    for path in args.probs:
        with open(path, "rb") as f:
            sims.append(pickle.load(f))
    grade = list(itertools.product(args.min_p, args.min_movimento, args.max_p_nenhum))
    print("min_p mov  max_ | trecho  | janela: certos alarme_ parada | paradas>=2s | outro sinal | dic   | câmera")
    for min_p, mm, mx in grade:
        regras = {"min_p": min_p, "min_movimento": mm, "max_p_nenhum": mx}
        rels = [relatorio(s, regras, imprime=False) for s in sims]
        camera = set(sinais_camera(rels[0]))
        for r in rels[1:]:
            camera &= set(sinais_camera(r))

        def media(f):
            return np.mean([f(r) for r in rels])

        trecho = media(lambda r: sum(v["trecho"][0] for v in r["cv"].values()) / max(sum(v["trecho"][1] for v in r["cv"].values()), 1))
        dic = media(lambda r: sum(v["trecho"][0] for v in r["dic"].values()) / max(sum(v["trecho"][1] for v in r["dic"].values()), 1))
        par = media(lambda r: r["cv_alarmes"]["alarmes_parada"])
        npar = rels[0]["cv_alarmes"]["paradas"]
        outros = media(lambda r: r["cv_alarmes"]["videos_com_outro"] / max(r["cv_alarmes"]["videos"], 1))
        j = {k: media(lambda r, k=k: r["janela"][k]) for k in ("acerto", "alarme_outro", "alarme_parada")}
        print(f"{min_p:.2f}  {mm:.2f} {mx:.2f} | {trecho:6.1%} | {j['acerto']:6.1%} {j['alarme_outro']:6.1%} "
              f"{j['alarme_parada']:6.1%} | {par:4.1f}/{npar} | {outros:6.1%} | {dic:5.1%} | {len(camera)} "
              f"{' '.join(sorted(camera))}", flush=True)
        if args.por_sinal:
            for g in sorted(args.por_sinal.split(",")):
                vals = [r["cv"].get(g, {}).get("trecho", [0, 0]) for r in rels]
                d = rels[0]["dic"].get(g, {}).get("video", [0, 0])
                print(f"      {g}: " + " ".join(f"{a}/{b}" for a, b in vals) + f" | dic {d[0]}/{d[1]}")


def sinais_camera(resultados):
    """Glosas que passam: no trecho >= MIN_ACERTO_CAMERA com >= MIN_TESTE vídeos e, com dicionário, >= MIN_ACERTO_DIC."""
    out = []
    for g, v in resultados["cv"].items():
        a, b = v["trecho"]
        if b < MIN_TESTE or a / b < MIN_ACERTO_CAMERA:
            continue
        d = resultados["dic"].get(g, {}).get("video", [0, 0])
        if d[1] >= MIN_DIC and d[0] / d[1] < MIN_ACERTO_DIC:
            continue
        out.append(g)
    return sorted(out)


def regras_json(regras):
    """Regras de leitura no formato do model.json (reading_rules, readingRules.ts do app)."""
    return {"min_probability": regras["min_p"], "min_motion": regras["min_movimento"],
            "motion_shape_weight": PESO_FORMA, "max_none_probability": regras["max_p_nenhum"]}


def aplicar_regras(args):
    """
    Grava as regras de leitura (reading_rules) no model.json de um modelo já exportado, sem mexer
    nos pesos: o portão de movimento e o teto do "_" não mudam o modelo, só quando a leitura vale.
    """
    path = os.path.join(args.modelo, "model.json")
    with open(path) as f:
        m = json.load(f)
    if m.get("kind") != "sinais":
        raise SystemExit(f"{path} não é um modelo de sinais")
    m["reading_rules"] = regras_json(regras_de(args))
    with open(path, "w") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"reading_rules em {path}: {m['reading_rules']}")


def treinar(args):
    from train_static import export_web, mlp_forward

    cfg = cfg_de(args)
    if cfg["negativas_paradas"]:
        raise SystemExit("--negativas-paradas só no avaliar (o treinar não lê as janelas ao vivo)")
    X, y, pessoa, _, tipo = carregar(args.dataset, args.min_pessoas)
    ajustado = ajustar(X, y, cfg, seed=0)
    m, sc = ajustado.modelo
    labels = [str(c) for c in m.classes_]
    layers = [(k.astype(np.float32), b.astype(np.float32), a) for k, b, a in camadas_sklearn(m, sc)]
    Xc = compactar(X, cfg["passos"])
    amostra = Xc[np.linspace(0, len(Xc) - 1, 200).round().astype(int)]
    diff = np.abs(mlp_forward(layers, amostra) - ajustado(amostra)[1]).max()
    print(f"diferença máxima camadas exportadas x scikit-learn: {diff:.2e}")
    if diff >= 1e-4:
        raise SystemExit("as camadas exportadas não batem com o scikit-learn")
    acerto, alarme, _ = medir(y, mlp_forward(layers, Xc), labels)
    print(f"no próprio treino: sinais {acerto:.1%}, alarme falso {alarme:.1%} (não vale como medida)")
    extra = {
        "kind": "sinais", "frames": cfg["passos"], "features_per_frame": int(X.shape[2]),
        "window_frames": int(X.shape[1]), "windows_s": list(JANELAS_S),
        "people": int(len({p for p in pessoa if not p.startswith(DICIONARIO)})), "source": "scikit-learn",
        "reading_rules": regras_json(regras_de(args)),
    }
    if args.resultados:
        # com mais de um arquivo (divisões diferentes dos canais), o sinal precisa passar em todos
        todos = []
        for path in args.resultados:
            with open(path) as f:
                todos.append(json.load(f))
            # resultados de antes das regras de leitura: só o limiar, sem portão
            medido = todos[-1].get("regras", {"min_p": MIN_P, "min_movimento": 0.0, "max_p_nenhum": 1.0})
            if medido != regras_de(args):
                print(f"aviso: {path} foi medido com as regras {medido}, o modelo sai com {regras_de(args)}")
        res = todos[0]
        camera = [g for g in sinais_camera(res) if g in labels and all(g in sinais_camera(r) for r in todos[1:])]
        extra.update({
            "camera_signs": camera, "camera_min_heldout": MIN_ACERTO_CAMERA,
            "heldout": {g: {"certas": v["trecho"][0], "total": v["trecho"][1]} for g, v in sorted(res["cv"].items())},
            "dictionary": {g: {"certas": v["video"][0], "total": v["video"][1]} for g, v in sorted(res["dic"].items())},
        })
        print(f"câmera: {' '.join(camera) or 'nenhum'}")
    export_web(args.out, layers, labels, [], extra=extra)
    # vetores dourados: janelas de verdade (entrada compactada) e o softmax do scikit-learn
    picks = np.linspace(0, len(Xc) - 1, min(12, len(Xc))).round().astype(int)
    with open(os.path.join(args.out, "golden.json"), "w") as f:
        json.dump({"labels": labels, "cases": [
            {"input": [round(float(v), 6) for v in Xc[i]],
             "probs": [float(v) for v in ajustado(np.round(Xc[i:i + 1].astype(np.float64), 6))[1][0]]}
            for i in picks]}, f)
    print(f"modelo em {args.out} ({len(labels) - 1} sinais e '_')")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for nome in ("avaliar", "treinar"):
        a = sub.add_parser(nome)
        a.add_argument("--dataset", default=DATASET)
        a.add_argument("--min-pessoas", type=int, default=MIN_PESSOAS)
        a.add_argument("--passos", type=int, default=PASSOS)
        a.add_argument("--ocultas", default=",".join(map(str, OCULTAS)))
        a.add_argument("--alpha", type=float, default=ALPHA)
        a.add_argument("--aumento", type=int, default=AUMENTO)
        a.add_argument("--congeladas", type=float, default=0)
        a.add_argument("--max-nenhum", type=float, default=MAX_NENHUM)
        a.add_argument("--negativas-paradas", type=int, default=0,
                       help="janelas ao vivo de mão parada por vídeo de treino que entram como \"_\"")
        a.add_argument("--min-p", type=float, default=MIN_P)
        a.add_argument("--min-movimento", type=float, default=MIN_MOVIMENTO,
                       help="portão de movimento do app (0 desliga)")
        a.add_argument("--max-p-nenhum", type=float, default=1.0,
                       help="sem leitura quando p(\"_\") passa disto (1 desliga)")
    a = sub.choices["avaliar"]
    a.add_argument("--landmarks", default=os.path.join(DATA, "landmarks_sinais"))
    a.add_argument("--rotulos", default=os.path.join(DATA, "rotulos_sinais"))
    a.add_argument("--grupos", type=int, default=5)
    a.add_argument("--processos", type=int, default=4)
    a.add_argument("--salvar", default="")
    a.add_argument("--probs", default="", help="guarda as probabilidades (pickle) para o varrer")
    a.add_argument("--semente", type=int, default=0, help="divisão sorteada dos canais nos grupos")
    t = sub.choices["treinar"]
    t.add_argument("--out", required=True)
    t.add_argument("--resultados", nargs="*", default=[], help="o --salvar do avaliar (um ou mais)")
    r = sub.add_parser("regras", help="grava as regras de leitura no model.json de um modelo exportado")
    r.add_argument("--modelo", required=True, help="pasta com o model.json")
    r.add_argument("--min-p", type=float, default=MIN_P)
    r.add_argument("--min-movimento", type=float, default=MIN_MOVIMENTO)
    r.add_argument("--max-p-nenhum", type=float, default=1.0)
    v = sub.add_parser("varrer")
    v.add_argument("probs", nargs="+", help="arquivos do avaliar --probs (um por divisão dos canais)")
    v.add_argument("--min-p", type=float, nargs="+", default=[MIN_P])
    v.add_argument("--min-movimento", type=float, nargs="+", default=[MIN_MOVIMENTO])
    v.add_argument("--max-p-nenhum", type=float, nargs="+", default=[1.0])
    v.add_argument("--por-sinal", default="", help="glosas (separadas por vírgula) com o acerto em cada divisão")
    args = ap.parse_args()
    if args.cmd == "avaliar":
        avaliar(args)
    elif args.cmd == "varrer":
        varrer(args)
    elif args.cmd == "regras":
        aplicar_regras(args)
    else:
        treinar(args)


if __name__ == "__main__":
    main()
