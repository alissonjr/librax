"""
Vídeo de divulgação, passo 2 (docs/video-divulgacao-librax.md): monta o vídeo com as mãos escolhidas
em selecao.json (passo 1: preparar.py).

Desenho: cada letra de LIBRAX ganha um quadrado colorido com a foto da mão dentro. Os quadrados
entram um a um, da esquerda para a direita, e ficam lado a lado formando LIBRAX em Libras; embaixo
de cada quadrado entra a letra escrita. No fim, a fileira e as letras dão lugar à palavra-marca
do app (símbolo Traço e "librax").

Roteiro (25 quadros por segundo):
- 0 a 0,4 s: só o fundo do app;
- cada letra: o quadrado entra (0,16 s, crescendo de 92% a 100%) com a primeira mão e as outras
  trocam a cada 80 ms; são POR_LETRA mãos (5), a última para por 0,36 s enquanto a letra entra
  embaixo (0,84 s por letra);
- LIBRAX completo fica parado 0,8 s; depois tudo sai e entra a palavra-marca (1 s parada).

Cuidado com luz piscando: o fundo da tela e a cor de cada quadrado ficam fixos; só a mão muda,
dentro de um quadrado pequeno. Nada de clarão de tela inteira.

As cores dos quadrados são do design system (docs/design-system.md, apps/web-poc/src/styles/tokens.css):
tons médios e frios (petróleo, safira, framboesa, verde, ametista), longe do tom de pele, para a
mão se destacar em qualquer pele. O canto é o raio de card (radius.lg) na proporção do quadrado.

Formatos: vertical 1080 x 1920 (padrão), quadrado 1080 x 1080 e horizontal 1920 x 1080.

Saída em <data>/divulgacao/ (H.264, sem som):
- <nome>.mp4 no vertical, <nome>-quadrado.mp4 e <nome>-horizontal.mp4 (padrão do nome: rascunho-v2);
- final-v2.png (e -quadrado, -horizontal; o nome segue o do vídeo): a composição final, com LIBRAX completo;
- com --previa L: previa-L.mp4 e previa-L.gif (só uma letra, para ver a troca).

Uso:
    python divulgacao/montar.py [--data PASTA]                  vertical
    python divulgacao/montar.py --formato todos                 os três formatos
    python divulgacao/montar.py --por-letra 4                   outra quantidade de mãos por letra
    python divulgacao/montar.py --previa L
    python divulgacao/montar.py --quadros 1.0 3.2 6.1           (grava esses instantes em JPG para conferir)
"""

import os
import subprocess

import cv2
import numpy as np
import PIL.Image
import PIL.ImageDraw
import PIL.ImageFont

from comum import FUNDO, LETRAS, MARCA, TINTA, Pastas, argumentos, hex_rgb, ler_json

FPS = 25
POR_LETRA = 5  # mãos por letra; a última é a que fica
QUADROS_POR_MAO = 2  # 80 ms
INICIO = 0.4
ENTRADA = 0.16  # quadrado aparecendo, já com a primeira mão
PAUSA = 0.36  # última mão parada, letra entrando
CHEIO = 0.8  # LIBRAX completo parado
SAIDA = 0.5  # fileira e letras saem, depois a palavra-marca entra
FIM = 1.0  # palavra-marca parada

FORMATOS = {
    # nome: (largura, altura, margem lateral em fração da largura, sufixo do arquivo)
    "vertical": (1080, 1920, 0.045, ""),
    "quadrado": (1080, 1080, 0.045, "-quadrado"),
    "horizontal": (1920, 1080, 0.07, "-horizontal"),
}
VAO = 0.1  # vão entre quadrados, em fração do lado
RAIO = 22 / 120  # radius.lg (22) num card de 120 px, levado ao lado do quadrado

# Uma cor por quadrado, na ordem de LIBRAX. Tons médios (luminosidade 38 a 48) e frios: a pele
# das fotos fica entre 43 e 77, quase toda bem mais clara, e o matiz fica do outro lado do círculo.
# Tangerina, âmbar e ouro ficam de fora (perto demais do tom de pele); a tangerina segue nas letras
# e no símbolo. O petróleo, que no app é a cor da mão e da Libras, abre e fecha a fileira.
CORES_QUADRADOS = {
    "L": "#0E7C7B",  # color.petroleo.600 (game.hand.fill no claro)
    "I": "#3460E6",  # league.safira.fill
    "B": "#B42A5E",  # color.framboesa.600
    "R": "#14834A",  # color.verde.600
    "A": "#7B4FE0",  # league.ametista.fill
    "X": "#0B6463",  # color.petroleo.700
}

