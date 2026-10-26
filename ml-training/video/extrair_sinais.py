"""
Extrai de novo os landmarks dos vídeos de sinais (fontes_sinais.json, tipo "sinal") a
QUADROS_POR_S quadros por segundo, com as duas mãos (HandLandmarker, num_hands 2) e o corpo
(PoseLandmarker lite), em Python com a mesma versão e os mesmos modelos do app (1.1.1).

Por que existe: a página treino-video.html grava os sinais com cerca de 5 quadros por segundo
(toca o vídeo acelerado), pouco para o movimento. As letras com movimento mostraram que a 15
quadros por segundo, a taxa da câmera do app, o movimento aparece (video/extrair_maos.py, que
fica igual ao navegador com diferença de até 0,006).

Quadros: lê o vídeo inteiro em ordem e passa aos detectores o quadro mais próximo de cada múltiplo
de 1/QUADROS_POR_S segundo (modo VIDEO nos dois, como o app, que acompanha mão e corpo entre
quadros).

Saída em data/sinais15/landmarks/<id>.json (fora do git), no formato de data/landmarks_sinais:
cada quadro com "t", "hands" ([{h, s, lm}] com 21 x 3 números) e "pose" (os POSE_PONTOS primeiros
pontos com x, y, z e visibilidade, como a página grava) ou null sem corpo. Vídeo que já tem saída
é pulado (dá para parar e continuar). O progresso vai para a saída padrão, uma linha por vídeo.

Uso:
    nice -n 10 python video/extrair_sinais.py [--processos 6] [--glosas A,B] [--ids ID ...]
    nice -n 10 python video/extrair_sinais.py --tipos numero,sequencia --saida data/numeros15/landmarks
    python video/extrair_sinais.py --estimar 6     (mede uns vídeos e estima o tempo total)
    (LIBRAX_DATA=/caminho/data aponta para outra pasta de dados)
"""

import argparse
import json
import os
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
SAIDA = os.path.join(DATA, "sinais15", "landmarks")
MAOS_PADRAO = os.path.join(AQUI, "..", "..", "apps", "web-poc", "public", "ml", "1.1.1", "hand_landmarker.task")
CORPO_PADRAO = os.path.join(DATA, "modelos", "pose_landmarker_lite.task")
QUADROS_POR_S = 15.0
# A página guarda os 25 primeiros pontos do corpo (até os quadris); o atributo usa nariz e ombros
POSE_PONTOS = 25


def arred(x):
    return round(float(x), 5)


def extrair(job):
    """Extrai um vídeo (roda num processo à parte). Devolve (id, quadros, segundos, erro)."""
    fonte, video_path, modelo_maos, modelo_corpo, saida = job
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (HandLandmarker, HandLandmarkerOptions, PoseLandmarker,
                                               PoseLandmarkerOptions, RunningMode)

    inicio = time.time()
    try:
        maos_opts = HandLandmarkerOptions(base_options=BaseOptions(model_asset_path=modelo_maos),
                                          running_mode=RunningMode.VIDEO, num_hands=2)
        corpo_opts = PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=modelo_corpo),
                                           running_mode=RunningMode.VIDEO, num_poses=1)
        cap = cv2.VideoCapture(video_path)
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        if not (0 < fps < 240):
            fps = 30.0
        frames = []
        proximo = 0.0
        i = 0
        with HandLandmarker.create_from_options(maos_opts) as det, \
                PoseLandmarker.create_from_options(corpo_opts) as corpo:
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
                ms = int(round(t * 1000))
                res = det.detect_for_video(img, ms)
                hands = []
                for lms, hd in zip(res.hand_landmarks, res.handedness):
                    hands.append({
                        "h": hd[0].category_name,
                        "s": arred(hd[0].score),
                        "lm": [arred(v) for p in lms for v in (p.x, p.y, p.z)],
                    })
                pr = corpo.detect_for_video(img, ms)
                pose = None
                if pr.pose_landmarks:
                    pose = [arred(v) for p in pr.pose_landmarks[0][:POSE_PONTOS]
                            for v in (p.x, p.y, p.z, p.visibility if p.visibility is not None else 0.0)]
                frames.append({"t": round(t, 5), "hands": hands, "pose": pose})
        cap.release()
    except Exception as err:  # vídeo quebrado: segue com os outros
        return fonte["id"], 0, time.time() - inicio, repr(err)
    if not frames:
        return fonte["id"], 0, time.time() - inicio, "nenhum quadro lido"
    out = {
        "id": fonte["id"],
        "tipo": fonte.get("tipo"),
        "rotulo": fonte.get("rotulo"),
        "glosa": fonte.get("glosa"),
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
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, os.path.join(saida, f"{fonte['id']}.json"))
    return fonte["id"], len(frames), time.time() - inicio, None


