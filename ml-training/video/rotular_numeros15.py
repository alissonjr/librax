"""
Rotula as paradas dos números de 0 a 9 (forma cardinal) nos landmarks a 15 quadros por segundo
(video/extrair_sinais.py) e gera o dataset do train_numeros15.py. É o rotular_numeros.py com mais
fontes e as mãos extraídas na mesma taxa da câmera do app.

Fontes (numeros15_fontes.json, conferido a olho em folhas de quadros):
- vídeos de um número e de números compostos (fontes_sinais.json, glosa "0" a "9", "10", "12"...):
  a sequência sai da glosa, como no rotular_numeros.py; os da lista "excluir" ficam de fora;
- trechos de vídeos de sequência ("numero 0 a 9", aulas): modo "sequencia" (ordem conhecida, com
  "q1" a "q4" no lugar da forma de quantidade do 1 ao 4, que não vai para o dataset) ou modo "ocr"
  (aula fora de ordem: cada parada vale o dígito escrito na tela).
Landmarks: data/numeros15/landmarks (tipos numero e sequencia), data/sinais15/landmarks (os de
glosa) ou a pasta do trecho.

Como sai o rótulo (o mesmo caminho do rotular_numeros.py):
1. Mão: a mais alta do quadro, entre as que estão perto do corpo quando há corpo (balões com mãos
   desenhadas ficam de fora). Mão em repouso (juntas ou baixas) não é número.
2. Paradas (rotular.paradas, VEL_FORMA mais solta) e divisão das que juntaram dois números.
3. Pontuação de cada parada: regras de dedos e direção na rodada 0 e depois um classificador
   treinado só com os OUTROS canais (consenso entre pessoas), mais a pista do número na tela (OCR).
4. Alinhamento monotônico com a sequência (ou, no modo ocr, o dígito lido na tela).
5. Checagem: fica a parada que o modelo dos outros canais confirma (entre os 3 primeiros com
   p >= 0,2), ou que tem o número escrito na tela, ou, para número sem outro canal, as regras.

Classe "_" (nenhum número), cada quadro marcado com a origem em "neg":
- "repouso": mãos juntas ou baixas nos próprios vídeos dos números;
- "transicao": quadros com a mão levantada longe de qualquer parada (a mão mudando de forma);
- "quantidade": as paradas das formas de quantidade do 1 ao 4 (q1 a q4), que o curso não usa;
- data/negativas.jsonl (video/negativas.py, mãos em repouso de muitos canais), com "neg": "repouso_geral".

Saídas em data/numeros15/ (fora do git):
- dataset.jsonl: uma linha por quadro, com todos os quadros do miolo de cada parada aceita
  (person_id = canal, "parada" = item:índice); o treino escolhe quantos usa;
- rotulos/<item>.json: as paradas de cada item com o número e se foi aceita (conferir.py --numeros15).

Uso:
    python video/rotular_numeros15.py [--rodadas 3]
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
import rotular_numeros as rn  # noqa: E402
from negativas import OMBRO_D, OMBRO_E, repouso  # noqa: E402
from rotular_sinais import DICIONARIO  # noqa: E402
from train_static import NORMALIZATION_VERSION, normalize_hand  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
SAIDA_DIR = os.path.join(DATA, "numeros15")
SAIDA = os.path.join(SAIDA_DIR, "dataset.jsonl")
ROTULOS = os.path.join(SAIDA_DIR, "rotulos")
OCR_DIR = os.path.join(SAIDA_DIR, "ocr")
FONTES = os.path.join(AQUI, "..", "numeros15_fontes.json")
PASTAS = ("numeros15/landmarks", "sinais15/landmarks")

DIGITOS = rn.DIGITOS
NENHUM = "_"
QUANTIDADE = {f"q{d}": str(d) for d in range(1, 5)}
# Pontuação (log) de uma parada ser a forma de quantidade: só ocupa o lugar no alinhamento
PONTO_QUANTIDADE = np.log(0.15)
# Mão a mais de MAX_LONGE_OMBROS larguras de ombro do meio dos ombros não é da pessoa
MAX_LONGE_OMBROS = 3.0
# Transição: quadro com a mão levantada a mais de LONGE_PARADA_S de qualquer parada
LONGE_PARADA_S = 0.25
TRANSICAO_POR_ITEM = 20
REPOUSO_POR_ITEM = 20


def achar_landmarks(vid, pasta=None):
    for p in ([pasta] if pasta else PASTAS):
        path = os.path.join(DATA, p, f"{vid}.json")
        if os.path.exists(path):
            return path, p
    return None, None


def perto_do_corpo(frame, h, aspect):
    pose = frame.get("pose")
    if not pose:
        return True
    P = np.asarray(pose).reshape(-1, 4)
    oe = np.array([P[OMBRO_E, 0] * aspect, P[OMBRO_E, 1]])
    od = np.array([P[OMBRO_D, 0] * aspect, P[OMBRO_D, 1]])
    largura = float(np.linalg.norm(oe - od))
    if largura < 1e-3:
        return True
    pulso = np.array([h["lm"][0] * aspect, h["lm"][1]])
    return np.linalg.norm(pulso - (oe + od) / 2) / largura <= MAX_LONGE_OMBROS


def quadros(v):
    """Como rotular_numeros.quadros, só com as mãos perto do corpo (quando há corpo)."""
    aspect = v["aspect"]
    out = []
    for f in v["frames"]:
        hands = [h for h in f["hands"] if perto_do_corpo(f, h, aspect)]
        h = rotular.escolher_mao(hands, None)
        if h is None:
            out.append(None)
            continue
        pts = np.asarray(h["lm"], dtype=np.float64).reshape(21, 3)
        palmo = np.hypot((pts[9, 0] - pts[0, 0]) * aspect, pts[9, 1] - pts[0, 1])
        out.append({"t": f["t"], "raw": h["lm"], "h": h["h"], "v": normalize_hand(h["lm"], h["h"], aspect),
                    "pulso": np.array([pts[0, 0] * aspect, pts[0, 1]]), "palmo": max(palmo, 1e-3)})
    return out


def itens():
    """(id do item, id do vídeo, fonte, pasta, sequência, janela, modo, dígitos do ocr)."""
    cfg = json.load(open(FONTES))
    excluir = cfg["excluir"]
    fontes = json.load(open(os.path.join(DATA, "fontes_sinais.json")))
    por_id = {f["id"]: f for f in fontes}
    letras = {f["id"]: f for f in json.load(open(os.path.join(DATA, "fontes.json")))}
    curso = rn.urls_do_curso()
    out = []
    for f in fontes:
        g = str(f.get("glosa", ""))
        if g not in rn.SEQUENCIAS or f["id"] in excluir or f.get("tipo") == "sequencia":
            continue
        if f["id"].startswith(DICIONARIO):
            url = curso.get(g)
            if f.get("channel_id") == "dic-ines" and url and "ines.gov.br" in url and f.get("url") != url:
                continue
        path, pasta = achar_landmarks(f["id"])
        if path:
            out.append((f["id"], f["id"], f, pasta, rn.SEQUENCIAS[g], None, "glosa", None))
    vezes = collections.Counter()
    for t in cfg["trechos"]:
        if t["id"] in excluir:
            continue
        path, pasta = achar_landmarks(t["id"], t.get("pasta"))
        if not path:
            print(f"sem landmarks: {t['id']}")
            continue
        vezes[t["id"]] += 1
        f = por_id.get(t["id"]) or letras.get(t["id"]) or {"id": t["id"]}
        modo = t.get("modo", "sequencia")
        out.append((f"{t['id']}@{vezes[t['id']]}", t["id"], f, pasta, t.get("sequencia"), (t["ini"], t["fim"]),
                    modo, t.get("digitos")))
    return out


def carregar():
    rotular.VEL_FORMA = rn.VEL_FORMA
    videos, cache = [], {}
    for item, vid, f, pasta, seq, janela, modo, digs in itens():
        if vid not in cache:
            cache = {vid: json.load(open(os.path.join(DATA, pasta, f"{vid}.json")))}
        bruto = cache[vid]
        v = {"id": item, "video": vid, "aspect": bruto["aspect"], "pasta": pasta, "janela": janela, "modo": modo,
             "digitos": digs, "sequencia": seq, "glosa": f.get("glosa"), "arquivo": f.get("arquivo"),
             "channel_id": f.get("channel_id") or bruto.get("channel_id") or vid, "channel": f.get("channel", "")}
        frames = [fr for fr in bruto["frames"] if not janela or janela[0] <= fr["t"] <= janela[1]]
        v["frames"] = frames
        qs = quadros(v)
        rep_q = []
        for i, (fr, q) in enumerate(zip(frames, qs)):
            if q is None:
                continue
            rep = repouso(fr, v["aspect"])
            if any(h["lm"] == q["raw"] for h in rep) or rn.abaixo_ombros(fr, q, v["aspect"]):
                qs[i] = None
        # mãos em repouso do item (classe "_")
        for fr in frames:
            for h in repouso(fr, v["aspect"]):
                rep_q.append((fr["t"], h))
        v["_repouso"] = rep_q
        ps = [d for p in rotular.paradas(qs) for d in rn.dividir(qs, p)]
        v["frames"] = None
        v["_qs"], v["_ps"] = qs, ps
        if ps:
            v["_feat"] = np.stack([rotular.media(qs, p) for p in ps])
            v["_regras"] = np.stack([rn.pontos_regras(x) for x in v["_feat"]])
        else:
            v["_feat"] = np.zeros((0, 65))
            v["_regras"] = np.zeros((0, 10))
        v["_dur"] = [qs[p[-1]]["t"] - qs[p[0]]["t"] for p in ps]
        videos.append(v)
    return videos


# ---------------------------------------------------------------------------
# Número escrito na tela
# ---------------------------------------------------------------------------

def ocr(videos):
    from multiprocessing import Pool

    os.makedirs(OCR_DIR, exist_ok=True)
    caches, falta = {}, collections.defaultdict(set)
    for v in videos:
        vid = v["video"]
        if vid not in caches:
            p = os.path.join(OCR_DIR, f"{vid}.json")
            caches[vid] = json.load(open(p)) if os.path.exists(p) else {}
        v["_meios"] = [v["_qs"][p[len(p) // 2]]["t"] for p in v["_ps"]]
        if v["arquivo"]:
            falta[vid] |= {t for t in v["_meios"] if f"{t:.2f}" not in caches[vid]}
    arquivos = {v["video"]: v["arquivo"] for v in videos}
    jobs = [(vid, (os.path.join(DATA, "videos", arquivos[vid]), sorted(ts))) for vid, ts in falta.items() if ts]
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
            for txt, conf in caches[v["video"]].get(f"{t:.2f}", []):
                txt = "".join(rn.OCR_TROCAS.get(c, c) for c in txt)
                if conf >= rn.OCR_MIN_CONF and txt.isdigit():
                    digs |= set(txt)
            lidas.append(digs if len(digs) <= 2 else set())
        v["_ocr"] = lidas


# ---------------------------------------------------------------------------
# Alinhamento
# ---------------------------------------------------------------------------

def digito(x):
    """Dígito de um item da sequência ("q3" -> "3", para o OCR)."""
    return QUANTIDADE.get(x, x)


def alinhar(v, P):
    """Posição na sequência de cada parada (-1: lixo). Modo ocr: o dígito lido, se permitido."""
    if v["modo"] == "ocr":
        out = []
        for digs in v["_ocr"]:
            ok = [d for d in digs if d in v["digitos"]]
            out.append(DIGITOS.index(ok[0]) if len(digs) == 1 and ok else -1)
        return out
    seq = v["sequencia"]
    s = np.zeros((len(v["_ps"]), len(seq)))
    for j, x in enumerate(seq):
        s[:, j] = PONTO_QUANTIDADE if x in QUANTIDADE else np.log(P[:, DIGITOS.index(x)] + 1e-4)
    if v["janela"] is None and len(seq) == 2:
        s[:, -1] += rn.BONUS_ULTIMO
    for i, digs in enumerate(v["_ocr"]):
        if digs:
            for j, x in enumerate(seq):
                s[i, j] += rotular.OCR_BONUS if digito(x) in digs else -rotular.OCR_MULTA
    return rotular.alinhar(s)


def rotulo(v, j):
    """Número da posição j (None para lixo e para a forma de quantidade)."""
    if j < 0:
        return None
    if v["modo"] == "ocr":
        return DIGITOS[j]
    x = v["sequencia"][j]
    return None if x in QUANTIDADE else x


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rodadas", type=int, default=3)
    args = ap.parse_args()
    warnings.filterwarnings("ignore", message=".*(converge|Maximum iterations).*")

    videos = carregar()
    ocr(videos)
    com = [v for v in videos if v["_ps"]]
    print(f"{len(videos)} item(ns), {len(com)} com paradas, {len({v['channel_id'] for v in com})} canal(is)")

    P = {v["id"]: v["_regras"] for v in videos}
    conhecidos = {v["id"]: set() for v in videos}
    for rodada in range(args.rodadas + 1):
        rotulos = {}
        for v in videos:
            v["_pos"] = alinhar(v, P[v["id"]]) if v["_ps"] else []
            rotulos[v["id"]] = [rotulo(v, j) for j in v["_pos"]]
        print(f"rodada {rodada}: {sum(1 for r in rotulos.values() for L in r if L)} paradas rotuladas", flush=True)
        if rodada < args.rodadas:
            P, conhecidos = rn.probs_outros_canais(com, rotulos)
            for v in videos:
                P.setdefault(v["id"], v["_regras"])
                conhecidos.setdefault(v["id"], set())

    # Checagem; nos modos de sequência, uma parada por posição
    for v in videos:
        Pv = P[v["id"]]
        aceita = [False] * len(v["_ps"])
        melhor = {}
        for i, j in enumerate(v["_pos"]):
            d = rotulo(v, j)
            if d is None or v["_dur"][i] < rn.MIN_PARADA_ACEITA_S:
                continue
            k = DIGITOS.index(d)
            if d in conhecidos[v["id"]]:
                ok = k in np.argsort(-Pv[i])[:rn.CHECAGEM_TOP] and Pv[i, k] >= rn.CHECAGEM_MIN_P
            else:
                ok = k in np.argsort(-v["_regras"][i])[:rn.CHECAGEM_TOP]
            ok = ok or d in v["_ocr"][i]
            if not ok:
                continue
            if v["modo"] == "ocr":
                aceita[i] = True
                continue
            nota = v["_dur"][i] * Pv[i, k]
            if j not in melhor or nota > melhor[j][1]:
                melhor[j] = (i, nota)
        for i, _ in melhor.values():
            aceita[i] = True
        v["_aceita"] = aceita

    os.makedirs(ROTULOS, exist_ok=True)
    for velho in glob.glob(os.path.join(ROTULOS, "*.json")):
        os.remove(velho)
    rng = np.random.default_rng(0)
    por_numero, canais_numero, videos_numero = collections.Counter(), collections.defaultdict(set), collections.defaultdict(set)
    linhas, negs = 0, collections.Counter()

    def linha(out, label, v, q, raw, hand, t, extra):
        out.write(json.dumps({
            "label": label, "person_id": v["channel_id"], "platform": "youtube", "device_model": "", "browser": "",
            "normalization_version": NORMALIZATION_VERSION, "handedness": hand, "aspect": v["aspect"],
            "v": [round(float(x), 6) for x in (q["v"] if q else normalize_hand(raw, hand, v["aspect"]))],
            "raw": raw, "session_id": v["video"], "item": v["id"], "t": t, **extra,
        }) + "\n")

    with open(SAIDA, "w") as out:
        for v in videos:
            qs = v["_qs"]
            rot = []
            perto = np.zeros(len(qs), dtype=bool)
            for idx in v["_ps"]:
                t0, t1 = qs[idx[0]]["t"] - LONGE_PARADA_S, qs[idx[-1]]["t"] + LONGE_PARADA_S
                for i2, q in enumerate(qs):
                    if q is not None and t0 <= q["t"] <= t1:
                        perto[i2] = True
            for i, (idx, j, ok) in enumerate(zip(v["_ps"], v["_pos"], v["_aceita"])):
                d = rotulo(v, j)
                bruto = v["sequencia"][j] if j >= 0 and v["modo"] != "ocr" else d
                rot.append({"ini": qs[idx[0]]["t"], "fim": qs[idx[-1]]["t"], "meio": qs[idx[len(idx) // 2]]["t"],
                            "numero": d, "posicao": bruto, "aceita": ok,
                            "p": round(float(P[v["id"]][i, DIGITOS.index(d)]), 3) if d else None,
                            "ocr": "".join(sorted(v["_ocr"][i])),
                            "pulso": [round(float(x), 4) for x in qs[idx[len(idx) // 2]]["raw"][:2]]})
                k = len(idx)
                miolo = idx[k // 5: k - k // 5] or idx
                if bruto in QUANTIDADE and v["_dur"][i] >= rn.MIN_PARADA_ACEITA_S:
                    for i2 in miolo:
                        q = qs[i2]
                        linha(out, NENHUM, v, q, q["raw"], q["h"], q["t"], {"neg": "quantidade", "forma": bruto,
                                                                          "parada": f"{v['id']}:{i}"})
                        negs["quantidade"] += 1
                if not ok:
                    continue
                for i2 in miolo:
                    q = qs[i2]
                    linha(out, d, v, q, q["raw"], q["h"], q["t"], {"parada": f"{v['id']}:{i}"})
                    linhas += 1
                por_numero[d] += 1
                canais_numero[d].add(v["channel_id"])
                videos_numero[d].add(v["video"])
            # transições: mão levantada longe de qualquer parada
            trans = [i2 for i2, q in enumerate(qs) if q is not None and not perto[i2]]
            if trans:
                pick = np.linspace(0, len(trans) - 1, min(TRANSICAO_POR_ITEM, len(trans))).round().astype(int)
                for i2 in sorted({trans[p] for p in pick}):
                    q = qs[i2]
                    linha(out, NENHUM, v, q, q["raw"], q["h"], q["t"], {"neg": "transicao"})
                    negs["transicao"] += 1
            rep = v["_repouso"]
            if rep:
                pick = np.linspace(0, len(rep) - 1, min(REPOUSO_POR_ITEM, len(rep))).round().astype(int)
                for p in sorted(set(pick.tolist())):
                    t, h = rep[p]
                    linha(out, NENHUM, v, None, h["lm"], h["h"], t, {"neg": "repouso"})
                    negs["repouso"] += 1
            with open(os.path.join(ROTULOS, f"{v['id']}.json"), "w") as f:
                json.dump({"id": v["id"], "video": v["video"], "glosa": v["glosa"], "channel_id": v["channel_id"],
                           "channel": v["channel"], "arquivo": v["arquivo"], "pasta": v["pasta"], "modo": v["modo"],
                           "janela": v["janela"], "sequencia": v["sequencia"], "paradas": rot},
                          f, indent=1, ensure_ascii=False)
        neg = os.path.join(DATA, "negativas.jsonl")
        if os.path.exists(neg):
            for l in open(neg):
                if l.strip():
                    r = json.loads(l)
                    r["neg"] = "repouso_geral"
                    out.write(json.dumps(r) + "\n")
                    negs["repouso_geral"] += 1
    print(f"{linhas} quadros de números + '_': {dict(negs)} em {SAIDA}")
    for d in DIGITOS:
        print(f"  {d}: {por_numero[d]} parada(s) aceitas, {len(videos_numero[d])} vídeo(s), "
              f"{len(canais_numero[d])} canal(is)")
    fora = [(v["id"], v["glosa"]) for v in videos if not any(v["_aceita"])]
    if fora:
        print("itens sem parada aceita:", " ".join(f"{i}({g})" for i, g in fora))


if __name__ == "__main__":
    main()