# Recorte das fotos (maos/<ID>.png, 1080 x 1460, pulso em (540, 1130), palmo de 285 px): o mesmo
# lado para todas, com a mão de pé e o antebraço saindo pela borda de baixo. Assim todas as mãos têm o
# mesmo tamanho e, dentro de cada quadrado, o pulso fica sempre no mesmo ponto.
FOLGA = 0.05  # folga em cima e dos lados da união das mãos, em fração do lado
CORTE_BAIXO = 1190  # y do recorte embaixo, logo abaixo do pulso (o antebraço some por volta de 1253)

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


# ---------------------------------------------------------------------------
# Camadas (RGBA uint8 com a posição no quadro) desenhadas uma vez
# ---------------------------------------------------------------------------

def camada(rgba, x0=0, y0=0):
    """Camada recortada no que tem tinta: (RGBA uint8, x, y) no quadro do vídeo."""
    rgba = np.asarray(rgba)
    ys, xs = np.nonzero(rgba[..., 3])
    if not len(xs):
        return rgba[:1, :1], x0, y0
    a, b, c, d = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return np.ascontiguousarray(rgba[a:b, c:d]), x0 + c, y0 + a


class Leiaute:
    """Posição dos quadrados e das letras escritas, centrados no quadro."""

    def __init__(self, formato, n=len(LETRAS)):
        self.formato = formato
        self.largura, self.altura, margem, self.sufixo = FORMATOS[formato]
        util = self.largura * (1 - 2 * margem)
        self.lado = int(util / (n + (n - 1) * VAO))
        self.vao = int(round(self.lado * VAO))
        total = n * self.lado + (n - 1) * self.vao
        x0 = (self.largura - total) // 2
        self.xs = [x0 + i * (self.lado + self.vao) for i in range(n)]
        self.corpo_letra = 0.66 * self.lado
        self.espaco_letra = 0.22 * self.lado  # do pé do quadrado ao topo das letras
        altura_letra = 0.72 * self.corpo_letra  # altura de maiúscula da Anybody, mais ou menos
        bloco = self.lado + self.espaco_letra + altura_letra
        # no vertical o bloco sobe um pouco (centro ótico); nos outros fica no meio
        centro = self.altura * (0.47 if self.altura > self.largura else 0.5)
        self.y = int(round(centro - bloco / 2))
        self.raio = max(4, int(round(self.lado * RAIO)))
        self.escala = min(self.largura, self.altura) / 1080
        self.centro_marca = self.altura * (0.484 if self.altura > self.largura else 0.5)

    def centro(self, i):
        return self.xs[i] + self.lado / 2, self.y + self.lado / 2


def mascara_arredondada(lado, raio, escala=4):
    S = lado * escala
    img = PIL.Image.new("L", (S, S), 0)
    PIL.ImageDraw.Draw(img).rounded_rectangle([0, 0, S - 1, S - 1], radius=raio * escala, fill=255)
    return np.asarray(img.resize((lado, lado), PIL.Image.LANCZOS))


def recortes(fotos_por_letra):
    """Um quadrado (x, y, lado) por letra nas fotos de maos/, todos do mesmo lado.

    O lado é o maior que alguma letra precisa para caber as suas mãos com folga, para o palmo ter
    o mesmo tamanho em todos os quadrados; cada letra se centra na horizontal pelas suas mãos e o
    antebraço sai pela borda de baixo."""
    caixas = {}
    for letra, fotos in fotos_por_letra.items():
        x_min, x_max, y_min = 10 ** 6, 0, 10 ** 6
        for bgra in fotos:
            ys, xs = np.nonzero(bgra[..., 3] > 24)
            x_min, x_max, y_min = min(x_min, xs.min()), max(x_max, xs.max()), min(y_min, ys.min())
        caixas[letra] = (x_min, x_max, y_min)
    lado = int(round(max(max((CORTE_BAIXO - y0) / (1 - FOLGA), (x1 - x0) / (1 - 2 * FOLGA))
                         for x0, x1, y0 in caixas.values())))
    return {letra: (int(round((x0 + x1) / 2 - lado / 2)), CORTE_BAIXO - lado, lado)
            for letra, (x0, x1, y0) in caixas.items()}


def quadrado_da_mao(bgra, corte, cor, lado, mascara):
    """A foto dentro do quadrado: fundo na cor do quadrado, cantos arredondados (RGBA uint8)."""
    x, y, s = corte
    H, W = bgra.shape[:2]
    pedaco = np.zeros((s, s, 4), np.float32)
    a0, b0 = max(0, y), min(H, y + s)
    c0, d0 = max(0, x), min(W, x + s)
    pedaco[a0 - y:b0 - y, c0 - x:d0 - x] = bgra[a0:b0, c0:d0]
    rgba = pedaco[..., [2, 1, 0, 3]] / 255
    rgba[..., :3] *= rgba[..., 3:4]  # pré-multiplica para reduzir sem borda escura
    rgba = cv2.resize(rgba, (lado, lado), interpolation=cv2.INTER_AREA)
    fundo = np.array(hex_rgb(cor), np.float32) / 255
    rgb = rgba[..., :3] + fundo * (1 - rgba[..., 3:4])
    out = np.dstack([np.clip(rgb, 0, 1) * 255, mascara]).round().astype(np.uint8)
    return out