def glosas_com_camera():
    """Glosas dos sinais com exercício de câmera (perform_sign) nas lições do app."""
    import glob

    conteudo = os.path.join(AQUI, "..", "..", "apps", "web-poc", "src", "assets", "content")
    try:
        with open(os.path.join(conteudo, "signs.json")) as f:
            glosa_de = {s["id"]: s["gloss"] for s in json.load(f)}
    except OSError:
        return set()
    out = set()
    for path in glob.glob(os.path.join(conteudo, "lessons", "*.json")):
        with open(path) as f:
            for e in json.load(f).get("exercises", []):
                sid = e.get("payload", {}).get("sign_id")
                if e.get("type") == "perform_sign" and sid in glosa_de:
                    out.add(glosa_de[sid])
    return out


def duracao(path):
    import cv2

    cap = cv2.VideoCapture(path)
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()
    return n / fps if fps > 0 else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", nargs="*", default=[])
    ap.add_argument("--glosas", default="", help="só estas glosas (separadas por vírgula)")
    ap.add_argument("--tipos", default="sinal",
                    help='tipos de fontes_sinais.json (separados por vírgula; os números usam "numero,sequencia")')
    ap.add_argument("--fontes", default=os.path.join(DATA, "fontes_sinais.json"))
    ap.add_argument("--videos", default=os.path.join(DATA, "videos"))
    ap.add_argument("--maos", default=MAOS_PADRAO)
    ap.add_argument("--corpo", default=CORPO_PADRAO)
    ap.add_argument("--saida", default=SAIDA)
    ap.add_argument("--processos", type=int, default=6)
    ap.add_argument("--estimar", type=int, default=0, help="extrai N vídeos e estima o tempo do resto")
    args = ap.parse_args()

    for m in (args.maos, args.corpo):
        if not os.path.exists(m):
            raise SystemExit(f"modelo não encontrado: {m} (rode npm run ml:assets no apps/web-poc)")
    with open(args.fontes) as f:
        fontes = json.load(f)
    glosas = {g for g in args.glosas.split(",") if g}
    pedidos = set(args.ids)
    tipos = set(args.tipos.split(","))
    escolhidas = [x for x in fontes if x.get("tipo") in tipos and x.get("arquivo")
                  and (not pedidos or x["id"] in pedidos) and (not glosas or x.get("glosa") in glosas)]
    # Primeiro as glosas dos exercícios de câmera das lições (perform_sign) e, dentro delas, as com
    # mais pessoas (canais): são as que dá para treinar antes de tudo acabar
    canais = {}
    for x in escolhidas:
        canais.setdefault(x.get("glosa"), set()).add(x.get("channel_id") or x["id"])
    camera = glosas_com_camera()
    escolhidas.sort(key=lambda x: (x.get("glosa") not in camera, -len(canais[x.get("glosa")])))
    os.makedirs(args.saida, exist_ok=True)
    jobs = []
    for x in escolhidas:
        arq = os.path.join(args.videos, x["arquivo"])
        if not os.path.exists(arq):
            print(f"sem vídeo: {x['id']}")
            continue
        if os.path.exists(os.path.join(args.saida, f"{x['id']}.json")):
            continue
        jobs.append((x, arq, os.path.abspath(args.maos), os.path.abspath(args.corpo), args.saida))
    total_s = sum(duracao(j[1]) for j in jobs)
    print(f"{len(jobs)} vídeo(s) para extrair em {args.saida} ({total_s / 60:.0f} min de vídeo)", flush=True)
    if not jobs:
        return
    if args.estimar:
        jobs = jobs[::max(1, len(jobs) // args.estimar)][:args.estimar]
    from multiprocessing import Pool

    inicio = time.time()
    feito_s, feitos, erros = 0.0, 0, 0
    with Pool(args.processos) as pool:
        for vid, n, s, erro in pool.imap_unordered(extrair, jobs):
            feitos += 1
            if erro:
                erros += 1
                print(f"[{feitos}/{len(jobs)}] {vid}: erro {erro}", flush=True)
                continue
            feito_s += n / QUADROS_POR_S
            passou = time.time() - inicio
            print(f"[{feitos}/{len(jobs)}] {vid}: {n} quadros em {s:.0f} s | {passou / 60:.1f} min",
                  flush=True)
    passou = time.time() - inicio
    print(f"fim: {feitos - erros} vídeos, {erros} erro(s), {feito_s / 60:.1f} min de vídeo em {passou / 60:.1f} min",
          flush=True)
    if args.estimar and feito_s > 0:
        print(f"estimativa para os {len(escolhidas)} pedidos: {total_s * passou / feito_s / 60:.0f} min "
              f"com {args.processos} processos", flush=True)


if __name__ == "__main__":
    sys.exit(main())
