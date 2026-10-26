"""
Modelo das letras com movimento (H, J, K, X, Y, Z e Ç do alfabeto manual) a partir dos trechos de
video/rotular_letras_mov.py e dos landmarks a 15 quadros por segundo de video/extrair_maos.py.

O modelo das letras paradas (train_static.py) olha um quadro só e lê a forma da mão. Aqui a
entrada é uma janela de JANELAS_S segundos: a forma da mão em cada momento e a trajetória do
pulso, sem o corpo (os vídeos do alfabeto não têm pose, e as letras só precisam saber como a mão
anda em relação a ela mesma). O app não carrega o modelo do corpo para as letras.

Entrada (contrato com apps/web-poc/src/recognition/letterMotion.ts; mudou aqui, muda lá, gera o
fixture com scripts/gerar-fixture-letras-mov.py e treina de novo):
1. Mão de cada quadro: a mais alta (menor y do pulso). Rótulo da janela: o rótulo do MediaPipe que
   mais aparece entre as mãos escolhidas nos quadros da janela (empate: o que apareceu primeiro).
   A janela inteira é espelhada por esse rótulo (mão esquerda da pessoa vira direita), como na
   normalize_hand.
2. Por quadro: presença, pulso (x * aspecto, y), palmo (distância 3D pulso -> base do médio, com
   x e z * aspecto) e os 65 da normalize_hand com o rótulo da janela.
3. Reamostragem em T quadros de t0 a t1: a presença é interpolada entre todos os quadros e
   arredondada em 0,5; o resto é interpolado só entre os quadros com mão (np.interp, fora do
   intervalo vale o primeiro ou o último). Passo sem mão fica todo zero.
4. Por passo (F = 69): [presença, pulso x e y menos a média dos passos com mão, divididos pelo
   palmo médio (x espelhado), log(palmo / palmo médio), 65 da normalize_hand].
5. Compacta em PASSOS passos espalhados (np.linspace(0, T - 1, PASSOS).round()), achatados.
Janela com mão em menos de MIN_PRESENCA dos quadros entre t0 e t1 não é avaliada.

Classes: as letras com movimento e "_" (nenhuma letra com movimento: letras paradas, transições,
mão parada). O model.json traz em camera_letters só as que acertam pelo menos MIN_ACERTO_CAMERA
nos canais separados mais o INES, somando SEMENTES_CAMERA treinos com sementes diferentes (o
exportado é o da semente 0): o app avalia pela câmera só essas.

Uso:
    python train_letras_mov.py avaliar [--grupos 5]   validação por canal (GroupKFold) no treino
                                                       e teste nos canais separados e no INES
    python train_letras_mov.py treinar --out out/letras-mov-v1    MLP do scikit-learn (o mesmo do
                                                       avaliar) no formato librax-mlp
    python train_letras_mov.py medir --modelo PASTA    mede um modelo exportado nos canais separados
                                                       e no INES (para comparar com o anterior)
    python train_letras_mov.py experimento --probs probs.pkl [--cv]   treina as SEMENTES_CAMERA sementes (e,
                                                       com --cv, a validação cruzada) e guarda as
                                                       probabilidades das janelas ao vivo
    python train_letras_mov.py varrer probs.pkl --min-movimento 0 0.3 [--max-p-nenhum 1 0.3]
                                                       mede regras de leitura sem treinar de novo
    (treinar aceita --min-p, --min-movimento e --max-p-nenhum: as regras de leitura do app, que vão
    para o reading_rules do model.json e decidem camera_letters)
    (LM_VIZINHAS=CPVT... põe as vizinhas paradas no "_" com peso, ver VIZINHAS)
    (LM_SEM_XZ=1 deixa de fora os vídeos de video/baixar_xz.py, letras_mov_trechos_xz.json)
    (LM_SEM_Z2=1 deixa de fora os de video/baixar_extra.py, letras_mov_trechos_z2.json)
    (LIBRAX_DATA=/caminho/data aponta para a pasta de dados)
"""

import argparse
import collections
import contextlib
import io
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from train_static import NORMALIZATION_VERSION, is_left_hand, normalize_hand  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "data")
LANDMARKS = os.path.join(DATA, "letras_mov", "landmarks15")
# Vídeos de video/baixar_xz.py (mais X e Z com o movimento à vista): landmarks e trechos à parte
LANDMARKS_XZ = os.path.join(DATA, "letras_mov", "landmarks15_xz")
TRECHOS = os.path.join(AQUI, "letras_mov_trechos.json")
TRECHOS_XZ = os.path.join(AQUI, "letras_mov_trechos_xz.json")
# Mais alfabetos de canais novos para o Z (video/baixar_extra.py, data/letras_mov/fontes_z2.json)
LANDMARKS_Z2 = os.path.join(DATA, "letras_mov", "landmarks15_z2")
TRECHOS_Z2 = os.path.join(AQUI, "letras_mov_trechos_z2.json")
# LM_SEM_Z2=1 deixa esses vídeos de fora (para comparar com o modelo anterior). Deles só entram o X e
# o Z (as folhas revisadas a olho, letras_mov_conferencia_z2.json); as outras letras ficam ok=false.
# 2026-10-26, soma de 8 sementes nos canais separados mais INES: só o Z (LM_Z2_LETRAS=Z), Z 40/56 e
# X 33/48; com o X e o Z, Z 39/56, X 36/48 e alarme nas paradas 73/792 (98/792 no modelo anterior)
SEM_Z2 = os.environ.get("LM_SEM_Z2") == "1"
LETRAS_Z2 = os.environ.get("LM_Z2_LETRAS", "XZ")
# LM_SEM_XZ=1 treina e avalia só com os trechos antigos (para comparar com o modelo anterior)
SEM_XZ = os.environ.get("LM_SEM_XZ") == "1"
# Letras dos trechos dos vídeos novos que entram no treino (as outras ficam marcadas ok=false: nem
# letra nem "_")
LETRAS_XZ = os.environ.get("LM_XZ_LETRAS", "HJKXZÇ")

# Contrato da janela (letterMotion.ts)
T = 24
PASSOS = 8
F = 69
JANELAS_S = (0.8, 1.2, 1.6)
MIN_PRESENCA = 0.6
MIN_P = 0.6  # mesmo limiar das letras paradas e dos sinais
NENHUMA = "_"
# O Y fica nas letras paradas: nos vídeos e na VLibras a mão não se mexe
LETRAS_MOV = ["H", "J", "K", "X", "Z", "Ç"]


# ---------------------------------------------------------------------------
# Janela (contrato com o app)
# ---------------------------------------------------------------------------

def palmo(lm, aspect):
    p = np.asarray(lm, dtype=np.float64).reshape(-1, 3)
    d = p[9] - p[0]
    return float(np.sqrt((d[0] * aspect) ** 2 + d[1] ** 2 + (d[2] * aspect) ** 2))


def mao_do_quadro(hands):
    """A mão mais alta do quadro (menor y do pulso), ou None."""
    if not hands:
        return None
    melhor = hands[0]
    for h in hands[1:]:
        if h["lm"][1] < melhor["lm"][1]:
            melhor = h
    return melhor


def rotulo_janela(frames, t0, t1):
    """Rótulo do MediaPipe que mais aparece entre as mãos escolhidas em [t0, t1] (empate: o primeiro)."""
    cont = {}
    for f in frames:
        if t0 <= f["t"] <= t1:
            h = mao_do_quadro(f["hands"])
            if h is not None:
                cont[h["h"]] = cont.get(h["h"], 0) + 1
    melhor, n = None, 0
    for k, c in cont.items():
        if c > n:
            melhor, n = k, c
    return melhor


