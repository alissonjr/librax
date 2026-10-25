"""
Rotula os vídeos de sinais (data/landmarks_sinais/*.json, gravados pela página treino-video.html no
modo sinais) e gera o dataset do modelo de movimento.

Cada vídeo "sinal de X em Libras" tem introdução, fala e o sinal (às vezes repetido). O título diz
qual é o sinal, mas não quando. Como sai o trecho:
0. Vídeo cujo título fala de outra coisa com a glosa dentro ("Tênis de Mesa", "Arroz doce",
   "Almoço x Jantar") fica de fora (titulo_composto).
1. Quadro ativo: mão presente, corpo presente e pulso acima de ATIVO_ABAIXO_OMBRO larguras de
   ombro abaixo da linha dos ombros. Trechos ativos viram janelas candidatas de JANELAS_S
   segundos (passo PASSO_S), reamostradas para T quadros.
2. Consenso por sinal: em cada vídeo vale a janela mais parecida com as dos OUTROS vídeos do mesmo
   sinal (mediana da distância). O que se repete entre pessoas diferentes é o sinal; introdução e
   fala mudam de vídeo para vídeo. Refina RODADAS vezes contra as janelas escolhidas.
3. Repetições no mesmo vídeo entram se ficarem tão perto quanto a escolhida (REPETICAO_FOLGA).
   Vídeo cuja melhor janela destoa dos outros (mediana + 2 MAD) sai inteiro: provavelmente é
   outro sinal ou outra variante.
   Com --ancoras, quando o sinal tem vídeo de dicionário (só o sinal, sem introdução nem fala), as
   rodadas de refinamento comparam só com as janelas escolhidas nos dicionários.
4. Janelas ativas que não se sobrepõem às escolhidas, em vídeos aceitos, viram "_" (nenhum sinal),
   até NEGATIVAS_POR_VIDEO por vídeo.

Atributos por quadro (features_quadro), em relação ao corpo, na ordem: para a mão dominante e
depois a outra, [presença, pulso x/y a partir do meio dos ombros, pulso x/y a partir do nariz,
65 da normalize_hand]. Posições em larguras de ombro, x com o aspecto corrigido, espelhadas quando
a dominante é a esquerda da pessoa. Sem a mão, tudo zero. F = 2 x 70 = 140.

Saídas em data/:
- dataset_sinais.npz: X [N, T, F] float32, y, pessoa (canal), video, t0, t1.
- rotulos_sinais/<id>.json: janelas escolhidas e negativas de cada vídeo, para conferir.

Uso:
    python video/rotular_sinais.py [--glosas A,B,...]
"""

import argparse
import glob
import json
import os
import re
import sys
import unicodedata

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
from train_static import is_left_hand, normalize_hand  # noqa: E402

DATA = os.path.join(AQUI, "..", "data")
ENTRADA = os.path.join(DATA, "landmarks_sinais")
ROTULOS = os.path.join(DATA, "rotulos_sinais")
SAIDA = os.path.join(DATA, "dataset_sinais.npz")

T = 24  # quadros por janela depois de reamostrar (cerca de 1,5 s a 16 fps)
JANELAS_S = (1.0, 1.5, 2.0)
PASSO_S = 0.25
ATIVO_ABAIXO_OMBRO = 1.8
JUNTAR_GAP_S = 0.3
RODADAS = 3
REPETICAO_FOLGA = 1.15
NEGATIVAS_POR_VIDEO = 4
NENHUM = "_"
DICIONARIO = "dic-"  # prefixo dos vídeos de dicionário (video/baixar_dicionarios.py)

# Índices do PoseLandmarker
NARIZ, OMBRO_E, OMBRO_D = 0, 11, 12
POR_MAO = 70
F = 2 * POR_MAO


# ---------------------------------------------------------------------------
# Título
# ---------------------------------------------------------------------------

# Palavras de título que não mudam o sinal ("Sinal de MESA em Libras", "Como eu falo CAMA")
GENERICAS = set("""sinal sinais de em da do na no libras como que se fala falo eu o a e ou diz dizer faz fazer
basico dicionario ed aprenda aprender aula curso shorts short para voce lingua brasileira sinalizado
sinalizar portugues palavra significado the numero cor fruta mes""".split())
CONTRASTE = (" x ", "diferen", "dialogo", "exemplo", "classificador", "frase", "kilogram", "cuantos")


