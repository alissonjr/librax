"""
Trechos das letras com movimento (H, J, K, X, Z e Ç) nos vídeos do alfabeto, para o modelo do
train_letras_mov.py. O Y ficou de fora: nas folhas, todo mundo segura a mão parada (a VLibras
também); continua com o modelo das letras paradas.

Nos vídeos do alfabeto a ordem das letras é conhecida (fontes.json "sequencia") e o rotular.py já
achou as paradas das letras vizinhas (data/rotulos/<id>.json). A letra com movimento fica entre a
parada da letra de antes e a da letra de depois. Como sai o trecho:
1. Âncoras: paradas aceitas pelo rotular.py (checagem cruzada) com a letra. Vale o vídeo com
   qualidade >= MIN_QUALIDADE e landmarks a 15 quadros por segundo (video/extrair_maos.py).
2. Vão: do fim da parada da letra anterior ao começo da parada da seguinte. Com as duas vizinhas
   da sequência, o vão é o trecho. Faltando uma vizinha, só entra se a própria letra tiver parada
   alinhada no vão: o trecho vai até MARGEM_PROPRIA_S antes e depois dela. O Z é a última letra:
   o trecho vai do fim da parada do Y até o fim da parada do próprio Z (ou MAX_FIM_S depois).
   Vão maior que MAX_VAO_S sem parada da letra fica de fora (aula falada no meio).
3. Parada da própria letra: muitas pessoas fazem o movimento e seguram a mão no fim (o H gira e
   para; o K sobe e para). A parada fica marcada no trecho: o treino não usa janela que cai quase
   toda dentro dela como exemplo da letra (sem movimento), e sim como "_".
4. Movimento: energia por quadro (deslocamento do pulso em palmos, giro da mão em radianos e
   mudança da forma) para conferir que o trecho tem movimento; trecho sem movimento sai.
5. Texto na tela: OCR em três pontos do trecho (cache em data/letras_mov/ocr/<id>.json). A própria
   letra em algum ponto confirma; sem ela, o trecho sai quando o meio mostra uma letra que não é
   vizinha na sequência.
6. Revisão a olho das folhas: letras_mov_conferencia.json lista os trechos que não mostram a letra.
   Trecho maior que MAX_TRECHO_S fica com os primeiros MAX_TRECHO_S (o movimento vem logo depois
   da letra anterior; o resto é a mão parada na letra).
Vídeos de uma letra só (tipo "letra", até MAX_VIDEO_LETRA_S, sem os desafios de palavras): o
trecho é o pedaço com mão de maior energia de movimento (até MAX_LETRA_S), com peso maior nos
quadros em que o modelo das letras paradas lê a forma da letra (FAMILIA), conferido nas folhas.
Ficam marcados com fonte "letra".

Saídas:
- ml-training/letras_mov_trechos.json (no git): trechos, paradas próprias e paradas das letras
  paradas usadas como "_" (com o vídeo e o canal); os vídeos de uma letra parada (fonte
  "letra-parada") com a região em volta da letra, também "_" (a mão sobe, faz a letra e desce);
- data/letras_mov/conferir/letra-<L>.jpg: uma linha por trecho com 5 quadros do início ao fim.

Uso:
    python video/rotular_letras_mov.py [--folhas]
    (LIBRAX_DATA=/caminho/data aponta para a pasta de dados)
"""

import argparse
import glob
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
from train_letras_mov import LANDMARKS, LETRAS_MOV, TRECHOS, mao_do_quadro, palmo  # noqa: E402
from train_static import normalize_hand  # noqa: E402

DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
SAIDA_DIR = os.path.join(DATA, "letras_mov")
OCR_DIR = os.path.join(SAIDA_DIR, "ocr")
CONFERIR = os.path.join(SAIDA_DIR, "conferir")
INES = os.path.join(AQUI, "..", "letras_mov_ines.json")
CONFERENCIA = os.path.join(AQUI, "..", "letras_mov_conferencia.json")