def presenca(frames, t0, t1):
    """Fração dos quadros em [t0, t1] com mão (0 sem quadros)."""
    dentro = [f for f in frames if t0 <= f["t"] <= t1]
    if not dentro:
        return 0.0
    return sum(1 for f in dentro if f["hands"]) / len(dentro)


def janela(frames, aspect, t0, t1):
    """
    Janela [t0, t1] -> matriz [T, F] (ver o cabeçalho), ou None quando não dá para avaliar
    (mão em menos de MIN_PRESENCA dos quadros, ou nenhum quadro). `frames` em ordem de tempo; pode
    ter quadros fora da janela (entram na interpolação das pontas, como no app).
    """
    if presenca(frames, t0, t1) < MIN_PRESENCA:
        return None
    rotulo = rotulo_janela(frames, t0, t1)
    ts = np.array([f["t"] for f in frames], dtype=np.float64)
    pres = np.zeros(len(frames))
    cols = []
    tem = []
    for i, f in enumerate(frames):
        h = mao_do_quadro(f["hands"])
        if h is None:
            continue
        pres[i] = 1.0
        lm = h["lm"]
        cols.append(np.concatenate([[lm[0] * aspect, lm[1], palmo(lm, aspect)],
                                    normalize_hand(lm, rotulo, aspect)]))
        tem.append(i)
    alvo = np.linspace(t0, t1, T)
    p = (np.interp(alvo, ts, pres) >= 0.5).astype(np.float64)
    if not tem or p.sum() == 0:
        return None
    M = np.array(cols)
    tp = ts[tem]
    R = np.empty((T, M.shape[1]))
    for j in range(M.shape[1]):
        R[:, j] = np.interp(alvo, tp, M[:, j])
    ok = p > 0
    media = R[ok, :2].mean(axis=0)
    palmo_medio = max(float(R[ok, 2].mean()), 1e-6)
    sinal = -1.0 if is_left_hand(rotulo) else 1.0
    out = np.zeros((T, F))
    out[:, 0] = p
    out[:, 1] = sinal * (R[:, 0] - media[0]) / palmo_medio
    out[:, 2] = (R[:, 1] - media[1]) / palmo_medio
    out[:, 3] = np.log(np.maximum(R[:, 2], 1e-6) / palmo_medio)
    out[:, 4:] = R[:, 3:]
    out[~ok] = 0.0
    return out


def compactar(W):
    """[N, T, F] (ou [T, F]) -> [N, PASSOS * F] com PASSOS passos espalhados."""
    W = np.asarray(W)
    if W.ndim == 2:
        W = W[None]
    idx = np.linspace(0, W.shape[1] - 1, PASSOS).round().astype(int)
    return W[:, idx, :].reshape(len(W), -1).astype(np.float32)


# ---------------------------------------------------------------------------
# Dataset de janelas
# ---------------------------------------------------------------------------

# Janelas candidatas: fim a cada PASSO_S; duração sorteada perto das do app (velocidade diferente)
PASSO_S = 0.1
VARIA_DURACAO = 0.2
# Janela da letra: tem pelo menos esta fração da energia de movimento do trecho (e perto da melhor
# janela daquela duração); janela "_" não encosta em trecho de letra com movimento
MIN_COBERTURA = 0.5
PERTO_DA_MELHOR = 0.8
FOLGA_NEGATIVA_S = 0.2
# Parada da própria letra (mão segurando a forma, sem movimento): vira "_" por dentro
MARGEM_PARADA_S = 0.25
MAX_DENTRO_PARADA = float(os.environ.get("LM_MAX_DENTRO", "0.7"))
NEGATIVA_NA_PARADA = os.environ.get("LM_NEG_PARADA", "1") == "1"
NEGATIVAS_POR_VIDEO = 400
# Vizinhas paradas das letras com movimento (C do Ç, P, V e T do K, I do J, D do Z): com LM_VIZINHAS,
# as janelas que terminam na parada dessas letras (forma segurada, começo em região sem letra com
# movimento) entram todas como "_", a cada PASSO_S, fora do limite NEGATIVAS_POR_VIDEO e com
# LM_VAR_VIZINHAS variações giradas (as letras têm `variacoes`; o resto do "_", uma). Nos vídeos de
# uma letra parada dessas letras, as janelas também ganham as variações. Vazio desliga.
# CPVTUID desde 2026-10-25 (com MAX_NENHUMA 4): alarme nas paradas das letras paradas dos canais
# separados de 16,5% para 13,1% (16 sementes), K e X um pouco melhores. LM_VIZINHAS= desliga.
VIZINHAS = os.environ.get("LM_VIZINHAS", "CPVTUID")
VARIACOES_VIZINHAS = int(os.environ.get("LM_VAR_VIZINHAS", "2"))
# Rótulo interno das janelas de vizinhas (vira NENHUMA no janelas_do_video)
_VIZINHA = "_vizinha"
# Avaliação como no app (letterMotion.ts): a cada AVALIA_S, janelas que terminam ali; leitura
# confirmada com CONFIRMA leituras seguidas iguais
AVALIA_S = 0.25
BUFFER_S = 2.0
CONFIRMA = 2
INES_CANAL = "ines"
# Processos do montar e das janelas ao vivo (LM_PROCESSOS; menos quando a máquina está ocupada)
PROCESSOS = int(os.environ.get("LM_PROCESSOS", "6"))


def carregar_trechos(caminho=TRECHOS):
    """
    Trechos do letras_mov_trechos.json somados aos de letras_mov_trechos_xz.json (sem LM_SEM_XZ=1) e
    aos de letras_mov_trechos_z2.json (sem LM_SEM_Z2=1).
    """
    with open(caminho) as f:
        out = json.load(f)
    extras = [] if caminho != TRECHOS else [(p, letras) for p, fora, letras in
                                             ((TRECHOS_XZ, SEM_XZ, LETRAS_XZ), (TRECHOS_Z2, SEM_Z2, LETRAS_Z2))
                                             if not fora and os.path.exists(p)]
    for path, letras in extras:
        with open(path) as f:
            extra = json.load(f)
        out["trechos"] = out["trechos"] + [t if t["letra"] in letras else {**t, "ok": False}
                                           for t in extra["trechos"]]
        out["videos"] = out["videos"] + extra["videos"]
    return out


def landmarks_de(vid):
    """Arquivo de landmarks a 15 quadros por segundo do vídeo (landmarks15, _xz ou _z2), ou None."""
    for pasta in (LANDMARKS, LANDMARKS_XZ, LANDMARKS_Z2):
        path = os.path.join(pasta, f"{vid}.json")
        if os.path.exists(path):
            return path
    return None


def carregar_video(vid):
    with open(landmarks_de(vid)) as f:
        return json.load(f)


def canais_teste():
    """Canais que nunca entram no treino: os do teste fixo das letras paradas e o INES."""
    from teste_fixo import canais_do_teste

    return canais_do_teste() | {INES_CANAL}