def _sem_acento(t):
    return unicodedata.normalize("NFKD", t.lower()).encode("ascii", "ignore").decode()


def titulo_composto(glosa, titulo):
    """True quando o título fala de outra coisa que contém a glosa: palavra colada antes ou
    depois ("Tênis de Mesa", "Arroz doce", "Quadro branco") ou comparação ("Almoço x Jantar")."""
    t = " " + re.sub(r"\s+", " ", _sem_acento(titulo)) + " "
    if any(c in t for c in CONTRASTE):
        return True
    g = _sem_acento(glosa).replace("-", " ")
    m = re.search(r"(?<![a-z])" + re.escape(g) + r"(?![a-z])", t)
    if not m:
        return False
    antes = t[:m.start()].rstrip()
    colada_antes = re.findall(r"([a-z]+)$", antes)
    com_de = re.findall(r"([a-z]+) de$", antes)
    depois = re.findall(r"^ ?([a-z]+)", t[m.end():])
    return any(w and w[0] not in GENERICAS for w in (colada_antes, com_de, depois))


# ---------------------------------------------------------------------------
# Atributos por quadro
# ---------------------------------------------------------------------------

def mao_dominante(frames, aspect):
    """Rótulo do MediaPipe da mão que mais se mexe (a que sinaliza)."""
    ultimo, movimento = {}, {}
    for f in frames:
        for h in f["hands"]:
            p = np.array([h["lm"][0] * aspect, h["lm"][1]])
            if h["h"] in ultimo:
                movimento[h["h"]] = movimento.get(h["h"], 0.0) + float(np.linalg.norm(p - ultimo[h["h"]]))
            ultimo[h["h"]] = p
    return max(movimento, key=movimento.get) if movimento else None


def features_quadro(f, aspect, dominante):
    """Vetor de F atributos do quadro, ou None sem corpo. Ver o cabeçalho para a ordem."""
    pose = f.get("pose")
    if not pose:
        return None
    P = np.asarray(pose, dtype=np.float64).reshape(-1, 4)
    oe = np.array([P[OMBRO_E, 0] * aspect, P[OMBRO_E, 1]])
    od = np.array([P[OMBRO_D, 0] * aspect, P[OMBRO_D, 1]])
    largura = float(np.linalg.norm(oe - od))
    if largura < 1e-3:
        return None
    meio = (oe + od) / 2
    nariz = np.array([P[NARIZ, 0] * aspect, P[NARIZ, 1]])
    espelho = is_left_hand(dominante)

    maos = {"dom": None, "outra": None}
    for h in f["hands"]:
        slot = "dom" if h["h"] == dominante else "outra"
        if maos[slot] is None:
            maos[slot] = h
        elif maos["outra" if slot == "dom" else "dom"] is None:
            maos["outra" if slot == "dom" else "dom"] = h  # rótulo trocado: ocupa a vaga livre

    out = np.zeros(F)
    for k, slot in enumerate(("dom", "outra")):
        h = maos[slot]
        if h is None:
            continue
        pulso = np.array([h["lm"][0] * aspect, h["lm"][1]])
        rel_ombros = (pulso - meio) / largura
        rel_nariz = (pulso - nariz) / largura
        if espelho:
            rel_ombros[0] = -rel_ombros[0]
            rel_nariz[0] = -rel_nariz[0]
        base = k * POR_MAO
        out[base] = 1.0
        out[base + 1:base + 3] = rel_ombros
        out[base + 3:base + 5] = rel_nariz
        out[base + 5:base + POR_MAO] = normalize_hand(h["lm"], h["h"], aspect)
    return out


def quadros(video):
    """(tempos, matriz [n, F] com NaN onde não há corpo, ativo [n])."""
    aspect = video["aspect"]
    dom = mao_dominante(video["frames"], aspect)
    ts, feats, ativo = [], [], []
    for f in video["frames"]:
        x = features_quadro(f, aspect, dom)
        ts.append(f["t"])
        if x is None:
            feats.append(np.full(F, np.nan))
            ativo.append(False)
            continue
        feats.append(x)
        # mão levantada: alguma mão presente com o pulso perto da linha dos ombros ou acima
        alto = any(x[k * POR_MAO] > 0 and x[k * POR_MAO + 2] < ATIVO_ABAIXO_OMBRO for k in range(2))
        ativo.append(alto)
    return np.array(ts), np.array(feats), np.array(ativo)