SEQ = "ABCÇDEFGHIJKLMNOPQRSTUVWXYZ"
MIN_QUALIDADE = 0.5
MAX_VAO_S = 3.5
MAX_TRECHO_S = 3.0
MAX_VIDEO_LETRA_S = 30.0
# Vídeos de uma letra que mostram palavras com a letra (desafios) ou falam de outra coisa
TITULO_FORA = ("desafio", "personagens", "esqueci", "faltou")
# Forma da mão de cada letra com movimento, como o modelo das letras paradas costuma ler
FAMILIA = {"H": "HKPUVR", "K": "HKPUVR", "X": "X", "J": "I", "Z": "DLGX", "Ç": "CO"}
# A letra na tela: o OCR não lê a cedilha
OCR_ACEITA = {"Ç": "ÇC"}
CLASSIFICADOR = os.path.join(AQUI, "..", "..", "apps", "web-poc", "public", "ml", "classifier")
MARGEM_PROPRIA_S = 0.8
MAX_FIM_S = 2.0
MAX_LETRA_S = 2.0
MIN_ENERGIA = 0.6  # soma no trecho (palmos + radianos + forma), abaixo disto a mão quase não mexeu
OCR_MIN_CONF = 0.6
LADO = 120


# ---------------------------------------------------------------------------
# Quadros e energia
# ---------------------------------------------------------------------------