def energia_quadros(frames, aspect):
    """Energia de movimento do intervalo que termina em cada quadro (como no rotular_letras_mov)."""
    es = np.zeros(len(frames))
    ant = None
    for i, f in enumerate(frames):
        h = mao_do_quadro(f["hands"])
        if h is None:
            ant = None
            continue
        x = normalize_hand(h["lm"], h["h"], aspect)
        w = np.array([h["lm"][0] * aspect, h["lm"][1]])
        p = max(palmo(h["lm"], aspect), 1e-6)
        if ant is not None:
            w0, p0, x0 = ant
            es[i] = (np.linalg.norm(w - w0) / ((p + p0) / 2)
                     + float(np.arccos(np.clip(np.dot(x[63:65], x0[63:65]), -1, 1)))
                     + np.linalg.norm(x[:63] - x0[:63]) / np.sqrt(21))
        ant = (w, p, x)
    return es


def regioes_seguras(video, seq="ABCÇDEFGHIJKLMNOPQRSTUVWXYZ"):
    """
    Intervalos sem letra com movimento num vídeo do alfabeto: cada parada de letra parada e o vão
    até a próxima quando as letras entre as duas na sequência também são paradas.
    """
    ps = sorted(video["paradas"], key=lambda p: p["ini"])
    out = []
    for i, p in enumerate(ps):
        a, b = p["ini"], p["fim"]
        if i + 1 < len(ps):
            q = ps[i + 1]
            ia, ib = seq.index(p["letra"]), seq.index(q["letra"])
            if ib > ia and not any(L in LETRAS_MOV for L in seq[ia + 1:ib]):
                b = q["ini"]
        if out and a <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def girar_maos(frames, aspect, rng, max_deg=(20, 20, 12)):
    """Cópia dos quadros com as mãos giradas em 3D (o mesmo giro na janela toda) e alguns quadros a menos."""
    from train_static import rotate_raw

    yaw, pitch, roll = rng.uniform(-np.radians(max_deg), np.radians(max_deg))
    fica = rng.uniform(0.55, 1.0)
    out = []
    for f in frames:
        if out and rng.random() > fica:
            continue
        out.append({"t": f["t"], "hands": [{"h": h["h"], "lm": rotate_raw(h["lm"], aspect, yaw, pitch, roll).tolist()}
                                           for h in f["hands"]]})
    return out


def pedidos_do_video(video, trechos_video, frames, aspect, rng, treino):
    """Janelas (t0, t1, rótulo) de um vídeo. Ver as regras no começo desta seção."""
    ts = np.array([f["t"] for f in frames])
    cum = np.concatenate([[0.0], np.cumsum(energia_quadros(frames, aspect))])

    def en(a, b):
        i0, i1 = np.searchsorted(ts, a, side="right"), np.searchsorted(ts, b, side="right")
        return cum[i1] - cum[i0]

    pedidos = []
    for tr in trechos_video:
        a, b = tr["ini"], tr["fim"]
        total = max(en(a, b), 1e-6)
        parada = tr.get("parada")
        pa, pb = (parada[0] + MARGEM_PARADA_S, parada[1] - MARGEM_PARADA_S) if parada else (0.0, 0.0)
        for D in JANELAS_S:
            cands = []
            te = a + 0.3
            while te <= b + D:
                d = D * (1 + rng.uniform(-VARIA_DURACAO, VARIA_DURACAO)) if treino else D
                t0 = te - d
                cov = en(max(t0, a), min(te, b)) / total
                na_parada = max(0.0, min(te, pb) - max(t0, pa)) / d if pb > pa else 0.0
                cands.append((t0, te, cov, na_parada))
                te += PASSO_S
            melhor = max((c[2] for c in cands), default=0.0)
            if melhor < MIN_COBERTURA:
                continue
            for t0, t1, cov, na_parada in cands:
                if cov >= max(MIN_COBERTURA, PERTO_DA_MELHOR * melhor) and na_parada <= MAX_DENTRO_PARADA:
                    pedidos.append((t0, t1, tr["letra"]))
        # dentro da parada da própria letra (forma parada, sem movimento): "_"
        if NEGATIVA_NA_PARADA and pb > pa:
            for D in JANELAS_S:
                te = pa + D
                while te <= pb:
                    pedidos.append((te - D, te, NENHUMA))
                    te += 2 * PASSO_S

    if video.get("fonte") == "alfabeto":
        moveis = [(t["ini"] - FOLGA_NEGATIVA_S, t["fim"] + FOLGA_NEGATIVA_S) for t in video.get("_todos_trechos", [])]
        negs = []
        for r0, r1 in regioes_seguras(video):
            for D in JANELAS_S:
                te = r0 + D
                while te <= r1:
                    if not any(te - D < m1 and te > m0 for m0, m1 in moveis):
                        negs.append((te - D, te, NENHUMA))
                    te += 2 * PASSO_S
        if treino and len(negs) > NEGATIVAS_POR_VIDEO:
            negs = [negs[i] for i in sorted(rng.choice(len(negs), NEGATIVAS_POR_VIDEO, replace=False))]
        pedidos += negs
        if treino and VIZINHAS:
            seguras = regioes_seguras(video)
            for p in video["paradas"]:
                if p["letra"] not in VIZINHAS:
                    continue
                r0 = next((a for a, b in seguras if a <= p["ini"] <= b), p["ini"])
                for D in JANELAS_S:
                    te = max(p["ini"] + 0.2, r0 + D)
                    while te <= p["fim"]:
                        if not any(te - D < m1 and te > m0 for m0, m1 in moveis):
                            pedidos.append((te - D, te, _VIZINHA))
                        te += PASSO_S
    elif video.get("fonte") == "letra-parada":
        # vídeo de uma letra parada: a mão sobe, faz a letra e desce
        vizinha = treino and VIZINHAS and video.get("letra") and video["letra"] in VIZINHAS
        rotulo = _VIZINHA if vizinha else NENHUMA
        for r0, r1 in video["regioes"]:
            for D in JANELAS_S:
                te = r0 + D
                while te <= r1:
                    pedidos.append((te - D, te, rotulo))
                    te += 2 * PASSO_S
    return pedidos


def janelas_do_video(video, trechos_video, frames, aspect, rng, variacoes, treino):
    """(lista de [T, F], rótulos) das janelas de um vídeo, com as variações de treino."""
    X, y = [], []
    ts = np.array([f["t"] for f in frames])
    for t0, t1, L in pedidos_do_video(video, trechos_video, frames, aspect, rng, treino):
        i0, i1 = np.searchsorted(ts, t1 - BUFFER_S - 0.2), np.searchsorted(ts, t1 + 0.2, side="right")
        perto = frames[i0:i1]
        n_var = variacoes if L != NENHUMA else min(variacoes, 1)
        if L == _VIZINHA:
            L, n_var = NENHUMA, VARIACOES_VIZINHAS
        for fr in [perto] + [girar_maos(perto, aspect, rng) for _ in range(n_var if treino else 0)]:
            w = janela(fr, aspect, t0, t1)
            if w is not None:
                X.append(w)
                y.append(L)
    return X, y


def _janelas_job(args):
    v, trs, variacoes, treino, seed = args
    dados = carregar_video(v["id"])
    Xv, yv = janelas_do_video(v, trs, dados["frames"], dados["aspect"], np.random.default_rng(seed), variacoes, treino)
    return v["id"], np.array(Xv, dtype=np.float32).reshape(-1, T, F), np.array(yv)


