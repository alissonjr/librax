"""
Rotula as paradas dos números de 0 a 9 (forma cardinal, a que o curso escolheu em signs.json) e
gera o dataset JSONL no mesmo formato das letras, para o train_numeros.py.

Os dez números são formas de mão paradas (recognition "static" em signs.json). De onde vêm:
- vídeos de um número (fontes_sinais.json, glosa "0" a "9"): a sequência é o próprio número;
- vídeos de números compostos, que o curso descreve como dígitos em sequência no mesmo lugar
  (10, 12 a 19, 20, 30, 60, 70, 80, 90 e 100; o 11 balança o 1 e para nele): a sequência sai da
  glosa ("16" -> 1, 6). O 40 e o 50 usam outra forma de 4 e de 0 e ficam de fora;
- trechos de aulas longas listados em numeros_trechos.json (início, fim e a ordem dos números).
No dicionário do INES, quando há mais de um verbete do número (forma de quantidade, QUARENTA),
vale só o verbete que o curso usa (source.url em signs.json).

Como sai o rótulo (o mesmo caminho do rotular.py das letras):
1. Paradas: trechos em que a forma e a posição da mão ficam estáveis (rotular.paradas). Parada com
   a mão em repouso (mãos juntas ou baixas, negativas.repouso) não pode ser número.
2. Pontuação de cada parada contra cada número: regras de dedos e direção (rodada 0) e, nas
   rodadas seguintes, um classificador treinado com as paradas rotuladas dos OUTROS canais
   (consenso entre pessoas: a forma que se repete em canais diferentes é o número; introdução e
   fala mudam de canal para canal). Número que nenhum outro canal tem fica só com as regras.
   Em todas as rodadas soma a pista do número escrito na tela (OCR no meio da parada, cache em
   data/numeros/ocr/<id>.json).
3. Alinhamento monotônico (rotular.alinhar) encaixa as paradas na sequência; o resto vira lixo.
4. Checagem: a parada fica se o modelo dos outros canais concordar (entre os CHECAGEM_TOP com
   pelo menos CHECAGEM_MIN_P), se o número estiver escrito na tela, ou, para número sem outro
   canal, se as regras concordarem. Fica uma parada por posição da sequência (a mais longa x
   mais confiável).

A classe "_" (nenhum número) vem de data/negativas.jsonl (video/negativas.py: mãos em repouso).

Saídas em data/numeros/ (fora do git):
- dataset_numeros.jsonl: uma linha por quadro (person_id = canal, "parada" = vídeo:índice);
- rotulos/<id>.json: as paradas de cada vídeo com o número e se foi aceita, para conferir.

Uso:
    python video/rotular_numeros.py [--rodadas 3] [--quadros-por-parada 12]
    (LIBRAX_DATA=/caminho/data aponta para outra pasta de dados)
"""

import argparse
import collections
import glob
import json
import os
import sys
import warnings

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, ".."))
import rotular  # noqa: E402
from negativas import OMBRO_D, OMBRO_E, repouso  # noqa: E402
from rotular_sinais import DICIONARIO, titulo_composto  # noqa: E402
from train_static import NORMALIZATION_VERSION, normalize_hand  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
SAIDA_DIR = os.path.join(DATA, "numeros")
SAIDA = os.path.join(SAIDA_DIR, "dataset_numeros.jsonl")
ROTULOS = os.path.join(SAIDA_DIR, "rotulos")
OCR_DIR = os.path.join(SAIDA_DIR, "ocr")
TRECHOS = os.path.join(AQUI, "..", "numeros_trechos.json")
CONTENT = os.path.join(AQUI, "..", "..", "apps", "web-poc", "src", "assets", "content")

