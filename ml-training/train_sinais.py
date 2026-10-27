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
  (todos os vídeos da glosa que passaram no filtro de título, aceitos ou não). A divisão --semente
  N treina o grupo k com a semente N * grupos + k: cada divisão também tem os seus treinos.
- Câmera (subcomando camera): soma o "no trecho" de SEMENTES_CAMERA divisões (cada uma com os seus
  treinos) e decide por sinal com a soma (ver sinais_camera).
- Teste nos dicionários: treina só no YouTube e roda nos vídeos de dicionário (só o sinal):
  acerto quando a glosa é confirmada no vídeo.
- Alarmes: janelas "_" e "parada" lidas como sinal (janela a janela) e, nos vídeos, trechos de mão
  parada por pelo menos a janela mais longa com alguma leitura confirmada.

Uso:
    python train_sinais.py avaliar --dataset data/sinais15/dataset.npz --landmarks data/sinais15/landmarks \\
        --rotulos data/sinais15/rotulos [--passos 8] [--ocultas 256,128] [--congeladas 2] [--salvar res.json]
        (vídeos de outra lista: --landmarks com mais uma pasta e --fontes-extra data/sinais15/fontes_extra.json,
        para o canal deles valer na divisão dos grupos)
        (--so-treino ext-: os vídeos externos de video/baixar_externas.py só no treino, o teste fica o do YouTube)
    python train_sinais.py camera (mesmas opções do avaliar) --salvar camera.json [--sementes 8]
        validação cruzada por canal em SEMENTES_CAMERA divisões (sementes 0 a 7, cada uma com
        GRUPOS_CAMERA grupos e os seus treinos), o teste no dicionário e a decisão por sinal com a
        soma; o --salvar guarda cada divisão ao terminar e, com a mesma configuração, a próxima
        execução continua de onde parou
    python train_sinais.py treinar --out PASTA (mesmas opções) [--camera camera.json]
        com --camera (o --salvar do camera), o model.json leva em camera_signs só os sinais que
        passaram na soma das divisões e no dicionário (sinais_camera)
    python train_sinais.py avaliar ... --probs probs.pkl [--min-movimento 0.17]
    python train_sinais.py varrer probs-s0.pkl probs-s1.pkl --min-movimento 0 0.15 0.17 [--por-sinal A,B]
        uma linha por regra: acerto no trecho, alarmes e a câmera (soma das divisões, sinais_camera)
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

# Sinal só ganha câmera no app com pelo menos MIN_ACERTO_CAMERA certa nos vídeos deixados de fora
# da validação cruzada (no trecho), somando SEMENTES_CAMERA divisões dos canais em GRUPOS_CAMERA
# grupos (cada divisão com os seus treinos), com vídeos de pelo menos MIN_CANAIS canais diferentes
# no teste e, quando há pelo menos MIN_DIC vídeos de dicionário, pelo menos MIN_ACERTO_DIC neles.
# Antes (até 2026-10-26) o sinal precisava passar sozinho em cada uma de duas divisões (sementes 0 e
# 1, com pelo menos 8 vídeos): com 10 a 20 vídeos por sinal, um vídeo a mais ou a menos muda 5 a 10
# pontos e um sinal no limite (o HOMEM com 15/19 e 11/19) segurava ou derrubava a decisão sozinho.
# A soma é a regra das letras com movimento (train_letras_mov.py, SEMENTES_CAMERA).
MIN_ACERTO_CAMERA = 0.7
MIN_CANAIS = 8
SEMENTES_CAMERA = 8
GRUPOS_CAMERA = 5
MIN_DIC = 3
# Sinais dispensados do teste do dicionário por decisão de produto (2026-10-26): FELIZ acerta 94,6% com
# pessoas novas na soma das divisões, mas confirma só 1 de 4 vídeos de dicionário. Ainda precisam passar
# em MIN_ACERTO_CAMERA e MIN_CANAIS.
SEM_TESTE_DIC = {"FELIZ"}
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
    # em ordem: com o set direto, a ordem dos sorteios mudava com o PYTHONHASHSEED de cada execução e o
    # mesmo treino dava outro resultado (até 4 vídeos a mais ou a menos por sinal na mesma divisão)
    idx = {c: np.where(y == c)[0] for c in sorted(set(y))}
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
    """
    Prepara o cache das janelas ao vivo dos vídeos `ids`, procurados nas pastas `landmarks` (uma ou
    mais; cada pasta tem o seu cache). Devolve {id: pasta do cache}.
    """
    from multiprocessing import Pool

    if isinstance(landmarks, str):
        landmarks = [landmarks]
    pastas, jobs = {}, []
    for vid in sorted(ids):
        origem = next((d for d in landmarks if os.path.exists(os.path.join(d, f"{vid}.json"))), landmarks[0])
        pasta = pasta_cache(origem)
        pastas[vid] = pasta
        if not os.path.exists(os.path.join(pasta, f"aovivo-{vid}.npz")):
            jobs.append((vid, origem, pasta))
    for pasta in set(pastas.values()):
        os.makedirs(pasta, exist_ok=True)
    if jobs:
        print(f"janelas ao vivo: {len(jobs)} vídeo(s) para preparar", flush=True)
        with Pool(processos) as pool:
            for _ in pool.imap_unordered(_ao_vivo_job, jobs, chunksize=4):
                pass
    return pastas