def montar(trechos, ids=None, treino=True, variacoes=2, seed=0, processos=None):
    """Janelas de todos os vídeos (ou só de `ids`): X [N, T, F], y, canal e vídeo."""
    from multiprocessing import Pool

    por_video = collections.defaultdict(list)
    todos = collections.defaultdict(list)
    for t in trechos["trechos"]:
        todos[t["id"]].append(t)
        if t["ok"] and t["letra"] in LETRAS_MOV:
            por_video[t["id"]].append(t)
    jobs = []
    for i, v in enumerate(trechos["videos"]):
        if ids is not None and v["id"] not in ids:
            continue
        if not landmarks_de(v["id"]):
            continue
        # semente por vídeo: o resultado não depende da ordem nem de quantos processos
        jobs.append(({**v, "_todos_trechos": todos[v["id"]]}, por_video[v["id"]], variacoes, treino, seed * 1000 + i))
    canal_de = {v["id"]: v["channel_id"] for v in trechos["videos"]}
    with Pool(processos or PROCESSOS) as pool:
        partes = pool.map(_janelas_job, jobs)
    X = np.concatenate([p[1] for p in partes]) if partes else np.zeros((0, T, F), np.float32)
    y = np.concatenate([p[2] for p in partes]) if partes else np.array([])
    video = np.concatenate([[p[0]] * len(p[2]) for p in partes]) if partes else np.array([])
    canal = np.array([canal_de[v] for v in video])
    return X, y.astype(str), canal, video.astype(str)


def preparar_ao_vivo(ids, processos=None):
    """Calcula (e guarda) as janelas ao vivo dos vídeos, em paralelo."""
    from multiprocessing import Pool

    with Pool(processos or PROCESSOS) as pool:
        pool.map(_ao_vivo_job, sorted(ids))


def _ao_vivo_job(vid):
    janelas_ao_vivo_cache(vid)
    return vid


# ---------------------------------------------------------------------------
# Avaliação como no app
# ---------------------------------------------------------------------------

def janelas_ao_vivo(frames, aspect):
    """
    As janelas que o app avalia num vídeo: a cada AVALIA_S, as de JANELAS_S que terminam no quadro
    mais recente, com o buffer de BUFFER_S. Devolve (tempos, janelas [n, T, F], dono de cada janela).
    """
    ts = np.array([f["t"] for f in frames])
    tempos, wins, donos = [], [], []
    if len(ts) == 0:
        return np.array(tempos), np.zeros((0, T, F), np.float32), np.array(donos, dtype=int)
    te = ts[0] + AVALIA_S
    while te <= ts[-1] + 1e-9:
        # o buffer do app: os quadros dos últimos BUFFER_S segundos antes do quadro mais recente
        i1 = np.searchsorted(ts, te, side="right")
        i0 = np.searchsorted(ts, ts[i1 - 1] - BUFFER_S) if i1 else 0
        buf = frames[i0:i1]
        tempos.append(te)
        if len(buf) >= 2:
            span = buf[-1]["t"] - buf[0]["t"]
            tend = buf[-1]["t"]
            for D in JANELAS_S:
                if span < D * 0.9:
                    continue
                w = janela(buf, aspect, tend - D, tend)
                if w is not None:
                    wins.append(w)
                    donos.append(len(tempos) - 1)
        te += AVALIA_S
    W = np.array(wins, dtype=np.float32) if wins else np.zeros((0, T, F), np.float32)
    return np.array(tempos), W, np.array(donos, dtype=int)


_CACHE_AO_VIVO = {}


def janelas_ao_vivo_cache(vid):
    """janelas_ao_vivo de um vídeo, guardadas em data/letras_mov/cache (não dependem do modelo)."""
    if vid in _CACHE_AO_VIVO:
        return _CACHE_AO_VIVO[vid]
    chave = f"T{T}F{F}J{'-'.join(map(str, JANELAS_S))}P{MIN_PRESENCA}B{BUFFER_S}A{AVALIA_S}"
    pasta = os.path.join(DATA, "letras_mov", "cache")
    path = os.path.join(pasta, f"aovivo-{vid}-{chave}.npz")
    if os.path.exists(path):
        d = np.load(path)
        out = (d["tempos"], d["W"], d["donos"])
    else:
        dados = carregar_video(vid)
        out = janelas_ao_vivo(dados["frames"], dados["aspect"])
        os.makedirs(pasta, exist_ok=True)
        np.savez_compressed(path, tempos=out[0], W=out[1], donos=out[2])
    _CACHE_AO_VIVO[vid] = out
    return out


def movimento(Xc):
    """
    Quanto a mão se mexe em cada janela compactada [N, PASSOS * F] (a entrada do modelo): entre dois
    passos quaisquer com a mão, a distância do pulso (em palmos, as colunas 1 e 2) mais PESO_FORMA
    vezes a distância dos 65 da normalize_hand dividida por raiz de 21 (os dedos em relação ao
    pulso, em palmos, e a direção da mão); vale o maior valor. Janela com a mão em menos de dois
    passos vale 0. Contrato com o letterMotion.ts (letterWindowMotion).
    """
    C = np.asarray(Xc, dtype=np.float64).reshape(len(Xc), PASSOS, -1)
    tem = C[:, :, 0] > 0.5
    w = C[:, :, 1:3]
    h = C[:, :, 4:]
    dw = np.sqrt(((w[:, :, None] - w[:, None]) ** 2).sum(-1))
    dh = np.sqrt(((h[:, :, None] - h[:, None]) ** 2).sum(-1)) / np.sqrt(21)
    par = tem[:, :, None] & tem[:, None]
    return np.where(par, dw + PESO_FORMA * dh, 0.0).max((1, 2))


def guardar(prever):
    """Marca o prever para guardar as probabilidades de cada vídeo (varrer as regras sem prever de novo)."""
    prever.guardadas = {}
    return prever


def probs_ao_vivo(vid, prever):
    """Probabilidades e movimento de todas as janelas que o app avalia num vídeo (não dependem das regras)."""
    guardadas = getattr(prever, "guardadas", None)
    if guardadas is not None and vid in guardadas:
        return guardadas[vid]
    tempos, W, donos = janelas_ao_vivo_cache(vid)
    if len(W):
        Xc = compactar(W)
        labels, P = prever(Xc)
        E = movimento(Xc)
    else:
        labels, P, E = [], np.zeros((0, 0)), np.zeros(0)
    pv = {"tempos": tempos, "donos": donos, "labels": [str(x) for x in labels], "P": np.asarray(P, np.float32),
          "E": np.asarray(E, np.float32)}
    if guardadas is not None:
        guardadas[vid] = pv
    return pv


def leituras(vid, prever, regras=None):
    """
    Simula o app num vídeo: em cada avaliação, a leitura (letra mais provável de alguma janela, não
    "_", com p >= min_p, movimento >= min_movimento e p("_") <= max_p_nenhum; vale a de maior p) e a
    confirmada (CONFIRMA leituras seguidas iguais). Devolve [(t, lida, confirmada)]. `prever`:
    [n, PASSOS * F] -> (rótulos, probabilidades). `regras`: as do app (REGRAS sem elas).
    """
    regras = regras or REGRAS
    pv = probs_ao_vivo(vid, prever)
    tempos, donos, labels, P, E = pv["tempos"], pv["donos"], pv["labels"], pv["P"], pv["E"]
    lidas = [None] * len(tempos)
    melhor_p = [0.0] * len(tempos)
    if len(P):
        nenhuma = labels.index(NENHUMA)
        j = P.argmax(1)
        ok = ((np.asarray(labels)[j] != NENHUMA) & (P[np.arange(len(P)), j] >= regras["min_p"])
              & (E >= regras["min_movimento"]) & (P[:, nenhuma] <= regras["max_p_nenhum"]))
        for k, jj, p in zip(donos[ok], j[ok], P[ok]):
            if p[jj] > melhor_p[k]:
                lidas[k], melhor_p[k] = labels[jj], float(p[jj])
    out, ant, n = [], None, 0
    for t, L in zip(tempos, lidas):
        n = n + 1 if (L is not None and L == ant) else (1 if L is not None else 0)
        ant = L
        out.append((float(t), L, L if n >= CONFIRMA else None))
    return out


