"""
Vídeo de divulgação, passo 2 (docs/video-divulgacao-librax.md): monta o vídeo com as mãos escolhidas
em selecao.json (passo 1: preparar.py).

Desenho: cada letra de LIBRAX ganha um quadrado colorido com a foto da mão dentro. O quadrado da
letra aparece grande no meio da tela enquanto as mãos trocam; depois encolhe, gira um pouco e vai
para o seu lugar, em cima da sua letra da palavra LIBRAX escrita embaixo. A palavra fica com o
espaçamento do logotipo, então os quadrados, maiores que o passo entre as letras, se sobrepõem
(o de cada letra por cima do anterior), cada um levemente girado e deslocado, como se tivessem
sido colados à mão, com uma sombra de papel. No fim, a fileira e a palavra sobem para o meio e
dão lugar à palavra-marca do app (símbolo Traço e "librax").

Roteiro (30 quadros por segundo; tempos em ENTRADA, QUADROS_POR_MAO etc.):
- 0 a 0,3 s: só o fundo do app;
- cada letra: o quadrado grande entra (0,13 s) com a primeira mão; as outras trocam a cada
  67 ms (POR_LETRA mãos, 10); a última fica 0,1 s e o quadrado encolhe para o lugar (0,3 s),
  com a letra escrita entrando embaixo; a letra seguinte começa antes do fim do encolhimento
  (cerca de 1 s por letra);
- LIBRAX completo sobe para o meio, fica parado 1 s e sai; entra a palavra-marca (1 s parada).

Com menos de POR_LETRA fotos numa letra, as fotos se repetem em ciclo, sem a mesma duas vezes
seguidas.

Cuidado com luz piscando: o fundo da tela e a cor de cada quadrado ficam fixos; só a mão muda.
Nada de clarão de tela inteira.

As cores dos quadrados são do design system (docs/design-system.md, apps/web-poc/src/styles/tokens.css):
tons médios e frios (petróleo, safira, framboesa, verde, ametista), longe do tom de pele, para a
mão se destacar em qualquer pele. Os quadrados não têm canto arredondado (pedido do dono).

Formatos: vertical 1080 x 1920 (padrão e principal), quadrado 1080 x 1080 e horizontal 1920 x 1080.

Saída em <data>/divulgacao/ (H.264, sem som):
- <nome>.mp4 no vertical, <nome>-quadrado.mp4 e <nome>-horizontal.mp4 (padrão do nome: rascunho-v3);
- final-v3.png (e -quadrado, -horizontal; o nome segue o do vídeo): a composição final, com LIBRAX completo;
- com --previa L: previa-L.mp4 e previa-L.gif (só essa letra: zoom, troca e encolhimento).

Uso:
    python divulgacao/montar.py [--data PASTA]                  vertical
    python divulgacao/montar.py --formato todos                 os três formatos
    python divulgacao/montar.py --por-letra 8                   outra quantidade de mãos por letra
    python divulgacao/montar.py --semente 5                     outro sorteio de giro e deslocamento
    python divulgacao/montar.py --previa L
    python divulgacao/montar.py --quadros 1.0 3.2 6.1           (grava esses instantes em JPG para conferir)
"""

import os
import random
import subprocess

import cv2
import numpy as np
import PIL.Image
import PIL.ImageDraw
import PIL.ImageFont

from comum import FUNDO, LETRAS, MARCA, POR_LETRA, TINTA, Pastas, argumentos, hex_rgb, ler_json, no_video

FPS = 30
QUADROS_POR_MAO = 2  # 67 ms
INICIO = 0.3
ENTRADA = 0.13  # quadrado grande aparecendo, já com a primeira mão
PARADA = 0.1  # última mão parada no quadrado grande
ENCOLHE = 0.3  # do meio da tela para o lugar na fileira
PROXIMA = 0.65  # a letra seguinte entra quando o encolhimento chega a essa fração
LETRA_ENTRA = 0.2  # letra escrita aparecendo, a partir de 60% do encolhimento
SOBE = 0.5  # fileira e palavra sobem para o meio
CHEIO = 1.0  # LIBRAX completo parado
SAIDA = 0.5  # fileira e letras saem, depois a palavra-marca entra
FIM = 1.0  # palavra-marca parada