def probs_ao_vivo(vid, pastas, prever, passos):
    """
    Probabilidades de todas as janelas que o app avalia num vídeo, com o movimento de cada uma
    (não dependem das regras de leitura, então dá para variar as regras sem treinar de novo).
    """
    d = np.load(os.path.join(pastas[vid], f"aovivo-{vid}.npz"))
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


def janelas_paradas_ao_vivo(rots, pastas, n_por_video, rng):
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
        d = np.load(os.path.join(pastas[r["id"]], f"aovivo-{r['id']}.npz"))
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


def contexto(args):
    """O que o avaliar e o camera usam: dataset, rótulos por vídeo, cache das janelas ao vivo."""
    import types

    cfg = cfg_de(args)
    X, y, pessoa, video, tipo = carregar(args.dataset, args.min_pessoas)
    classes = sorted(set(y))
    glosas = [c for c in classes if c != NENHUM]
    print(f"config: {cfg} | regras: {regras_de(args)}")
    print(f"janelas: {len(y)} ({collections.Counter(tipo).most_common()}) | glosas: {len(glosas)} | "
          f"canais: {len(set(pessoa))}")
    fontes = rq.carregar_fontes(args.fontes_extra)
    rots = carregar_rotulos(args.rotulos, set(glosas), fontes)
    pastas = preparar_ao_vivo({r["id"] for r in rots}, args.landmarks, args.processos)
    # --so-treino: canais que ficam sempre no treino e nunca no teste (como os dicionários, mas fora do
    # teste do dicionário), para medir o efeito de mais dados no mesmo conjunto de teste
    so_treino = tuple(args.so_treino)
    return types.SimpleNamespace(
        cfg=cfg, X=X, y=y, pessoa=pessoa, tipo=tipo, classes=classes, glosas=glosas, rots=rots, pastas=pastas,
        dic_win=np.array([p.startswith(DICIONARIO) for p in pessoa]),
        yt_rots=[r for r in rots if not r["id"].startswith(DICIONARIO)
                 and not (so_treino and r["canal"].startswith(so_treino))],
        dic_rots=[r for r in rots if r["id"].startswith(DICIONARIO)],
        E=movimento(compactar(X, cfg["passos"]), cfg["passos"]))


def _extras(c, rots_treino, seed):
    """Negativas da mão parada ao vivo dos vídeos de treino (--negativas-paradas)."""
    if c.cfg["negativas_paradas"] <= 0:
        return None
    return janelas_paradas_ao_vivo(rots_treino, c.pastas, c.cfg["negativas_paradas"], np.random.default_rng(1000 + seed))


def validacao_por_canal(c, grupos, semente):
    """
    Validação cruzada por canal do YouTube (os dicionários e os canais do --so-treino ficam sempre no
    treino), na divisão `semente` (0: a do GroupKFold sem sorteio; N: sorteada com N). O grupo k
    treina com a semente semente * grupos + k. Devolve (probabilidades ao vivo por vídeo, probs das
    janelas do dataset, janelas testadas).
    """
    from sklearn.model_selection import GroupKFold

    canais = np.array([r["canal"] for r in c.yt_rots])
    pv = {}
    probs = np.zeros((len(c.y), len(c.classes)))
    testado = np.zeros(len(c.y), dtype=bool)
    gk = GroupKFold(grupos, shuffle=True, random_state=semente) if semente else GroupKFold(grupos)
    for k, (_, te) in enumerate(gk.split(canais, groups=canais)):
        fora = set(canais[te])
        tr = np.array([p not in fora for p in c.pessoa])
        treino_rots = [r for r in c.rots if r["canal"] not in fora]
        seed = semente * grupos + k
        prever = ajustar(c.X[tr], c.y[tr], c.cfg, seed=seed, extra=_extras(c, treino_rots, seed))
        labels, p = prever(compactar(c.X[~tr], c.cfg["passos"]))
        idx = np.where(~tr)[0]
        probs[np.ix_(idx, [c.classes.index(g) for g in labels])] = p
        testado[idx] = True
        for i in te:
            pv[c.yt_rots[i]["id"]] = probs_ao_vivo(c.yt_rots[i]["id"], c.pastas, prever, c.cfg["passos"])
        print(f"  divisão {semente}, grupo {k + 1}/{grupos}: {len(te)} vídeos", flush=True)
    return pv, probs, testado & ~c.dic_win


