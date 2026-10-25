"""
Peças comuns do vídeo de divulgação (docs/video-divulgacao-librax.md): pastas, cores e fonte do
app, geometria do quadro, classificador de letras e os modelos pequenos baixados uma vez.

Os scripts só LEEM a pasta de dados (vídeos, landmarks, rótulos, fontes.json) e gravam tudo em
<data>/divulgacao/, que fica fora do git como o resto de ml-training/data.
"""

import argparse
import json
import os
import sys
import urllib.request

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
ML = os.path.dirname(AQUI)
sys.path.insert(0, ML)

from teste_fixo import MIN_P, NENHUMA, carregar_modelo  # noqa: E402
from train_static import mlp_forward, normalize_hand  # noqa: E402

DATA_PADRAO = os.path.join(ML, "data")
LETRAS = "LIBRAX"
POR_LETRA = 10  # mãos de cada letra que entram no vídeo (montar.py --por-letra)

# Quadro do vídeo e da mão (px). A mão fica de pé, com o pulso sempre no mesmo ponto e o palmo
# (pulso até a base do dedo médio) sempre do mesmo tamanho: parece uma mão só trocando de pessoa.
LARGURA, ALTURA = 1080, 1920
PALMO = 285
PULSO = (540, 1130)

# Cores do app (apps/web-poc/src/styles/tokens.css, tema escuro): fundo bg.canvas, marca e tinta.
FUNDO = "#14110E"
TINTA = "#F7F2EC"  # brand.ink no escuro
MARCA = "#FF8A45"  # brand.mark no escuro
TANGERINA = "#FF7A2E"  # brand.icon.mark

# Modelos pequenos e oficiais, baixados para <data>/divulgacao/modelos/ na primeira vez.
MODELOS = {
    "rosto": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/"
             "float16/1/blaze_face_short_range.tflite",
    "segmentacao": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/"
                   "float32/latest/selfie_multiclass_256x256.tflite",
}
ARQUIVOS = {"rosto": "blaze_face_short_range.tflite", "segmentacao": "selfie_multiclass_256x256.tflite"}


def hex_bgr(cor):
    c = cor.lstrip("#")
    return (int(c[4:6], 16), int(c[2:4], 16), int(c[0:2], 16))


def hex_rgb(cor):
    return hex_bgr(cor)[::-1]


def argumentos(descricao):
    ap = argparse.ArgumentParser(description=descricao, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=DATA_PADRAO,
                    help="pasta de dados do treino (só leitura; saída em <data>/divulgacao). "
                         "Padrão: ml-training/data")
    return ap


class Pastas:
    """Caminhos de entrada (só leitura) e de saída a partir da pasta de dados."""

    def __init__(self, data):
        self.data = os.path.abspath(data)
        self.saida = os.path.join(self.data, "divulgacao")
        self.modelos = os.path.join(self.saida, "modelos")
        self.maos = os.path.join(self.saida, "maos")
        # O app fica dois níveis acima de ml-training/data (no checkout principal, onde estão os dados)
        app = os.path.join(self.data, "..", "..", "apps", "web-poc")
        if not os.path.isdir(app):
            app = os.path.join(ML, "..", "apps", "web-poc")
        self.app = os.path.abspath(app)
        self.classificador = os.path.join(self.app, "public", "ml", "classifier")
        self.fonte_display = os.path.join(self.app, "public", "fonts", "Anybody-latin-wdth-wght.woff2")
        self.candidatos = os.path.join(self.saida, "candidatos.json")
        self.selecao = os.path.join(self.saida, "selecao.json")

    def criar(self):
        for p in (self.saida, self.modelos, self.maos):
            os.makedirs(p, exist_ok=True)

    def modelo(self, nome):
        """Caminho do modelo; baixa da fonte oficial se ainda não estiver na pasta."""
        caminho = os.path.join(self.modelos, ARQUIVOS[nome])
        if not os.path.exists(caminho):
            os.makedirs(self.modelos, exist_ok=True)
            print(f"baixando {ARQUIVOS[nome]} ...")
            tmp = caminho + ".parcial"
            urllib.request.urlretrieve(MODELOS[nome], tmp)
            os.replace(tmp, caminho)
        return caminho


class Classificador:
    """O MLP de letras do app, com a mesma normalização e o mesmo limiar (teste_fixo.py)."""

    def __init__(self, pasta):
        self.labels, self.layers = carregar_modelo(pasta)

    def ler(self, lm, handedness, aspect):
        """(letra lida ou None, probabilidade da mais provável, vetor de probabilidades)."""
        P = mlp_forward(self.layers, np.array([normalize_hand(lm, handedness, aspect)]))[0]
        i = int(P.argmax())
        letra = self.labels[i] if P[i] >= MIN_P and self.labels[i] != NENHUMA else None
        return letra, float(P[i]), P

    def prob(self, P, letra):
        return float(P[self.labels.index(letra)])


def numero(i):
    """Número da foto na folha: L12 -> 12."""
    return int(i[1:])


def no_video(ids, por_letra=POR_LETRA):
    """As fotos da seleção que entram no vídeo: as por_letra de número menor (ordem da folha)."""
    return sorted((i.upper() for i in ids), key=numero)[:por_letra]


def ler_json(caminho):
    with open(caminho) as f:
        return json.load(f)


def gravar_json(caminho, obj):
    tmp = caminho + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, caminho)