FORMATOS = {
    # nome: largura, altura, largura da palavra (fração da largura), lado do quadrado grande (fração
    # do lado menor), centro do quadrado grande e da fileira (fração da altura), sufixo do arquivo
    "vertical": (1080, 1920, 0.86, 0.62, 0.33, 0.62, ""),
    "quadrado": (1080, 1080, 0.72, 0.40, 0.25, 0.64, "-quadrado"),
    "horizontal": (1920, 1080, 0.46, 0.42, 0.27, 0.64, "-horizontal"),
}
LADO_POR_PASSO = 1.12  # lado do quadrado em relação ao passo médio entre as letras da palavra
ESPACO_LETRA = 0.2  # do pé do quadrado ao topo das letras, em fração do lado
GIRO = (2.5, 6.0)  # graus, sorteado por quadrado, com o sentido alternado
DESLOCA = (0.03, 0.05)  # deslocamento máximo em x e y, em fração do lado
SEMENTE = 3
SOMBRA = (0.55, 0.035, 0.02, 0.035)  # opacidade, desfoque, deslocamento x e y (fração do lado)

# Uma cor por quadrado, na ordem de LIBRAX. Tons médios (luminosidade 38 a 48) e frios: a pele
# das fotos fica quase toda bem mais clara, e o matiz fica do outro lado do círculo. Tangerina,
# âmbar e ouro ficam de fora (perto demais do tom de pele); a tangerina segue nas letras e no
# símbolo. O petróleo, que no app é a cor da mão e da Libras, abre e fecha a fileira.
CORES_QUADRADOS = {
    "L": "#0E7C7B",  # color.petroleo.600 (game.hand.fill no claro)
    "I": "#3460E6",  # league.safira.fill
    "B": "#B42A5E",  # color.framboesa.600
    "R": "#14834A",  # color.verde.600
    "A": "#7B4FE0",  # league.ametista.fill
    "X": "#0B6463",  # color.petroleo.700
}

# Recorte das fotos (maos/<ID>.png, 1080 x 1460, pulso em (540, 1130), palmo de 285 px): a mão de
# pé e o antebraço saindo pela borda de baixo; dentro de cada letra, o pulso fica sempre no
# mesmo ponto do quadrado.
FOLGA = 0.06  # folga em cima e dos lados da união das mãos, em fração do lado
CORTE_BAIXO = 1190  # y do recorte embaixo, logo abaixo do pulso (o antebraço some por volta de 1253)
DESCE_MAX = 25  # quanto o recorte pode descer quando sobra altura (até 1215 o antebraço ainda é firme)

CORPO_MARCA = 150  # corpo do "librax" na palavra-marca, num quadro de 1080 de lado menor


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def fonte_display(pastas, corpo, largura=125, peso=900):
    f = PIL.ImageFont.truetype(pastas.fonte_display, int(round(corpo)))
    f.set_variation_by_axes([largura, peso])
    return f