def teste_dicionario(c):
    """Dicionários: treina só no YouTube (e nos externos) e roda nos vídeos de dicionário."""
    prever = ajustar(c.X[~c.dic_win], c.y[~c.dic_win], c.cfg, seed=99, extra=_extras(c, c.yt_rots, 99))
    labels, p = prever(compactar(c.X[c.dic_win], c.cfg["passos"]))
    pd = np.zeros((c.dic_win.sum(), len(c.classes)))
    pd[:, [c.classes.index(g) for g in labels]] = p
    pv_dic = {r["id"]: probs_ao_vivo(r["id"], c.pastas, prever, c.cfg["passos"]) for r in c.dic_rots}
    return pd, pv_dic


def avaliar(args):
    import pickle

    regras = regras_de(args)
    c = contexto(args)
    # --semente: outra divisão dos canais em grupos (confere se o acerto por sinal se repete)
    pv, probs, m = validacao_por_canal(c, args.grupos, args.semente)
    pd, pv_dic = teste_dicionario(c)
    sim = {"classes": c.classes, "glosas": c.glosas, "grupos": args.grupos, "cfg": c.cfg, "dataset": args.dataset,
           "y": c.y[m], "tipo": c.tipo[m], "probs": probs[m].astype(np.float32), "E": c.E[m],
           "y_dic": c.y[c.dic_win], "probs_dic": pd.astype(np.float32), "E_dic": c.E[c.dic_win],
           "rots_cv": c.yt_rots, "pv": pv, "rots_dic": c.dic_rots, "pv_dic": pv_dic}
    if args.probs:
        with open(args.probs, "wb") as f:
            pickle.dump(sim, f, protocol=pickle.HIGHEST_PROTOCOL)
        print(f"probabilidades em {args.probs} (para o varrer)")
    rel = relatorio(sim, regras)
    if args.salvar:
        with open(args.salvar, "w") as f:
            json.dump({"cfg": cfg_json(c.cfg), "regras": regras, "dataset": args.dataset, "glosas": c.glosas, **rel},
                      f, ensure_ascii=False)
        print(f"resultados em {args.salvar}")


def cfg_json(cfg):
    return {k: list(v) if isinstance(v, tuple) else v for k, v in cfg.items()}


def canais_por_glosa(rots):
    """Canais diferentes com vídeo no teste "no trecho" (aceito e com o trecho do sinal) por glosa."""
    por = collections.defaultdict(set)
    for r in rots:
        if r.get("aceito") and r.get("sinal"):
            por[r["glosa"]].add(r["canal"])
    return {g: len(v) for g, v in sorted(por.items())}


def somar_divisoes(cvs):
    """Soma por glosa o "cv" de várias divisões (o do relatorio): trecho, vídeo e o trecho de cada uma."""
    soma = {}
    for cv in cvs:
        for g, v in cv.items():
            s = soma.setdefault(g, {"trecho": [0, 0], "video": [0, 0], "divisoes": []})
            for k in ("trecho", "video"):
                s[k][0] += v[k][0]
                s[k][1] += v[k][1]
            s["divisoes"].append(list(v["trecho"]))
    return dict(sorted(soma.items()))