# ---------------------------------------------------------------------------
# Janelas candidatas
# ---------------------------------------------------------------------------

def trechos_ativos(ts, ativo):
    out, ini = [], None
    for i, a in enumerate(ativo):
        if a and ini is None:
            ini = i
        if not a and ini is not None:
            out.append([ini, i - 1])
            ini = None
    if ini is not None:
        out.append([ini, len(ativo) - 1])
    juntos = []
    for a, b in out:
        if juntos and ts[a] - ts[juntos[-1][1]] < JUNTAR_GAP_S:
            juntos[-1][1] = b
        else:
            juntos.append([a, b])
    return [(ts[a], ts[b]) for a, b in juntos]


def reamostrar(ts, feats, t0, t1):
    """Janela [t0, t1] em T quadros (interpolação linear; NaN vira zero)."""
    alvo = np.linspace(t0, t1, T)
    x = np.nan_to_num(feats)
    out = np.empty((T, F))
    for j in range(F):
        out[:, j] = np.interp(alvo, ts, x[:, j])
    # presença: arredonda (mão aparece ou não)
    for k in range(2):
        out[:, k * POR_MAO] = (out[:, k * POR_MAO] >= 0.5).astype(float)
    return out


def candidatas(ts, feats, ativo):
    cands = []
    for a, b in trechos_ativos(ts, ativo):
        for dur in JANELAS_S:
            if b - a < dur * 0.6:
                continue
            ini = a - 0.2
            while ini + dur <= b + 0.2 + 1e-9:
                cands.append((ini, ini + dur, reamostrar(ts, feats, ini, ini + dur)))
                ini += PASSO_S
    return cands


def resumo(x):
    """Vetor para comparar janelas: posições e presença com peso cheio, forma da mão com peso menor."""
    pesos = np.zeros(F)
    for k in range(2):
        b = k * POR_MAO
        pesos[b] = 1.0
        pesos[b + 1:b + 5] = 1.0
        pesos[b + 5:b + 5 + 63] = 0.15
        pesos[b + 5 + 63:b + POR_MAO] = 0.5  # direção da mão
    return (x * pesos).reshape(-1)


# ---------------------------------------------------------------------------
# Consenso por sinal
# ---------------------------------------------------------------------------

