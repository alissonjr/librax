"""
Vídeo de divulgação, passo 2 (docs/video-divulgacao-librax.md): monta o vídeo vertical com as mãos
escolhidas em selecao.json (passo 1: preparar.py).

Roteiro (25 quadros por segundo, então cada mão fica 2 quadros = 80 ms):
- 0 a 0,4 s: só o fundo do app;
- cada letra: 1 s de mãos trocando e 0,28 s de pausa na última mão, com a letra entrando embaixo
  (L, LI, LIB, LIBR, LIBRA, LIBRAX);
- no fim, a mão e as letras dão lugar à palavra-marca do app (símbolo Traço e "librax").

Fundo liso e a mão sempre no mesmo lugar: só a forma da mão muda, sem clarão de tela.
As letras usam a fonte de display do app (Anybody) e o símbolo é o mesmo do BrandMark.

Saída em <data>/divulgacao/: rascunho.mp4 (1080 x 1920, H.264, sem som) e, com --previa,
previa-<LETRA>.mp4 e previa-<LETRA>.gif (só uma letra trocando, para ver o efeito).

Uso:
    python divulgacao/montar.py [--data PASTA]
    python divulgacao/montar.py --previa L
    python divulgacao/montar.py --quadros 1.0 5.2 8.9     (grava esses instantes em JPG para conferir)
"""

import os
import subprocess

import cv2
import numpy as np
import PIL.Image
import PIL.ImageDraw
import PIL.ImageFont

from comum import (ALTURA, FUNDO, LARGURA, LETRAS, MARCA, TINTA, Pastas, argumentos, hex_rgb, ler_json)

FPS = 25
QUADROS_POR_MAO = 2  # 80 ms
INICIO = 0.4
TROCA = 1.0
PAUSA = 0.28  # 7 quadros
SAIDA = 0.5  # mão e letras saem, depois a palavra-marca entra
FIM = 0.8  # palavra-marca parada

CORPO_LETRA = 176
BASE_LETRA = 1610  # linha de base das letras soletradas
CORPO_MARCA = 150  # corpo do "librax" na palavra-marca (o símbolo tem 1,3 vez isso)
CENTRO_MARCA = 930


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def fonte_display(pastas, corpo, largura=125, peso=900):
    f = PIL.ImageFont.truetype(pastas.fonte_display, corpo)
    f.set_variation_by_axes([largura, peso])
    return f


# ---------------------------------------------------------------------------
# Camadas (RGBA float, 0 a 1) desenhadas uma vez
# ---------------------------------------------------------------------------

def camada(rgba, x0=0, y0=0):
    """Camada recortada no que tem tinta: (RGBA uint8, x, y) no quadro do vídeo."""
    rgba = np.asarray(rgba)
    ys, xs = np.nonzero(rgba[..., 3])
    if not len(xs):
        return rgba[:1, :1], x0, y0
    a, b, c, d = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return np.ascontiguousarray(rgba[a:b, c:d]), x0 + c, y0 + a


def letras_soletradas(pastas):
    """Uma camada por letra, cada uma no seu lugar fixo da palavra LIBRAX centralizada."""
    f = fonte_display(pastas, CORPO_LETRA)
    avancos = [f.getlength(c) for c in LETRAS]
    espaco = -0.02 * CORPO_LETRA
    total = sum(avancos) + espaco * (len(LETRAS) - 1)
    x = (LARGURA - total) / 2
    camadas = []
    for c, av in zip(LETRAS, avancos):
        por_cor = {}
        for nome, cor in (("tinta", TINTA), ("marca", MARCA)):
            img = PIL.Image.new("RGBA", (LARGURA, ALTURA), (0, 0, 0, 0))
            PIL.ImageDraw.Draw(img).text((x, BASE_LETRA), c, font=f, fill=hex_rgb(cor) + (255,), anchor="ls")
            por_cor[nome] = camada(img)
        camadas.append(por_cor)
        x += av + espaco
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


