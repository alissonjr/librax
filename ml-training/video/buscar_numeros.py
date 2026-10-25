"""
Só busca (não baixa nada): procura no YouTube vídeos dos números de 0 a 9 em Libras para medir
quanto dado novo existe antes de decidir baixar. Usa a mesma busca do baixar.py (yt_dlp, sem
download) e não mexe em fontes.json nem em fontes_sinais.json.

Dois tipos de vídeo:
- "numero": um número só ("Número 6 - LIBRAS", "sete em libras"), até MAX_DURACAO_NUMERO s;
- "sequencia": os números em sequência ("números em Libras de 0 a 10", "números cardinais"),
  até MAX_DURACAO_SEQUENCIA s. Rotular esses pede OCR do número na tela ou a ordem 0..9.

Cada candidato sai marcado com "ja_temos" quando o id já está nas listas do baixar.py. O resumo
conta, por número, quantos canais NOVOS apareceriam (o que importa para medir em pessoas não
vistas).

Saída: data/numeros/candidatos.json

Uso:
    python video/buscar_numeros.py [--por-busca 15]
"""

import argparse
import collections
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from baixar import buscar, excluido, sem_acento  # noqa: E402

# LIBRAX_DATA aponta para outra pasta de dados (por exemplo, a do checkout principal)
DATA = os.environ.get("LIBRAX_DATA") or os.path.join(AQUI, "..", "data")
SAIDA = os.path.join(DATA, "numeros", "candidatos.json")

NOMES = ["zero", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"]
MAX_DURACAO_NUMERO = 75
MAX_DURACAO_SEQUENCIA = 600
BUSCAS_SEQUENCIA = ("números em libras", "números cardinais em libras", "numerais em libras",
                    "números de 0 a 10 em libras", "contar de 1 a 10 em libras", "números libras 1 a 9")


def numero_do_titulo(title, d):
    """True se o título fala do número d sozinho ("Número 6", "seis em libras", "N° 6")."""
    t = sem_acento(title)
    if "libras" not in t or excluido(title):
        return False
    nome = NOMES[d]
    if re.search(rf"(numero|n[ºo°]?)\s*({d}|{nome})\b(?!\s*[0-9])", t):
        return True
    # "6 em libras" / "seis em libras" (o "um" sozinho pega frase demais: só com "numero")
    alvo = f"{d}" if d == 1 else f"({d}|{nome})"
    return re.search(rf"(?<![0-9a-z]){alvo}\s+em\s+libras", t) is not None


def titulo_de_sequencia(title):
    t = sem_acento(title)
    return ("numer" in t or "contar" in t) and "libras" in t and not excluido(title)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--por-busca", type=int, default=15)
    args = ap.parse_args()

    conhecidos = set()
    for nome in ("fontes.json", "fontes_sinais.json"):
        path = os.path.join(DATA, nome)
        if os.path.exists(path):
            conhecidos |= {f["id"] for f in json.load(open(path))}
    # canais que já temos por número (vídeo com landmarks), para separar o que é canal novo
    canais_antes = collections.defaultdict(set)
    for f in json.load(open(os.path.join(DATA, "fontes_sinais.json"))):
        g = str(f.get("glosa", ""))
        if g.isdigit() and int(g) <= 9 and os.path.exists(os.path.join(DATA, "landmarks_sinais", f"{f['id']}.json")):
            canais_antes[g].add(f.get("channel_id") or f["id"])

    vistos, cands = set(), []
    for d in range(10):
        nome = NOMES[d]
        for q in (f"número {d} em libras", f"numero {nome} libras", f"{nome} em libras número"):
            for e in buscar(q, args.por_busca):
                if e["id"] in vistos or not e["duration"] or e["duration"] > MAX_DURACAO_NUMERO:
                    continue
                if not numero_do_titulo(e["title"], d):
                    continue
                vistos.add(e["id"])
                cands.append({**e, "tipo": "numero", "glosa": str(d), "ja_temos": e["id"] in conhecidos})
        print(f"{d}: {sum(1 for c in cands if c['glosa'] == str(d))} candidato(s)", flush=True)
    for q in BUSCAS_SEQUENCIA:
        for e in buscar(q, args.por_busca):
            if e["id"] in vistos or not e["duration"] or e["duration"] > MAX_DURACAO_SEQUENCIA:
                continue
            if not titulo_de_sequencia(e["title"]):
                continue
            vistos.add(e["id"])
            cands.append({**e, "tipo": "sequencia", "glosa": None, "ja_temos": e["id"] in conhecidos})
    print(f"sequências: {sum(1 for c in cands if c['tipo'] == 'sequencia')} candidato(s)", flush=True)

    resumo = {}
    for d in map(str, range(10)):
        novos = {c["channel_id"] for c in cands if c["glosa"] == d and not c["ja_temos"]} - canais_antes[d]
        resumo[d] = {"canais_que_temos": len(canais_antes[d]), "videos_novos": sum(
            1 for c in cands if c["glosa"] == d and not c["ja_temos"]), "canais_novos": len(novos)}
    seq_novas = [c for c in cands if c["tipo"] == "sequencia" and not c["ja_temos"]]
    resumo["sequencias"] = {"videos_novos": len(seq_novas), "canais_novos": len({c["channel_id"] for c in seq_novas})}
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w") as f:
        json.dump({"resumo": resumo, "candidatos": cands}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    for k, r in resumo.items():
        print(k, r)
    print(f"gravado em {SAIDA} (nada foi baixado)")


if __name__ == "__main__":
    sys.exit(main())