def suave(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def suave3(t):
    """Entrada e saída mais macias que suave (para o encolhimento)."""
    t = min(max(t, 0.0), 1.0)
    return t * t * t * (t * (6 * t - 15) + 10)


def camada(rgba, x0=0, y0=0):
    """Camada recortada no que tem tinta: (RGBA uint8, x, y) no quadro do vídeo."""
    rgba = np.asarray(rgba)
    ys, xs = np.nonzero(rgba[..., 3])
    if not len(xs):
        return rgba[:1, :1], x0, y0
    a, b, c, d = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return np.ascontiguousarray(rgba[a:b, c:d]), x0 + c, y0 + a


# ---------------------------------------------------------------------------
# Leiaute: a palavra com o espaçamento do logotipo e os quadrados em cima de cada letra
# ---------------------------------------------------------------------------

class Leiaute:
    def __init__(self, pastas, formato, semente=SEMENTE):
        (self.largura, self.altura, frac_palavra, frac_grande, y_grande, y_fileira,
         self.sufixo) = FORMATOS[formato]
        self.formato = formato
        # corpo da palavra que dá a largura pedida (avanço do logotipo: menos 1% do corpo por letra)
        f100 = fonte_display(pastas, 100)
        largura100 = sum(f100.getlength(c) - 1 for c in LETRAS)
        self.corpo = frac_palavra * self.largura * 100 / largura100
        self.fonte = fonte_display(pastas, self.corpo)
        f = self.fonte
        avancos = [f.getlength(c) - 0.01 * self.corpo for c in LETRAS]
        x = (self.largura - sum(avancos)) / 2
        self.x_letras, self.cx = [], []
        for c, av in zip(LETRAS, avancos):
            x0, _, x1, _ = f.getbbox(c, anchor="ls")
            self.x_letras.append(x)
            self.cx.append(x + (x0 + x1) / 2)  # centro da tinta da letra
            x += av
        self.passos = [b - a for a, b in zip(self.cx, self.cx[1:])]
        self.lado = int(round(LADO_POR_PASSO * float(np.mean(self.passos))))
        self.grande = int(round(frac_grande * min(self.largura, self.altura)))
        self.centro_grande = (self.largura / 2, y_grande * self.altura)
        self.y_fileira = y_fileira * self.altura
        _, cima, _, baixo = f.getbbox("L", anchor="ls")
        self.altura_letra = baixo - cima
        self.topo_letras = self.y_fileira + self.lado / 2 + ESPACO_LETRA * self.lado
        self.base_letras = self.topo_letras - cima
        # sorteio fixo de giro e deslocamento: parece colado à mão e é igual em toda renderização
        rng = random.Random(semente)
        sinal = rng.choice((-1, 1))
        self.giro, self.desloca = [], []
        for _ in LETRAS:
            self.giro.append(sinal * rng.uniform(*GIRO))
            sinal = -sinal
            self.desloca.append((rng.uniform(-1, 1) * DESLOCA[0] * self.lado,
                                 rng.uniform(-1, 1) * DESLOCA[1] * self.lado))
        # no fim, fileira e palavra sobem até o bloco ficar no meio (como a palavra-marca)
        self.centro_marca = self.altura * (0.484 if self.altura > self.largura else 0.5)
        topo_bloco = self.y_fileira - self.lado / 2
        fim_bloco = self.topo_letras + self.altura_letra
        self.sobe = self.centro_marca - (topo_bloco + fim_bloco) / 2
        self.escala = min(self.largura, self.altura) / 1080

    def centro(self, i):
        """Centro do quadrado i na fileira (sem a subida do fim)."""
        return self.cx[i] + self.desloca[i][0], self.y_fileira + self.desloca[i][1]

    def visivel(self, i):
        """Fração da largura do quadrado i que o quadrado seguinte (por cima) deixa à mostra."""
        if i + 1 >= len(LETRAS):
            return 1.0
        dx = self.centro(i + 1)[0] - self.centro(i)[0]
        return float(min(1.0, max(0.45, dx / self.lado)))


# ---------------------------------------------------------------------------
# Fotos dentro do quadrado
# ---------------------------------------------------------------------------

def caixa_das_maos(fotos):
    """União (x0, x1, y0) das mãos de uma letra, no quadro das fotos de maos/."""
    x_min, x_max, y_min = 10 ** 6, 0, 10 ** 6
    for bgra in fotos:
        ys, xs = np.nonzero(bgra[..., 3] > 24)
        x_min, x_max, y_min = min(x_min, xs.min()), max(x_max, xs.max()), min(y_min, ys.min())
    return x_min, x_max, y_min


def corte_centrado(caixa):
    """Recorte (x, y, lado) com as mãos no meio: é o do quadrado grande."""
    x0, x1, y0 = caixa
    lado = max((CORTE_BAIXO - y0) / (1 - FOLGA), (x1 - x0) / (1 - 2 * FOLGA))
    sobra = lado - (CORTE_BAIXO - y0) / (1 - FOLGA)
    return ((x0 + x1) / 2 - lado / 2, CORTE_BAIXO - lado + min(sobra / 2, DESCE_MAX), lado)


def corte_na_fileira(caixa, visivel):
    """Recorte do quadrado na fileira: a mão cabe na parte que o quadrado seguinte deixa à mostra.

    Fica no meio quando cabe; senão encosta à esquerda o mínimo necessário e, se nem assim couber,
    a foto se afasta (a mão fica menor nesse quadrado)."""
    x0, x1, y0 = caixa
    w = x1 - x0
    lado = max((CORTE_BAIXO - y0) / (1 - FOLGA), w / (1 - 2 * FOLGA), w / max(0.2, visivel - 2 * FOLGA))
    centro = min(lado / 2, (visivel - FOLGA) * lado - w / 2)  # centro da mão, a partir da borda esquerda
    # se a foto se afastou, a sobra desce um pouco (só até o antebraço ainda chegar firme na borda)
    sobra = lado - (CORTE_BAIXO - y0) / (1 - FOLGA)
    return ((x0 + x1) / 2 - centro, CORTE_BAIXO - lado + min(sobra / 2, DESCE_MAX), lado)


def interpola(a, b, t):
    return tuple(p + (q - p) * t for p, q in zip(a, b))


def quadrado(bgra, corte, cor, n):
    """A foto recortada num quadrado n x n com o fundo na cor do quadrado (RGB float, 0 a 1)."""
    x, y, s = (int(round(v)) for v in corte)
    H, W = bgra.shape[:2]
    pedaco = np.zeros((s, s, 4), np.float32)
    a0, b0 = max(0, y), min(H, y + s)
    c0, d0 = max(0, x), min(W, x + s)
    if b0 > a0 and d0 > c0:
        pedaco[a0 - y:b0 - y, c0 - x:d0 - x] = bgra[a0:b0, c0:d0]
    rgba = pedaco[..., [2, 1, 0, 3]] / 255
    rgba[..., :3] *= rgba[..., 3:4]  # pré-multiplica para reduzir sem borda escura
    rgba = cv2.resize(rgba, (n, n), interpolation=cv2.INTER_AREA)
    fundo = np.array(hex_rgb(cor), np.float32) / 255
    return np.clip(rgba[..., :3] + fundo * (1 - rgba[..., 3:4]), 0, 1)


def colado(rgb, giro):
    """Quadrado girado com a sombra de papel: (RGB pré-multiplicado, alfa, sombra), do mesmo tamanho,
    centrados no centro do quadrado."""
    n = rgb.shape[0]
    op, desfoque, dx, dy = SOMBRA
    pad = int(np.ceil(n * (0.25 + desfoque * 3 + max(dx, dy))))
    N = n + 2 * pad
    tela = np.zeros((N, N, 3), np.float32)
    tela[pad:pad + n, pad:pad + n] = rgb
    alfa = np.zeros((N, N), np.float32)
    alfa[pad:pad + n, pad:pad + n] = 1
    M = cv2.getRotationMatrix2D((N / 2 - 0.5, N / 2 - 0.5), -giro, 1.0)
    tela = cv2.warpAffine(tela, M, (N, N), flags=cv2.INTER_LINEAR, borderValue=0)
    alfa = cv2.warpAffine(alfa, M, (N, N), flags=cv2.INTER_LINEAR, borderValue=0)
    T = np.float32([[1, 0, dx * n], [0, 1, dy * n]])
    sombra = cv2.warpAffine(alfa, T, (N, N), flags=cv2.INTER_LINEAR, borderValue=0)
    sombra = cv2.GaussianBlur(sombra, (0, 0), max(0.5, desfoque * n)) * op
    return tela, alfa, sombra


def colar(base, peca, cx, cy, opacidade=1.0):
    """Põe a peça (de colado) com o centro em (cx, cy): primeiro a sombra, depois o quadrado."""
    tela, alfa, sombra = peca
    N = alfa.shape[0]
    x, y = int(round(cx - N / 2)), int(round(cy - N / 2))
    y0, x0 = max(0, y), max(0, x)
    y1, x1 = min(base.shape[0], y + N), min(base.shape[1], x + N)
    if y1 <= y0 or x1 <= x0:
        return
    sl = (slice(y0 - y, y1 - y), slice(x0 - x, x1 - x))
    alvo = base[y0:y1, x0:x1]
    alvo *= 1 - (sombra[sl] * opacidade)[..., None]
    a = (alfa[sl] * opacidade)[..., None]
    alvo *= 1 - a
    alvo += tela[sl] * opacidade


# ---------------------------------------------------------------------------
# Letras e palavra-marca
# ---------------------------------------------------------------------------

def letras_escritas(lei):
    """Uma camada por letra (em tinta e em tangerina), com o espaçamento do logotipo."""
    camadas = []
    for i, c in enumerate(LETRAS):
        por_cor = {}
        for nome, cor in (("tinta", TINTA), ("marca", MARCA)):
            img = PIL.Image.new("RGBA", (lei.largura, lei.altura), (0, 0, 0, 0))
            PIL.ImageDraw.Draw(img).text((lei.x_letras[i], lei.base_letras), c, font=lei.fonte,
                                         fill=hex_rgb(cor) + (255,), anchor="ls")
            por_cor[nome] = camada(img)
        camadas.append(por_cor)
    return camadas


def simbolo(lado, escala=4):
    """BrandMark (src/components/Brand.tsx, caixa de 64) com as cores do tema escuro, em RGBA."""
    S = lado * escala
    k = S / 64
    img = PIL.Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = PIL.ImageDraw.Draw(img)
    marca = hex_rgb(MARCA) + (255,)
    # traço: M20 21 V33 Q20 46 33 46 H39, espessura 6.5, pontas redondas
    pts = [(20, 21), (20, 33)]
    for t in np.linspace(0, 1, 40)[1:]:
        pts.append(((1 - t) ** 2 * 20 + 2 * (1 - t) * t * 20 + t * t * 33,
                    (1 - t) ** 2 * 33 + 2 * (1 - t) * t * 46 + t * t * 46))
    pts.append((39, 46))
    # traço como sequência densa de discos: pontas e juntas redondas, como stroke-linecap round
    w = 6.5 * k
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        n = max(2, int(np.hypot(xb - xa, yb - ya) * k / 2))
        for t in np.linspace(0, 1, n):
            x, y = (xa + (xb - xa) * t) * k, (ya + (yb - ya) * t) * k
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=marca)
    # ponta: M37 36.5 L52 46 L37 55.5 z, com contorno de 2 e cantos redondos
    tri = [(37 * k, 36.5 * k), (52 * k, 46 * k), (37 * k, 55.5 * k)]
    d.polygon(tri, fill=marca)
    d.line(tri + [tri[0]], fill=marca, width=int(round(2 * k)), joint="curve")
    for x, y in tri:
        d.ellipse([x - k, y - k, x + k, y + k], fill=marca)
    # ponto inicial: círculo em (20, 12.5), raio 5
    d.ellipse([15 * k, 7.5 * k, 25 * k, 17.5 * k], fill=hex_rgb(TINTA) + (255,))
    return img.resize((lado, lado), PIL.Image.LANCZOS)