def medir_video(video, trechos_video, prever, regras=None):
    """Acertos por trecho e alarmes falsos nas paradas das letras paradas (e na parada da própria letra)."""
    lido = leituras(video["id"], prever, regras)
    res = {"trechos": [], "paradas": [], "propria": []}
    maxD = max(JANELAS_S)
    for tr in trechos_video:
        conf = [L for t, _, L in lido if tr["ini"] <= t <= tr["fim"] + 0.75 and L]
        res["trechos"].append((tr["letra"], conf[0] if conf else None, tr["letra"] in conf))
        parada = tr.get("parada")
        if parada:
            pa, pb = parada[0] + MARGEM_PARADA_S, parada[1] - MARGEM_PARADA_S
            janelas = [L for t, _, L in lido if pa + maxD <= t <= pb]
            if janelas:
                res["propria"].append((tr["letra"], tr["letra"] in janelas))
    if video.get("fonte") == "alfabeto":
        moveis = [(t["ini"] - FOLGA_NEGATIVA_S, t["fim"] + FOLGA_NEGATIVA_S) for t in video.get("_todos_trechos", [])]
        seguras = regioes_seguras(video)
        for p in video["paradas"]:
            # só as avaliações em que a janela mais longa fica toda em região sem letra com movimento
            avaliadas = [L for t, _, L in lido if p["ini"] <= t <= p["fim"]
                         and any(r0 <= t - maxD and t <= r1 for r0, r1 in seguras)
                         and not any(t - maxD < m1 and t > m0 for m0, m1 in moveis)]
            if avaliadas:
                alarmes = [L for L in avaliadas if L]
                res["paradas"].append((p["letra"], alarmes[0] if alarmes else None, "alfabeto"))
    elif video.get("fonte") == "letra-parada":
        for r0, r1 in video["regioes"]:
            alarmes = [L for t, _, L in lido if r0 <= t <= r1 and L]
            res["paradas"].append((video["letra"], alarmes[0] if alarmes else None, "video"))
    return res


def resumo(resultados, titulo):
    """Imprime acerto por letra, trocas e alarmes falsos."""
    por = collections.defaultdict(lambda: [0, 0])
    trocas = collections.Counter()
    for r in resultados:
        for L, primeira, acertou in r["trechos"]:
            por[L][1] += 1
            por[L][0] += acertou
            if not acertou:
                trocas[(L, primeira or "nada")] += 1
    paradas = [x[:2] for r in resultados for x in r["paradas"] if x[2] == "alfabeto"]
    alarmes = [x for x in paradas if x[1]]
    videos_parados = [x[:2] for r in resultados for x in r["paradas"] if x[2] == "video"]
    alarmes_videos = [x for x in videos_parados if x[1]]
    propria = [x for r in resultados for x in r["propria"]]
    n = sum(v[1] for v in por.values())
    print(f"== {titulo}")
    print(f"letras com movimento certas: {sum(v[0] for v in por.values())}/{n} "
          f"({sum(v[0] for v in por.values()) / max(n, 1):.1%})")
    print("por letra:", " ".join(f"{L}:{por[L][0]}/{por[L][1]}" for L in LETRAS_MOV if por[L][1]))
    print("trocas:", " ".join(f"{a}->{b}:{c}" for (a, b), c in trocas.most_common(10)) or "nenhuma")
    print(f"alarme falso (parada de letra parada lida como letra com movimento): {len(alarmes)}/{len(paradas)} "
          f"({len(alarmes) / max(len(paradas), 1):.1%})",
          " ".join(f"{a}->{b}:{c}" for (a, b), c in collections.Counter(alarmes).most_common(8)))
    if videos_parados:
        print(f"alarme falso em vídeos de uma letra parada (a mão sobe, faz a letra e desce): "
              f"{len(alarmes_videos)}/{len(videos_parados)} ({len(alarmes_videos) / len(videos_parados):.1%})",
              " ".join(f"{a}->{b}:{c}" for (a, b), c in collections.Counter(alarmes_videos).most_common(8)))
    if propria:
        print(f"forma parada da própria letra (sem o movimento) lida como a letra: "
              f"{sum(x[1] for x in propria)}/{len(propria)}")
    return {L: (v[0], v[1]) for L, v in por.items()}, (len(alarmes), len(paradas))


def medir_ines(trechos, prever, regras=None, imprime=True):
    """Verbetes do INES: a letra com movimento lida no verbete; nas letras paradas, qualquer leitura é alarme."""
    linhas = []
    for x in trechos.get("ines", []):
        lido = leituras(x["id"], prever, regras)
        conf = [L for _, _, L in lido if L]
        lidas = [L for _, L, _ in lido if L]
        if x["letra"] in LETRAS_MOV:
            linhas.append((x["letra"], "certa" if x["letra"] in conf else f"leu {conf[0] if conf else 'nada'}", lidas))
        else:
            linhas.append((x["letra"], f"alarme {conf[0]}" if conf else "sem alarme", lidas))
    if imprime:
        print("== INES (uma pessoa, fora do YouTube)")
        for L, r, lidas in linhas:
            print(f"  {L}: {r}  (leituras: {' '.join(lidas) or '-'})")
    return linhas


# ---------------------------------------------------------------------------
# Modelo
# ---------------------------------------------------------------------------

# Regras de leitura do app (letterMotion.ts, no model.json): limiar, portão de movimento (janela que
# se mexe menos que min_movimento não é lida; 0 desliga, ver movimento()) e teto do "_" (sem leitura
# quando p("_") passa de max_p_nenhum; 1 desliga). Limiar 0,7 e portão 0,3 desde 2026-10-25: com as
# vizinhas, o alarme nas paradas das letras paradas volta a cerca de 12% (o nível de antes dos
# vídeos do X e do Z) sem tirar letra da câmera. O MIN_P (0,6) fica como o limiar sem reading_rules.
PESO_FORMA = 1.0
MIN_P_LEITURA = 0.7
MIN_MOVIMENTO = 0.3
REGRAS = {"min_p": MIN_P_LEITURA, "min_movimento": MIN_MOVIMENTO, "max_p_nenhum": 1.0}

# MLP: camadas ocultas, regularização L2 e "_" no treino (vezes a soma das letras)
OCULTAS = (128, 64)
ALPHA = 1e-2
# 4 (antes 2) junto com as vizinhas: o "_" tem bem mais janelas que isso, e mais delas no treino
# tiram alarmes sem perder letra (sozinho, sem as vizinhas, não ajudou: 118/792 contra 128/792)
MAX_NENHUMA = 4.0
# Letra com movimento só ganha câmera no app com pelo menos esta fração certa nos canais separados
# mais o INES (e pelo menos MIN_TESTE trechos); as outras ficam no modelo (para não virarem outra
# letra) mas fora de camera_letters
MIN_ACERTO_CAMERA = 0.7
MIN_TESTE = 3
# A decisão da câmera soma os acertos de SEMENTES_CAMERA treinos iguais com sementes diferentes (o
# exportado é o da semente 0): com 6 ou 7 trechos por letra no teste, um trecho a mais ou a menos
# muda 15 pontos, e só a semente já fazia o X ir de 4/6 a 6/6 e o Z de 4/7 a 6/7 (2026-10-25)
SEMENTES_CAMERA = 8