def consenso(videos, usar_ancoras=False):
    """Para os vídeos de um sinal, escolhe as janelas do sinal. Devolve {id: [índices]} e notas."""
    vids = [v for v in videos if v["_cands"]]
    if len(vids) < 3:
        return {}, {}
    R = [np.stack([resumo(c[2]) for c in v["_cands"]]) for v in vids]

    def dist(A, B):
        d = (A ** 2).sum(1)[:, None] + (B ** 2).sum(1)[None, :] - 2 * A @ B.T
        return np.sqrt(np.maximum(d, 0)) / np.sqrt(A.shape[1])

    # rodada 0: distância da janela à mais parecida de cada outro vídeo
    notas = []
    for i, A in enumerate(R):
        por_video = [dist(A, B).min(axis=1) for j, B in enumerate(R) if j != i]
        notas.append(np.median(np.stack(por_video), axis=0))
    escolha = [int(np.argmin(n)) for n in notas]

    # Vídeos de dicionário (só o sinal, sem introdução) viram a referência quando existem
    ancoras = [j for j, v in enumerate(vids) if usar_ancoras and v["id"].startswith(DICIONARIO)]
    for _ in range(RODADAS):
        refs = [R[j][escolha[j]] for j in range(len(R))]
        notas = []
        for i, A in enumerate(R):
            base = [j for j in ancoras if j != i] or [j for j in range(len(R)) if j != i]
            outras = np.stack([refs[j] for j in base])
            notas.append(np.median(dist(A, outras), axis=1))
        escolha = [int(np.argmin(n)) for n in notas]

    melhores = np.array([notas[i][escolha[i]] for i in range(len(R))])
    med = np.median(melhores)
    mad = np.median(np.abs(melhores - med)) + 1e-6
    out, nota_video = {}, {}
    for i, v in enumerate(vids):
        nota_video[v["id"]] = float(melhores[i])
        if melhores[i] > med + 2 * mad * 1.4826:
            continue  # destoa dos outros vídeos do mesmo sinal
        cands = v["_cands"]
        ordem = np.argsort(notas[i])
        pegos = []
        for c in ordem:
            if notas[i][c] > melhores[i] * REPETICAO_FOLGA:
                break
            t0, t1 = cands[c][0], cands[c][1]
            if all(t1 <= cands[p][0] or t0 >= cands[p][1] for p in pegos):
                pegos.append(int(c))
        out[v["id"]] = pegos
    return out, nota_video


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glosas", default="", help="só estas glosas (separadas por vírgula)")
    # Em 2026-10-25, no piloto de 20 sinais, as âncoras pioraram a validação cruzada (41% contra 47%)
    ap.add_argument("--ancoras", action="store_true", help="usa os dicionários como referência do consenso")
    ap.add_argument("--saida", default=SAIDA)
    args = ap.parse_args()
    filtro = {g for g in args.glosas.split(",") if g}

    with open(os.path.join(DATA, "fontes_sinais.json")) as f:
        titulos = {x["id"]: x.get("title", "") for x in json.load(f)}
    por_glosa = {}
    for path in sorted(glob.glob(os.path.join(ENTRADA, "*.json"))):
        with open(path) as f:
            v = json.load(f)
        g = v.get("glosa")
        if not g or (filtro and g not in filtro):
            continue
        if not v["id"].startswith(DICIONARIO) and titulo_composto(g, titulos.get(v["id"], "")):
            continue
        ts, feats, ativo = quadros(v)
        v["_ts"], v["_cands"] = ts, candidatas(ts, feats, ativo)
        v["frames"] = None  # libera memória
        por_glosa.setdefault(g, []).append(v)

    os.makedirs(ROTULOS, exist_ok=True)
    X, y, pessoa, video, t0s, t1s = [], [], [], [], [], []
    rng = np.random.default_rng(0)
    for g in sorted(por_glosa):
        vids = por_glosa[g]
        escolhidas, notas = consenso(vids, args.ancoras)
        aceitos = 0
        for v in vids:
            pegos = escolhidas.get(v["id"], [])
            sinal = [v["_cands"][c] for c in pegos]
            for t0, t1, x in sinal:
                X.append(x); y.append(g); pessoa.append(v.get("channel_id") or v["id"]); video.append(v["id"])
                t0s.append(t0); t1s.append(t1)
            negs = []
            if sinal:
                aceitos += 1
                livres = [c for c in v["_cands"] if all(c[1] <= s[0] or c[0] >= s[1] for s in sinal)]
                for i in rng.permutation(len(livres)):
                    c = livres[i]
                    if len(negs) >= NEGATIVAS_POR_VIDEO:
                        break
                    if all(c[1] <= n[0] or c[0] >= n[1] for n in negs):
                        negs.append(c)
                for t0, t1, x in negs:
                    X.append(x); y.append(NENHUM); pessoa.append(v.get("channel_id") or v["id"]); video.append(v["id"])
                    t0s.append(t0); t1s.append(t1)
            with open(os.path.join(ROTULOS, f"{v['id']}.json"), "w") as f:
                json.dump({
                    "id": v["id"], "glosa": g, "nota": notas.get(v["id"]), "aceito": bool(sinal),
                    "sinal": [[round(a, 2), round(b, 2)] for a, b, _ in sinal],
                    "negativas": [[round(a, 2), round(b, 2)] for a, b, _ in negs],
                }, f, ensure_ascii=False)
        print(f"{g}: {aceitos}/{len(vids)} vídeos aceitos, {sum(1 for yy in y if yy == g)} janelas", flush=True)

    np.savez_compressed(args.saida, X=np.array(X, dtype=np.float32), y=np.array(y), pessoa=np.array(pessoa),
                        video=np.array(video), t0=np.array(t0s), t1=np.array(t1s))
    print(f"{len(X)} janelas ({sum(1 for yy in y if yy == NENHUM)} de nenhum sinal) em {args.saida}")


if __name__ == "__main__":
    main()