def palavra_marca(pastas, lei):
    """Wordmark do app: símbolo com 1,3 vez o corpo, espaço de 0,32 corpo e "librax" em Anybody 900 a 125%."""
    corpo = CORPO_MARCA * lei.escala
    f = fonte_display(pastas, corpo)
    lado = round(corpo * 1.3)
    gap = 0.32 * corpo
    texto = "librax"
    larg_texto = f.getlength(texto) - 0.01 * corpo * (len(texto) - 1)
    total = lado + gap + larg_texto
    x0 = (lei.largura - total) / 2
    img = PIL.Image.new("RGBA", (lei.largura, lei.altura), (0, 0, 0, 0))
    img.alpha_composite(simbolo(lado), (int(round(x0)), int(round(lei.centro_marca - lado / 2))))
    d = PIL.ImageDraw.Draw(img)
    x = x0 + lado + gap
    for c in texto:
        d.text((x, lei.centro_marca), c, font=f, fill=hex_rgb(TINTA) + (255,), anchor="lm")
        x += f.getlength(c) - 0.01 * corpo
    return camada(img)


def sobre(base, cam, alfa=1.0, dy=0):
    """Compõe a camada (RGBA uint8, x, y) sobre a base RGB float, deslocada dy px para baixo."""
    rgba, x, y = cam
    y += int(round(dy))
    h, w = rgba.shape[:2]
    y0, x0 = max(0, y), max(0, x)
    y1, x1 = min(base.shape[0], y + h), min(base.shape[1], x + w)
    if y1 <= y0 or x1 <= x0:
        return
    pedaco = rgba[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32) / 255
    a = pedaco[..., 3:4] * alfa
    alvo = base[y0:y1, x0:x1]
    alvo *= 1 - a
    alvo += pedaco[..., :3] * a