def palavra_marca(pastas):
    """Wordmark do app: símbolo com 1,3 vez o corpo, espaço de 0,32 corpo e "librax" em Anybody 900 a 125%."""
    f = fonte_display(pastas, CORPO_MARCA)
    lado = round(CORPO_MARCA * 1.3)
    gap = 0.32 * CORPO_MARCA
    texto = "librax"
    larg_texto = f.getlength(texto) - 0.01 * CORPO_MARCA * (len(texto) - 1)
    total = lado + gap + larg_texto
    x0 = (LARGURA - total) / 2
    img = PIL.Image.new("RGBA", (LARGURA, ALTURA), (0, 0, 0, 0))
    img.alpha_composite(simbolo(lado), (int(round(x0)), int(round(CENTRO_MARCA - lado / 2))))
    d = PIL.ImageDraw.Draw(img)
    x = x0 + lado + gap
    for c in texto:
        d.text((x, CENTRO_MARCA), c, font=f, fill=hex_rgb(TINTA) + (255,), anchor="lm")
        x += f.getlength(c) - 0.01 * CORPO_MARCA
    return camada(img)


def maos_da_letra(pastas, letra, sel, existentes):
    """Fotos da letra na ordem da folha, com a melhor por último (é a que para na pausa)."""
    ids = [i.upper() for i in sel["letras"].get(letra, [])]
    for i in ids:
        if i not in existentes:
            raise SystemExit(f"{i}: não existe em candidatos.json (rode o preparar.py de novo)")
    ids.sort(key=lambda i: int(i[1:]), reverse=True)
    out = []
    for i in ids:
        bgra = cv2.imread(os.path.join(pastas.maos, f"{i}.png"), cv2.IMREAD_UNCHANGED)
        out.append(camada(cv2.cvtColor(bgra, cv2.COLOR_BGRA2RGBA)))
    if not out:
        raise SystemExit(f"{letra}: nenhuma mão na seleção")
    return out


# ---------------------------------------------------------------------------
# Linha do tempo
# ---------------------------------------------------------------------------