def avaliar_camera(args):
    """
    A decisão da câmera: a validação cruzada por canal em --sementes divisões (0 a N-1, cada uma com
    os seus treinos), somadas por sinal, e o teste no dicionário. Com --salvar, cada divisão fica
    guardada ao terminar e uma execução com a mesma configuração continua de onde parou.
    """
    regras = regras_de(args)
    c = contexto(args)
    chave = {"cfg": cfg_json(c.cfg), "regras": regras, "dataset": os.path.abspath(args.dataset),
             "rotulos": os.path.abspath(args.rotulos), "so_treino": list(args.so_treino), "grupos": args.grupos,
             "min_pessoas": args.min_pessoas, "glosas": c.glosas}
    salvo = {}
    if args.salvar and os.path.exists(args.salvar):
        with open(args.salvar) as f:
            salvo = json.load(f)
        if salvo.get("chave") != chave:
            print(f"{args.salvar} é de outra configuração: começa do zero")
            salvo = {}
    salvo["chave"] = chave
    divisoes = salvo.setdefault("divisoes", {})

    def guardar():
        if args.salvar:
            tmp = args.salvar + ".tmp"
            with open(tmp, "w") as f:
                json.dump(salvo, f, ensure_ascii=False)
            os.replace(tmp, args.salvar)

    for s in range(args.sementes):
        if str(s) in divisoes:
            continue
        pv, probs, m = validacao_por_canal(c, args.grupos, s)
        acerto, al_outro, al_parada = medir_janelas(c.y[m], c.tipo[m], probs[m], c.classes, c.E[m], regras)
        res = [medir_video(r, pv[r["id"]], regras) for r in c.yt_rots]
        por, al = resumo_videos(res, "", set(c.glosas), imprime=False)
        divisoes[str(s)] = {"cv": por, "alarmes": al,
                            "janela": {"acerto": acerto, "alarme_outro": al_outro, "alarme_parada": al_parada}}
        a = sum(v["trecho"][0] for v in por.values())
        b = sum(v["trecho"][1] for v in por.values())
        print(f"divisão {s}: no trecho {a}/{b} ({a / max(b, 1):.1%}) | janela: alarme em \"_\" {al_outro:.1%}, "
              f"mão parada {al_parada:.1%} | trechos parados com leitura {al['alarmes_parada']}/{al['paradas']}",
              flush=True)
        guardar()
    if "dic" not in salvo:
        pd, pv_dic = teste_dicionario(c)
        res = [medir_video(r, pv_dic[r["id"]], regras) for r in c.dic_rots]
        salvo["dic"], salvo["dic_alarmes"] = resumo_videos(res, "", set(c.glosas), imprime=False)
        guardar()

    usadas = [divisoes[str(s)] for s in range(args.sementes)]
    soma = somar_divisoes([d["cv"] for d in usadas])
    canais = canais_por_glosa(c.yt_rots)
    escolhidos = sinais_camera(soma, canais, salvo["dic"])
    salvo.update({"sementes": args.sementes, "soma": soma, "canais": canais, "camera": escolhidos})
    guardar()

    def media(f):
        return float(np.mean([f(d) for d in usadas]))

    a = sum(v["trecho"][0] for v in soma.values())
    b = sum(v["trecho"][1] for v in soma.values())
    par = sum(d["alarmes"]["alarmes_parada"] for d in usadas)
    npar = sum(d["alarmes"]["paradas"] for d in usadas)
    print(f"== soma de {args.sementes} divisões em {args.grupos} grupos ({c.cfg} | {regras})")
    print(f"no trecho {a}/{b} ({a / max(b, 1):.1%}) | janela (média): alarme em \"_\" "
          f"{media(lambda d: d['janela']['alarme_outro']):.1%}, mão parada {media(lambda d: d['janela']['alarme_parada']):.1%}"
          f" | trechos parados com leitura {par}/{npar} | vídeos com leitura de outro sinal "
          f"{media(lambda d: d['alarmes']['videos_com_outro'] / max(d['alarmes']['videos'], 1)):.1%}")
    print(f"{'sinal':14} {'soma':>9} {'%':>6} {'menor':>6} {'canais':>6} {'dic':>5}  câmera")
    for g in sorted(soma, key=lambda g: -soma[g]["trecho"][0] / max(soma[g]["trecho"][1], 1)):
        sa, sb = soma[g]["trecho"]
        if not sb:
            continue
        menor = min(x / y for x, y in soma[g]["divisoes"] if y)
        d = salvo["dic"].get(g, {}).get("video", [0, 0])
        print(f"{g:14} {sa:>4}/{sb:<4} {sa / sb:6.1%} {menor:6.0%} {canais.get(g, 0):6} {d[0]:>2}/{d[1]:<2}  "
              f"{'sim' if g in escolhidos else ''}")
    print(f"câmera ({len(escolhidos)}): {' '.join(escolhidos) or 'nenhum'}")
    if args.salvar:
        print(f"resultados em {args.salvar}")


