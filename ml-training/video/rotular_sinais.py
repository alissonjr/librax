"""
Rotula os vídeos de sinais e gera o dataset do modelo de movimento. Lê os landmarks de
data/landmarks_sinais/ (gravados pela página treino-video.html no modo sinais, cerca de 5 quadros
por segundo) ou, com --entrada, de outra pasta no mesmo formato, como data/sinais15/landmarks/
(video/extrair_sinais.py, 15 quadros por segundo, a taxa da câmera do app).

Cada vídeo "sinal de X em Libras" tem introdução, fala e o sinal (às vezes repetido). O título diz
qual é o sinal, mas não quando. Como sai o trecho:
0. Vídeo cujo título fala de outra coisa com a glosa dentro ("Tênis de Mesa", "Arroz doce",
   "Almoço x Jantar") fica de fora (titulo_composto). Números ficam de fora (têm o modelo próprio,
   video/rotular_numeros.py).
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
5. Com --paradas (lição das letras com movimento: a forma parada não é o sinal), os momentos de
   mão levantada e parada do mesmo vídeo (a pose do começo ou do fim do sinal, segurada) também
   viram "_": janelas com pelo menos PARADA_DENTRO da duração em trecho parado, até
   PARADAS_POR_VIDEO por vídeo. Trecho parado: quadros ativos com velocidade (pulsos em larguras
   de ombro por segundo, mais a mudança da forma da mão) abaixo de PARADA_VEL, por pelo menos
   PARADA_MIN_S. Janela com mais de MAX_PARADA_NO_SINAL da duração parada não concorre a sinal.

Mão dominante: com --dominante video (o padrão antigo), a que mais se mexe no vídeo inteiro. Com
--dominante buffer, a de cada janela é calculada como o app faz ao vivo (signRecognizer.ts): a que
mais se mexe nos BUFFER_S segundos de quadros que terminam no fim da janela e, sem movimento, a
mais vista (dominante_ao_vivo).

Atributos por quadro (features_quadro), em relação ao corpo, na ordem: para a mão dominante e
depois a outra, [presença, pulso x/y a partir do meio dos ombros, pulso x/y a partir do nariz,
65 da normalize_hand]. Posições em larguras de ombro, x com o aspecto corrigido, espelhadas quando
a dominante é a esquerda da pessoa. Sem a mão, tudo zero. F = 2 x 70 = 140.

Saídas em data/ (pastas e nomes mudam com --rotulos e --saida):
- dataset_sinais.npz: X [N, T, F] float32, y, pessoa (canal), video, t0, t1 e tipo ("sinal",
  "outro" para as negativas do passo 4, "parada" para as do passo 5).
- rotulos_sinais/<id>.json: janelas escolhidas, negativas e paradas de cada vídeo, para conferir.

Vídeos de outras listas (video/baixar_extra.py, data/sinais15/fontes_extra.json) entram com
--fontes-extra (título e canal) e com mais uma pasta em --entrada (data/sinais15/landmarks_extra).

Uso:
    python video/rotular_sinais.py [--glosas A,B,...]
    python video/rotular_sinais.py --entrada data/sinais15/landmarks --dominante buffer --paradas \
        --rotulos data/sinais15/rotulos --saida data/sinais15/dataset.npz
    (LIBRAX_DATA=/caminho/data aponta para outra pasta de dados)
"""

import argparse
import glob
import json
import multiprocessing
import os
import re
import sys
import unicodedata

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
from train_static import is_left_hand, normalize_hand  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
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
# Buffer de quadros do app (BUFFER_S do signRecognizer.ts), para a mão dominante ao vivo
BUFFER_S = 2.5
# Mão levantada e parada (passo 5 do cabeçalho)
PARADA_VEL = 0.35
PARADA_PESO_FORMA = 0.3
PARADA_MIN_S = 0.5
PARADA_DENTRO = 0.85
MAX_PARADA_NO_SINAL = 0.7
PARADAS_POR_VIDEO = 6
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


def mais_vista(frames):
    """Rótulo de mão que mais aparece nos quadros (empate: o que apareceu primeiro), ou None."""
    cont = {}
    for f in frames:
        for h in f["hands"]:
            cont[h["h"]] = cont.get(h["h"], 0) + 1
    melhor, n = None, 0
    for k, c in cont.items():
        if c > n:
            melhor, n = k, c
    return melhor


def dominante_ao_vivo(frames, aspect):
    """Mão dominante como o app calcula no buffer: a que mais se mexe; sem movimento, a mais vista."""
    dom = mao_dominante(frames, aspect)
    return dom if dom is not None else mais_vista(frames)