def suave(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


class Roteiro:
    """O que aparece em cada quadro: (mão, opacidade da mão, letras e suas opacidades, palavra-marca)."""

    def __init__(self, maos, letras=LETRAS, final=True):
        self.maos = maos
        self.letras = letras
        self.final = final
        self.q_inicio = round(INICIO * FPS)
        self.q_troca = round(TROCA * FPS)
        self.q_pausa = round(PAUSA * FPS)
        self.q_letra = self.q_troca + self.q_pausa
        self.q_saida = round(SAIDA * FPS) if final else 0
        self.q_fim = round(FIM * FPS) if final else round(0.3 * FPS)
        self.total = self.q_inicio + len(letras) * self.q_letra + self.q_saida + self.q_fim

    def estado(self, q):
        e = {"mao": None, "alfa_mao": 1.0, "letras": [], "marca": 0.0}
        if q < self.q_inicio:
            return e
        r = q - self.q_inicio
        i = min(r // self.q_letra, len(self.letras) - 1)
        dentro = r - i * self.q_letra
        fotos = self.maos[self.letras[i]]
        n_trocas = -(-self.q_troca // QUADROS_POR_MAO)
        if dentro < self.q_troca:
            # a sequência termina na última foto da lista (a melhor), começando onde precisa
            k = dentro // QUADROS_POR_MAO
            e["mao"] = fotos[(len(fotos) - n_trocas + k) % len(fotos)]
        else:
            e["mao"] = fotos[-1]
        # letras: as anteriores fixas em tinta; a da vez entra na pausa em tangerina
        for j in range(i):
            e["letras"].append((j, "tinta", 1.0, 0.0))
        if dentro >= self.q_troca or r >= len(self.letras) * self.q_letra:
            t = (dentro - self.q_troca) / max(1, self.q_pausa * 0.6)
            e["letras"].append((i, "marca", suave(t), (1 - suave(t)) * 26))
        fim_letras = self.q_inicio + len(self.letras) * self.q_letra
        if q >= fim_letras:
            e["mao"] = self.maos[self.letras[-1]][-1]
            e["letras"] = [(j, "tinta", 1.0, 0.0) for j in range(len(self.letras) - 1)] + \
                          [(len(self.letras) - 1, "marca", 1.0, 0.0)]
            if self.final:
                x = (q - fim_letras) / max(1, self.q_saida)
                sai, entra = suave(x / 0.6), suave((x - 0.4) / 0.6)
                e["alfa_mao"] = 1 - sai
                e["letras"] = [(j, c, a * (1 - sai), dy) for j, c, a, dy in e["letras"]]
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


def desenhar(e, fundo, letras, marca):
    img = fundo.copy()
    if e["mao"] is not None and e["alfa_mao"] > 0:
        sobre(img, e["mao"], e["alfa_mao"])
    for j, cor, a, dy in e["letras"]:
        if a > 0:
            sobre(img, letras[j][cor], a, dy)
    if e["marca"] > 0:
        # a palavra-marca cresce um pouco enquanto aparece (de 96% a 100%)
        s = 0.96 + 0.04 * e["marca"]
        rgba, x, y = marca
        m = cv2.resize(rgba, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        cx, cy = LARGURA / 2, CENTRO_MARCA
        sobre(img, (m, int(round(cx + (x - cx) * s)), int(round(cy + (y - cy) * s))), e["marca"])
    return (np.clip(img, 0, 1) * 255).round().astype(np.uint8)


def gravar(caminho, quadros, total, largura=LARGURA, altura=ALTURA):
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{largura}x{altura}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
           "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", caminho]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for k, q in enumerate(quadros):
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


def main():
    ap = argumentos(__doc__)
    ap.add_argument("--previa", metavar="LETRA", help="só uma letra trocando (MP4 e GIF)")
    ap.add_argument("--quadros", nargs="*", type=float, help="instantes (s) do rascunho para gravar em JPG")
    args = ap.parse_args()
    pastas = Pastas(args.data)

    candidatos = ler_json(pastas.candidatos)["candidatos"]
    sel = ler_json(pastas.selecao)
    existentes = {c["id"] for c in candidatos}
    letras_alvo = args.previa.upper() if args.previa else LETRAS
    maos = {L: maos_da_letra(pastas, L, sel, existentes) for L in letras_alvo}
    for L in letras_alvo:
        print(f"{L}: {len(maos[L])} mãos")

    fundo = np.empty((ALTURA, LARGURA, 3), np.float32)
    fundo[:] = np.array(hex_rgb(FUNDO), np.float32) / 255
    letras = letras_soletradas(pastas)
    marca = palavra_marca(pastas)

    if args.previa:
        L = letras_alvo
        # duas voltas de troca e a letra entrando, como no vídeo
        rot = Roteiro(maos, letras=L, final=False)
        rot.q_inicio = 0
        rot.q_troca = 2 * round(TROCA * FPS)
        rot.q_letra = rot.q_troca + rot.q_pausa
        rot.total = rot.q_letra + rot.q_fim
        idx = LETRAS.index(L)
        # sozinha, a letra fica no meio (no vídeo ela ocupa o seu lugar em LIBRAX)
        letras_previa = [{cor: (rgba, (LARGURA - rgba.shape[1]) // 2, y)
                          for cor, (rgba, x, y) in letras[idx].items()}]

        def quadros():
            for q in range(rot.total):
                yield desenhar(rot.estado(q), fundo, letras_previa, marca)
        mp4 = gravar(os.path.join(pastas.saida, f"previa-{L}.mp4"), quadros(), rot.total)
        print(mp4)
        print(gif(mp4, os.path.join(pastas.saida, f"previa-{L}.gif")))
        return

    rot = Roteiro(maos)
    if args.quadros:
        for t in args.quadros:
            q = min(rot.total - 1, int(round(t * FPS)))
            out = os.path.join(pastas.saida, f"quadro-{t:.2f}s.jpg")
            cv2.imwrite(out, cv2.cvtColor(desenhar(rot.estado(q), fundo, letras, marca), cv2.COLOR_RGB2BGR),
                        [cv2.IMWRITE_JPEG_QUALITY, 88])
            print(out)
        return

    def quadros():
        for q in range(rot.total):
            yield desenhar(rot.estado(q), fundo, letras, marca)
    out = gravar(os.path.join(pastas.saida, "rascunho.mp4"), quadros(), rot.total)
    print(f"{out} ({rot.total / FPS:.1f} s, {rot.total} quadros)")


if __name__ == "__main__":
    main()
