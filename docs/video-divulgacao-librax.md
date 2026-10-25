# Vídeo de divulgação: LIBRAX soletrado por muitas mãos

Status: projetado em 2026-10-25; scripts e rascunho prontos em 2026-10-25, aguardando a aprovação da folha.

## Ideia

Um vídeo curto que soletra o nome do app em Libras (L, I, B, R, A, X). Em cada letra, fotos de
mãos de pessoas diferentes fazendo a mesma letra trocam muito rápido entre si; entre uma letra e
outra há uma pausa. A palavra vai se formando embaixo e, no final, entra o logotipo do Librax.

## Decisões

| Ponto | Escolha |
|---|---|
| Imagens | Fotos reais de mãos, recortadas dos vídeos do alfabeto já baixados para o treino |
| Recorte | Só a mão e o pulso, sem rosto; uso de imagem assumido pelo dono do projeto |
| Formato | Vertical 9:16, 1080 x 1920, MP4 |
| Som | Sem som |

As 6 letras são estáticas no alfabeto manual (sem movimento), então todas cabem no formato de
troca rápida.

## Material disponível

Vídeos do alfabeto com a letra marcada no tempo certo (paradas aceitas pelo `ml-training/video/rotular.py`),
contando um vídeo por canal ou pessoa:

| Letra | Vídeos |
|---|---|
| L | 21 |
| I | 23 |
| B | 20 |
| R | 18 |
| A | 22 |
| X | 16 |

Dá para escolher de 10 a 12 mãos boas por letra.

## Preparação de cada foto

1. **Quadro:** o meio da parada da letra no vídeo (`data/rotulos/<id>.json`), com os pontos da mão
   do mesmo instante (`data/landmarks/<id>.json`).
2. **Recorte:** a caixa da mão e do pulso a partir dos 21 pontos, com margem. Fica de fora a foto
   em que aparece rosto, logotipo ou texto do canal.
3. **Alinhamento:** todas as mãos no mesmo tamanho (palmo do pulso até a base do dedo médio), na
   mesma posição (pulso no mesmo ponto da tela) e de pé (pulso para baixo, dedos para cima). Assim
   parece uma mão só trocando de pessoa.
4. **Fundo:** o fundo de cada foto é removido e trocado por um fundo único na cor do app
   (`docs/design-system.md`). O brilho constante evita o efeito de piscar.
5. **Conferência pelo modelo:** cada foto passa pelo classificador de letras do app
   (`public/ml/classifier`); só entra a que ele lê como aquela letra com probabilidade de 0,6 ou mais.
6. **Aprovação:** antes do vídeo final, uma folha com as fotos escolhidas de cada letra para o dono
   aprovar.

## Roteiro (cerca de 9 s)

| Tempo | O que aparece |
|---|---|
| 0 a 0,4 s | Fundo do app, vazio |
| Cada letra, 1 s | 10 a 12 mãos trocando a cada 80 ms (cerca de 12 por segundo) |
| Entre letras, 0,3 s | A última mão para e a letra entra embaixo: L, LI, LIB, LIBR, LIBRA, LIBRAX |
| 7,8 a 9 s | LIBRAX completo; as mãos somem e entra o logotipo |

## Cuidados

- **Luz piscando:** trocas rápidas de imagem podem incomodar pessoas sensíveis. Fundo e brilho
  constantes fazem só a forma da mão mudar; evitar clarões de tela inteira.
- **Letras parecidas:** só entram fotos que o modelo lê como a letra certa, para não misturar,
  por exemplo, R com U.

## Produção

1. Um script em `ml-training/` escolhe as fotos, recorta, alinha, tira o fundo e grava os quadros
   e a folha de aprovação.
2. Outro script monta a animação a partir dos quadros e exporta o MP4 vertical.
3. Os arquivos gerados (quadros, folha e vídeo) ficam fora do git, como os vídeos baixados.

## Como rodar

Os scripts ficam em `ml-training/divulgacao/` e rodam no ambiente do treino
(`~/.venvs/librax-ml/bin/python`, com opencv, mediapipe e numpy). Eles só **leem** a pasta de
dados (`--data`, padrão `ml-training/data`: vídeos, landmarks, rótulos e `fontes.json`) e gravam
tudo em `<data>/divulgacao/`, que fica fora do git. Na primeira vez baixam dois modelos pequenos e
oficiais do MediaPipe (detector de rosto e segmentação de pele, cerca de 16 MB) para
`<data>/divulgacao/modelos/`. Nada vai para serviço online.

```bash
cd ml-training
PY=~/.venvs/librax-ml/bin/python
$PY divulgacao/preparar.py                  # candidatas, filtros, mãos recortadas, folha.jpg e selecao.json
$PY divulgacao/montar.py --previa L         # previa-L.mp4 e previa-L.gif (só uma letra)
$PY divulgacao/montar.py                    # rascunho.mp4 (1080 x 1920, H.264, sem som)
$PY divulgacao/montar.py --quadros 1 5.2 9  # quadros soltos em JPG para conferir
```

O `preparar.py` leva uns 12 minutos (mede três quadros de cada parada). Depois que ele rodou uma
vez, `--reusar-analise` refaz só filtros, mãos e folha a partir de `analise.json`.

Filtros, em ordem (a contagem de canais depois de cada um sai no terminal e em `candidatos.json`):
classificador do app (p >= 0,6 na letra certa), tamanho do palmo no vídeo, mão inteira dentro do
quadro, nitidez, pele de verdade, recorte sem buraco, rosto e texto. Na regra do rosto, a mão
recortada não pode cair dentro da caixa de um rosto (mão na frente do rosto sai) e o recorte não
pode levar pele de rosto; o fundo inteiro, rosto incluído, é removido e só fica a pele ligada à
mão. O fundo sai pela segmentação de pele do MediaPipe (selfie multiclass), colada às bordas da
foto por um filtro guiado, e o antebraço some aos poucos abaixo do pulso.

### Aprovação da folha

`folha.jpg` tem uma faixa por letra, na ordem da nota (confiança do modelo, tamanho e nitidez).
Cada foto tem um número (L1, L2...) e a confiança do classificador; as pré-selecionadas têm borda e
selo tangerina. A seleção fica em `selecao.json`:

```bash
$PY divulgacao/preparar.py --tirar L3 --por A14   # edita a seleção e redesenha a folha
$PY divulgacao/montar.py                          # refaz o rascunho com a seleção nova
```

Também dá para editar `selecao.json` à mão: vale a lista `letras` de cada letra, com os números
da folha (o campo `chaves` só guarda o vídeo e o instante de cada número). Uma nova rodada do
`preparar.py` mantém a seleção do dono mesmo que a numeração mude; só `--nova-selecao` volta para
a pré-seleção automática. O vídeo mostra as fotos na ordem da folha, com a de número menor por
último: é ela que fica parada na pausa enquanto a letra entra.