DIGITOS = [str(d) for d in range(10)]
NENHUM = "_"
# Glosa do vídeo -> dígitos na ordem em que aparecem (descrição do curso em signs.json)
SEQUENCIAS = {**{d: [d] for d in DIGITOS}, "10": ["1", "0"], "11": ["1"], "100": ["1", "0"],
              **{str(n): ["1", str(n - 10)] for n in range(12, 20)},
              **{str(n): [str(n // 10), "0"] for n in (20, 30, 60, 70, 80, 90)}}

# Regras da rodada 0 (mesmo formato do rotular.PADROES): polegar, indicador, médio, anelar,
# mínimo (1 estendido, 0 dobrado, None sem regra) e direção pulso -> base do médio.
PADROES = {
    "0": (None, None, None, None, None, None),  # O: dedos curvados tocando o polegar
    "1": (1, 0, 0, 0, 0, None),                 # mão fechada, polegar para cima
    "2": (1, 1, 0, 0, 0, "lado"),               # polegar para cima, indicador na horizontal
    "3": (1, 1, 1, 0, 0, "lado"),               # polegar, indicador e médio na horizontal
    "4": (0, 1, 1, 1, 1, "lado"),               # quatro dedos na horizontal, polegar dobrado
    "5": (0, None, None, 0, 0, None),           # indicador e médio em gancho
    "6": (1, 0, 0, 0, 0, None),                 # polegar para cima, dedos em gancho
    "7": (0, 1, 0, 0, 0, "lado"),               # só o indicador na horizontal
    "8": (0, 0, 0, 0, 0, None),                 # mão fechada, polegar por cima
    "9": (1, 0, 0, 0, 0, None),                 # polegar para baixo, dedos em gancho
}

CHECAGEM_TOP = 3
CHECAGEM_MIN_P = 0.2
PESO_REGRAS = 0.5  # mistura com o classificador dos outros canais (poucos canais: as regras pesam)
MIN_PARADA_ACEITA_S = 0.25  # os vídeos de dicionário são curtos (cerca de 8 quadros por segundo)
# Os números ficam na altura do rosto ou do peito; nos vídeos do canal da Suzana, por exemplo, a mão
# do número fica perto da linha dos ombros (0 a 0,2) e as mãos em repouso, juntas, a 0,8
MAX_ABAIXO_OMBRO = 0.5
# Velocidade de forma da parada: a das letras (rotular.VEL_FORMA = 4) quebra a parada no tremor
# dos dedos dobrados a 8 quadros por segundo. Aqui é mais solta; dividir() separa as formas
# diferentes que acabarem juntas.
VEL_FORMA = 12.0
DIVIDIR_DIST = 0.8
BONUS_ULTIMO = np.log(3.0)
DIVIDIR_MIN_QUADROS = 2
OCR_MIN_CONF = 0.6
OCR_TROCAS = {"O": "0", "o": "0"}


def pontos_regras(v):
    d = rotular.dedos(v)
    dirs = rotular.direcao(v)
    out = []
    for L in DIGITOS:
        pad = PADROES[L]
        s = 0.0
        for k in range(5):
            q = 0.5 if pad[k] is None else (d[k] if pad[k] == 1 else 1 - d[k])
            s += np.log(0.1 + 0.85 * q)
        q = 0.5 if pad[5] is None else dirs[pad[5]]
        s += np.log(0.1 + 0.85 * q)
        out.append(s)
    out = np.exp(np.array(out))
    return out / out.sum()


# ---------------------------------------------------------------------------
# Vídeos
# ---------------------------------------------------------------------------

def quadros(video):
    """
    Como rotular.quadros, mas sempre com a mão mais alta do quadro. Nos vídeos de um número a
    outra mão costuma ficar parada embaixo, presente em mais quadros: a regra das letras (a mão
    que mais aparece levantada) escolheria a mão em repouso.
    """
    aspect = video["aspect"]
    out = []
    for f in video["frames"]:
        h = rotular.escolher_mao(f["hands"], None)  # sem dominante: a mais alta
        if h is None:
            out.append(None)
            continue
        pts = np.asarray(h["lm"], dtype=np.float64).reshape(21, 3)
        palmo = np.hypot((pts[9, 0] - pts[0, 0]) * aspect, pts[9, 1] - pts[0, 1])
        out.append({"t": f["t"], "raw": h["lm"], "h": h["h"], "v": normalize_hand(h["lm"], h["h"], aspect),
                    "pulso": np.array([pts[0, 0] * aspect, pts[0, 1]]), "palmo": max(palmo, 1e-3)})
    return out


def abaixo_ombros(frame, q, aspect):
    """True quando o pulso está mais de MAX_ABAIXO_OMBRO larguras de ombro abaixo dos ombros
    (mãos descansando na cintura). Sem corpo no quadro (vídeos de letras), não decide."""
    pose = frame.get("pose")
    if not pose:
        return False
    P = np.asarray(pose).reshape(-1, 4)
    largura = np.hypot((P[OMBRO_E, 0] - P[OMBRO_D, 0]) * aspect, P[OMBRO_E, 1] - P[OMBRO_D, 1])
    if largura < 1e-3:
        return False
    return (q["raw"][1] - (P[OMBRO_E, 1] + P[OMBRO_D, 1]) / 2) / largura > MAX_ABAIXO_OMBRO


def dividir(qs, idx):
    """
    Divide uma parada que juntou dois números: a troca de um dígito para o outro no mesmo lugar
    (1 -> 2 abrindo o indicador) às vezes é lenta demais para quebrar a parada, sobretudo a 7 ou
    8 quadros por segundo. Corta no ponto em que as duas metades mais diferem, se a diferença
    passar de DIVIDIR_DIST, e repete em cada pedaço.
    """
    if len(idx) < 2 * DIVIDIR_MIN_QUADROS:
        return [idx]
    V = np.stack([qs[i]["v"] for i in idx])
    melhor, corte = 0.0, None
    for k in range(DIVIDIR_MIN_QUADROS, len(idx) - DIVIDIR_MIN_QUADROS + 1):
        d = np.linalg.norm(np.median(V[:k], axis=0) - np.median(V[k:], axis=0))
        if d > melhor:
            melhor, corte = d, k
    if corte is None or melhor < DIVIDIR_DIST:
        return [idx]
    return dividir(qs, idx[:corte]) + dividir(qs, idx[corte:])


def urls_do_curso():
    with open(os.path.join(CONTENT, "signs.json")) as f:
        raw = json.load(f)
    signs = raw if isinstance(raw, list) else list(raw.values())
    return {s["gloss"]: (s.get("source") or {}).get("url") for s in signs if s.get("category") == "numeros"}


def carregar_videos():
    """Lista de vídeos com sequência, canal e os quadros da mão (fora do trecho: None)."""
    fontes = json.load(open(os.path.join(DATA, "fontes_sinais.json")))
    curso = urls_do_curso()
    itens = []
    for f in fontes:
        g = str(f.get("glosa", ""))
        if g not in SEQUENCIAS:
            continue
        path = os.path.join(DATA, "landmarks_sinais", f"{f['id']}.json")
        if not os.path.exists(path):
            continue
        if f["id"].startswith(DICIONARIO):
            url = curso.get(g)
            # verbete do INES diferente do que o curso usa (forma de quantidade, QUARENTA)
            if f.get("channel_id") == "dic-ines" and url and "ines.gov.br" in url and f.get("url") != url:
                continue
        elif titulo_composto(g, f.get("title", "")):
            continue
        itens.append((path, f, SEQUENCIAS[g], None, f.get("arquivo")))
    if os.path.exists(TRECHOS):
        fontes_letras = {x["id"]: x for x in json.load(open(os.path.join(DATA, "fontes.json")))}
        for t in json.load(open(TRECHOS))["trechos"]:
            path = os.path.join(DATA, t["pasta"], f"{t['id']}.json")
            if os.path.exists(path):
                f = fontes_letras.get(t["id"], {"id": t["id"]})
                itens.append((path, f, t["sequencia"], (t["ini"], t["fim"]), f.get("arquivo")))

    rotular.VEL_FORMA = VEL_FORMA
    videos = []
    for path, f, seq, janela, arquivo in itens:
        with open(path) as fh:
            v = json.load(fh)
        v["channel_id"] = v.get("channel_id") or f.get("channel_id") or v["id"]
        v["channel"] = f.get("channel", "")
        v["glosa"] = f.get("glosa")
        v["sequencia"] = seq
        v["arquivo"] = arquivo
        v["janela"] = janela
        qs = quadros(v)
        for i, (fr, q) in enumerate(zip(v["frames"], qs)):
            if q is None:
                continue
            if janela and not (janela[0] <= fr["t"] <= janela[1]):
                qs[i] = None
                continue
            # mão em repouso ou baixa não é número
            if any(h["lm"] == q["raw"] for h in repouso(fr, v["aspect"])) or abaixo_ombros(fr, q, v["aspect"]):
                qs[i] = None
        ps = [d for p in rotular.paradas(qs) for d in dividir(qs, p)]
        v["frames"] = None
        if not ps:
            continue
        v["_qs"], v["_ps"] = qs, ps
        v["_feat"] = np.stack([rotular.media(qs, p) for p in ps])
        v["_regras"] = np.stack([pontos_regras(x) for x in v["_feat"]])
        v["_dur"] = [qs[p[-1]]["t"] - qs[p[0]]["t"] for p in ps]
        videos.append(v)
    return videos


# ---------------------------------------------------------------------------
# Número escrito na tela
# ---------------------------------------------------------------------------

def ocr(videos):
    """Dígitos lidos na tela no meio de cada parada (com cache) em v["_ocr"]: lista de sets."""
    from multiprocessing import Pool

    os.makedirs(OCR_DIR, exist_ok=True)
    jobs, caches = [], {}
    for v in videos:
        cache_path = os.path.join(OCR_DIR, f"{v['id']}.json")
        caches[v["id"]] = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
        v["_meios"] = [v["_qs"][p[len(p) // 2]]["t"] for p in v["_ps"]]
        falta = [t for t in v["_meios"] if f"{t:.2f}" not in caches[v["id"]]]
        if falta and v["arquivo"]:
            jobs.append((v["id"], (os.path.join(DATA, "videos", v["arquivo"]), falta)))
    if jobs:
        print(f"OCR em {sum(len(j[1][1]) for j in jobs)} parada(s) de {len(jobs)} vídeo(s)...", flush=True)
        with Pool(4, initializer=rotular._ocr_init) as pool:
            for (vid, _), res in zip(jobs, pool.imap(rotular._ocr_job, [j[1] for j in jobs])):
                caches[vid].update(res)
                with open(os.path.join(OCR_DIR, f"{vid}.json"), "w") as f:
                    json.dump(caches[vid], f)
    for v in videos:
        lidas = []
        for t in v["_meios"]:
            digs = set()
            for txt, conf in caches[v["id"]].get(f"{t:.2f}", []):
                txt = "".join(OCR_TROCAS.get(c, c) for c in txt)
                if conf >= OCR_MIN_CONF and txt.isdigit():
                    digs |= set(txt)  # "10" na tela: a parada pode ser o 1 ou o 0
            lidas.append(digs if len(digs) <= 2 else set())
        v["_ocr"] = lidas


def pista_ocr(v):
    out = np.zeros((len(v["_ps"]), len(v["sequencia"])))
    for i, digs in enumerate(v["_ocr"]):
        if digs:
            for j, d in enumerate(v["sequencia"]):
                out[i, j] = rotular.OCR_BONUS if d in digs else -rotular.OCR_MULTA
    return out


# ---------------------------------------------------------------------------
# Rodadas
# ---------------------------------------------------------------------------

def probs_outros_canais(videos, rotulos):
    """
    Para cada vídeo, a probabilidade de cada número em cada parada segundo um classificador
    treinado só com as paradas rotuladas dos outros canais, misturada com as regras. Número sem
    exemplo nos outros canais fica só com as regras. Devolve {id: [paradas x 10]} e, por vídeo,
    o conjunto de números que os outros canais têm.
    """
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    canais = sorted({v["channel_id"] for v in videos})
    out, conhecidos = {}, {}
    for c in canais:
        X = [f for v in videos if v["channel_id"] != c for f, L in zip(v["_feat"], rotulos[v["id"]]) if L]
        y = [L for v in videos if v["channel_id"] != c for L in rotulos[v["id"]] if L]
        alvo = [v for v in videos if v["channel_id"] == c]
        if len(set(y)) < 2:
            for v in alvo:
                out[v["id"]], conhecidos[v["id"]] = v["_regras"], set()
            continue
        sc = StandardScaler().fit(X)
        clf = MLPClassifier(hidden_layer_sizes=(64,), alpha=1e-2, max_iter=600, random_state=0)
        clf.fit(sc.transform(X), y)
        idx = {L: i for i, L in enumerate(clf.classes_)}
        for v in alvo:
            p = clf.predict_proba(sc.transform(v["_feat"]))
            full = v["_regras"].copy()
            for j, L in enumerate(DIGITOS):
                if L in idx:
                    full[:, j] = (1 - PESO_REGRAS) * p[:, idx[L]] + PESO_REGRAS * v["_regras"][:, j]
            out[v["id"]] = full / full.sum(axis=1, keepdims=True)
            conhecidos[v["id"]] = set(idx)
    return out, conhecidos


def alinhar_video(v, P):
    s = np.log(P[:, [DIGITOS.index(d) for d in v["sequencia"]]] + 1e-4)
    if v["janela"] is None and len(v["sequencia"]) == 2:
        # número composto: o primeiro dígito passa rápido e o último fica parado (signs.json)
        s[:, -1] += BONUS_ULTIMO
    return rotular.alinhar(s + pista_ocr(v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rodadas", type=int, default=3)
    ap.add_argument("--quadros-por-parada", type=int, default=12)
    args = ap.parse_args()
    warnings.filterwarnings("ignore", message=".*(converge|Maximum iterations).*")

    videos = carregar_videos()
    ocr(videos)
    canais = collections.Counter(v["channel_id"] for v in videos)
    print(f"{len(videos)} vídeo(s) com paradas de {len(canais)} canal(is)")

    P = {v["id"]: v["_regras"] for v in videos}
    conhecidos = {v["id"]: set() for v in videos}
    for rodada in range(args.rodadas + 1):
        rotulos = {}
        for v in videos:
            al = alinhar_video(v, P[v["id"]])
            v["_pos"] = al
            rotulos[v["id"]] = [v["sequencia"][j] if j >= 0 else None for j in al]
        n = sum(1 for r in rotulos.values() for L in r if L)
        print(f"rodada {rodada}: {n} paradas rotuladas", flush=True)
        if rodada < args.rodadas:
            P, conhecidos = probs_outros_canais(videos, rotulos)

    # Checagem e uma parada por posição da sequência
    for v in videos:
        Pv = P[v["id"]]
        aceita = [False] * len(v["_ps"])
        melhor = {}
        for i, j in enumerate(v["_pos"]):
            if j < 0 or v["_dur"][i] < MIN_PARADA_ACEITA_S:
                continue
            d = v["sequencia"][j]
            k = DIGITOS.index(d)
            top = np.argsort(-Pv[i])[:CHECAGEM_TOP]
            if d in conhecidos[v["id"]]:
                ok = k in top and Pv[i, k] >= CHECAGEM_MIN_P
            else:
                ok = k in np.argsort(-v["_regras"][i])[:CHECAGEM_TOP]
            ok = ok or d in v["_ocr"][i]
            if not ok:
                continue
            nota = v["_dur"][i] * Pv[i, k]
            if j not in melhor or nota > melhor[j][1]:
                melhor[j] = (i, nota)
        for i, _ in melhor.values():
            aceita[i] = True
        v["_aceita"] = aceita

    os.makedirs(ROTULOS, exist_ok=True)
    for velho in glob.glob(os.path.join(ROTULOS, "*.json")):
        os.remove(velho)  # vídeo que deixou de ter parada não pode ficar com o rótulo antigo
    rng = np.random.default_rng(0)
    por_numero = collections.Counter()
    canais_numero = collections.defaultdict(set)
    videos_numero = collections.defaultdict(set)
    linhas = 0
    with open(SAIDA, "w") as out:
        for v in videos:
            qs = v["_qs"]
            rot = []
            for i, (idx, j, ok) in enumerate(zip(v["_ps"], v["_pos"], v["_aceita"])):
                d = v["sequencia"][j] if j >= 0 else None
                rot.append({"ini": qs[idx[0]]["t"], "fim": qs[idx[-1]]["t"], "meio": qs[idx[len(idx) // 2]]["t"],
                            "numero": d, "aceita": ok, "p": round(float(P[v["id"]][i, DIGITOS.index(d)]), 3) if d else None,
                            "ocr": "".join(sorted(v["_ocr"][i])),
                            "pulso": [round(float(x), 4) for x in qs[idx[len(idx) // 2]]["raw"][:2]]})
                if not ok:
                    continue
                k = len(idx)
                miolo = idx[k // 5: k - k // 5] or idx
                pick = miolo if len(miolo) <= args.quadros_por_parada else sorted(
                    rng.choice(miolo, args.quadros_por_parada, replace=False).tolist())
                for q in (qs[i2] for i2 in pick):
                    out.write(json.dumps({
                        "label": d, "person_id": v["channel_id"], "platform": "youtube", "device_model": "",
                        "browser": "", "normalization_version": NORMALIZATION_VERSION, "handedness": q["h"],
                        "aspect": v["aspect"], "v": [round(float(x), 6) for x in q["v"]], "raw": q["raw"],
                        "session_id": v["id"], "parada": f"{v['id']}:{i}", "t": q["t"],
                    }) + "\n")
                    linhas += 1
                por_numero[d] += 1
                canais_numero[d].add(v["channel_id"])
                videos_numero[d].add(v["id"])
            with open(os.path.join(ROTULOS, f"{v['id']}.json"), "w") as f:
                json.dump({"id": v["id"], "glosa": v["glosa"], "channel_id": v["channel_id"], "channel": v["channel"],
                           "arquivo": v["arquivo"], "pasta": "landmarks" if v["janela"] else "landmarks_sinais",
                           "sequencia": v["sequencia"], "paradas": rot}, f, indent=1, ensure_ascii=False)
        # Nenhum número: mãos em repouso de muitos canais (video/negativas.py)
        neg = os.path.join(DATA, "negativas.jsonl")
        n_neg = 0
        if os.path.exists(neg):
            for l in open(neg):
                if l.strip():
                    out.write(l if l.endswith("\n") else l + "\n")
                    n_neg += 1
    print(f"{linhas} quadros de números + {n_neg} de '_' em {SAIDA}")
    for d in DIGITOS:
        print(f"  {d}: {por_numero[d]} parada(s) aceitas, {len(videos_numero[d])} vídeo(s), "
              f"{len(canais_numero[d])} canal(is)")
    fora = [(v["id"], v["glosa"]) for v in videos if not any(v["_aceita"])]
    if fora:
        print("vídeos sem parada aceita:", " ".join(f"{i}({g})" for i, g in fora))


if __name__ == "__main__":
    main()