def equilibrar(X, y, rng, max_nenhuma=MAX_NENHUMA):
    """Repete as janelas das letras até cada letra ter a média delas; "_" fica com até max_nenhuma x as letras."""
    idx = {c: np.where(y == c)[0] for c in set(y)}
    letras = [c for c in idx if c != NENHUMA]
    alvo = int(np.mean([len(idx[c]) for c in letras])) if letras else 0
    pega = []
    for c in letras:
        pega.append(rng.choice(idx[c], max(alvo, len(idx[c])), replace=len(idx[c]) < alvo))
    if NENHUMA in idx:
        n = min(len(idx[NENHUMA]), int(max_nenhuma * alvo * len(letras)))
        pega.append(rng.choice(idx[NENHUMA], n, replace=False))
    pega = np.concatenate(pega)
    return X[pega], y[pega]


def ajustar_sklearn(X, y, seed=0, ocultas=OCULTAS, alpha=ALPHA, max_nenhuma=MAX_NENHUMA):
    """MLP do scikit-learn (o da validação cruzada e o exportado). Devolve prever(Xc), com .modelo."""
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    rng = np.random.default_rng(seed)
    Xb, yb = equilibrar(compactar(X), y, rng, max_nenhuma)
    sc = StandardScaler().fit(Xb)
    m = MLPClassifier(ocultas, alpha=alpha, max_iter=200, early_stopping=True, random_state=seed)
    m.fit(sc.transform(Xb), yb)
    labels = list(m.classes_)

    def prever(Xc):
        return labels, m.predict_proba(sc.transform(Xc))

    prever.modelo = (m, sc)
    return prever


def camadas_sklearn(m, sc):
    """
    Camadas no formato do mlp.ts a partir do MLPClassifier, com a padronização dentro da primeira
    camada (o app passa a janela crua): ReLU nas ocultas e softmax na saída.
    """
    escala = np.where(sc.scale_ > 0, sc.scale_, 1.0)
    layers = []
    for i, (k, b) in enumerate(zip(m.coefs_, m.intercepts_)):
        if i == 0:
            k, b = k / escala[:, None], b - (sc.mean_ / escala) @ k
        layers.append((k, b, "softmax" if i == len(m.coefs_) - 1 else "relu"))
    return layers


def prever_camadas(layers, labels):
    from train_static import mlp_forward

    def prever(Xc):
        return labels, mlp_forward(layers, Xc)

    return prever


def videos_por_canal(trechos):
    out = collections.defaultdict(list)
    for v in trechos["videos"]:
        if landmarks_de(v["id"]):
            out[v["channel_id"]].append(v["id"])
    return out


def medir_videos(trechos, ids, prever, regras=None):
    por_video = collections.defaultdict(list)
    todos = collections.defaultdict(list)
    for t in trechos["trechos"]:
        todos[t["id"]].append(t)
        if t["ok"] and t["letra"] in LETRAS_MOV:
            por_video[t["id"]].append(t)
    out = []
    for v in trechos["videos"]:
        if v["id"] not in ids:
            continue
        out.append(medir_video({**v, "_todos_trechos": todos[v["id"]]}, por_video[v["id"]], prever, regras))
    return out


def montar_cache(trechos, ids, variacoes):
    """montar() do treino, guardado em data/letras_mov/cache pelo conteúdo dos trechos e das regras."""
    import hashlib

    regras = [T, F, JANELAS_S, MIN_PRESENCA, PASSO_S, VARIA_DURACAO, MIN_COBERTURA, PERTO_DA_MELHOR,
              FOLGA_NEGATIVA_S, MARGEM_PARADA_S, MAX_DENTRO_PARADA, NEGATIVA_NA_PARADA, NEGATIVAS_POR_VIDEO, BUFFER_S, variacoes,
              sorted(ids), LETRAS_MOV]
    if VIZINHAS:
        # só entra na chave quando ligado: o cache de antes continua valendo
        regras += [VIZINHAS, VARIACOES_VIZINHAS]
    chave = hashlib.sha1((json.dumps(trechos, sort_keys=True) + json.dumps(regras)).encode()).hexdigest()[:16]
    path = os.path.join(DATA, "letras_mov", "cache", f"treino-{chave}.npz")
    if os.path.exists(path):
        d = np.load(path)
        return d["X"], d["y"].astype(str), d["canal"].astype(str), d["video"].astype(str)
    X, y, canal, video = montar(trechos, ids, treino=True, variacoes=variacoes)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    np.savez_compressed(path, X=X, y=y, canal=canal, video=video)
    return X, y, canal, video


def separar(trechos):
    teste = canais_teste()
    canais = videos_por_canal(trechos)
    treino_ids = {vid for c, vids in canais.items() if c not in teste for vid in vids}
    teste_ids = {vid for c, vids in canais.items() if c in teste for vid in vids}
    return treino_ids, teste_ids


def avaliar(grupos, variacoes, **modelo):
    from sklearn.model_selection import GroupKFold

    trechos = carregar_trechos()
    treino_ids, teste_ids = separar(trechos)
    preparar_ao_vivo(treino_ids | teste_ids | {x["id"] for x in trechos.get("ines", [])})
    X, y, canal, video = montar_cache(trechos, treino_ids, variacoes)
    print(f"janelas de treino: {len(y)} ({collections.Counter(y).most_common()}) em {len(set(canal))} canais")

    # Validação cruzada por canal: cada grupo de canais é medido como no app pelo modelo dos outros
    resultados = []
    gk = GroupKFold(grupos)
    for k, (tr, te) in enumerate(gk.split(X, y, canal)):
        prever = ajustar_sklearn(X[tr], y[tr], seed=k, **modelo)
        ids = set(video[te]) & treino_ids
        resultados += medir_videos(trechos, ids, prever)
    resumo(resultados, f"validação cruzada por canal ({grupos} grupos, {len(set(canal))} canais)")

    # Canais separados (teste fixo das letras paradas) e INES, com o modelo de todos os canais de treino
    prever = ajustar_sklearn(X, y, **modelo)
    resumo(medir_videos(trechos, teste_ids, prever), f"canais separados ({len(teste_ids)} vídeos)")
    medir_ines(trechos, prever)


def regras_json(regras):
    """Regras de leitura no formato do model.json (reading_rules, readingRules.ts do app)."""
    return {"min_probability": regras["min_p"], "min_motion": regras["min_movimento"],
            "motion_shape_weight": PESO_FORMA, "max_none_probability": regras["max_p_nenhum"]}


