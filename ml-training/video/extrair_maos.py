"""
Extrai de novo os landmarks das mãos dos vídeos baixados, a QUADROS_POR_S quadros por segundo, com
o HandLandmarker do MediaPipe em Python (mesma versão e mesmo modelo do app: hand_landmarker.task
da 1.1.1), no formato de data/landmarks/<id>.json.

Por que existe: a página treino-video.html toca o vídeo acelerado e grava cerca de 7,5 quadros
por segundo nos vídeos do alfabeto (2,5 a 5 nos de uma letra). Para as letras paradas basta, mas
o movimento do H, do J, do K, do X, do Z e do Ç passa em menos de um segundo: a 7,5 quadros por
segundo sobram 5 ou 6 pontos da trajetória. A câmera do app lê até 15 quadros por segundo, e o
treino do movimento usa a mesma taxa.

Quadros: lê o vídeo inteiro em ordem e passa ao detector o quadro mais próximo de cada múltiplo
de 1/QUADROS_POR_S segundo (modo VIDEO, como o app, que acompanha a mão entre quadros).

Saída em data/letras_mov/landmarks15/<id>.json (fora do git). Vídeo que já tem saída é pulado.

Uso:
    python video/extrair_maos.py --ids ID [ID ...] [--processos 3]
    python video/extrair_maos.py --alfabeto --letras HJKXYZÇ [--processos 3]
    python video/extrair_maos.py --ines      (baixa os verbetes de letras_mov_ines.json e extrai)
    (LIBRAX_DATA=/caminho/data aponta para outra pasta de dados; --modelo para o .task)
"""

import argparse
import json
import os
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
SAIDA = os.path.join(DATA, "letras_mov", "landmarks15")
INES = os.path.join(AQUI, "..", "letras_mov_ines.json")
INES_VIDEOS = os.path.join(DATA, "letras_mov", "ines")
MODELO_PADRAO = os.path.join(AQUI, "..", "..", "apps", "web-poc", "public", "ml", "1.1.1", "hand_landmarker.task")
QUADROS_POR_S = 15.0


def arred(x):
    return round(float(x), 5)


def extrair(job):
    """Extrai um vídeo (roda num processo à parte). Devolve (id, quadros, segundos)."""
    fonte, video_path, modelo, saida = job
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode

    inicio = time.time()
    opts = HandLandmarkerOptions(base_options=BaseOptions(model_asset_path=modelo),
                                 running_mode=RunningMode.VIDEO, num_hands=2)
    cap = cv2.VideoCapture(video_path)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    proximo = 0.0
    i = 0
    with HandLandmarker.create_from_options(opts) as det:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = i / fps
            i += 1
            # quadro mais próximo do próximo instante da grade de 1/QUADROS_POR_S
            if t + 0.5 / fps < proximo:
                continue
            proximo += 1.0 / QUADROS_POR_S
            while proximo <= t:
                proximo += 1.0 / QUADROS_POR_S
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = det.detect_for_video(img, int(round(t * 1000)))
            hands = []
            for lms, hd in zip(res.hand_landmarks, res.handedness):
                hands.append({
                    "h": hd[0].category_name,
                    "s": arred(hd[0].score),
                    "lm": [arred(v) for p in lms for v in (p.x, p.y, p.z)],
                })
            frames.append({"t": round(t, 5), "hands": hands})
    cap.release()
    out = {
        "id": fonte["id"],
        "tipo": fonte.get("tipo"),
        "rotulo": fonte.get("rotulo"),
        "channel_id": fonte.get("channel_id"),
        "title": fonte.get("title"),
        "width": w,
        "height": h,
        "aspect": w / h if h else 1.0,
        "duration": i / fps,
        "mediapipe": "python-" + mp.__version__,
        "quadros_por_s": QUADROS_POR_S,
        "frames": frames,
    }
    tmp = os.path.join(saida, f".{fonte['id']}.json.tmp")
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, os.path.join(saida, f"{fonte['id']}.json"))
    return fonte["id"], len(frames), time.time() - inicio


def baixar_ines():
    """Baixa os vídeos do INES que faltam em data/letras_mov/ines/ e devolve a lista no formato do fontes.json."""
    import urllib.request

    with open(INES) as f:
        cfg = json.load(f)
    os.makedirs(INES_VIDEOS, exist_ok=True)
    fontes = []
    for x in cfg["videos"]:
        destino = os.path.join(INES_VIDEOS, x["arquivo"])
        if not os.path.exists(destino):
            urllib.request.urlretrieve(cfg["url"].format(arquivo=x["arquivo"]), destino)
        fontes.append({**x, "tipo": "letra", "channel": "INES", "channel_id": "ines", "title": f"INES {x['rotulo']}"})
    return fontes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", nargs="*", default=[])
    ap.add_argument("--alfabeto", action="store_true", help="todos os vídeos do alfabeto inteiro (fontes.json)")
    ap.add_argument("--letras", default="", help="também os vídeos de uma letra destas letras")
    ap.add_argument("--fontes", default=os.path.join(DATA, "fontes.json"),
                    help="lista de vídeos (formato do fontes.json; os do INES vêm de letras_mov/fontes_ines.json)")
    ap.add_argument("--videos", default=os.path.join(DATA, "videos"))
    ap.add_argument("--modelo", default=MODELO_PADRAO)
    ap.add_argument("--saida", default=SAIDA)
    ap.add_argument("--processos", type=int, default=3)
    ap.add_argument("--ines", action="store_true", help="verbetes do INES (letras_mov_ines.json)")
    args = ap.parse_args()
    if args.ines:
        fontes = baixar_ines()
        args.videos = INES_VIDEOS
        args.ids = [x["id"] for x in fontes]

    if not os.path.exists(args.modelo):
        raise SystemExit(f"modelo não encontrado: {args.modelo} (rode npm run ml:assets no apps/web-poc)")
    if not args.ines:
        with open(args.fontes) as f:
            fontes = json.load(f)
    pedidos = set(args.ids)
    escolhidas = [x for x in fontes if x["id"] in pedidos
                  or (args.alfabeto and x.get("tipo") == "alfabeto" and len(x.get("sequencia") or "") > 5)
                  or (x.get("tipo") == "letra" and x.get("rotulo") and x["rotulo"] in args.letras)]
    os.makedirs(args.saida, exist_ok=True)
    jobs = []
    for x in escolhidas:
        arq = os.path.join(args.videos, x.get("arquivo") or f"{x['id']}.mp4")
        if not os.path.exists(arq):
            print(f"sem vídeo: {x['id']}")
            continue
        if os.path.exists(os.path.join(args.saida, f"{x['id']}.json")):
            continue
        jobs.append((x, arq, os.path.abspath(args.modelo), args.saida))
    print(f"{len(jobs)} vídeo(s) para extrair em {args.saida}", flush=True)
    if not jobs:
        return
    from multiprocessing import Pool

    with Pool(args.processos) as pool:
        for vid, n, s in pool.imap_unordered(extrair, jobs):
            print(f"{vid}: {n} quadros em {s:.0f} s", flush=True)


if __name__ == "__main__":
    sys.exit(main())