# ---------------------------------------------------------------------------
# Seleção das fotos
# ---------------------------------------------------------------------------

def ids_da_letra(letra, sel, existentes, por_letra):
    """As fotos que entram (as por_letra de número menor), na ordem em que aparecem: do maior número
    para o menor, que é a que fica. Com menos fotos que por_letra, repete em ciclo (nunca a mesma
    duas vezes seguidas, se houver mais de uma)."""
    ids = no_video(sel["letras"].get(letra, []), por_letra)
    for i in ids:
        if i not in existentes:
            raise SystemExit(f"{i}: não existe em candidatos.json (rode o preparar.py de novo)")
    if not ids:
        raise SystemExit(f"{letra}: nenhuma mão na seleção")
    ciclo = ids[::-1]
    voltas = -(-por_letra // len(ciclo))
    return (ciclo * voltas)[-por_letra:]


# ---------------------------------------------------------------------------
# Linha do tempo
# ---------------------------------------------------------------------------

class Roteiro:
    """Quadros de cada etapa e o estado de cada quadrado em cada quadro do vídeo."""

    def __init__(self, indices, n_maos, final=True):
        self.indices = indices  # letras de LIBRAX que aparecem (todas, ou uma na prévia)
        self.n_maos = n_maos
        q = lambda s: max(1, round(s * FPS))  # noqa: E731
        self.q_inicio = q(INICIO)
        self.q_entrada = q(ENTRADA)
        self.q_troca = self.q_entrada + (n_maos - 1) * QUADROS_POR_MAO
        self.q_parada = q(PARADA)
        self.q_encolhe = q(ENCOLHE)
        self.q_letra = q(LETRA_ENTRA)
        self.q_passo = self.q_troca + self.q_parada + round(PROXIMA * self.q_encolhe)
        self.q_dura = self.q_troca + self.q_parada + self.q_encolhe  # de uma letra, até pousar
        self.inicio = [self.q_inicio + k * self.q_passo for k in range(len(indices))]
        self.fim_letras = self.inicio[-1] + self.q_dura + self.q_letra
        self.final = final
        self.q_sobe = q(SOBE) if final else 0
        self.q_cheio = q(CHEIO) if final else q(0.4)
        self.q_saida = q(SAIDA) if final else 0
        self.q_fim = q(FIM) if final else 0
        self.cheio = self.fim_letras + self.q_sobe  # primeiro quadro com o bloco já no meio
        self.total = self.cheio + self.q_cheio + self.q_saida + self.q_fim

    def estado(self, q):
        """quadrados: (i, mão, pouso de 0 a 1, opacidade, escala da entrada); letras: (i, cor,
        opacidade, dy em fração do lado); sobe: fração da subida final; marca: palavra-marca."""
        e = {"quadrados": [], "letras": [], "sobe": 0.0, "marca": 0.0}
        n = len(self.indices)
        for k, i in enumerate(self.indices):
            d = q - self.inicio[k]
            if d < 0:
                break
            if d < self.q_troca:
                mao = 0 if d < self.q_entrada else min(self.n_maos - 1, 1 + (d - self.q_entrada) // QUADROS_POR_MAO)
            else:
                mao = self.n_maos - 1
            entra = suave(d / self.q_entrada)
            pouso = suave3((d - self.q_troca - self.q_parada) / self.q_encolhe)
            e["quadrados"].append((i, mao, pouso, entra, 0.88 + 0.12 * entra))
            # letra escrita: entra a partir de 60% do encolhimento, em tangerina; passa para a tinta
            # quando a letra seguinte entra
            d_letra = d - self.q_troca - self.q_parada - 0.6 * self.q_encolhe
            if d_letra >= 0:
                t = suave(d_letra / self.q_letra)
                e["letras"].append((i, "tinta", 1.0, 0.0))
                prox = (self.inicio[k + 1] + self.q_troca + self.q_parada + 0.6 * self.q_encolhe
                        if k + 1 < n else None)
                tangerina = 1.0 if prox is None or q < prox else 1 - suave((q - prox) / self.q_letra)
                if self.final and k == n - 1:
                    tangerina = 1.0  # o X fica em tangerina, como no logotipo
                e["letras"][-1] = (i, "tinta", t * (1 - tangerina), (1 - t) * 0.15)
                if tangerina > 0:
                    e["letras"].append((i, "marca", t * tangerina, (1 - t) * 0.15))
        if self.final and q >= self.fim_letras:
            e["sobe"] = suave3((q - self.fim_letras) / self.q_sobe)
            x = (q - self.cheio - self.q_cheio) / self.q_saida
            if x > 0:
                sai, entra = suave(x / 0.6), suave((x - 0.4) / 0.6)
                e["quadrados"] = [(i, m, p, a * (1 - sai), s) for i, m, p, a, s in e["quadrados"]]
                e["letras"] = [(i, c, a * (1 - sai), dy) for i, c, a, dy in e["letras"]]
                e["marca"] = entra
        return e


class Pintor:
    """Desenha os quadros do vídeo, com cache dos quadrados que já pousaram."""

    def __init__(self, lei, fotos, seq, caixas, letras, marca):
        self.lei, self.fotos, self.seq, self.letras, self.marca = lei, fotos, seq, letras, marca
        self.c_grande = {i: corte_centrado(caixas[i]) for i in caixas}
        self.c_fileira = {i: corte_na_fileira(caixas[i], lei.visivel(i)) for i in caixas}
        self.fundo = np.empty((lei.altura, lei.largura, 3), np.float32)
        self.fundo[:] = np.array(hex_rgb(FUNDO), np.float32) / 255
        self.pousados = {}

    def peca(self, i, mao, pouso, escala):
        lei = self.lei
        L = LETRAS[i]
        if pouso >= 1 and (i, mao) in self.pousados:
            return self.pousados[(i, mao)]
        n = max(4, int(round((lei.grande + (lei.lado - lei.grande) * pouso) * escala)))
        corte = interpola(self.c_grande[i], self.c_fileira[i], pouso)
        rgb = quadrado(self.fotos[self.seq[L][mao]], corte, CORES_QUADRADOS[L], n)
        p = colado(rgb, lei.giro[i] * pouso)
        if pouso >= 1:
            self.pousados[(i, mao)] = p
        return p

    def __call__(self, e):
        lei = self.lei
        img = self.fundo.copy()
        sobe = lei.sobe * e["sobe"]
        # os que já pousaram embaixo (o de cada letra por cima do anterior); os que estão no ar por cima
        ordem = sorted(e["quadrados"], key=lambda s: (s[2] < 1, s[2] if s[2] < 1 else 0, s[0]))
        for i, mao, pouso, alfa, escala in ordem:
            if alfa <= 0:
                continue
            gx, gy = lei.centro_grande
            fx, fy = lei.centro(i)
            cx, cy = gx + (fx - gx) * pouso, gy + (fy + sobe - gy) * pouso
            colar(img, self.peca(i, mao, pouso, escala), cx, cy, alfa)
        for i, cor, a, dy in e["letras"]:
            if a > 0:
                sobre(img, self.letras[i][cor], a, dy * lei.lado + sobe)
        if e["marca"] > 0:
            # a palavra-marca cresce um pouco enquanto aparece (de 96% a 100%)
            s = 0.96 + 0.04 * e["marca"]
            rgba, x, y = self.marca
            m = cv2.resize(rgba, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            cx, cy = lei.largura / 2, lei.centro_marca
            sobre(img, (m, int(round(cx + (x - cx) * s)), int(round(cy + (y - cy) * s))), e["marca"])
        return (np.clip(img, 0, 1) * 255).round().astype(np.uint8)


def gravar(caminho, quadros, largura, altura):
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{largura}x{altura}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
           "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", caminho]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for q in quadros:
        p.stdin.write(q.tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit("ffmpeg falhou")
    return caminho


def gif(mp4, caminho, largura=360):
    filtro = (f"fps={FPS},scale={largura}:-1:flags=lanczos,split[a][b];"
              "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4")
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", mp4, "-vf", filtro, "-loop", "0", caminho],
                   check=True)
    return caminho


def gravar_png(caminho, rgb):
    cv2.imwrite(caminho, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    return caminho


def main():
    ap = argumentos(__doc__)
    ap.add_argument("--formato", default="vertical", choices=list(FORMATOS) + ["todos"])
    ap.add_argument("--por-letra", type=int, default=POR_LETRA,
                    help=f"mãos por letra, as de número menor na seleção (padrão {POR_LETRA})")
    ap.add_argument("--semente", type=int, default=SEMENTE, help=f"sorteio do giro e do deslocamento (padrão {SEMENTE})")
    ap.add_argument("--nome", default="rascunho-v3", help="nome do vídeo, sem .mp4 (padrão rascunho-v3)")
    ap.add_argument("--previa", metavar="LETRA", help="só uma letra: zoom, troca e encolhimento (MP4 e GIF)")
    ap.add_argument("--quadros", nargs="*", type=float, help="instantes (s) do vídeo para gravar em JPG")
    args = ap.parse_args()
    if args.por_letra < 1:
        raise SystemExit("--por-letra precisa ser 1 ou mais")
    pastas = Pastas(args.data)

    existentes = {c["id"] for c in ler_json(pastas.candidatos)["candidatos"]}
    sel = ler_json(pastas.selecao)
    if args.previa and (len(args.previa) != 1 or args.previa.upper() not in LETRAS):
        raise SystemExit(f"--previa: uma letra de {LETRAS}")
    indices = [LETRAS.index(args.previa.upper())] if args.previa else list(range(len(LETRAS)))
    seq = {L: ids_da_letra(L, sel, existentes, args.por_letra) for L in LETRAS}
    for i in indices:
        L = LETRAS[i]
        print(f"{L}: {' '.join(seq[L])} ({len(set(seq[L]))} fotos diferentes)")
    fotos = {f: cv2.imread(os.path.join(pastas.maos, f"{f}.png"), cv2.IMREAD_UNCHANGED)
             for L in LETRAS for f in set(seq[L])}
    caixas = {i: caixa_das_maos([fotos[f] for f in set(seq[LETRAS[i]])]) for i in range(len(LETRAS))}

    formatos = list(FORMATOS) if args.formato == "todos" else [args.formato]
    for formato in formatos:
        lei = Leiaute(pastas, formato, args.semente)
        pintor = Pintor(lei, fotos, seq, caixas, letras_escritas(lei), palavra_marca(pastas, lei))
        rot = Roteiro(indices, args.por_letra, final=not args.previa)

        def quadro(q):
            return pintor(rot.estado(q))

        if args.previa:
            L = args.previa.upper()
            mp4 = gravar(os.path.join(pastas.saida, f"previa-{L}{lei.sufixo}.mp4"),
                         (quadro(q) for _ in range(2) for q in range(rot.q_inicio, rot.total)),
                         lei.largura, lei.altura)
            print(mp4)
            print(gif(mp4, os.path.join(pastas.saida, f"previa-{L}{lei.sufixo}.gif")))
            continue

        if args.quadros:
            for t in args.quadros:
                q = min(rot.total - 1, int(round(t * FPS)))
                out = os.path.join(pastas.saida, f"quadro{lei.sufixo}-{t:.2f}s.jpg")
                cv2.imwrite(out, cv2.cvtColor(quadro(q), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
                print(out)
            continue

        out = gravar(os.path.join(pastas.saida, f"{args.nome}{lei.sufixo}.mp4"),
                     (quadro(q) for q in range(rot.total)), lei.largura, lei.altura)
        # a composição final: LIBRAX completo no meio, antes da palavra-marca
        nome_final = args.nome.replace("rascunho", "final", 1) if "rascunho" in args.nome else f"{args.nome}-final"
        png = gravar_png(os.path.join(pastas.saida, f"{nome_final}{lei.sufixo}.png"),
                         quadro(rot.cheio + rot.q_cheio // 2))
        print(f"{out} ({lei.largura} x {lei.altura}, {rot.total / FPS:.2f} s, {rot.total} quadros, "
              f"{rot.q_passo / FPS:.2f} s por letra, quadrado de {lei.lado} px na fileira e {lei.grande} px grande)")
        print(png)


if __name__ == "__main__":
    main()