def treinar(out, variacoes, sementes=SEMENTES_CAMERA, regras=None):
    """Exporta o modelo da semente 0; camera_letters e as medidas saem das regras de leitura `regras`."""
    regras = regras or REGRAS
    from train_static import export_web

    trechos = carregar_trechos()
    treino_ids, teste_ids = separar(trechos)
    preparar_ao_vivo(teste_ids | {x["id"] for x in trechos.get("ines", [])})
    X, y, canal, _ = montar_cache(trechos, treino_ids, variacoes)
    # O mesmo MLP do scikit-learn da validação cruzada (avaliar), exportado com os pesos em float32
    ajustado = ajustar_sklearn(X, y)
    m, sc = ajustado.modelo
    labels = [str(c) for c in m.classes_]
    layers = [(k.astype(np.float32), b.astype(np.float32), a) for k, b, a in camadas_sklearn(m, sc)]
    Xc = compactar(X)
    amostra = Xc[np.linspace(0, len(Xc) - 1, 200).round().astype(int)]
    diff = np.abs(prever_camadas(layers, labels)(amostra)[1] - ajustado(amostra)[1]).max()
    print(f"diferença máxima camadas exportadas x scikit-learn: {diff:.2e}")
    if diff >= 1e-4:
        raise SystemExit("as camadas exportadas não batem com o scikit-learn")
    prever = prever_camadas(layers, labels)
    print(f"regras de leitura: {regras}")
    por_letra, (alarmes, paradas) = resumo(medir_videos(trechos, teste_ids, prever, regras),
                                           "canais separados (modelo exportado)")
    ines = medir_ines(trechos, prever, regras)

    def com_ines(por, linhas):
        out = {L: [a, b] for L, (a, b) in por.items()}
        for L, r, _ in linhas:
            if L in LETRAS_MOV:
                out.setdefault(L, [0, 0])
                out[L][0] += r == "certa"
                out[L][1] += 1
        return out

    teste = com_ines(por_letra, ines)
    print("canais separados + INES (modelo exportado):", " ".join(f"{L}:{a}/{b}" for L, (a, b) in sorted(teste.items())))
    # Soma de SEMENTES_CAMERA treinos (a semente 0 é o exportado)
    soma = {L: list(v) for L, v in teste.items()}
    soma_alarmes = [alarmes, paradas]
    for semente in range(1, sementes):
        outro = ajustar_sklearn(X, y, seed=semente)
        with contextlib.redirect_stdout(io.StringIO()):
            por_s, (al_s, par_s) = resumo(medir_videos(trechos, teste_ids, outro, regras), "")
            ines_s = medir_ines(trechos, outro, regras)
        t_s = com_ines(por_s, ines_s)
        print(f"semente {semente}:", " ".join(f"{L}:{a}/{b}" for L, (a, b) in sorted(t_s.items())), f"alarmes {al_s}/{par_s}",
              flush=True)
        for L, (a, b) in t_s.items():
            soma.setdefault(L, [0, 0])
            soma[L][0] += a
            soma[L][1] += b
        soma_alarmes[0] += al_s
        soma_alarmes[1] += par_s
    camera = [L for L in labels if L in soma and soma[L][1] >= MIN_TESTE * sementes
              and soma[L][0] / soma[L][1] >= MIN_ACERTO_CAMERA]
    print(f"canais separados + INES, soma de {sementes} sementes:",
          " ".join(f"{L}:{a}/{b} ({a / b:.0%})" for L, (a, b) in sorted(soma.items())),
          f"alarmes {soma_alarmes[0]}/{soma_alarmes[1]} | câmera: {' '.join(camera) or 'nenhuma'}")
    export_web(out, layers, labels, [], extra={
        "kind": "letras-mov", "frames": PASSOS, "features_per_frame": F, "window_frames": T,
        "windows_s": list(JANELAS_S), "min_presence": MIN_PRESENCA, "channels": int(len(set(canal))),
        "heldout": {L: {"certas": a, "total": b} for L, (a, b) in sorted(por_letra.items())},
        "heldout_false_alarms": {"alarmes": alarmes, "paradas": paradas},
        "ines": {L: r for L, r, _ in ines},
        "source": "scikit-learn",
        "reading_rules": regras_json(regras),
        "camera_letters": camera,
        "camera_min_heldout": MIN_ACERTO_CAMERA,
        "camera_seeds": sementes,
        "heldout_ines_seeds": {L: {"certas": a, "total": b} for L, (a, b) in sorted(soma.items())},
        "heldout_false_alarms_seeds": {"alarmes": soma_alarmes[0], "paradas": soma_alarmes[1]},
    })
    # vetores dourados: janelas de verdade (entrada compactada) e o softmax do scikit-learn
    picks = np.linspace(0, len(Xc) - 1, min(12, len(Xc))).round().astype(int)
    with open(os.path.join(out, "golden.json"), "w") as f:
        json.dump({"labels": labels, "cases": [
            {"input": [round(float(v), 6) for v in Xc[i]],
             "probs": [float(v) for v in ajustado(np.round(Xc[i:i + 1].astype(np.float64), 6))[1][0]]}
            for i in picks]}, f)
    print(f"modelo em {out} ({', '.join(labels)})")


def medir_sementes(trechos, teste_ids, prevs, regras=None):
    """
    Soma, nos treinos `prevs` (sementes diferentes), o acerto por letra nos canais separados mais o
    INES, os alarmes nas paradas das letras paradas e os alarmes do INES nas letras paradas.
    """
    soma, alarmes, paradas, ines_alarmes, ines_paradas = {}, 0, 0, collections.Counter(), 0
    for prever in prevs:
        with contextlib.redirect_stdout(io.StringIO()):
            por, (al, par) = resumo(medir_videos(trechos, teste_ids, prever, regras), "")
        linhas = medir_ines(trechos, prever, regras, imprime=False)
        for L, (a, b) in por.items():
            soma.setdefault(L, [0, 0])
            soma[L][0] += a
            soma[L][1] += b
        for L, r, _ in linhas:
            if L in LETRAS_MOV:
                soma.setdefault(L, [0, 0])
                soma[L][0] += r == "certa"
                soma[L][1] += 1
            else:
                ines_paradas += 1
                if r.startswith("alarme"):
                    ines_alarmes[f"{L}->{r.split()[1]}"] += 1
        alarmes += al
        paradas += par
    return soma, (alarmes, paradas), (ines_alarmes, ines_paradas)


def letras_camera(soma, sementes):
    return [L for L in LETRAS_MOV if L in soma and soma[L][1] >= MIN_TESTE * sementes
            and soma[L][0] / soma[L][1] >= MIN_ACERTO_CAMERA]