def letras_escritas(pastas, lei, letras):
    """Uma camada por letra (em tinta e em tangerina), centrada embaixo do seu quadrado."""
    f = fonte_display(pastas, lei.corpo_letra)
    topo = lei.y + lei.lado + lei.espaco_letra
    camadas = []
    for i, c in enumerate(letras):
        cx = lei.xs[i] + lei.lado / 2
        # alinha pelo topo da maiúscula: todas as letras de LIBRAX têm a mesma altura
        _, cima, _, _ = f.getbbox(c, anchor="ms")
        base = topo - cima
        por_cor = {}
        for nome, cor in (("tinta", TINTA), ("marca", MARCA)):
            img = PIL.Image.new("RGBA", (lei.largura, lei.altura), (0, 0, 0, 0))
            PIL.ImageDraw.Draw(img).text((cx, base), c, font=f, fill=hex_rgb(cor) + (255,), anchor="ms")
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


def ids_da_letra(letra, sel, existentes, por_letra):
    """Os por_letra primeiros números da folha, mostrados do maior para o menor (o menor é o que fica)."""
    ids = [i.upper() for i in sel["letras"].get(letra, [])]
    for i in ids:
        if i not in existentes:
            raise SystemExit(f"{i}: não existe em candidatos.json (rode o preparar.py de novo)")
    if not ids:
        raise SystemExit(f"{letra}: nenhuma mão na seleção")
    ids.sort(key=lambda i: int(i[1:]))
    return ids[:por_letra][::-1]


# ---------------------------------------------------------------------------
# Linha do tempo
# ---------------------------------------------------------------------------

