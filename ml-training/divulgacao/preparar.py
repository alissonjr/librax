"""
Vídeo de divulgação, passo 1 (docs/video-divulgacao-librax.md): escolhe, confere e prepara as
fotos das mãos de cada letra de LIBRAX e monta a folha para o dono aprovar.

Candidatas: para cada letra, as paradas aceitas dos vídeos do alfabeto (data/rotulos), no miolo
da parada, com os pontos da mão do mesmo instante (data/landmarks). Fica uma por canal: a melhor.

Filtros, em ordem (a contagem de canais antes e depois de cada um sai no fim e em candidatos.json):
1. classificador: o MLP de letras do app lê aquela letra com p >= 0.6 (como o teste_fixo.py);
2. tamanho: palmo (pulso até a base do dedo médio) com pelo menos MIN_PALMO px no vídeo;
   enquadramento: a mão, até o antebraço sumir, inteira dentro do quadro do vídeo;
3. nitidez: variância do Laplaciano na mão, com a mão levada sempre ao mesmo tamanho;
4. mão de verdade: a segmentação vê pele nos ossos da mão (corta avatar desenhado e luva);
   recorte: o recorte cobre os ossos da mão (sem buraco nem dedo cortado) e a outra mão não
   encosta nela;
5. rosto: a mão recortada não pode cair dentro da caixa de um rosto (detector do MediaPipe), nem
   levar pedaço da cabeça (caixa alargada para testa e queixo) longe dos dedos, nem pele de rosto
   (segmentação). Caixa de "rosto" quase toda coberta pela própria mão é o
   detector confundindo o punho fechado com rosto e não conta;
6. texto: nenhum texto ou logotipo (OCR) em cima da mão recortada.

Preparação: a mão e o pulso saem do quadro, ficam de pé (pulso para baixo), com o pulso no mesmo
ponto e o palmo do mesmo tamanho; o polegar fica sempre do mesmo lado (a minoria é espelhada). O
fundo sai pela segmentação de pele do MediaPipe (selfie multiclass, local) e o antebraço some aos
poucos abaixo do pulso. A ampliação é Lanczos com um reforço leve de nitidez.

Saída em <data>/divulgacao/: maos/<ID>.png (mão com transparência, no quadro do vídeo),
analise.json (medidas de todos os quadros), candidatos.json (as que passaram, com a contagem por
filtro), selecao.json (pré-seleção; só é criada se não existir) e folha.jpg.

Uso:
    python divulgacao/preparar.py [--data PASTA]                  tudo (mantém selecao.json)
    python divulgacao/preparar.py --nova-selecao                  idem, refazendo a pré-seleção
    python divulgacao/preparar.py --reusar-analise                sem medir de novo (mudou só filtro)
    python divulgacao/preparar.py --tirar L3 --por A14 [...]      só edita a seleção e redesenha a folha
    python divulgacao/preparar.py --folha                         só redesenha a folha
"""

import collections
import glob
import os
import sys

import cv2
import numpy as np

from comum import (FUNDO, LARGURA, LETRAS, MIN_P, PALMO, PULSO, TANGERINA, TINTA, Classificador, Pastas,
                   argumentos, gravar_json, hex_bgr, hex_rgb, ler_json)

QUADROS_POR_PARADA = 3
MIN_PALMO = 40  # px no vídeo original
MIN_NITIDEZ = 40.0  # variância do Laplaciano com o palmo levado a PALMO_NITIDEZ px
PALMO_NITIDEZ = 60
MIN_PELE = 0.6  # pele média nos ossos da mão
MAX_PELE_ROSTO = 0.05  # fração da mão recortada, fora da mão, que a segmentação chama de pele de rosto
MAX_MAO_NO_ROSTO = 0.02  # fração da mão recortada dentro da caixa de um rosto
MAX_VAZAMENTO = 0.005  # fração do recorte na cabeça (caixa do rosto alargada) e longe da mão
MAX_ROSTO_NA_MAO = 0.4  # caixa de "rosto" coberta pela mão a partir disso é a própria mão (punho fechado)
MAX_FORA = 0.01  # fração da mão (até o antebraço sumir) cortada pela borda do vídeo
MIN_COBERTURA = 0.9  # fração dos ossos da mão dentro do recorte
MAX_OUTRA_MAO = 0.05  # fração da mão coberta pela outra mão (as duas encostadas viram um recorte só)
PRE_SELECAO = 12
MIN_SELECAO = 10

# Altura útil do quadro da mão gravado em maos/ (o resto do vídeo é fundo e letras)
ALTURA_MAO = 1460

OSSOS = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (5, 9), (9, 10), (10, 11), (11, 12),
         (9, 13), (13, 14), (14, 15), (15, 16), (13, 17), (0, 17), (17, 18), (18, 19), (19, 20)]
# Classes do selfie multiclass
FUNDO_SEG, CABELO, PELE, PELE_ROSTO, ROUPA, OUTROS = range(6)