def velocidade(ts, feats):
    """
    Velocidade de cada quadro em relação ao anterior com corpo: soma, nas vagas com mão nos dois
    quadros, do deslocamento do pulso (larguras de ombro) e de PARADA_PESO_FORMA vezes a mudança
    média dos pontos da normalize_hand; mão que aparece ou some conta 0,5. Por segundo, com a
    mediana de 3 quadros. NaN sem corpo.
    """
    n = len(ts)
    v = np.full(n, np.nan)
    ant = None
    for i in range(n):
        x = feats[i]
        if np.isnan(x[0]):
            continue
        if ant is not None:
            a = feats[ant]
            d = 0.0
            for k in range(2):
                b0 = k * POR_MAO
                pa, pb = a[b0] > 0, x[b0] > 0
                if pa and pb:
                    d += float(np.linalg.norm(x[b0 + 1:b0 + 3] - a[b0 + 1:b0 + 3]))
                    d += PARADA_PESO_FORMA * float(np.linalg.norm(x[b0 + 5:b0 + 68] - a[b0 + 5:b0 + 68])) / np.sqrt(21)
                elif pa != pb:
                    d += 0.5
            v[i] = d / max(ts[i] - ts[ant], 1e-3)
        ant = i
    out = v.copy()
    for i in range(1, n - 1):
        trio = v[i - 1:i + 2]
        if not np.isnan(trio).any():
            out[i] = float(np.median(trio))
    return out


class Quadros:
    """
    Atributos dos quadros de um vídeo. `modo` "video": mão dominante do vídeo inteiro (o padrão
    antigo); "buffer": a de cada janela, como o app ao vivo (dominante_ao_vivo nos BUFFER_S
    segundos que terminam no fim da janela).
    """

    def __init__(self, video, modo="video"):
        self.aspect = video["aspect"]
        self.frames = video["frames"]
        self.modo = modo
        self.ts = np.array([f["t"] for f in self.frames], dtype=np.float64)
        self._feats = {}
        self.dom_video = mao_dominante(self.frames, self.aspect)
        base = self.feats(self.dom_video)
        tem = ~np.isnan(base[:, 0])
        # mão levantada: alguma mão presente com o pulso perto da linha dos ombros ou acima
        alto = np.zeros(len(self.ts), dtype=bool)
        for k in range(2):
            alto |= tem & (np.nan_to_num(base[:, k * POR_MAO]) > 0) & (np.nan_to_num(base[:, k * POR_MAO + 2]) < ATIVO_ABAIXO_OMBRO)
        self.ativo = alto
        self.vel = velocidade(self.ts, base)
        parado = self.ativo & (np.nan_to_num(self.vel, nan=np.inf) < PARADA_VEL)
        self.paradas = [(a, b) for a, b in _trechos(self.ts, parado) if b - a >= PARADA_MIN_S]

    def feats(self, dom):
        """Matriz [n, F] com a dominante `dom` (NaN onde não há corpo)."""
        if dom not in self._feats:
            out = np.full((len(self.ts), F), np.nan)
            for i, f in enumerate(self.frames):
                x = features_quadro(f, self.aspect, dom)
                if x is not None:
                    out[i] = x
            self._feats[dom] = out
        return self._feats[dom]

    def dominante(self, t1):
        if self.modo != "buffer":
            return self.dom_video
        i1 = int(np.searchsorted(self.ts, t1, side="right"))
        if i1 == 0:
            return None
        i0 = int(np.searchsorted(self.ts, self.ts[i1 - 1] - BUFFER_S, side="left"))
        return dominante_ao_vivo(self.frames[i0:i1], self.aspect)

    def janela(self, t0, t1):
        return reamostrar(self.ts, self.feats(self.dominante(t1)), t0, t1)

    def fracao_parada(self, t0, t1):
        dentro = sum(max(0.0, min(t1, b) - max(t0, a)) for a, b in self.paradas)
        return dentro / max(t1 - t0, 1e-6)


def _trechos(ts, marca):
    """Trechos [(t_ini, t_fim)] de quadros seguidos com `marca`."""
    out, ini = [], None
    for i, m in enumerate(marca):
        if m and ini is None:
            ini = i
        if not m and ini is not None:
            out.append((ts[ini], ts[i - 1]))
            ini = None
    if ini is not None:
        out.append((ts[ini], ts[len(marca) - 1]))
    return out


def quadros(video):
    """(tempos, matriz [n, F] com NaN onde não há corpo, ativo [n]), com a dominante do vídeo."""
    q = Quadros(video)
    return q.ts, q.feats(q.dom_video), q.ativo


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