class Roteiro:
    """O que aparece em cada quadro: quadrados (com a mão da vez), letras e palavra-marca."""

    def __init__(self, n_maos, final=True):
        self.n_maos = n_maos  # mãos de cada letra, na ordem da fileira
        self.q_inicio = round(INICIO * FPS)
        self.q_entrada = max(1, round(ENTRADA * FPS))
        self.q_troca = self.q_entrada + (max(n_maos) - 1) * QUADROS_POR_MAO
        self.q_pausa = round(PAUSA * FPS)
        self.q_letra = self.q_troca + self.q_pausa
        self.final = final
        self.q_cheio = round(CHEIO * FPS)
        self.q_saida = round(SAIDA * FPS) if final else 0
        self.q_fim = round(FIM * FPS) if final else 0
        self.fim_letras = self.q_inicio + len(n_maos) * self.q_letra
        self.total = self.fim_letras + self.q_cheio + self.q_saida + self.q_fim

    def estado(self, q):
        """quadrados: (i, mão, escala, opacidade); letras: (i, cor, opacidade, dy em fração do lado)."""
        e = {"quadrados": [], "letras": [], "marca": 0.0}
        if q < self.q_inicio:
            return e
        n = len(self.n_maos)
        r = q - self.q_inicio
        atual = min(r // self.q_letra, n - 1) if q < self.fim_letras else n
        for i in range(min(atual + 1, n)):
            dentro = r - i * self.q_letra
            ultima = self.n_maos[i] - 1
            if i < atual:
                e["quadrados"].append((i, ultima, 1.0, 1.0))
                if i == n - 1:
                    e["letras"].append((i, "marca", 1.0, 0.0))
                    continue
                e["letras"].append((i, "tinta", 1.0, 0.0))
                # a letra anterior passa da tangerina para a tinta enquanto o quadrado novo entra
                passou = r - (i + 1) * self.q_letra
                if passou < self.q_entrada:
                    e["letras"].append((i, "marca", 1 - suave(passou / self.q_entrada), 0.0))
                continue
            entra = suave(dentro / self.q_entrada)
            # a primeira mão fica enquanto o quadrado entra; com menos fotos, a última fica mais tempo
            k = 0 if dentro < self.q_entrada else min(ultima, 1 + (dentro - self.q_entrada) // QUADROS_POR_MAO)
            e["quadrados"].append((i, k, 0.92 + 0.08 * entra, entra))
            if dentro >= self.q_troca:
                t = suave((dentro - self.q_troca) / max(1, self.q_pausa * 0.6))
                e["letras"].append((i, "marca", t, (1 - t) * 0.17))
        if q >= self.fim_letras and self.final:
            x = (q - self.fim_letras - self.q_cheio) / max(1, self.q_saida)
            if x > 0:
                sai, entra = suave(x / 0.6), suave((x - 0.4) / 0.6)
                e["quadrados"] = [(i, k, s, a * (1 - sai)) for i, k, s, a in e["quadrados"]]
                e["letras"] = [(i, c, a * (1 - sai), dy) for i, c, a, dy in e["letras"]]
                e["marca"] = entra
        return e


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


def desenhar(e, lei, fundo, quadrados, letras, marca):
    img = fundo.copy()
    for i, k, s, a in e["quadrados"]:
        if a <= 0:
            continue
        rgba = quadrados[i][k]
        cx, cy = lei.centro(i)
        if s < 0.999:
            lado = max(2, int(round(lei.lado * s)))
            rgba = cv2.resize(rgba, (lado, lado), interpolation=cv2.INTER_AREA)
        h = rgba.shape[0]
        sobre(img, (rgba, int(round(cx - h / 2)), int(round(cy - h / 2))), a)
    for i, cor, a, dy in e["letras"]:
        if a > 0:
            sobre(img, letras[i][cor], a, dy * lei.lado)
    if e["marca"] > 0:
        # a palavra-marca cresce um pouco enquanto aparece (de 96% a 100%)
        s = 0.96 + 0.04 * e["marca"]
        rgba, x, y = marca
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
                    help=f"mãos por letra, as de número menor na folha (padrão {POR_LETRA})")
    ap.add_argument("--nome", default="rascunho-v2", help="nome do vídeo, sem .mp4 (padrão rascunho-v2)")
    ap.add_argument("--previa", metavar="LETRA", help="só uma letra trocando (MP4 e GIF)")
    ap.add_argument("--quadros", nargs="*", type=float, help="instantes (s) do vídeo para gravar em JPG")
    args = ap.parse_args()
    if args.por_letra < 1:
        raise SystemExit("--por-letra precisa ser 1 ou mais")
    pastas = Pastas(args.data)

    existentes = {c["id"] for c in ler_json(pastas.candidatos)["candidatos"]}
    sel = ler_json(pastas.selecao)
    letras_alvo = args.previa.upper() if args.previa else LETRAS
    if args.previa and (len(letras_alvo) != 1 or letras_alvo not in LETRAS):
        raise SystemExit(f"--previa: uma letra de {LETRAS}")
    ids = {L: ids_da_letra(L, sel, existentes, args.por_letra) for L in LETRAS}
    for L in letras_alvo:
        print(f"{L}: {' '.join(ids[L])}")
    fotos = {i: cv2.imread(os.path.join(pastas.maos, f"{i}.png"), cv2.IMREAD_UNCHANGED)
             for L in LETRAS for i in ids[L]}
    # o recorte considera todas as letras, para a mão ter o mesmo tamanho na prévia e no vídeo
    cortes = recortes({L: [fotos[i] for i in ids[L]] for L in LETRAS})

    formatos = list(FORMATOS) if args.formato == "todos" else [args.formato]
    for formato in formatos:
        lei = Leiaute(formato, n=len(letras_alvo))
        mascara = mascara_arredondada(lei.lado, lei.raio)
        quadrados = [[quadrado_da_mao(fotos[i], cortes[L], CORES_QUADRADOS[L], lei.lado, mascara) for i in ids[L]]
                     for L in letras_alvo]
        fundo = np.empty((lei.altura, lei.largura, 3), np.float32)
        fundo[:] = np.array(hex_rgb(FUNDO), np.float32) / 255
        letras = letras_escritas(pastas, lei, letras_alvo)
        marca = palavra_marca(pastas, lei)
        rot = Roteiro([len(ids[L]) for L in letras_alvo], final=not args.previa)

        def quadro(q):
            return desenhar(rot.estado(q), lei, fundo, quadrados, letras, marca)

        if args.previa:
            # a letra entra, fica parada e começa de novo: duas voltas
            rot.total = rot.fim_letras + round(0.3 * FPS)
            volta = range(rot.q_inicio, rot.total)
            mp4 = gravar(os.path.join(pastas.saida, f"previa-{letras_alvo}{lei.sufixo}.mp4"),
                         (quadro(q) for _ in range(2) for q in volta), lei.largura, lei.altura)
            print(mp4)
            print(gif(mp4, os.path.join(pastas.saida, f"previa-{letras_alvo}{lei.sufixo}.gif")))
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
        # a composição final: LIBRAX completo, no meio da parada antes da palavra-marca
        nome_final = args.nome.replace("rascunho", "final", 1) if "rascunho" in args.nome else f"{args.nome}-final"
        png = gravar_png(os.path.join(pastas.saida, f"{nome_final}{lei.sufixo}.png"),
                         quadro(rot.fim_letras + rot.q_cheio // 2))
        print(f"{out} ({lei.largura} x {lei.altura}, {rot.total / FPS:.2f} s, {rot.total} quadros, "
              f"quadrado de {lei.lado} px)")
        print(png)


if __name__ == "__main__":
    main()