# ---------------------------------------------------------------------------
# Modelos (MediaPipe e OpenCV), abertos uma vez
# ---------------------------------------------------------------------------

class Modelos:
    def __init__(self, pastas):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self.mp = mp
        self.seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=pastas.modelo("segmentacao")),
            output_confidence_masks=True))
        self.rosto = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=pastas.modelo("rosto")), min_detection_confidence=0.5))
        from rapidocr_onnxruntime import RapidOCR
        self.ocr = RapidOCR()

    def segmentar(self, bgr):
        rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        r = self.seg.segment(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb))
        return np.stack([m.numpy_view().reshape(bgr.shape[:2]) for m in r.confidence_masks], -1)

    def rostos(self, bgr, min_conf=0.5):
        """Caixas de rosto (x0, y0, x1, y1) em px da imagem; amplia imagens pequenas antes."""
        f = max(1.0, 640 / max(bgr.shape[:2]))
        img = cv2.resize(bgr, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC) if f > 1 else bgr
        rgb = np.ascontiguousarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        r = self.rosto.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb))
        out = []
        for d in r.detections:
            if d.categories and d.categories[0].score < min_conf:
                continue
            b = d.bounding_box
            out.append((b.origin_x / f, b.origin_y / f, (b.origin_x + b.width) / f, (b.origin_y + b.height) / f))
        return out

    def textos(self, bgr):
        """Caixas de texto (polígonos em px) com confiança >= 0.5."""
        f = max(1.0, 480 / max(bgr.shape[:2]))
        img = cv2.resize(bgr, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC) if f > 1 else bgr
        res, _ = self.ocr(img)
        return [np.array(b, np.float32) / f for b, txt, conf in (res or []) if float(conf) >= 0.5 and txt.strip()]


# ---------------------------------------------------------------------------
# Candidatas
# ---------------------------------------------------------------------------

def paradas_aceitas(pastas):
    """(id do vídeo, parada) das letras de LIBRAX, em todos os vídeos rotulados."""
    for caminho in sorted(glob.glob(os.path.join(pastas.data, "rotulos", "*.json"))):
        rot = ler_json(caminho)
        for p in rot["paradas"]:
            if p.get("aceita") and p.get("letra") and p["letra"] in LETRAS:
                yield rot["id"], p


def quadros_da_parada(lms, p):
    """Até QUADROS_POR_PARADA quadros com mão no miolo da parada, do mais perto do meio para fora."""
    ini, fim = p["ini"], p["fim"]
    margem = (fim - ini) * 0.2
    com_mao = [f for f in lms["frames"] if f["hands"]]
    dentro = [f for f in com_mao if ini + margem <= f["t"] <= fim - margem]
    if not dentro:
        dentro = [f for f in com_mao if ini <= f["t"] <= fim]
    return sorted(dentro, key=lambda f: abs(f["t"] - p["meio"]))[:QUADROS_POR_PARADA]


def ler_quadro(cap, t):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    return frame if ok else None


# ---------------------------------------------------------------------------
# Geometria: do quadro do vídeo para o quadro da mão (pulso fixo, palmo fixo, de pé)
# ---------------------------------------------------------------------------

def pontos_px(lm, w, h):
    pts = np.asarray(lm, np.float64).reshape(21, 3)
    return np.stack([pts[:, 0] * w, pts[:, 1] * h], 1)


def transformacao(pts):
    """Matriz 2x3 que leva o pulso a PULSO e a base do médio para cima dele, a PALMO px."""
    v = pts[9] - pts[0]
    palmo = float(np.hypot(*v))
    k = PALMO / palmo
    phi = -np.pi / 2 - np.arctan2(v[1], v[0])
    c, s = np.cos(phi) * k, np.sin(phi) * k
    A = np.array([[c, -s], [s, c]])
    t = np.array(PULSO, np.float64) - A @ pts[0]
    return np.hstack([A, t[:, None]])


def aplicar(M, pts):
    return pts @ M[:, :2].T + M[:, 2]


def zona_da_mao(pts_c, forma):
    """Onde a mão pode estar no quadro da mão: o núcleo da mão com uma folga, de borda suave."""
    z = nucleo_da_mao(pts_c, forma)
    z = cv2.dilate(z, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(PALMO * 0.4),) * 2))
    return cv2.GaussianBlur(z.astype(np.float32), (0, 0), PALMO * 0.03)