def carregar(vid):
    path = os.path.join(LANDMARKS, f"{vid}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def energia(v):
    """(tempos, energia do intervalo que termina em cada quadro) da mão mais alta de cada quadro."""
    asp = v["aspect"]
    ts, es = [], []
    ant = None
    for f in v["frames"]:
        ts.append(f["t"])
        h = mao_do_quadro(f["hands"])
        if h is None:
            es.append(0.0)
            ant = None
            continue
        x = normalize_hand(h["lm"], h["h"], asp)
        w = np.array([h["lm"][0] * asp, h["lm"][1]])
        p = max(palmo(h["lm"], asp), 1e-6)
        if ant is None:
            es.append(0.0)
        else:
            w0, p0, x0 = ant
            dpos = np.linalg.norm(w - w0) / ((p + p0) / 2)
            dang = float(np.arccos(np.clip(np.dot(x[63:65], x0[63:65]), -1, 1)))
            dforma = np.linalg.norm(x[:63] - x0[:63]) / np.sqrt(21)
            es.append(float(dpos + dang + dforma))
        ant = (w, p, x)
    return np.array(ts), np.array(es)


def energia_em(ts, es, a, b):
    m = (ts > a) & (ts <= b)
    return float(es[m].sum())


# ---------------------------------------------------------------------------
# Vídeos do alfabeto
# ---------------------------------------------------------------------------

def trechos_alfabeto(vid, fonte, rot):
    """Trechos das letras com movimento e paradas das letras paradas num vídeo do alfabeto."""
    seq = fonte.get("sequencia") or SEQ
    paradas = rot["paradas"]
    aceitas = [p for p in paradas if p["letra"] and p.get("aceita") and p["letra"] in seq]
    alinhadas = [p for p in paradas if p["letra"] and p["letra"] in seq]
    out = []
    for L in LETRAS_MOV:
        if L not in seq:
            continue
        j = seq.index(L)
        antes = [p for p in aceitas if seq.index(p["letra"]) < j]
        depois = [p for p in aceitas if seq.index(p["letra"]) > j]
        ant = antes[-1] if antes else None
        prox = depois[0] if depois else None
        a = ant["fim"] if ant else None
        b = prox["ini"] if prox else None
        propria = [p for p in alinhadas if p["letra"] == L
                   and (a is None or p["ini"] >= a - 0.05) and (b is None or p["fim"] <= b + 0.05)]
        propria = max(propria, key=lambda p: p["fim"] - p["ini"]) if propria else None
        vizinhas = ant is not None and seq.index(ant["letra"]) == j - 1 and (
            (prox is not None and seq.index(prox["letra"]) == j + 1) or (prox is None and j == len(seq) - 1))
        if a is None:
            continue
        if b is None:
            # última letra (Z): até o fim da própria parada, ou MAX_FIM_S depois da anterior
            b = propria["fim"] if propria else a + MAX_FIM_S
        motivo = "vizinhas" if vizinhas else None
        if not vizinhas:
            if not propria:
                continue
            a = max(a, propria["ini"] - MARGEM_PROPRIA_S)
            b = min(b, propria["fim"] + MARGEM_PROPRIA_S)
            motivo = "propria"
        if b - a > MAX_VAO_S and not propria:
            continue
        if b - a > MAX_VAO_S:
            a = max(a, propria["ini"] - MARGEM_PROPRIA_S)
            b = min(b, propria["fim"] + MARGEM_PROPRIA_S)
        if b - a > MAX_TRECHO_S:
            b = a + MAX_TRECHO_S
        if b - a < 0.3:
            continue
        out.append({"letra": L, "ini": round(a, 3), "fim": round(b, 3), "como": motivo,
                    "parada": [round(propria["ini"], 3), round(propria["fim"], 3)] if propria else None})
    paradas_estaticas = [{"letra": p["letra"], "ini": round(p["ini"], 3), "fim": round(p["fim"], 3)}
                         for p in aceitas if p["letra"] not in LETRAS_MOV]
    inicio = min((p["ini"] for p in aceitas), default=None)
    fim = max((p["fim"] for p in aceitas), default=None)
    return out, paradas_estaticas, inicio, fim


# ---------------------------------------------------------------------------
# Vídeos de uma letra
# ---------------------------------------------------------------------------

_ESTATICO = None


def familia(v, letra):
    """1 nos quadros em que o modelo das letras paradas lê a forma da letra (FAMILIA), senão 0."""
    global _ESTATICO
    from teste_fixo import carregar_modelo
    from train_static import mlp_forward

    if _ESTATICO is None:
        _ESTATICO = carregar_modelo(CLASSIFICADOR)
    labels, layers = _ESTATICO
    out = np.zeros(len(v["frames"]))
    for i, f in enumerate(v["frames"]):
        h = mao_do_quadro(f["hands"])
        if h is None:
            continue
        p = mlp_forward(layers, normalize_hand(h["lm"], h["h"], v["aspect"])[None])[0]
        out[i] = float(sum(p[k] for k, L in enumerate(labels) if L in FAMILIA[letra]))
    return out


def regiao_parada(v, letra, folga=1.5):
    """
    [a, b] em volta dos quadros em que o modelo das letras paradas lê `letra` (o primeiro e o último,
    com `folga` segundos para a mão subindo e descendo), ou None se ele quase não lê a letra.
    """
    from teste_fixo import carregar_modelo
    from train_static import mlp_forward

    global _ESTATICO
    if _ESTATICO is None:
        _ESTATICO = carregar_modelo(CLASSIFICADOR)
    labels, layers = _ESTATICO
    if letra not in labels:
        return None
    k = labels.index(letra)
    lidos = []
    for f in v["frames"]:
        h = mao_do_quadro(f["hands"])
        if h is None:
            continue
        p = mlp_forward(layers, normalize_hand(h["lm"], h["h"], v["aspect"])[None])[0]
        if int(np.argmax(p)) == k and p[k] >= 0.6:
            lidos.append(f["t"])
    if len(lidos) < 3:
        return None
    # o maior grupo de leituras com buracos de até 1 s (o resto pode ser introdução)
    grupos, atual = [], [lidos[0]]
    for t in lidos[1:]:
        if t - atual[-1] <= 1.0:
            atual.append(t)
        else:
            grupos.append(atual)
            atual = [t]
    grupos.append(atual)
    g = max(grupos, key=len)
    fim_video = v["frames"][-1]["t"]
    return [round(max(0.0, g[0] - folga), 3), round(min(fim_video, g[-1] + folga), 3)]


def trecho_letra(v, ts, es, letra):
    """Pedaço com mão de maior energia (com peso na forma da letra), de até MAX_LETRA_S segundos."""
    es = es * (1 + 2 * familia(v, letra))
    com_mao = np.array([bool(f["hands"]) for f in v["frames"]])
    if com_mao.sum() < 4:
        return None
    melhor, nota = None, 0.0
    passo = 0.1
    t = ts[0]
    while t <= ts[-1]:
        m = (ts >= t) & (ts <= t + MAX_LETRA_S)
        if m.sum() and com_mao[m].mean() >= 0.8:
            e = float(es[m].sum())
            if e > nota:
                melhor, nota = (t, min(t + MAX_LETRA_S, ts[-1])), e
        t += passo
    if melhor is None:
        return None
    # aperta nas pontas sem movimento (quadros de energia baixa no começo e no fim)
    a, b = melhor
    m = np.where((ts >= a) & (ts <= b) & (es > 0.05))[0]
    if len(m):
        a, b = max(a, ts[m[0]] - 0.15), min(b, ts[m[-1]] + 0.1)
    return a, b


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------

_OCR = None


def ocr_letras(vid, arquivo, t, cache):
    """Letras (uma por texto, com confiança >= OCR_MIN_CONF) escritas na tela no instante t."""
    global _OCR
    chave = f"{t:.2f}"
    if chave not in cache:
        import cv2

        if _OCR is None:
            from rapidocr_onnxruntime import RapidOCR
            _OCR = RapidOCR()
        cap = cv2.VideoCapture(arquivo)
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        cap.release()
        res = _OCR(frame)[0] if ok else None
        cache[chave] = [[r[1].strip(), round(float(r[2]), 3)] for r in (res or []) if len(r[1].strip()) <= 2]
    letras = {}
    for txt, conf in cache[chave]:
        txt = txt.upper()
        if len(txt) == 1 and conf >= OCR_MIN_CONF and txt in SEQ:
            letras[txt] = max(conf, letras.get(txt, 0))
    return letras if len(letras) <= 2 else {}


# ---------------------------------------------------------------------------
# Folhas de conferência
# ---------------------------------------------------------------------------

def recorte(frame, lm):
    import cv2

    h, w = frame.shape[:2]
    pts = np.asarray(lm).reshape(21, 3)
    xs, ys = pts[:, 0] * w, pts[:, 1] * h
    cx, cy = xs.mean(), ys.mean()
    r = max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.9 + 14
    x0, x1 = int(max(cx - r, 0)), int(min(cx + r, w))
    y0, y1 = int(max(cy - r, 0)), int(min(cy + r, h))
    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return np.zeros((LADO, LADO, 3), np.uint8)
    return cv2.resize(crop, (LADO, LADO))


def folhas(trechos, arquivos):
    import cv2

    os.makedirs(CONFERIR, exist_ok=True)
    feitas = []
    for L in LETRAS_MOV:
        linhas = []
        for tr in [t for t in trechos if t["letra"] == L]:
            v = carregar(tr["id"])
            arq = arquivos.get(tr["id"])
            if v is None or not arq:
                continue
            ts = np.array([f["t"] for f in v["frames"]])
            cap = cv2.VideoCapture(arq)
            tiles = []
            for t in np.linspace(tr["ini"], tr["fim"], 5):
                i = int(np.argmin(np.abs(ts - t)))
                h = mao_do_quadro(v["frames"][i]["hands"])
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
                ok, frame = cap.read()
                tile = recorte(frame, h["lm"]) if ok and h else np.zeros((LADO, LADO, 3), np.uint8)
                cv2.putText(tile, f"{t:.1f}", (3, LADO - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
                tiles.append(tile)
            cap.release()
            rotulo = np.zeros((LADO, 150, 3), np.uint8)
            cor = (80, 220, 80) if tr.get("ok", True) else (60, 60, 230)
            for k, txt in enumerate([f"{L} {tr['fonte']}", tr["id"][:12], tr.get("canal", "")[:16],
                                     f"{tr['ini']:.1f}-{tr['fim']:.1f}s", f"ocr {tr.get('ocr') or '-'}",
                                     tr.get("como") or ""]):
                cv2.putText(rotulo, txt, (4, 16 + 18 * k), cv2.FONT_HERSHEY_SIMPLEX, 0.42, cor, 1)
            linhas.append(np.hstack([rotulo] + tiles))
        if not linhas:
            continue
        if len(linhas) % 2:
            linhas.append(np.zeros_like(linhas[0]))
        meio = len(linhas) // 2
        img = np.hstack([np.vstack(linhas[:meio]), np.full((meio * LADO, 6, 3), 255, np.uint8), np.vstack(linhas[meio:])])
        out = os.path.join(CONFERIR, f"letra-{L}.jpg")
        cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        feitas.append(out)
    return feitas


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folhas", action="store_true", help="gera as folhas de conferência")
    args = ap.parse_args()

    with open(os.path.join(DATA, "fontes.json")) as f:
        fontes = {x["id"]: x for x in json.load(f)}
    with open(INES) as f:
        ines = json.load(f)["videos"]
    arquivos = {vid: os.path.join(DATA, "videos", x.get("arquivo") or f"{vid}.mp4") for vid, x in fontes.items()}
    arquivos.update({x["id"]: os.path.join(SAIDA_DIR, "ines", x["arquivo"]) for x in ines})
    # Revisão a olho (folhas): trechos que não mostram a letra ficam de fora
    with open(CONFERENCIA) as f:
        fora = {(x["id"], x["letra"]): x.get("motivo", "") for x in json.load(f)["fora"]}

    os.makedirs(OCR_DIR, exist_ok=True)
    trechos, videos = [], []
    for path in sorted(glob.glob(os.path.join(LANDMARKS, "*.json"))):
        vid = os.path.basename(path)[:-5]
        if vid.startswith("ines-"):
            continue
        fonte = fontes.get(vid)
        if not fonte:
            continue
        v = carregar(vid)
        ts, es = energia(v)
        cache_path = os.path.join(OCR_DIR, f"{vid}.json")
        cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
        canal = fonte.get("channel", "")
        if fonte["tipo"] == "alfabeto":
            rot_path = os.path.join(DATA, "rotulos", f"{vid}.json")
            if not os.path.exists(rot_path):
                continue
            with open(rot_path) as f:
                rot = json.load(f)
            if (rot.get("qualidade") or 0) < MIN_QUALIDADE:
                continue
            achados, estaticas, inicio, fim = trechos_alfabeto(vid, fonte, rot)
            videos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": "alfabeto",
                           "inicio": inicio, "fim": fim, "paradas": estaticas})
        elif fonte["tipo"] == "letra" and fonte.get("rotulo") in LETRAS_MOV:
            if fonte.get("duration", 0) > MAX_VIDEO_LETRA_S or any(w in fonte["title"].lower() for w in TITULO_FORA):
                continue
            ab = trecho_letra(v, ts, es, fonte["rotulo"])
            achados = [{"letra": fonte["rotulo"], "ini": round(ab[0], 3), "fim": round(ab[1], 3),
                        "como": "maior energia", "parada": None}] if ab else []
            videos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": "letra",
                           "inicio": None, "fim": None, "paradas": []})
        elif fonte["tipo"] == "letra" and fonte.get("rotulo") in SEQ:
            # Vídeo de letra parada: a mão sobe, faz a letra e desce. Vira "_" em volta do trecho em
            # que o modelo das letras paradas lê a letra (ensina que subir a mão com a forma do I não é J)
            if fonte.get("duration", 0) > MAX_VIDEO_LETRA_S or any(w in fonte["title"].lower() for w in TITULO_FORA):
                continue
            regiao = regiao_parada(v, fonte["rotulo"])
            if regiao:
                videos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": "letra-parada",
                               "letra": fonte["rotulo"], "regioes": [regiao], "paradas": []})
            continue
        else:
            continue
        for tr in achados:
            e = energia_em(ts, es, tr["ini"], tr["fim"])
            # Texto na tela em três pontos: a letra em algum deles confirma. Sem ela, o trecho sai quando
            # o meio mostra outra letra que não é vizinha na sequência (no começo e no fim do trecho a
            # tela ainda mostra a anterior ou já mostra a próxima)
            pontos = [ocr_letras(vid, arquivos[vid], round(tr["ini"] + frac * (tr["fim"] - tr["ini"]), 2), cache)
                      for frac in (0.25, 0.5, 0.9)]
            letras = {k: c for p in pontos for k, c in p.items()}
            aceitas_ocr = OCR_ACEITA.get(tr["letra"], tr["letra"])
            j = SEQ.index(tr["letra"])
            vizinhas = set(SEQ[max(j - 1, 0):j + 2])
            confirma = any(c in letras for c in aceitas_ocr)
            outra = bool(pontos[1]) and not set(pontos[1]) <= vizinhas
            ok = e >= MIN_ENERGIA and (confirma or not outra)
            motivo = None if ok else ("sem movimento" if e < MIN_ENERGIA else f"tela mostra {''.join(sorted(pontos[1]))}")
            if ok and (vid, tr["letra"]) in fora:
                ok, motivo = False, f"conferência: {fora[(vid, tr['letra'])]}"
            trechos.append({"id": vid, "canal": canal, "channel_id": fonte["channel_id"], "fonte": videos[-1]["fonte"],
                            **tr, "energia": round(e, 2), "ocr": "".join(sorted(letras)), "ok": ok,
                            **({"motivo": motivo} if motivo else {})})
        with open(cache_path, "w") as f:
            json.dump(cache, f)

    # INES: teste à parte (P, I, D e C são letras paradas)
    ines_trechos = []
    for x in ines:
        v = carregar(x["id"])
        if v is None:
            continue
        ts, es = energia(v)
        # o verbete é só a letra: do primeiro ao último quadro com mão
        com = [f["t"] for f in v["frames"] if f["hands"]]
        ab = (com[0], com[-1]) if len(com) >= 4 else None
        if ab:
            ines_trechos.append({"id": x["id"], "canal": "INES", "channel_id": "ines", "fonte": "ines", "letra": x["rotulo"],
                                 "ini": round(ab[0], 3), "fim": round(ab[1], 3), "energia": round(energia_em(ts, es, *ab), 2),
                                 "ok": True})

    saida = {
        "_sobre": "Trechos das letras com movimento (video/rotular_letras_mov.py). ok=false fica fora do treino "
                  "e do teste. 'videos' traz as paradas aceitas das letras paradas (classe \"_\") e o começo e o "
                  "fim do alfabeto em cada vídeo. A revisão a olho das folhas fica em letras_mov_conferencia.json.",
        "trechos": trechos,
        "ines": ines_trechos,
        "videos": videos,
    }
    with open(TRECHOS, "w") as f:
        json.dump(saida, f, indent=1, ensure_ascii=False)
        f.write("\n")
    for L in LETRAS_MOV:
        ts_L = [t for t in trechos if t["letra"] == L]
        ok = [t for t in ts_L if t["ok"]]
        print(f"{L}: {len(ok)}/{len(ts_L)} trechos ok, {len({t['channel_id'] for t in ok})} canais "
              f"(alfabeto {sum(t['fonte'] == 'alfabeto' for t in ok)}, letra {sum(t['fonte'] == 'letra' for t in ok)})")
    print(f"gravado em {TRECHOS}")
    if args.folhas:
        for out in folhas(trechos + ines_trechos, arquivos):
            print(out)


if __name__ == "__main__":
    sys.exit(main())
