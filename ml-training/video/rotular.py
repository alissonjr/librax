"""
Rotula os landmarks extraídos dos vídeos (ml-training/data/landmarks/*.json, gravados pela página
treino-video.html) e gera o dataset JSONL que o train_static.py lê.

Como sai o rótulo:
1. Em cada vídeo, escolhe a mão que sinaliza e acha as "paradas": trechos em que a forma e a
   posição da mão ficam estáveis por pelo menos MIN_PARADA_S.
2. Vídeo do alfabeto (ou das vogais): a ordem das letras é conhecida. Um alinhamento monotônico
   (programação dinâmica) encaixa as paradas na sequência; parada que não combina com letra
   nenhuma vira lixo (introdução, fala, mão descendo).
3. A pontuação de cada parada contra cada letra começa com regras de dedos estendidos e direção
   da mão (rodada 0) e depois vem de um classificador treinado com os rótulos da rodada anterior,
   usando todos os vídeos juntos. Repete RODADAS vezes. Em todas as rodadas soma a pista do texto
   na tela: muitos vídeos mostram a letra escrita, lida por OCR no meio de cada parada (o cache
   fica em data/ocr/<id>.json).
4. Checagem cruzada: cada vídeo é julgado por um modelo treinado só com os outros. Parada que
   esse modelo não confirma (nem a letra na tela) sai; vídeo com maioria reprovada sai inteiro.
5. Vídeo de uma letra só: entra com o rótulo do título quando o classificador final concorda.

Saídas em ml-training/data/:
- dataset_video.jsonl: uma linha por quadro, no formato da coleta (person_id = canal). A classe
  "_" (nenhuma letra) vem de video/negativas.py (mãos em repouso).
- rotulos/<id>.json: as paradas de cada vídeo com a letra, para conferir.

Uso:
    python video/rotular.py [--rodadas 4] [--quadros-por-parada 12]
"""

import argparse
import glob
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
from train_static import NORMALIZATION_VERSION, normalize_hand  # noqa: E402
from teste_fixo import canais_do_teste  # noqa: E402

DATA = os.path.join(AQUI, "..", "data")
LANDMARKS = os.path.join(DATA, "landmarks")
ROTULOS = os.path.join(DATA, "rotulos")
OCR_DIR = os.path.join(DATA, "ocr")
SAIDA = os.path.join(DATA, "dataset_video.jsonl")

# Letras que o curso avalia como estáticas (signs.json, recognition "static"). Ç, J e Z têm
# movimento: entram no alinhamento para ocupar o lugar delas, mas não vão para o dataset.
ESTATICAS = set("ABCDEFGHIKLMNOPQRSTUVWXY")

MIN_PARADA_S = 0.2
# Velocidades (por segundo) abaixo das quais a mão conta como parada. Forma: distância no
# espaço normalizado. Posição: deslocamento do pulso em palmos.
VEL_FORMA = 4.0
VEL_POSICAO = 2.5
# Paradas vizinhas quase iguais e com intervalo curto são a mesma letra.
JUNTAR_GAP_S = 0.35
JUNTAR_DIST = 0.6

# Checagem cruzada (vídeos divididos em grupos; cada grupo é julgado pelo modelo dos outros)
CHECAGEM_GRUPOS = 5
CHECAGEM_TOP = 3
CHECAGEM_MIN_P = 0.2
CHECAGEM_MIN_VIDEO = 0.5
# Classe "nenhuma letra" (o app trata como nada reconhecido; ver classifier.ts NO_LETTER_LABEL)
NENHUMA = "_"
# As paradas fora do alinhamento muitas vezes eram letras (introdução em Libras); a classe "_"
# agora vem de mãos em repouso (video/negativas.py). Mantido em 0 para não misturar.
NEGATIVAS_POR_VIDEO = 0

# Parada mais curta que isto, em vídeo de sequência, costuma ser transição entre letras
MIN_PARADA_ACEITA_S = 0.4