def nucleo_da_mao(pts_c, forma, pulso="largo"):
    """A mão sem folga: casco dos pontos, ossos com a grossura de um dedo e o pulso (0 ou 1)."""
    z = np.zeros(forma, np.uint8)
    cv2.fillConvexPoly(z, cv2.convexHull(pts_c.astype(np.int32)), 1)
    for a, b in OSSOS:
        cv2.line(z, tuple(pts_c[a].astype(int)), tuple(pts_c[b].astype(int)), 1, int(PALMO * 0.28))
    for i in (4, 8, 12, 16, 20):
        cv2.circle(z, tuple(pts_c[i].astype(int)), int(PALMO * 0.14), 1, -1)
    if pulso == "largo":
        # pulso e começo do antebraço, que pode chegar de lado quando o pulso dobra (some depois)
        cv2.circle(z, PULSO, int(PALMO * 0.6), 1, -1)
    elif pulso == "estreito":
        cv2.ellipse(z, (PULSO[0], int(PULSO[1] + PALMO * 0.3)), (int(PALMO * 0.35), int(PALMO * 0.4)), 0, 0, 360, 1, -1)
    return z


def ossos_finos(pts_c, forma, largura):
    z = np.zeros(forma, np.uint8)
    for a, b in OSSOS:
        cv2.line(z, tuple(pts_c[a].astype(int)), tuple(pts_c[b].astype(int)), 255, max(1, int(largura)))
    return z > 0


def suave(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def filtro_guiado(guia, p, r, eps):
    """Filtro guiado colorido (He, Sun e Tang): a máscara segue as bordas da cor da foto."""
    caixa = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))  # noqa: E731
    I = guia.astype(np.float32) / 255
    mI = caixa(I)
    mp_ = caixa(p)
    cov_Ip = caixa(I * p[..., None]) - mI * mp_[..., None]
    var = np.empty(I.shape[:2] + (3, 3), np.float32)
    for i in range(3):
        for j in range(i, 3):
            var[..., i, j] = var[..., j, i] = caixa(I[..., i] * I[..., j]) - mI[..., i] * mI[..., j]
    var += eps * np.eye(3, dtype=np.float32)
    a = np.linalg.solve(var, cov_Ip[..., None])[..., 0]
    b = mp_ - (a * mI).sum(-1)
    return (caixa(a) * I).sum(-1) + caixa(b)


def alfa_da_mao(pele, guia, pts_c, outras_c=()):
    """Transparência da mão: pele da segmentação colada às bordas da cor, só na zona da mão."""
    pele = pele.astype(np.float32)
    g = filtro_guiado(guia, pele, int(PALMO * 0.035), 4e-3)
    # o filtro só manda na faixa de dúvida da borda; onde a segmentação tem certeza, vale ela
    duvida = cv2.GaussianBlur(((pele > 0.08) & (pele < 0.92)).astype(np.float32), (0, 0), PALMO * 0.02)
    duvida = np.clip(duvida * 2, 0, 1)
    p = duvida * g + (1 - duvida) * pele
    a = suave(p, 0.35, 0.65)
    a *= zona_da_mao(pts_c, a.shape)
    # a outra mão, quando o MediaPipe viu as duas, fica de fora mesmo encostada nesta
    for o in outras_c:
        z = cv2.dilate(nucleo_da_mao(o, a.shape, pulso=None),
                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(PALMO * 0.2),) * 2))
        a *= 1 - cv2.GaussianBlur(z.astype(np.float32), (0, 0), PALMO * 0.02)
    # só a parte ligada aos ossos da mão (tira a outra mão, o rosto e sobras do fundo)
    n, comp = cv2.connectedComponents((a > 0.5).astype(np.uint8))
    sem = ossos_finos(pts_c, a.shape, PALMO * 0.06)
    manter = np.zeros(a.shape, np.uint8)
    for c in set(np.unique(comp[sem & (comp > 0)])):
        manter[comp == c] = 255
    manter = cv2.dilate(manter, np.ones((5, 5), np.uint8))
    a *= cv2.GaussianBlur(manter.astype(np.float32) / 255, (0, 0), 1.5)
    # o antebraço some abaixo do pulso
    y = np.arange(a.shape[0], dtype=np.float32)[:, None]
    a *= 1 - suave(y, PULSO[1] + PALMO * 0.1, PULSO[1] + PALMO * 0.65)
    return np.clip(a, 0, 1)


# ---------------------------------------------------------------------------
# Análise de um quadro
# ---------------------------------------------------------------------------

