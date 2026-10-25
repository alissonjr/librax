# Vídeo de divulgação: LIBRAX soletrado por muitas mãos

Status: projetado em 2026-10-25; scripts e rascunho prontos em 2026-10-25. Segundo desenho (mãos em
quadrados coloridos, 5 mãos por letra, fileira LIBRAX) em 2026-10-25, aguardando a revisão do dono.

## Ideia

Um vídeo curto que soletra o nome do app em Libras (L, I, B, R, A, X). Cada letra ganha um
quadrado colorido; dentro dele, fotos de mãos de pessoas diferentes fazendo a mesma letra trocam
muito rápido entre si e a última fica. Os quadrados se acumulam lado a lado, da esquerda para a
direita, formando LIBRAX em Libras, com a letra escrita entrando embaixo de cada um. No final,
entra o logotipo do Librax.

## Decisões

| Ponto | Escolha |
|---|---|
| Imagens | Fotos reais de mãos, recortadas dos vídeos do alfabeto já baixados para o treino |
| Recorte | Só a mão e o pulso, sem rosto; uso de imagem assumido pelo dono do projeto |
| Formato | Vertical 9:16, 1080 x 1920, MP4; também quadrado 1:1 (1080 x 1080) e horizontal 16:9 (1920 x 1080) |
| Mãos por letra | 5 (parâmetro `--por-letra`) |
| Quadrados | Cores do design system, fixas por quadrado, cantos de card (`radius.lg`) |
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
4. **Fundo:** o fundo de cada foto é removido; no vídeo a mão fica sobre a cor fixa do seu
   quadrado. O brilho constante evita o efeito de piscar.
5. **Conferência pelo modelo:** cada foto passa pelo classificador de letras do app
   (`public/ml/classifier`); só entra a que ele lê como aquela letra com probabilidade de 0,6 ou mais.
6. **Aprovação:** antes do vídeo final, uma folha com as fotos escolhidas de cada letra para o dono
   aprovar.

## Roteiro (cerca de 7,7 s)

Tela com o fundo escuro do app (`bg.canvas` do tema escuro, `#14110E`): as cores dos quadrados e a
tangerina das letras se destacam nele, e é o mesmo fundo do logotipo no fim. Uma fileira de 6
quadrados no meio da tela, com LIBRAX escrito embaixo, cada letra centrada sob o seu quadrado.

| Tempo | O que aparece |
|---|---|
| 0 a 0,4 s | Fundo do app, vazio |
| Cada letra, 0,84 s | O quadrado entra no seu lugar da fileira (0,16 s, crescendo de 92% a 100%) já com a primeira mão; as outras 4 trocam a cada 80 ms |
| Fim de cada letra, 0,36 s | A quinta mão para e a letra entra embaixo do quadrado em tangerina; quando o próximo quadrado entra, ela passa para a cor do texto |
| 5,4 a 6,2 s | LIBRAX completo parado: 6 quadrados com as mãos e a palavra escrita |
| 6,2 a 7,7 s | Quadrados e letras somem e entra o logotipo (símbolo Traço e "librax"), parado por 1 s |

Mãos de cada letra: as 5 de número menor na seleção (`selecao.json`), mostradas do maior para o
menor; a de número menor é a que fica.

Cores dos quadrados (paleta do design system, na ordem de LIBRAX):

| Letra | Cor | Token |
|---|---|---|
| L | `#0E7C7B` | `color.petroleo.600` |
| I | `#3460E6` | `league.safira.fill` |
| B | `#B42A5E` | `color.framboesa.600` |
| R | `#14834A` | `color.verde.600` |
| A | `#7B4FE0` | `league.ametista.fill` |
| X | `#0B6463` | `color.petroleo.700` |

Tons médios e frios: a pele das fotos é quase toda mais clara que eles e de matiz oposto, então a
mão se destaca em qualquer tom de pele. Tangerina, âmbar e ouro ficam de fora porque ficam perto
demais da cor da pele; a tangerina aparece nas letras e no símbolo. O petróleo, cor da mão e da
Libras no app, abre e fecha a fileira.

Formatos: com 6 quadrados lado a lado, o lado do quadrado depende só da largura do vídeo. No
vertical e no quadrado (1080 de largura) cada quadrado tem 151 px; no horizontal (1920 de largura),
254 px. O horizontal é o mais legível; o quadrado ocupa melhor a tela no feed do celular; o
vertical deixa a fileira pequena no meio de muito fundo vazio.

## Cuidados

- **Luz piscando:** trocas rápidas de imagem podem incomodar pessoas sensíveis. O fundo da tela e a
  cor de cada quadrado ficam fixos; só a mão muda, dentro de um quadrado pequeno. Nada de clarão de
  tela inteira.
- **Letras parecidas:** só entram fotos que o modelo lê como a letra certa, para não misturar,
  por exemplo, R com U.

## Produção

1. Um script em `ml-training/` escolhe as fotos, recorta, alinha, tira o fundo e grava os quadros
   e a folha de aprovação.
2. Outro script monta a animação a partir das mãos recortadas e exporta o MP4 (vertical, quadrado
   ou horizontal).
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
$PY divulgacao/montar.py --previa L         # previa-L.mp4 e previa-L.gif (só uma letra, quadrado grande)
$PY divulgacao/montar.py                    # rascunho-v2.mp4 e final-v2.png (1080 x 1920, H.264, sem som)
$PY divulgacao/montar.py --formato todos    # também rascunho-v2-quadrado.mp4 e rascunho-v2-horizontal.mp4
$PY divulgacao/montar.py --por-letra 4      # outra quantidade de mãos por letra (padrão 5)
$PY divulgacao/montar.py --quadros 1 5.8 7  # quadros soltos em JPG para conferir
```

`--formato` aceita `vertical` (padrão), `quadrado`, `horizontal` ou `todos`. Cada vídeo sai com um
`final-v2*.png` ao lado: a composição final, com LIBRAX completo. `--nome` troca o nome do vídeo
(padrão `rascunho-v2`); o rascunho anterior (`rascunho.mp4`, mão grande e única no meio) fica na
pasta para comparar.

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
$PY divulgacao/montar.py --formato todos          # refaz os rascunhos com a seleção nova
```

Também dá para editar `selecao.json` à mão: vale a lista `letras` de cada letra, com os números
da folha (o campo `chaves` só guarda o vídeo e o instante de cada número). Uma nova rodada do
`preparar.py` mantém a seleção do dono mesmo que a numeração mude; só `--nova-selecao` volta para
a pré-seleção automática. O vídeo usa as 5 fotos de número menor de cada letra (`--por-letra`),
na ordem da folha, com a de número menor por último: é ela que fica parada enquanto a letra entra.
Para trocar uma foto do vídeo, basta tirar o número da seleção (por exemplo, `--tirar I2`): a próxima
da seleção, na ordem da folha, entra no lugar.