# Pontuações do alinhamento (log-probabilidades)
LIXO = np.log(0.04)
PULAR_LETRA = 3.0
# Letra lida na tela: bônus quando bate com a letra candidata, multa leve quando há outra letra
OCR_BONUS = np.log(30.0)
OCR_MULTA = np.log(3.0)
OCR_MIN_CONF = 0.6
OCR_TROCAS = {"0": "O", "5": "S", "2": "Z", "1": "I"}


# ---------------------------------------------------------------------------
# Mão, quadros e paradas
# ---------------------------------------------------------------------------

def mao_dominante(frames):
    """Rótulo do MediaPipe da mão que sinaliza: a que aparece mais vezes levantada."""
    cont = {}
    for f in frames:
        for h in f["hands"]:
            wrist_y = h["lm"][1]
            if wrist_y < 0.95:
                cont[h["h"]] = cont.get(h["h"], 0) + 1
    return max(cont, key=cont.get) if cont else None


def escolher_mao(hands, dominante):
    if not hands:
        return None
    iguais = [h for h in hands if h["h"] == dominante]
    pool = iguais if len(iguais) == 1 else hands
    return min(pool, key=lambda h: h["lm"][1])  # a mais alta (pulso com menor y)


def quadros(video):
    """Lista de (t, raw, handedness, feature 65, pulso em px de altura, palmo) da mão escolhida."""
    aspect = video["aspect"]
    dom = mao_dominante(video["frames"])
    out = []
    for f in video["frames"]:
        h = escolher_mao(f["hands"], dom)
        if h is None:
            out.append(None)
            continue
        raw = np.asarray(h["lm"], dtype=np.float64)
        pts = raw.reshape(21, 3)
        palmo = np.hypot((pts[9, 0] - pts[0, 0]) * aspect, pts[9, 1] - pts[0, 1])
        out.append({
            "t": f["t"],
            "raw": h["lm"],
            "h": h["h"],
            "v": normalize_hand(raw, h["h"], aspect),
            "pulso": np.array([pts[0, 0] * aspect, pts[0, 1]]),
            "palmo": max(palmo, 1e-3),
        })
    return out


def paradas(qs):
    """Trechos estáveis: lista de listas de índices em qs."""
    estavel = np.zeros(len(qs), dtype=bool)
    for i in range(1, len(qs)):
        a, b = qs[i - 1], qs[i]
        if a is None or b is None:
            continue
        dt = max(b["t"] - a["t"], 1e-3)
        if dt > 0.25:
            continue
        vf = np.linalg.norm(b["v"] - a["v"]) / dt
        vp = np.linalg.norm(b["pulso"] - a["pulso"]) / b["palmo"] / dt
        estavel[i] = vf < VEL_FORMA and vp < VEL_POSICAO
    # tira piscadas: um quadro instável no meio de estáveis continua estável
    for i in range(1, len(qs) - 1):
        if not estavel[i] and estavel[i - 1] and estavel[i + 1] and qs[i] is not None:
            estavel[i] = True
    trechos, atual = [], []
    for i, ok in enumerate(estavel):
        if ok:
            atual.append(i)
        elif atual:
            trechos.append(atual)
            atual = []
    if atual:
        trechos.append(atual)
    trechos = [t for t in trechos if qs[t[-1]]["t"] - qs[t[0]]["t"] >= MIN_PARADA_S]

    # junta vizinhas quase iguais
    juntas = []
    for t in trechos:
        if juntas:
            ant = juntas[-1]
            gap = qs[t[0]]["t"] - qs[ant[-1]]["t"]
            if gap < JUNTAR_GAP_S and np.linalg.norm(media(qs, ant) - media(qs, t)) < JUNTAR_DIST:
                juntas[-1] = ant + t
                continue
        juntas.append(t)
    return juntas