def varrer(args):
    """
    Varre as regras de leitura do app (limiar, portão de movimento, teto do "_") sobre as
    probabilidades guardadas pelo avaliar --probs, sem treinar de novo. Com mais de um arquivo
    (divisões diferentes dos canais), a câmera é a da soma deles (sinais_camera).
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
        camera = sinais_camera(somar_divisoes([r["cv"] for r in rels]), canais_por_glosa(sims[0]["rots_cv"]),
                               rels[0]["dic"])

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


def sinais_camera(soma, canais, dic):
    """
    Glosas que passam: no trecho, somando as divisões (somar_divisoes), >= MIN_ACERTO_CAMERA, com
    vídeos de >= MIN_CANAIS canais no teste (canais_por_glosa) e, com dicionário, >= MIN_ACERTO_DIC.
    """
    out = []
    for g, v in soma.items():
        a, b = v["trecho"]
        if canais.get(g, 0) < MIN_CANAIS or not b or a / b < MIN_ACERTO_CAMERA:
            continue
        d = dic.get(g, {}).get("video", [0, 0])
        if g not in SEM_TESTE_DIC and d[1] >= MIN_DIC and d[0] / d[1] < MIN_ACERTO_DIC:
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
    if args.camera:
        # a decisão do subcomando camera (soma das divisões dos canais e dicionário)
        with open(args.camera) as f:
            res = json.load(f)
        chave = res["chave"]
        if chave["regras"] != regras_de(args) or chave["cfg"] != cfg_json(cfg):
            print(f"aviso: {args.camera} foi medido com {chave['cfg']} e {chave['regras']}, o modelo sai com "
                  f"{cfg_json(cfg)} e {regras_de(args)}")
        if chave["dataset"] != os.path.abspath(args.dataset):
            print(f"aviso: {args.camera} foi medido no dataset {chave['dataset']}")
        # decide de novo com o salvo, para valer a regra atual (SEM_TESTE_DIC) sem medir de novo
        camera = [g for g in sinais_camera(res["soma"], res["canais"], res["dic"]) if g in labels]
        extra.update({
            "camera_signs": camera, "camera_min_heldout": MIN_ACERTO_CAMERA, "camera_min_channels": MIN_CANAIS,
            "camera_seeds": res["sementes"], "camera_folds": chave["grupos"],
            "heldout": {g: {"certas": v["trecho"][0], "total": v["trecho"][1], "canais": res["canais"].get(g, 0)}
                        for g, v in res["soma"].items()},
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
    for nome in ("avaliar", "camera", "treinar"):
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
    for nome in ("avaliar", "camera"):
        a = sub.choices[nome]
        a.add_argument("--landmarks", nargs="+", default=[os.path.join(DATA, "landmarks_sinais")],
                       help="pastas dos landmarks (os vídeos de --fontes-extra ficam em outra pasta)")
        a.add_argument("--fontes-extra", nargs="*", default=[],
                       help="outras listas no formato do fontes_sinais.json (canal dos vídeos novos)")
        a.add_argument("--rotulos", default=os.path.join(DATA, "rotulos_sinais"))
        a.add_argument("--grupos", type=int, default=GRUPOS_CAMERA)
        a.add_argument("--so-treino", nargs="*", default=[],
                       help="prefixos de canal sempre no treino e nunca no teste (ex.: ext- dos vídeos externos)")
        a.add_argument("--processos", type=int, default=4)
        a.add_argument("--salvar", default="")
    a = sub.choices["avaliar"]
    a.add_argument("--probs", default="", help="guarda as probabilidades (pickle) para o varrer")
    a.add_argument("--semente", type=int, default=0, help="divisão sorteada dos canais nos grupos")
    sub.choices["camera"].add_argument("--sementes", type=int, default=SEMENTES_CAMERA,
                                       help="divisões dos canais (0 a N-1) somadas para decidir camera_signs")
    t = sub.choices["treinar"]
    t.add_argument("--out", required=True)
    t.add_argument("--camera", default="", help="o --salvar do camera (decide camera_signs)")
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
    elif args.cmd == "camera":
        avaliar_camera(args)
    elif args.cmd == "varrer":
        varrer(args)
    elif args.cmd == "regras":
        aplicar_regras(args)
    else:
        treinar(args)


if __name__ == "__main__":
    main()