def candidatas(q):
    """Janelas candidatas [(t0, t1, [T, F], fração parada)] dos trechos ativos de um Quadros."""
    cands = []
    for a, b in trechos_ativos(q.ts, q.ativo):
        for dur in JANELAS_S:
            if b - a < dur * 0.6:
                continue
            ini = a - 0.2
            while ini + dur <= b + 0.2 + 1e-9:
                cands.append((ini, ini + dur, q.janela(ini, ini + dur), q.fracao_parada(ini, ini + dur)))
                ini += PASSO_S
    return cands


def janelas_paradas(q, rng, n_max):
    """Janelas "_" de mão levantada e parada (passo 5): pelo menos PARADA_DENTRO dentro das paradas."""
    achadas = []
    for a, b in q.paradas:
        for dur in JANELAS_S:
            fim = a + dur * PARADA_DENTRO
            while fim <= b + dur * (1 - PARADA_DENTRO) + 1e-9:
                t0, t1 = fim - dur, fim
                if q.fracao_parada(t0, t1) >= PARADA_DENTRO:
                    achadas.append((t0, t1))
                fim += PASSO_S
    out = []
    for i in rng.permutation(len(achadas)):
        if len(out) >= n_max:
            break
        t0, t1 = achadas[i]
        # sem repetir quase a mesma janela
        if all(abs(t0 - o[0]) > PASSO_S / 2 or abs(t1 - o[1]) > PASSO_S / 2 for o in out):
            out.append((t0, t1))
    return [(t0, t1, q.janela(t0, t1)) for t0, t1 in sorted(out)]


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


def rotular_glosa(job):
    """Rotula os vídeos de uma glosa (roda num processo à parte). Devolve (glosa, colunas, linha de log)."""
    g, paths, titulos, cfg = job
    rng = np.random.default_rng(cfg["seed"])
    vids = []
    for path in paths:
        with open(path) as f:
            v = json.load(f)
        if not v["id"].startswith(DICIONARIO) and titulo_composto(g, titulos.get(v["id"], "")):
            continue
        q = Quadros(v, cfg["dominante"])
        todas = candidatas(q)
        # com --paradas, janela quase toda parada não concorre a sinal
        v["_todas"] = todas
        v["_cands"] = [c for c in todas if not cfg["paradas"] or c[3] <= MAX_PARADA_NO_SINAL]
        v["_q"] = q
        v["frames"] = None  # libera memória (o Quadros guarda o que precisa)
        vids.append(v)
    escolhidas, notas = consenso(vids, cfg["ancoras"])
    cols = {k: [] for k in ("X", "y", "pessoa", "video", "t0", "t1", "tipo")}

    def junta(v, t0, t1, x, rotulo, tipo):
        cols["X"].append(x.astype(np.float32)); cols["y"].append(rotulo)
        cols["pessoa"].append(v.get("channel_id") or v["id"]); cols["video"].append(v["id"])
        cols["t0"].append(t0); cols["t1"].append(t1); cols["tipo"].append(tipo)

    aceitos = 0
    for v in vids:
        pegos = escolhidas.get(v["id"], [])
        sinal = [v["_cands"][c] for c in pegos]
        for t0, t1, x, _ in sinal:
            junta(v, t0, t1, x, g, "sinal")
        negs, paradas = [], []
        if sinal:
            aceitos += 1
            livres = [c for c in v["_todas"] if all(c[1] <= s[0] or c[0] >= s[1] for s in sinal)
                      and (not cfg["paradas"] or c[3] <= MAX_PARADA_NO_SINAL)]
            for i in rng.permutation(len(livres)):
                c = livres[i]
                if len(negs) >= NEGATIVAS_POR_VIDEO:
                    break
                if all(c[1] <= n[0] or c[0] >= n[1] for n in negs):
                    negs.append(c)
            for t0, t1, x, _ in negs:
                junta(v, t0, t1, x, NENHUM, "outro")
            if cfg["paradas"]:
                paradas = janelas_paradas(v["_q"], rng, PARADAS_POR_VIDEO)
                for t0, t1, x in paradas:
                    junta(v, t0, t1, x, NENHUM, "parada")
        if cfg["rotulos"]:
            with open(os.path.join(cfg["rotulos"], f"{v['id']}.json"), "w") as f:
                json.dump({
                    "id": v["id"], "glosa": g, "nota": notas.get(v["id"]), "aceito": bool(sinal),
                    "sinal": [[round(a, 2), round(b, 2)] for a, b, _, _ in sinal],
                    "negativas": [[round(a, 2), round(b, 2)] for a, b, _, _ in negs],
                    "paradas": [[round(a, 2), round(b, 2)] for a, b, _ in paradas],
                    "trechos_parados": [[round(a, 2), round(b, 2)] for a, b in v["_q"].paradas],
                }, f, ensure_ascii=False)
    n_sinal = sum(1 for t in cols["tipo"] if t == "sinal")
    n_par = sum(1 for t in cols["tipo"] if t == "parada")
    linha = f"{g}: {aceitos}/{len(vids)} vídeos aceitos, {n_sinal} janelas, {n_par} paradas"
    return g, cols, linha