def media(qs, idx):
    """Forma típica do trecho: mediana do miolo (descarta as pontas, que já estão em transição)."""
    k = len(idx)
    miolo = idx[k // 5: k - k // 5] or idx
    return np.median(np.stack([qs[i]["v"] for i in miolo]), axis=0)


# ---------------------------------------------------------------------------
# Rodada 0: regras de dedos e direção
# ---------------------------------------------------------------------------

# (polegar, indicador, médio, anelar, mínimo; direção) com 1 estendido, 0 dobrado, None sem regra.
# Direção: "cima", "lado", "baixo" ou None.
PADROES = {
    "A": (None, 0, 0, 0, 0, "cima"),
    "B": (0, 1, 1, 1, 1, "cima"),
    "C": (None, None, None, None, None, None),
    "Ç": (None, None, None, None, None, None),
    "D": (None, 1, 0, 0, 0, "cima"),
    "E": (0, 0, 0, 0, 0, "cima"),
    "F": (None, 0, 1, 1, 1, "cima"),
    "G": (1, 1, 0, 0, 0, "lado"),
    "H": (0, 1, 1, 0, 0, "lado"),
    "I": (0, 0, 0, 0, 1, "cima"),
    "J": (None, 0, 0, 0, 1, None),
    "K": (1, 1, 1, 0, 0, "cima"),
    "L": (1, 1, 0, 0, 0, "cima"),
    "M": (None, None, None, None, None, None),
    "N": (None, None, None, None, None, None),
    "O": (None, None, None, None, None, None),
    "P": (1, 1, None, 0, 0, "baixo"),
    "Q": (None, None, 0, 0, 0, "baixo"),
    "R": (0, 1, 1, 0, 0, "cima"),
    "S": (0, 0, 0, 0, 0, "cima"),
    "T": (None, 0, 0, 0, 0, "cima"),
    "U": (0, 1, 1, 0, 0, "cima"),
    "V": (0, 1, 1, 0, 0, "cima"),
    "W": (0, 1, 1, 1, 0, "cima"),
    "X": (0, None, 0, 0, 0, "cima"),
    "Y": (1, 0, 0, 0, 1, "cima"),
    "Z": (None, 1, 0, 0, 0, None),
}

TIPS = [4, 8, 12, 16, 20]
MCPS = [2, 5, 9, 13, 17]


def dedos(v):
    """Probabilidade de cada dedo estar estendido, a partir do vetor normalizado."""
    p = v[:63].reshape(21, 3)
    out = []
    for k, (tip, mcp) in enumerate(zip(TIPS, MCPS)):
        if k == 0:
            # polegar: ponta longe da base do indicador
            r = np.linalg.norm(p[4] - p[5]) / np.linalg.norm(p[9])
            out.append(1 / (1 + np.exp(-(r - 0.75) * 8)))
        else:
            r = np.linalg.norm(p[tip]) / max(np.linalg.norm(p[mcp]), 1e-6)
            out.append(1 / (1 + np.exp(-(r - 1.55) * 8)))
    return out


def direcao(v):
    dy = v[64]
    return {"cima": 1 / (1 + np.exp((dy + 0.5) * 8)),
            "baixo": 1 / (1 + np.exp(-(dy - 0.4) * 8)),
            "lado": np.exp(-(dy / 0.45) ** 2)}


def pontos_regras(v, letras):
    d = dedos(v)
    dirs = direcao(v)
    out = []
    for L in letras:
        pad = PADROES[L]
        s = 0.0
        # Sem regra conta como meio acerto: senão a letra sem regra ganharia de todas
        for k in range(5):
            q = 0.5 if pad[k] is None else (d[k] if pad[k] == 1 else 1 - d[k])
            s += np.log(0.1 + 0.85 * q)
        q = 0.5 if pad[5] is None else dirs[pad[5]]
        s += np.log(0.1 + 0.85 * q)
        out.append(s)
    out = np.array(out)
    return out - np.log(np.exp(out).sum())


# ---------------------------------------------------------------------------
# Alinhamento monotônico
# ---------------------------------------------------------------------------

def alinhar(scores):
    """
    scores[i, j]: log-pontuação da parada i ser a letra j da sequência.
    Cada parada vira uma letra (ordem não decrescente) ou lixo. Pular letra custa PULAR_LETRA.
    Devolve, para cada parada, o índice da letra ou -1 (lixo).
    """
    M, N = scores.shape
    NEG = -1e18
    # dp[j + 1]: melhor pontuação com a última letra usada = j (dp[0]: nenhuma ainda)
    dp = np.full(N + 1, NEG)
    dp[0] = 0.0
    back = np.zeros((M, N + 1), dtype=np.int64)  # de qual estado veio; -2 = lixo
    for i in range(M):
        novo = np.full(N + 1, NEG)
        orig = np.full(N + 1, -2, dtype=np.int64)
        # lixo: fica no mesmo estado
        novo[:] = dp + LIXO
        # parada i é a letra j (veio do estado k <= j + 1, isto é, última letra k - 1 <= j)
        for j in range(N):
            ks = np.arange(0, j + 2)
            pen = np.where(ks == j + 1, 0.0, -PULAR_LETRA * (j + 1 - ks - 1).clip(min=0))
            cand = dp[ks] + pen
            k = int(np.argmax(cand))
            val = cand[k] + scores[i, j]
            if val > novo[j + 1]:
                novo[j + 1] = val
                orig[j + 1] = k
        back[i] = orig
        dp = novo
    fim = dp - PULAR_LETRA * (N - np.arange(N + 1))
    estado = int(np.argmax(fim))
    out = [-1] * M
    for i in range(M - 1, -1, -1):
        o = back[i, estado]
        if o == -2:
            out[i] = -1
        else:
            out[i] = estado - 1
            estado = int(o)
    return out


# ---------------------------------------------------------------------------
# Classificador das rodadas
# ---------------------------------------------------------------------------

def _ocr_init():
    global _OCR
    from rapidocr_onnxruntime import RapidOCR
    _OCR = RapidOCR()


def _ocr_job(args):
    import cv2

    path, tempos = args
    cap = cv2.VideoCapture(path)
    out = {}
    for t in tempos:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            out[f"{t:.2f}"] = []
            continue
        res, _ = _OCR(frame)
        out[f"{t:.2f}"] = [[r[1].strip(), round(float(r[2]), 3)] for r in (res or []) if len(r[1].strip()) <= 2]
    cap.release()
    return out


def ocr_paradas(videos):
    """Lê o texto da tela no meio de cada parada (com cache) e grava em v["_ocr"]."""
    from multiprocessing import Pool

    os.makedirs(OCR_DIR, exist_ok=True)
    fontes = {f["id"]: f for f in json.load(open(os.path.join(DATA, "fontes.json")))}
    jobs, caches = [], {}
    for v in videos:
        cache_path = os.path.join(OCR_DIR, f"{v['id']}.json")
        cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
        caches[v["id"]] = cache
        v["_meios"] = [v["_qs"][p[len(p) // 2]]["t"] for p in v["_ps"]]
        falta = [t for t in v["_meios"] if f"{t:.2f}" not in cache]
        arq = fontes.get(v["id"], {}).get("arquivo")
        if falta and arq:
            jobs.append((v["id"], (os.path.join(DATA, "videos", arq), falta)))
    if jobs:
        print(f"OCR em {sum(len(j[1][1]) for j in jobs)} parada(s) de {len(jobs)} vídeo(s)...", flush=True)
        with Pool(min(6, os.cpu_count() or 4), initializer=_ocr_init) as pool:
            for (vid, _), res in zip(jobs, pool.imap(_ocr_job, [j[1] for j in jobs])):
                caches[vid].update(res)
                with open(os.path.join(OCR_DIR, f"{vid}.json"), "w") as f:
                    json.dump(caches[vid], f)
    for v in videos:
        lidas = []
        for t in v["_meios"]:
            letras = {}
            for txt, conf in caches[v["id"]].get(f"{t:.2f}", []):
                txt = OCR_TROCAS.get(txt.upper(), txt.upper())
                if len(txt) == 1 and conf >= OCR_MIN_CONF and txt in "ABCÇDEFGHIJKLMNOPQRSTUVWXYZ":
                    letras[txt] = max(conf, letras.get(txt, 0))
            # Tabela do alfabeto na tela: várias letras ao mesmo tempo não dizem nada
            lidas.append(letras if len(letras) <= 2 else {})
        v["_ocr"] = lidas


def pista_ocr(v, seq):
    """Matriz [paradas x letras da sequência] com a pista do texto na tela."""
    out = np.zeros((len(v["_ps"]), len(seq)))
    for i, letras in enumerate(v.get("_ocr") or []):
        if not letras:
            continue
        for j, L in enumerate(seq):
            out[i, j] = OCR_BONUS * letras[L] if L in letras else -OCR_MULTA
    return out


def treinar(X, y, classes):
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    sc = StandardScaler().fit(X)
    clf = MLPClassifier(hidden_layer_sizes=(96,), alpha=1e-3, max_iter=400, random_state=0)
    clf.fit(sc.transform(X), y)
    idx = {c: i for i, c in enumerate(clf.classes_)}

    def score(Xq):
        p = clf.predict_proba(sc.transform(Xq))
        full = np.full((len(Xq), len(classes)), 1e-4)
        for j, c in enumerate(classes):
            if c in idx:
                full[:, j] = p[:, idx[c]] + 1e-4
        return np.log(full)

    return score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rodadas", type=int, default=4)
    ap.add_argument("--quadros-por-parada", type=int, default=12)
    args = ap.parse_args()

    # A sequência (alfabeto inteiro ou só vogais) e o canal vêm da lista do baixar.py
    with open(os.path.join(DATA, "fontes.json")) as f:
        fontes = {x["id"]: x for x in json.load(f)}
    videos = []
    for path in sorted(glob.glob(os.path.join(LANDMARKS, "*.json"))):
        with open(path) as f:
            v = json.load(f)
        fonte = fontes.get(v["id"], {})
        v["sequencia"] = fonte.get("sequencia")
        v["channel_id"] = v.get("channel_id") or fonte.get("channel_id")
        qs = quadros(v)
        ps = paradas(qs)
        if not ps:
            continue
        v["_qs"], v["_ps"] = qs, ps
        v["_feat"] = np.stack([media(qs, p) for p in ps])
        videos.append(v)
    ocr_paradas(videos)
    seq_videos = [v for v in videos if v["tipo"] == "alfabeto"]
    letra_videos = [v for v in videos if v["tipo"] == "letra"]
    print(f"{len(videos)} vídeo(s) com paradas: {len(seq_videos)} em sequência, {len(letra_videos)} de uma letra")
    if not seq_videos:
        raise SystemExit("nenhum vídeo do alfabeto analisado ainda")

    classes = sorted(set("".join(v.get("sequencia") or "" for v in seq_videos)) | ESTATICAS)

    def sequencia(v):
        return list(v.get("sequencia") or "ABCÇDEFGHIJKLMNOPQRSTUVWXYZ")

    score_fn = None
    for rodada in range(args.rodadas + 1):
        X, y = [], []
        usados = 0
        for v in seq_videos:
            seq = sequencia(v)
            if score_fn is None:
                s = np.stack([pontos_regras(f, seq) for f in v["_feat"]])
            else:
                full = score_fn(v["_feat"])
                s = full[:, [classes.index(c) for c in seq]]
            al = alinhar(s + pista_ocr(v, seq))
            v["_al"] = [seq[j] if j >= 0 else None for j in al]
            v["_conf"] = [float(np.exp(s[i, j])) if j >= 0 else 0.0 for i, j in enumerate(al)]
            n_letras = len({L for L in v["_al"] if L})
            v["_cobertura"] = n_letras / len(seq)
            if v["_cobertura"] < 0.6:
                continue  # alinhamento ruim (vídeo que não segue a ordem, aula com fala)
            usados += 1
            for f, L in zip(v["_feat"], v["_al"]):
                if L:
                    X.append(f)
                    y.append(L)
        print(f"rodada {rodada}: {usados}/{len(seq_videos)} vídeos alinhados, {len(X)} paradas rotuladas")
        if rodada == args.rodadas:
            break
        score_fn = treinar(np.array(X), np.array(y), classes)

    # Checagem cruzada: cada vídeo é pontuado por um modelo treinado só com os outros vídeos.
    # A parada fica se esse modelo concordar com a letra (ou se a letra escrita na tela confirmar);
    # vídeo em que a maioria não passa sai inteiro (aula falada, mãos juntas, ordem diferente).
    alinhados = [v for v in seq_videos if v.get("_cobertura", 0) >= 0.6]
    grupos = np.arange(len(alinhados)) % CHECAGEM_GRUPOS
    for g in range(CHECAGEM_GRUPOS):
        treino = [v for v, gg in zip(alinhados, grupos) if gg != g]
        Xg = [f for v in treino for f, L in zip(v["_feat"], v["_al"]) if L]
        yg = [L for v in treino for L in v["_al"] if L]
        fn = treinar(np.array(Xg), np.array(yg), classes)
        for v in [v for v, gg in zip(alinhados, grupos) if gg == g]:
            full = fn(v["_feat"])
            top = np.argsort(-full, axis=1)[:, :CHECAGEM_TOP]
            aceita = []
            for i, L in enumerate(v["_al"]):
                if not L:
                    aceita.append(False)
                    continue
                j = classes.index(L) if L in classes else -1
                modelo = j >= 0 and j in top[i] and np.exp(full[i, j]) >= CHECAGEM_MIN_P
                aceita.append(bool(modelo or L in (v["_ocr"][i] if v.get("_ocr") else {})))
            # Uma parada por letra: a principal (mais longa x mais confiável). As outras e as curtas
            # demais costumam ser a mão em transição entre letras vizinhas (B -> C, M -> N)
            qs = v["_qs"]
            dur = [qs[ix[-1]]["t"] - qs[ix[0]]["t"] for ix in v["_ps"]]
            melhor = {}
            for i, L in enumerate(v["_al"]):
                if not L or not aceita[i] or dur[i] < MIN_PARADA_ACEITA_S:
                    aceita[i] = False
                    continue
                j = classes.index(L) if L in classes else -1
                nota = dur[i] * (np.exp(full[i, j]) if j >= 0 else 0.0)
                if L not in melhor or nota > melhor[L][1]:
                    melhor[L] = (i, nota)
            principais = {i for i, _ in melhor.values()}
            aceita = [ok and i in principais for i, ok in enumerate(aceita)]
            v["_aceita"] = aceita
            rotuladas = len({L for L in v["_al"] if L})
            v["_qualidade"] = sum(aceita) / max(rotuladas, 1)
    bons = [v for v in alinhados if v["_qualidade"] >= CHECAGEM_MIN_VIDEO]
    for v in bons:
        v["_bom"] = True
    for v in seq_videos:
        if v not in bons:
            v["_aceita"] = [False] * len(v["_ps"])
    n_ok = sum(sum(v["_aceita"]) for v in bons)
    print(f"checagem cruzada: {len(bons)}/{len(seq_videos)} vídeos e {n_ok} paradas aceitas")
    for v in sorted(alinhados, key=lambda v: v["_qualidade"]):
        if v not in bons:
            print(f"  fora: {v['id']} (qualidade {v['_qualidade']:.2f}) {v.get('title', '')[:50]}")

    # Modelo final (só paradas aceitas) para os vídeos de uma letra
    Xf = [f for v in bons for f, ok in zip(v["_feat"], v["_aceita"]) if ok]
    yf = [L for v in bons for L, ok in zip(v["_al"], v["_aceita"]) if ok]
    score_fn = treinar(np.array(Xf), np.array(yf), classes)

    # Vídeos de uma letra: entra a parada que o classificador acha que é a letra do título
    for v in letra_videos:
        L = v.get("rotulo")
        if L not in classes:
            v["_al"] = [None] * len(v["_ps"])
            continue
        s = score_fn(v["_feat"]) if score_fn else None
        p = np.exp(s[:, classes.index(L)]) if s is not None else np.zeros(len(v["_ps"]))
        top3 = np.argsort(-s, axis=1)[:, :3] if s is not None else None
        v["_al"] = [L if (p[i] > 0.25 and classes.index(L) in top3[i]) else None for i in range(len(p))]
        v["_aceita"] = [bool(L) for L in v["_al"]]
        v["_conf"] = p.tolist()

    # Canais do teste fixo (teste_fixo.py) nunca entram no dataset
    fora = canais_do_teste()
    os.makedirs(ROTULOS, exist_ok=True)
    linhas = 0
    por_letra = {}
    rng = np.random.default_rng(0)
    with open(SAIDA, "w") as out:
        for v in videos:
            rot = []
            aceitas = v.get("_aceita") or [False] * len(v["_ps"])
            negativas_video = 0
            for idx, L, c, ok in zip(v["_ps"], v["_al"], v.get("_conf", [0] * len(v["_ps"])), aceitas):
                qs = v["_qs"]
                ocr = (v.get("_ocr") or [{}] * len(v["_ps"]))[len(rot)]
                rot.append({"ini": qs[idx[0]]["t"], "fim": qs[idx[-1]]["t"], "letra": L, "conf": round(float(c), 3),
                            "meio": qs[idx[len(idx) // 2]]["t"], "ocr": "".join(sorted(ocr)), "aceita": ok})
                # "Nenhuma letra": parada que o alinhamento deixou de fora num vídeo bom (introdução,
                # mão em repouso, mão descendo) e sem letra escrita na tela
                negativa = v.get("_bom") and not L and not ocr and negativas_video < NEGATIVAS_POR_VIDEO
                if v.get("channel_id") in fora:
                    continue
                if negativa:
                    negativas_video += 1
                    L = NENHUMA
                elif not L or L not in ESTATICAS or not ok:
                    continue
                k = len(idx)
                miolo = idx[k // 5: k - k // 5] or idx
                pick = miolo if len(miolo) <= args.quadros_por_parada else sorted(
                    rng.choice(miolo, args.quadros_por_parada, replace=False).tolist())
                for i in pick:
                    q = qs[i]
                    out.write(json.dumps({
                        "label": L,
                        "person_id": v.get("channel_id") or v["id"],
                        "platform": "youtube",
                        "device_model": "",
                        "browser": "",
                        "normalization_version": NORMALIZATION_VERSION,
                        "handedness": q["h"],
                        "aspect": v["aspect"],
                        "v": [round(float(x), 6) for x in q["v"]],
                        "raw": q["raw"],
                        "session_id": v["id"],
                        "t": q["t"],
                    }) + "\n")
                    linhas += 1
                    por_letra[L] = por_letra.get(L, 0) + 1
            with open(os.path.join(ROTULOS, f"{v['id']}.json"), "w") as f:
                json.dump({"id": v["id"], "tipo": v["tipo"], "cobertura": v.get("_cobertura"),
                           "qualidade": v.get("_qualidade"), "paradas": rot},
                          f, indent=1, ensure_ascii=False)
    print(f"{linhas} quadros em {SAIDA}")
    print("por letra:", " ".join(f"{k}:{por_letra.get(k, 0)}" for k in sorted(ESTATICAS | {NENHUMA})))


if __name__ == "__main__":
    main()
