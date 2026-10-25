"""
Exemplos da classe "_" (nenhuma letra) tirados de mãos em REPOUSO, e não de qualquer trecho que
o alinhamento deixou de fora (esses muitas vezes eram letras de verdade, ditas na introdução).

Repouso:
- mãos juntas: duas mãos detectadas com os pulsos a menos de JUNTAS_PALMOS palmos um do outro
  (mãos entrelaçadas, encostadas);
- mão baixa (só nos vídeos de sinais, que têm o corpo): pulso mais de BAIXA_OMBROS larguras de
  ombro abaixo da linha dos ombros (mão descansando ou descendo).
Cada mão do quadro vira um exemplo (o app olha uma mão por vez). Até POR_VIDEO quadros por vídeo,
espalhados no tempo, para ter muitas pessoas e pouca repetição.

Canais do teste fixo (teste_fixo.py) ficam de fora. Dos vídeos de sinais, 1 canal em cada
TESTE_A_CADA vai para o teste do alarme falso (data/teste_negativas.json) em vez do treino.

Saídas:
- data/negativas.jsonl: linhas no formato do dataset, label "_";
- data/teste_negativas.json: quadros de repouso de canais separados, para o teste fixo.

Uso:
    python video/negativas.py
"""

import glob
import hashlib
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
from teste_fixo import canais_do_teste  # noqa: E402
from train_static import NORMALIZATION_VERSION, normalize_hand  # noqa: E402

DATA = os.path.join(AQUI, "..", "data")
SAIDA = os.path.join(DATA, "negativas.jsonl")
SAIDA_TESTE = os.path.join(DATA, "teste_negativas.json")

NENHUMA = "_"
JUNTAS_PALMOS = 1.2
BAIXA_OMBROS = 1.3
POR_VIDEO = 12
TESTE_A_CADA = 5
OMBRO_E, OMBRO_D = 11, 12


def palmo(lm, aspect):
    p = np.asarray(lm).reshape(21, 3)
    return float(np.hypot((p[9, 0] - p[0, 0]) * aspect, p[9, 1] - p[0, 1])) or 1e-3


def repouso(frame, aspect):
    """Mãos do quadro que estão em repouso (lista de dicts de mão)."""
    hands = frame["hands"]
    if len(hands) == 2:
        a, b = (np.array([h["lm"][0] * aspect, h["lm"][1]]) for h in hands)
        escala = (palmo(hands[0]["lm"], aspect) + palmo(hands[1]["lm"], aspect)) / 2
        if np.linalg.norm(a - b) < JUNTAS_PALMOS * escala:
            return list(hands)
    pose = frame.get("pose")
    if pose and hands:
        P = np.asarray(pose).reshape(-1, 4)
        oe = np.array([P[OMBRO_E, 0] * aspect, P[OMBRO_E, 1]])
        od = np.array([P[OMBRO_D, 0] * aspect, P[OMBRO_D, 1]])
        largura = float(np.linalg.norm(oe - od))
        if largura > 1e-3:
            linha = (oe[1] + od[1]) / 2
            return [h for h in hands if (h["lm"][1] - linha) / largura > BAIXA_OMBROS]
    return []


def para_teste(canal):
    """Separação estável por canal (o mesmo canal cai sempre do mesmo lado)."""
    return int(hashlib.sha1(canal.encode()).hexdigest(), 16) % TESTE_A_CADA == 0


def main():
    fora = canais_do_teste()
    treino = teste = 0
    casos_teste = []
    canais = set()
    with open(SAIDA, "w") as out:
        for pasta in ("landmarks", "landmarks_sinais"):
            sinais = pasta == "landmarks_sinais"
            for path in sorted(glob.glob(os.path.join(DATA, pasta, "*.json"))):
                with open(path) as f:
                    v = json.load(f)
                canal = v.get("channel_id") or v["id"]
                if canal in fora:
                    continue
                vai_teste = sinais and para_teste(canal)
                achados = [(f["t"], h) for f in v["frames"] for h in repouso(f, v["aspect"])]
                if not achados:
                    continue
                idx = np.linspace(0, len(achados) - 1, min(POR_VIDEO, len(achados))).round().astype(int)
                for i in sorted(set(idx.tolist())):
                    t, h = achados[i]
                    if vai_teste:
                        casos_teste.append({"video": v["id"], "pasta": pasta, "canal": canal, "t": t,
                                            "handedness": h["h"], "aspect": v["aspect"], "raw": h["lm"]})
                        teste += 1
                        continue
                    out.write(json.dumps({
                        "label": NENHUMA, "person_id": canal, "platform": "youtube", "device_model": "",
                        "browser": "", "normalization_version": NORMALIZATION_VERSION, "handedness": h["h"],
                        "aspect": v["aspect"],
                        "v": [round(float(x), 6) for x in normalize_hand(h["lm"], h["h"], v["aspect"])],
                        "raw": h["lm"], "session_id": v["id"], "t": t,
                    }) + "\n")
                    treino += 1
                    canais.add(canal)
    with open(SAIDA_TESTE, "w") as f:
        json.dump({"criterio": "mãos juntas ou baixas, canais separados por hash (1 em 5)", "casos": casos_teste}, f)
    print(f"treino: {treino} exemplos de {len(canais)} canais -> {SAIDA}")
    print(f"teste: {teste} exemplos de {len({c['canal'] for c in casos_teste})} canais -> {SAIDA_TESTE}")


if __name__ == "__main__":
    main()