def carregar_fontes(extras=()):
    """{id: fonte} do fontes_sinais.json mais as listas `extras` (mesmo formato)."""
    with open(os.path.join(DATA, "fontes_sinais.json")) as f:
        fontes = {x["id"]: x for x in json.load(f)}
    for path in extras:
        with open(path) as f:
            fontes.update({x["id"]: x for x in json.load(f)})
    return fontes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glosas", default="", help="só estas glosas (separadas por vírgula)")
    # Em 2026-10-25, no piloto de 20 sinais, as âncoras pioraram a validação cruzada (41% contra 47%)
    ap.add_argument("--ancoras", action="store_true", help="usa os dicionários como referência do consenso")
    ap.add_argument("--entrada", nargs="+", default=[ENTRADA], help="pastas dos landmarks (padrão: landmarks_sinais)")
    ap.add_argument("--fontes-extra", nargs="*", default=[], help="outras listas no formato do fontes_sinais.json")
    ap.add_argument("--rotulos", default=ROTULOS, help="pasta dos rótulos por vídeo")
    ap.add_argument("--saida", default=SAIDA)
    ap.add_argument("--dominante", choices=("video", "buffer"), default="video",
                    help="mão dominante do vídeo inteiro ou do buffer do app no fim de cada janela")
    ap.add_argument("--paradas", action="store_true", help="mão levantada e parada também vira \"_\" (passo 5)")
    ap.add_argument("--processos", type=int, default=1)
    args = ap.parse_args()
    filtro = {g for g in args.glosas.split(",") if g}

    fontes = carregar_fontes(args.fontes_extra)
    titulos = {i: x.get("title", "") for i, x in fontes.items()}
    por_glosa = {}
    paths = sorted(p for pasta in args.entrada for p in glob.glob(os.path.join(pasta, "*.json")))
    for path in paths:
        vid = os.path.basename(path)[:-5]
        fonte = fontes.get(vid)
        if fonte is not None and fonte.get("fora"):
            continue  # tirado na revisão das folhas (motivo no "fora" da lista)
        if fonte is not None:
            g = fonte.get("glosa") if fonte.get("tipo") == "sinal" else None
        else:
            with open(path) as f:
                g = json.load(f).get("glosa")
        # números têm o modelo próprio (video/rotular_numeros.py)
        if not g or g.isdigit() or (filtro and g not in filtro):
            continue
        por_glosa.setdefault(g, []).append(path)

    os.makedirs(args.rotulos, exist_ok=True)
    cfg = {"dominante": args.dominante, "paradas": args.paradas, "ancoras": args.ancoras, "rotulos": args.rotulos}
    jobs = [(g, por_glosa[g], titulos, {**cfg, "seed": i}) for i, g in enumerate(sorted(por_glosa))]
    cols = {k: [] for k in ("X", "y", "pessoa", "video", "t0", "t1", "tipo")}
    if args.processos > 1:
        pool = multiprocessing.Pool(args.processos)
        resultados = pool.imap(rotular_glosa, jobs)
    else:
        pool = None
        resultados = map(rotular_glosa, jobs)
    for g, c, linha in resultados:
        for k in cols:
            cols[k] += c[k]
        print(linha, flush=True)
    if pool is not None:
        pool.close()

    X = np.array(cols["X"], dtype=np.float32).reshape(-1, T, F)
    np.savez_compressed(args.saida, X=X, y=np.array(cols["y"]), pessoa=np.array(cols["pessoa"]),
                        video=np.array(cols["video"]), t0=np.array(cols["t0"]), t1=np.array(cols["t1"]),
                        tipo=np.array(cols["tipo"]))
    y = cols["y"]
    print(f"{len(y)} janelas ({sum(1 for yy in y if yy == NENHUM)} de nenhum sinal, "
          f"{sum(1 for t in cols['tipo'] if t == 'parada')} paradas) em {args.saida}")


if __name__ == "__main__":
    main()