def experimento(args):
    """
    Treina `sementes` modelos com todos os canais de treino (como o treinar) e, com --cv, a validação
    cruzada por canal; guarda as probabilidades das janelas ao vivo (canais separados, INES e, com
    --cv, os vídeos de cada grupo) para o varrer e imprime o resultado com as regras padrão.
    """
    import pickle

    from sklearn.model_selection import GroupKFold

    trechos = carregar_trechos()
    treino_ids, teste_ids = separar(trechos)
    preparar_ao_vivo(teste_ids | treino_ids | {x["id"] for x in trechos.get("ines", [])})
    X, y, canal, video = montar_cache(trechos, treino_ids, args.variacoes)
    print(f"janelas de treino: {len(y)} ({collections.Counter(y).most_common()}) | vizinhas: {VIZINHAS or '-'}"
          f" | modelo: ocultas {args.ocultas} alpha {args.alpha} max_nenhuma {args.max_nenhuma}", flush=True)
    modelo = {"ocultas": tuple(int(x) for x in args.ocultas.split(",")), "alpha": args.alpha,
              "max_nenhuma": args.max_nenhuma}
    sementes = []
    for semente in range(args.primeira_semente, args.primeira_semente + args.sementes):
        prever = guardar(ajustar_sklearn(X, y, seed=semente, **modelo))
        with contextlib.redirect_stdout(io.StringIO()):
            resumo(medir_videos(trechos, teste_ids, prever), "")
            medir_ines(trechos, prever, imprime=False)
        sementes.append(prever.guardadas)
        print(f"  semente {semente}", flush=True)
    cv = {}
    if args.cv:
        for k, (tr, te) in enumerate(GroupKFold(args.grupos).split(X, y, canal)):
            prever = guardar(ajustar_sklearn(X[tr], y[tr], seed=k, **modelo))
            ids = set(video[te]) & treino_ids
            with contextlib.redirect_stdout(io.StringIO()):
                resumo(medir_videos(trechos, ids, prever), "")
            cv.update(prever.guardadas)
            print(f"  grupo {k + 1}/{args.grupos}", flush=True)
    with open(args.probs, "wb") as f:
        pickle.dump({"sementes": sementes, "cv": cv, "vizinhas": VIZINHAS, "modelo": modelo}, f,
                    protocol=pickle.HIGHEST_PROTOCOL)
    print(f"probabilidades em {args.probs}")
    varrer_letras([args.probs], [REGRAS["min_p"]], [REGRAS["min_movimento"]], [REGRAS["max_p_nenhum"]])


def _prever_guardado(guardadas):
    def prever(Xc):
        raise KeyError("vídeo sem probabilidades guardadas")

    prever.guardadas = guardadas
    return prever


def varrer_letras(arquivos, min_ps, min_movs, max_nenhumas, por_letra=False):
    """Varre as regras de leitura do app sobre as probabilidades do experimento (sem treinar de novo)."""
    import itertools
    import pickle

    trechos = carregar_trechos()
    treino_ids, teste_ids = separar(trechos)
    for path in arquivos:
        with open(path, "rb") as f:
            d = pickle.load(f)
        prevs = [_prever_guardado(g) for g in d["sementes"]]
        n = len(prevs)
        print(f"== {path} ({n} sementes, vizinhas {d.get('vizinhas') or '-'})")
        print("min_p mov  max_ | " + " ".join(f"{L:>7s}" for L in LETRAS_MOV)
              + " | paradas      | INES paradas | VC certas  VC alarme | câmera")
        for min_p, mm, mx in itertools.product(min_ps, min_movs, max_nenhumas):
            regras = {"min_p": min_p, "min_movimento": mm, "max_p_nenhum": mx}
            soma, (al, par), (ines_al, ines_par) = medir_sementes(trechos, teste_ids, prevs, regras)
            vc = ""
            if d["cv"]:
                with contextlib.redirect_stdout(io.StringIO()):
                    por, (cal, cpar) = resumo(medir_videos(trechos, set(d["cv"]) & treino_ids,
                                                           _prever_guardado(d["cv"]), regras), "")
                a = sum(v[0] for v in por.values())
                b = sum(v[1] for v in por.values())
                vc = f"{a}/{b} {a / max(b, 1):.1%}  {cal}/{cpar} {cal / max(cpar, 1):.1%}"
            camera = letras_camera(soma, n)
            print(f"{min_p:.2f}  {mm:.2f} {mx:.2f} | "
                  + " ".join(f"{soma.get(L, [0, 0])[0] / max(soma.get(L, [0, 1])[1], 1):7.0%}" for L in LETRAS_MOV)
                  + f" | {al:3d}/{par} {al / max(par, 1):5.1%} | {sum(ines_al.values()):2d}/{ines_par} | {vc} | "
                  + " ".join(camera), flush=True)
            if por_letra:
                print("      ", " ".join(f"{L}:{a}/{b}" for L, (a, b) in sorted(soma.items())),
                      "| INES:", " ".join(f"{k}:{c}" for k, c in ines_al.most_common()))


def medir(pasta):
    """Mede um modelo exportado (model.json + weights.bin) nos canais separados e no INES."""
    from teste_fixo import carregar_modelo

    labels, layers = carregar_modelo(pasta)
    prever = prever_camadas(layers, labels)
    trechos = carregar_trechos()
    _, teste_ids = separar(trechos)
    preparar_ao_vivo(teste_ids | {x["id"] for x in trechos.get("ines", [])})
    resumo(medir_videos(trechos, teste_ids, prever), f"canais separados ({pasta})")
    medir_ines(trechos, prever)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    md = sub.add_parser("medir")
    md.add_argument("--modelo", required=True, help="pasta com model.json e weights.bin")
    a = sub.add_parser("avaliar")
    a.add_argument("--grupos", type=int, default=5)
    a.add_argument("--variacoes", type=int, default=2)
    a.add_argument("--ocultas", default=",".join(map(str, OCULTAS)))
    a.add_argument("--alpha", type=float, default=ALPHA)
    a.add_argument("--max-nenhuma", type=float, default=MAX_NENHUMA)
    t = sub.add_parser("treinar")
    t.add_argument("--out", required=True)
    t.add_argument("--variacoes", type=int, default=2)
    t.add_argument("--sementes", type=int, default=SEMENTES_CAMERA,
                   help="treinos com sementes diferentes somados para decidir camera_letters")
    t.add_argument("--min-p", type=float, default=MIN_P_LEITURA)
    t.add_argument("--min-movimento", type=float, default=MIN_MOVIMENTO, help="portão de movimento (0 desliga)")
    t.add_argument("--max-p-nenhum", type=float, default=1.0, help="teto do \"_\" (1 desliga)")
    e = sub.add_parser("experimento")
    e.add_argument("--probs", required=True, help="arquivo (pickle) com as probabilidades, para o varrer")
    e.add_argument("--sementes", type=int, default=SEMENTES_CAMERA)
    e.add_argument("--primeira-semente", type=int, default=0, help="outras sementes para repetir a medida")
    e.add_argument("--variacoes", type=int, default=2)
    e.add_argument("--cv", action="store_true", help="também a validação cruzada por canal")
    e.add_argument("--grupos", type=int, default=5)
    e.add_argument("--ocultas", default=",".join(map(str, OCULTAS)))
    e.add_argument("--alpha", type=float, default=ALPHA)
    e.add_argument("--max-nenhuma", type=float, default=MAX_NENHUMA)
    v = sub.add_parser("varrer")
    v.add_argument("probs", nargs="+")
    v.add_argument("--min-p", type=float, nargs="+", default=[MIN_P_LEITURA])
    v.add_argument("--min-movimento", type=float, nargs="+", default=[MIN_MOVIMENTO])
    v.add_argument("--max-p-nenhum", type=float, nargs="+", default=[1.0])
    v.add_argument("--por-letra", action="store_true")
    args = ap.parse_args()
    if args.cmd == "experimento":
        experimento(args)
    elif args.cmd == "varrer":
        varrer_letras(args.probs, args.min_p, args.min_movimento, args.max_p_nenhum, args.por_letra)
    elif args.cmd == "medir":
        medir(args.modelo)
    elif args.cmd == "avaliar":
        avaliar(args.grupos, args.variacoes, ocultas=tuple(int(x) for x in args.ocultas.split(",")),
                alpha=args.alpha, max_nenhuma=args.max_nenhuma)
    else:
        treinar(args.out, args.variacoes, args.sementes,
                {"min_p": args.min_p, "min_movimento": args.min_movimento, "max_p_nenhum": args.max_p_nenhum})


if __name__ == "__main__":
    sys.exit(main())