def analisar(modelos, frame, hand, outras=(), pronta=False):
    """Medidas de uma mão num quadro e, com pronta, a foto pronta (BGRA no quadro da mão)."""
    h, w = frame.shape[:2]
    pts = pontos_px(hand["lm"], w, h)
    palmo = float(np.hypot(*(pts[9] - pts[0])))
    x0, y0 = pts.min(0)
    x1, y1 = pts.max(0)
    # Região quadrada em volta da mão, com braço e um pouco do corpo (contexto para a segmentação)
    lado = int(max(x1 - x0, y1 - y0) + 2.2 * palmo)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 0.3 * palmo
    ox, oy = cx - lado / 2, cy - lado / 2
    T = np.array([[1, 0, -ox], [0, 1, -oy]], np.float64)
    reg = cv2.warpAffine(frame, T, (lado, lado), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    valido = cv2.warpAffine(np.full((h, w), 255, np.uint8), T, (lado, lado), borderValue=0)
    pts_r = pts - [ox, oy]
    # Segmentação em duas escalas: a região (mão pequena ganha resolução) e o quadro inteiro (mão
    # grande perto da borda); fica o maior valor de cada classe
    probs = modelos.segmentar(reg)
    inteiro = cv2.warpAffine(modelos.segmentar(frame), T, (lado, lado), flags=cv2.INTER_LINEAR)
    probs = np.maximum(probs, inteiro)
    probs[valido < 128] = 0

    # Mão de verdade: pele média ao longo dos ossos
    ossos_r = ossos_finos(pts_r, (lado, lado), max(2, palmo * 0.08))
    pele_media = float(probs[..., PELE][ossos_r].mean())

    # Nitidez com o palmo sempre do mesmo tamanho, só na mão
    f = PALMO_NITIDEZ / palmo
    cinza = cv2.cvtColor(cv2.resize(reg, None, fx=f, fy=f, interpolation=cv2.INTER_AREA if f < 1 else cv2.INTER_CUBIC),
                         cv2.COLOR_BGR2GRAY)
    zona_r = cv2.resize(cv2.dilate(ossos_r.astype(np.uint8), np.ones((3, 3), np.uint8)), cinza.shape[::-1]) > 0
    lap = cv2.Laplacian(cinza, cv2.CV_64F)
    nitidez = float(lap[zona_r].var()) if zona_r.any() else 0.0

    # Quadro da mão: transformação a partir da região
    M = transformacao(pts_r)
    forma = (ALTURA_MAO, LARGURA)
    guia = cv2.warpAffine(reg, M, forma[::-1], flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    pele = cv2.warpAffine(probs[..., PELE], M, forma[::-1], flags=cv2.INTER_LINEAR)
    rosto_pele = cv2.warpAffine(probs[..., PELE_ROSTO], M, forma[::-1], flags=cv2.INTER_LINEAR)
    pts_c = aplicar(M, pts_r)
    outras_c = [aplicar(M, pontos_px(o["lm"], w, h) - [ox, oy]) for o in outras]
    alfa = alfa_da_mao(pele, guia, pts_c, outras_c)
    area = float(alfa.sum()) + 1e-6
    # Pele de rosto fora da mão (a segmentação às vezes chama os nós dos dedos de rosto)
    casco_c = np.zeros(forma, np.uint8)
    cv2.fillConvexPoly(casco_c, cv2.convexHull(pts_c.astype(np.int32)), 1)
    casco_c = cv2.dilate(casco_c, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(PALMO * 0.3),) * 2))
    pele_rosto = float((alfa * (rosto_pele > 0.5) * (casco_c == 0)).sum() / area)

    # Rostos achados pelo detector (na região e no quadro inteiro): quanto da mão recortada cai
    # dentro da caixa de um rosto. Mão na frente do rosto sai; mão ao lado do rosto fica, porque
    # o recorte só leva a pele ligada à mão (pele de rosto é outra classe da segmentação). Caixa
    # quase toda coberta pela mão é a mão confundida com rosto (acontece com o punho fechado).
    casco_r = np.zeros((lado, lado), np.uint8)
    cv2.fillConvexPoly(casco_r, cv2.convexHull(pts_r.astype(np.int32)), 1)
    casco_r = cv2.dilate(casco_r, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(palmo * 0.3) | 1,) * 2))
    caixas = modelos.rostos(reg) + [(a - ox, b - oy, c - ox, d - oy) for a, b, c, d in modelos.rostos(frame)]
    caixa_rosto = np.zeros((lado, lado), np.float32)
    cabeca = np.zeros((lado, lado), np.float32)
    n_rostos = 0
    for (a, b, c, d) in caixas:
        y0_, y1_, x0_, x1_ = max(0, int(b)), max(0, int(d)), max(0, int(a)), max(0, int(c))
        if y1_ <= y0_ or x1_ <= x0_ or casco_r[y0_:y1_, x0_:x1_].mean() >= MAX_ROSTO_NA_MAO:
            continue
        n_rostos += 1
        caixa_rosto[y0_:y1_, x0_:x1_] = 1
        # a caixa do detector vai das sobrancelhas à boca: a cabeça inteira pega testa, cabelo e queixo
        lw, lh = c - a, d - b
        cabeca[max(0, int(b - 0.6 * lh)):max(0, int(d + 0.2 * lh)), max(0, int(a - 0.25 * lw)):max(0, int(c + 0.25 * lw))] = 1
    caixa_rosto = cv2.warpAffine(caixa_rosto, M, forma[::-1], flags=cv2.INTER_NEAREST)
    cabeca = cv2.warpAffine(cabeca, M, forma[::-1], flags=cv2.INTER_NEAREST)
    mao_no_rosto = float((alfa * caixa_rosto).sum() / area)
    # Vazamento: recorte dentro da cabeça e longe dos dedos (pedaço de testa ou de pescoço que veio junto)
    dedos = cv2.dilate(nucleo_da_mao(pts_c, forma, pulso=None),
                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(PALMO * 0.3),) * 2))
    vazamento = float((alfa * cabeca * (dedos == 0)).sum() / area)

    # Enquadramento: quanto da mão (até onde o antebraço some) fica fora do quadro do vídeo
    nucleo = cv2.dilate(nucleo_da_mao(pts_c, forma, pulso="estreito"),
                        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(PALMO * 0.24),) * 2)).astype(np.float32)
    y = np.arange(forma[0], dtype=np.float32)[:, None]
    nucleo *= 1 - suave(y, PULSO[1] + PALMO * 0.1, PULSO[1] + PALMO * 0.65)
    valido_c = cv2.warpAffine(valido, M, forma[::-1], flags=cv2.INTER_NEAREST, borderValue=0) > 128
    fora = float((nucleo * ~valido_c).sum() / (nucleo.sum() + 1e-6))
    # Qualidade do recorte: os ossos da mão têm de estar dentro do recorte (mão inteira, sem buraco)
    cobertura = float((alfa[ossos_finos(pts_c, forma, 3)] > 0.5).mean())
    # Outra mão encostada nesta: fração do núcleo desta mão tomada pela outra
    propria = nucleo_da_mao(pts_c, forma, pulso=None) > 0
    outra_mao = 0.0
    for o in outras_c:
        outra_mao = max(outra_mao, float((nucleo_da_mao(o, forma, pulso=None)[propria] > 0).mean()))

    # Texto em cima da mão recortada
    texto = False
    for poli in modelos.textos(reg):
        m = np.zeros(forma, np.uint8)
        cv2.fillConvexPoly(m, aplicar(M, poli.astype(np.float64)).astype(np.int32), 1)
        if (alfa[m > 0] > 0.3).any():
            texto = True

    out = {
        "palmo": round(palmo, 1), "nitidez": round(nitidez, 1), "pele": round(pele_media, 3),
        "rostos": n_rostos, "mao_no_rosto": round(mao_no_rosto, 4), "vazamento": round(vazamento, 4), "pele_rosto": round(pele_rosto, 4), "texto": texto,
        "fora": round(fora, 4), "cobertura": round(cobertura, 3), "outra_mao": round(outra_mao, 3),
        "lado": float(np.sign(pts_c[5, 0] - pts_c[17, 0])),
    }
    if pronta:
        cor = cv2.warpAffine(reg, M, forma[::-1], flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
        # reforço leve de nitidez, proporcional à ampliação
        k = min(1.0, 0.25 * PALMO / palmo)
        borrada = cv2.GaussianBlur(cor, (0, 0), 1.2 + 0.25 * PALMO / palmo)
        cor = cv2.addWeighted(cor, 1 + k, borrada, -k, 0)
        # Borda sem a cor do fundo antigo: perto da borda a cor vem do miolo da mão, e a borda
        # recua um pouco (o fundo azul ou branco deixava um contorno)
        dura = (alfa > 0.92).astype(np.float32)
        sig = PALMO * 0.02
        miolo = cv2.GaussianBlur(cor.astype(np.float32) * dura[..., None], (0, 0), sig) / \
            (cv2.GaussianBlur(dura, (0, 0), sig)[..., None] + 1e-4)
        borda = np.clip((1 - alfa) * 2 + (1 - cv2.erode(dura, np.ones((5, 5), np.uint8))) * 0.6, 0, 1)[..., None]
        borda *= (cv2.GaussianBlur(dura, (0, 0), sig) > 0.05)[..., None]
        cor = (cor.astype(np.float32) * (1 - borda) + miolo * borda).clip(0, 255).astype(np.uint8)
        alfa = suave(alfa, 0.25, 1.0)
        out["bgra"] = np.dstack([cor, (alfa * 255).round().astype(np.uint8)])
    return out


def compor(bgra, fundo=FUNDO):
    """Mão sobre o fundo liso do app (BGR)."""
    a = bgra[..., 3:4].astype(np.float32) / 255
    bg = np.empty_like(bgra[..., :3], np.float32)
    bg[:] = hex_bgr(fundo)
    return (bgra[..., :3].astype(np.float32) * a + bg * (1 - a)).round().astype(np.uint8)


# ---------------------------------------------------------------------------
# Filtros e ranking
# ---------------------------------------------------------------------------

FILTROS = [
    ("classificador", lambda c: c["p"] >= MIN_P and c["lida"] == c["letra"]),
    ("tamanho", lambda c: c["palmo"] >= MIN_PALMO),
    ("enquadramento", lambda c: c["fora"] <= MAX_FORA),
    ("nitidez", lambda c: c["nitidez"] >= MIN_NITIDEZ),
    ("mao_de_verdade", lambda c: c["pele"] >= MIN_PELE),
    ("recorte", lambda c: c["cobertura"] >= MIN_COBERTURA and c["outra_mao"] <= MAX_OUTRA_MAO),
    ("rosto", lambda c: c["mao_no_rosto"] <= MAX_MAO_NO_ROSTO and c["vazamento"] <= MAX_VAZAMENTO
     and c["pele_rosto"] <= MAX_PELE_ROSTO),
    ("texto", lambda c: not c["texto"]),
]


def qualidade(c):
    """Nota para ordenar: confiança do modelo, tamanho da mão no vídeo e nitidez."""
    res = min(1.0, c["palmo"] / 110) ** 0.6
    nit = min(1.0, c["nitidez"] / 400) ** 0.4
    return round(c["p"] ** 2 * res * nit * min(1.0, c["pele"] / 0.85), 4)


def coletar(pastas, modelos, clf):
    fontes = {f["id"]: f for f in ler_json(os.path.join(pastas.data, "fontes.json"))}
    por_video = collections.defaultdict(list)
    for vid, p in paradas_aceitas(pastas):
        por_video[vid].append(p)
    cands = []
    for vid, ps in sorted(por_video.items()):
        fonte = fontes[vid]
        lms = ler_json(os.path.join(pastas.data, "landmarks", f"{vid}.json"))
        cap = cv2.VideoCapture(os.path.join(pastas.data, "videos", fonte["arquivo"]))
        for p in ps:
            for f in quadros_da_parada(lms, p):
                hand = min(f["hands"], key=lambda hh: hh["lm"][1])
                lida, pmax, P = clf.ler(hand["lm"], hand["h"], lms["aspect"])
                c = {"letra": p["letra"], "video": vid, "canal": fonte["channel"], "canal_id": fonte["channel_id"],
                     "t": f["t"], "parada": [p["ini"], p["fim"]], "lida": lida,
                     "p": round(clf.prob(P, p["letra"]), 4), "mao": hand["h"]}
                frame = ler_quadro(cap, f["t"])
                if frame is None:
                    continue
                # Só analisa a imagem de quem passa pelo classificador (o resto nem entra na conta)
                if FILTROS[0][1](c):
                    c.update(analisar(modelos, frame, hand, [o for o in f["hands"] if o is not hand]))
                cands.append(c)
        cap.release()
        print(f"{vid}: {len(ps)} paradas", flush=True)
    return cands


def filtrar(cands):
    """Aplica os filtros em ordem; devolve as que passam e a contagem de canais por etapa."""
    contagem = {L: {} for L in LETRAS}
    vivos = list(cands)
    for L in LETRAS:
        contagem[L]["paradas"] = len({(c["video"], tuple(c["parada"])) for c in cands if c["letra"] == L})
        contagem[L]["canais"] = len({c["canal_id"] for c in cands if c["letra"] == L})
    for nome, ok in FILTROS:
        vivos = [c for c in vivos if ok(c)]
        for L in LETRAS:
            contagem[L][nome] = len({c["canal_id"] for c in vivos if c["letra"] == L})
    return vivos, contagem


def melhores_por_canal(vivos):
    """Uma mão por canal e letra: a de melhor nota."""
    melhor = {}
    for c in vivos:
        c["qualidade"] = qualidade(c)
        k = (c["letra"], c["canal_id"])
        if k not in melhor or c["qualidade"] > melhor[k]["qualidade"]:
            melhor[k] = c
    return list(melhor.values())


def chave(c):
    return f"{c['video']}@{c['t']:.3f}"


# ---------------------------------------------------------------------------
# Folha de aprovação
# ---------------------------------------------------------------------------

TILE_W, TILE_H = 200, 250
POR_LINHA = 12


def folha(pastas, candidatos, selecao):
    """Uma faixa por letra, na ordem da nota; as pré-selecionadas com borda e selo tangerina."""
    import PIL.Image
    import PIL.ImageDraw
    import PIL.ImageFont

    escolhidas = {i for ids in selecao["letras"].values() for i in ids}
    fonte = PIL.ImageFont.truetype(pastas.fonte_display, 44)
    fonte.set_variation_by_axes([125, 900])
    fonte_n = PIL.ImageFont.truetype(pastas.fonte_display, 19)
    fonte_n.set_variation_by_axes([100, 800])
    margem_esq, gap, topo = 90, 8, 20
    linhas = []
    for L in LETRAS:
        cs = [c for c in candidatos if c["letra"] == L]
        n_linhas = max(1, -(-len(cs) // POR_LINHA))
        linhas.append((L, cs, n_linhas))
    altura = topo + sum(n * (TILE_H + gap) + 26 for _, _, n in linhas) + 10
    largura = margem_esq + POR_LINHA * (TILE_W + gap) + 10
    img = PIL.Image.new("RGB", (largura, altura), hex_rgb("#0E0B09"))
    d = PIL.ImageDraw.Draw(img)
    y = topo
    # recorte do quadro da mão que vai para cada miniatura
    rx0, rx1 = 190, LARGURA - 190
    ry1 = PULSO[1] + int(PALMO * 0.75)
    ry0 = ry1 - int((rx1 - rx0) * TILE_H / TILE_W)
    for L, cs, n_linhas in linhas:
        d.text((24, y + 8), L, font=fonte, fill=hex_rgb(TINTA))
        for k, c in enumerate(cs):
            col, lin = k % POR_LINHA, k // POR_LINHA
            x = margem_esq + col * (TILE_W + gap)
            yy = y + lin * (TILE_H + gap)
            bgra = cv2.imread(os.path.join(pastas.maos, f"{c['id']}.png"), cv2.IMREAD_UNCHANGED)
            tile = compor(bgra)[ry0:ry1, rx0:rx1]
            tile = cv2.resize(tile, (TILE_W, TILE_H), interpolation=cv2.INTER_AREA)
            img.paste(PIL.Image.fromarray(cv2.cvtColor(tile, cv2.COLOR_BGR2RGB)), (x, yy))
            sel = c["id"] in escolhidas
            if sel:
                d.rectangle([x, yy, x + TILE_W - 1, yy + TILE_H - 1], outline=hex_rgb(TANGERINA), width=5)
                d.ellipse([x + TILE_W - 30, yy + 9, x + TILE_W - 11, yy + 28], fill=hex_rgb(TANGERINA))
            rot = f"{c['id']}  {c['p']:.2f}"
            d.rectangle([x + 5, yy + TILE_H - 31, x + 12 + d.textlength(rot, font=fonte_n), yy + TILE_H - 6],
                        fill=(14, 11, 9))
            d.text((x + 9, yy + TILE_H - 30), rot, font=fonte_n,
                   fill=hex_rgb(TANGERINA) if sel else hex_rgb(TINTA))
        y += n_linhas * (TILE_H + gap) + 26
    out = os.path.join(pastas.saida, "folha.jpg")
    img.save(out, quality=88)
    return out


# ---------------------------------------------------------------------------
# Seleção
# ---------------------------------------------------------------------------

def pre_selecao(candidatos):
    letras = {}
    for L in LETRAS:
        cs = [c for c in candidatos if c["letra"] == L]
        letras[L] = [c["id"] for c in cs[:PRE_SELECAO]]
    return letras


def gravar_selecao(pastas, letras, candidatos):
    por_id = {c["id"]: c for c in candidatos}
    sel = {"letras": letras,
           "chaves": {i: chave(por_id[i]) for ids in letras.values() for i in ids},
           "como_editar": "tire ou ponha IDs da folha (ex.: L3, A14) em 'letras'; a ordem não importa. "
                          "Ou: python divulgacao/preparar.py --tirar L3 --por A14"}
    gravar_json(pastas.selecao, sel)
    return sel


def editar_selecao(pastas, tirar, por):
    candidatos = ler_json(pastas.candidatos)["candidatos"]
    ids = {c["id"] for c in candidatos}
    sel = ler_json(pastas.selecao)
    letras = {L: list(v) for L, v in sel["letras"].items()}
    for i in tirar:
        L = i[0].upper()
        if i.upper() in letras.get(L, []):
            letras[L].remove(i.upper())
        else:
            print(f"{i}: não estava na seleção")
    for i in por:
        i = i.upper()
        if i not in ids:
            sys.exit(f"{i}: não existe na folha (veja candidatos.json)")
        if i not in letras[i[0]]:
            letras[i[0]].append(i)
    for L in LETRAS:
        if len(letras[L]) < MIN_SELECAO:
            print(f"aviso: {L} ficou com {len(letras[L])} mãos (o roteiro pede de 10 a 12)")
    return gravar_selecao(pastas, letras, candidatos)


# ---------------------------------------------------------------------------

def main():
    ap = argumentos(__doc__)
    ap.add_argument("--nova-selecao", action="store_true", help="refaz selecao.json com as melhores de cada letra")
    ap.add_argument("--tirar", action="append", default=[], help="ID a tirar da seleção (ex.: L3)")
    ap.add_argument("--por", action="append", default=[], help="ID a pôr na seleção (ex.: A14)")
    ap.add_argument("--folha", action="store_true", help="só redesenha a folha")
    ap.add_argument("--reusar-analise", action="store_true",
                    help="usa as medidas de analise.json (só refaz filtros, mãos e folha)")
    args = ap.parse_args()
    pastas = Pastas(args.data)

    if args.tirar or args.por or args.folha:
        sel = editar_selecao(pastas, args.tirar, args.por) if (args.tirar or args.por) else ler_json(pastas.selecao)
        print(folha(pastas, ler_json(pastas.candidatos)["candidatos"], sel))
        for L in LETRAS:
            print(f"{L}: {' '.join(sel['letras'][L])}")
        return

    pastas.criar()
    clf = Classificador(pastas.classificador)
    modelos = Modelos(pastas)
    analise = os.path.join(pastas.saida, "analise.json")
    if args.reusar_analise and os.path.exists(analise):
        cands = ler_json(analise)
    else:
        cands = coletar(pastas, modelos, clf)
        gravar_json(analise, cands)
    vivos, contagem = filtrar(cands)
    melhores = melhores_por_canal(vivos)

    # Foto pronta das mãos que ficaram
    fontes_cache = {}
    finais = []
    for c in sorted(melhores, key=lambda c: (LETRAS.index(c["letra"]), -c["qualidade"])):
        fonte = fontes_cache.get(c["video"])
        if fonte is None:
            fonte = {f["id"]: f for f in ler_json(os.path.join(pastas.data, "fontes.json"))}[c["video"]]
            fontes_cache[c["video"]] = fonte
        lms = ler_json(os.path.join(pastas.data, "landmarks", f"{c['video']}.json"))
        f = min(lms["frames"], key=lambda f: abs(f["t"] - c["t"]))
        hand = min(f["hands"], key=lambda hh: hh["lm"][1])
        cap = cv2.VideoCapture(os.path.join(pastas.data, "videos", fonte["arquivo"]))
        frame = ler_quadro(cap, c["t"])
        cap.release()
        outras = [o for o in f["hands"] if o is not hand]
        c["bgra"] = analisar(modelos, frame, hand, outras, pronta=True)["bgra"]
        finais.append(c)

    # Brilho: aproxima um pouco cada mão da mediana (sem apagar o tom de pele) para a troca rápida
    # não piscar; o fundo já é o mesmo em todas
    for c in finais:
        a = c["bgra"][..., 3].astype(np.float32) / 255
        y = cv2.cvtColor(c["bgra"][..., :3], cv2.COLOR_BGR2GRAY).astype(np.float32)
        c["luz"] = round(float((y * a).sum() / (a.sum() + 1e-6)), 1)
    alvo = float(np.median([c["luz"] for c in finais])) if finais else 0
    for c in finais:
        c["ganho"] = round(float(np.clip((alvo / max(c["luz"], 1)) ** 0.5, 0.85, 1.2)), 3)
        cor = c["bgra"][..., :3].astype(np.float32) * c["ganho"]
        c["bgra"][..., :3] = np.clip(cor, 0, 255).round().astype(np.uint8)

    # Chaves (vídeo e instante) dos números da rodada anterior, para manter a seleção do dono
    antigos = {}
    if os.path.exists(pastas.candidatos):
        antigos = {c["id"]: chave(c) for c in ler_json(pastas.candidatos)["candidatos"]}

    # O polegar sempre do mesmo lado: espelha a minoria
    lado = 1.0 if sum(c["lado"] for c in finais) >= 0 else -1.0
    for f_ in glob.glob(os.path.join(pastas.maos, "*.png")):
        os.remove(f_)
    n_por_letra = collections.Counter()
    for c in finais:
        n_por_letra[c["letra"]] += 1
        c["id"] = f"{c['letra']}{n_por_letra[c['letra']]}"
        c["espelhada"] = c["lado"] != lado
        bgra = c.pop("bgra")
        if c["espelhada"]:
            bgra = np.ascontiguousarray(bgra[:, ::-1])
        cv2.imwrite(os.path.join(pastas.maos, f"{c['id']}.png"), bgra)

    gravar_json(pastas.candidatos, {"contagem": contagem, "filtros": [n for n, _ in FILTROS],
                                    "candidatos": finais})
    if args.nova_selecao or not os.path.exists(pastas.selecao):
        sel = gravar_selecao(pastas, pre_selecao(finais), finais)
    else:
        sel = ler_json(pastas.selecao)
        # a numeração pode mudar de uma rodada para outra: a chave (vídeo e instante) manda
        por_chave = {chave(c): c["id"] for c in finais}
        letras = {}
        for L in LETRAS:
            letras[L] = []
            for i in sel["letras"].get(L, []):
                k = sel.get("chaves", {}).get(i) or antigos.get(i)
                if k in por_chave:
                    letras[L].append(por_chave[k])
                else:
                    print(f"{i}: a foto não passou nos filtros desta rodada e saiu da seleção")
        sel = gravar_selecao(pastas, letras, finais)

    print("\ncanais por etapa (paradas = paradas aceitas; canais = um vídeo por canal):")
    etapas = ["paradas", "canais"] + [n for n, _ in FILTROS]
    print("letra " + " ".join(f"{e:>14}" for e in etapas))
    for L in LETRAS:
        print(f"{L:5} " + " ".join(f"{contagem[L][e]:>14}" for e in etapas))
    print(folha(pastas, finais, sel))
    print(pastas.selecao)


if __name__ == "__main__":
    main()
