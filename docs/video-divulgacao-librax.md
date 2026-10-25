# Vídeo de divulgação: LIBRAX soletrado por muitas mãos

Status: projetado em 2026-10-25; scripts e rascunho prontos em 2026-10-25. Segundo desenho (mãos em
quadrados coloridos, fileira LIBRAX) em 2026-10-25. Terceiro desenho (rascunho-v3: zoom no quadrado
da letra, 10 mãos por letra, quadrados colados à mão sobre a palavra) em 2026-10-25. Quarto
(rascunho-v4: troca mais lenta com fusão e a palavra escrita igual à do logotipo, em minúscula) em
2026-10-25, aguardando a revisão do dono.

## Ideia

Um vídeo curto que soletra o nome do app em Libras (L, I, B, R, A, X). Cada letra ganha um
quadrado colorido que aparece grande no meio da tela; dentro dele, fotos de mãos de pessoas
diferentes fazendo a mesma letra trocam muito rápido entre si e a última fica. Aí o quadrado
encolhe e vai para o seu lugar, em cima da sua letra da palavra "librax" escrita embaixo, igual à
do logotipo. Os quadrados se juntam lado a lado, um pouco por cima do outro e levemente girados,
como fotos coladas à mão, formando LIBRAX em Libras. No final, a própria palavra escrita encolhe e
vira o logotipo do Librax.

## Decisões

| Ponto | Escolha |
|---|---|
| Imagens | Fotos reais de mãos, recortadas dos vídeos do alfabeto já baixados para o treino |
| Recorte | Só a mão e o pulso, sem rosto; uso de imagem assumido pelo dono do projeto |
| Formato | Vertical 9:16, 1080 x 1920, MP4 (principal); `--formato` também faz quadrado 1:1 (1080 x 1080) e horizontal 16:9 (1920 x 1080) |
| Mãos por letra | 10 (parâmetro `--por-letra`); com menos fotos boas, repetem sem a mesma duas vezes seguidas |
| Quadrados | Cores do design system, fixas por quadrado, sem canto arredondado, girados e com sombra de papel |
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

Na prática, depois dos filtros e da conferência a olho, ficaram 10 fotos boas de L, I, B, R e A
e 6 de X (veja "Aprovação da folha").

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

## Roteiro (cerca de 12,4 s)

Tela com o fundo escuro do app (`bg.canvas` do tema escuro, `#14110E`): as cores dos quadrados e a
tangerina das letras se destacam nele, e é o mesmo fundo do logotipo no fim. O vídeo roda a 30
quadros por segundo.

| Tempo | O que aparece |
|---|---|
| 0 a 0,3 s | Fundo do app, vazio |
| Cada letra, 1,43 s | O quadrado da letra entra grande no alto da tela (0,13 s) já com a primeira mão; as mãos trocam a cada 125 ms (8 por segundo), cada troca com uma fusão de 67 ms (2 quadros), até a décima (1,13 s); ela fica 0,1 s e o quadrado encolhe, gira e vai para o seu lugar (0,3 s) |
| Ao pousar | A letra escrita entra embaixo, em tangerina; quando a letra seguinte pousa, a anterior passa para a cor do texto. O quadrado seguinte já começa a entrar quando o anterior está a 65% do caminho |
| 9,2 a 9,7 s | "librax" completo sobe para o meio da tela; o x passa da tangerina para a cor do texto, como no logotipo |
| 9,7 a 10,7 s | Parado: 6 quadrados com as mãos sobre a palavra escrita (é o `final-v4.png`) |
| 10,7 a 11,4 s | Os quadrados somem e a palavra encolhe e desliza até o seu lugar no logotipo, enquanto o símbolo Traço aparece ao lado |
| 11,4 a 12,4 s | Logotipo parado |

Mãos de cada letra: as 10 de número menor na seleção (`selecao.json`), mostradas do maior para o
menor; a de número menor é a que fica. Com menos de 10 na seleção, as fotos repetem em ciclo
(X tem 6: X4 X3 X2 X1 X6 X5 X4 X3 X2 X1).

A palavra escrita é a do logotipo: "librax" em minúscula, Anybody 900 a 125%, com o mesmo
espaçamento (avanço da fonte menos 1% do corpo), só que maior, ocupando 86% da largura no
vertical. Por isso, no fim, ela só encolhe e desliza até o texto do logotipo, sem troca de letra.
Cada quadrado fica com o centro em cima da sua letra e o pé um pouco acima do topo do l e do b; o
lado é 1,12 vez o passo médio entre as letras (178 px no vertical). Os quadrados se encostam e,
onde as letras são estreitas (l e i), um fica por cima do outro. A ordem das camadas é fixa,
também enquanto o quadrado voa, para ele não pular de camada ao pousar: L por cima de I, I por
cima de B, e dali em diante cada um por cima do anterior. Assim a mão mais larga, a do L (polegar
aberto), fica inteira à mostra. Cada quadrado tem um giro fixo de 2,5 a 6 graus, alternando o
sentido, e um pequeno deslocamento, sorteados com semente fixa (`--semente`, igual em toda
renderização), e uma sombra de papel que separa os quadrados sobrepostos. Na fileira só fica a
última mão de cada letra, e a foto se ajusta à parte do quadrado que os vizinhos de cima deixam à
mostra: fica no meio quando cabe; senão anda para o lado livre e se afasta um pouco (é o caso do I,
coberto pelo L). No quadrado grande a mão fica sempre no meio; o enquadramento muda suave durante
o encolhimento.

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

Formatos: o vertical é o principal. O zoom resolve o tamanho pequeno da fileira no celular: cada
mão aparece grande (670 px) enquanto troca, e a fileira final vira a composição com a palavra.
Quadrado e horizontal seguem o mesmo desenho, com o quadrado grande em cima e a fileira embaixo.

## Cuidados

- **Luz piscando:** trocas rápidas de imagem podem incomodar pessoas sensíveis. O fundo da tela e a
  cor de cada quadrado ficam fixos e o brilho das mãos é aproximado; só a forma da mão muda. Nada de
  clarão de tela inteira. Com o zoom, a troca acontece num quadrado grande (cerca de um quinto da
  tela); por isso ela é de 8 mãos por segundo, com uma fusão curta entre uma foto e outra em vez de
  corte seco. Mesmo assim, vale passar o vídeo final num verificador de flashes antes de publicar.
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
$PY divulgacao/montar.py --previa L         # previa-L.mp4 e previa-L.gif (só a letra L: zoom, troca e pouso)
$PY divulgacao/montar.py                    # rascunho-v4.mp4 e final-v4.png (1080 x 1920, H.264, sem som)
$PY divulgacao/montar.py --formato todos    # também rascunho-v4-quadrado.mp4 e rascunho-v4-horizontal.mp4
$PY divulgacao/montar.py --por-letra 8      # outra quantidade de mãos por letra (padrão 10)
$PY divulgacao/montar.py --semente 5        # outro sorteio de giro e deslocamento dos quadrados
$PY divulgacao/montar.py --quadros 1 5.8 8  # quadros soltos em JPG para conferir
```

`--formato` aceita `vertical` (padrão), `quadrado`, `horizontal` ou `todos`. Cada vídeo sai com um
`final-v4*.png` ao lado: a composição final, com "librax" completo. `--nome` troca o nome do vídeo
(padrão `rascunho-v4`); os rascunhos anteriores (`rascunho.mp4`, `rascunho-v2*.mp4` e
`rascunho-v3.mp4`) ficam na pasta para comparar.

O `preparar.py` leva uns 12 minutos (mede três quadros de cada parada). Depois que ele rodou uma
vez, `--reusar-analise` refaz só filtros, mãos e folha a partir de `analise.json`.

Filtros, em ordem (a contagem de canais depois de cada um sai no terminal e em `candidatos.json`):
classificador do app (p >= 0,6 na letra certa), tamanho do palmo no vídeo, mão inteira dentro do
quadro, nitidez, pele de verdade, recorte sem buraco, rosto e texto. Letra com menos de 10 canais
aprovados ganha uma folga só em tamanho (palmo de 36 px em vez de 40) e nitidez (24 em vez de 40),
para os canais que ainda não têm foto; essas fotos saem marcadas com "folga" na folha. Rosto,
texto e recorte nunca relaxam: as quase aprovadas nessas regras foram olhadas uma a uma e todas
tinham pedaço de rosto, texto ou buraco. Na regra do rosto, a mão
recortada não pode cair dentro da caixa de um rosto (mão na frente do rosto sai) e o recorte não
pode levar pele de rosto; o fundo inteiro, rosto incluído, é removido e só fica a pele ligada à
mão. O fundo sai pela segmentação de pele do MediaPipe (selfie multiclass), colada às bordas da
foto por um filtro guiado, e o antebraço some aos poucos abaixo do pulso.

### Aprovação da folha

`folha.jpg` tem uma faixa por letra, na ordem da nota (confiança do modelo, tamanho e nitidez).
Cada foto tem um número (L1, L2...) e a confiança do classificador. As que entram no vídeo (as 10
de número menor da seleção) têm borda tangerina e um selo com a ordem (1 é a que fica parada no
fim da troca); as que estão na seleção mas ficam fora do vídeo têm borda cinza. Em cima de cada
faixa, quantas entram (e se repetem, quando são menos de 10). A seleção fica em `selecao.json`:

```bash
$PY divulgacao/preparar.py --tirar L3 --por A14             # edita a seleção e redesenha a folha
$PY divulgacao/preparar.py --rejeitar I2 --motivo "buraco"  # foto ruim: sai da seleção
$PY divulgacao/preparar.py --reusar-analise                 # refaz folga, mãos e folha sem as rejeitadas
$PY divulgacao/montar.py                                    # refaz o rascunho com a seleção nova
```

Também dá para editar `selecao.json` à mão: vale a lista `letras` de cada letra, com os números
da folha (o campo `chaves` só guarda o vídeo e o instante de cada número). Uma nova rodada do
`preparar.py` mantém a seleção do dono mesmo que a numeração mude; só `--nova-selecao` volta para
a pré-seleção automática. A lista `rejeitadas` guarda letra, vídeo e motivo das fotos recusadas a
olho: elas não voltam para a folha nem contam para a folga, mesmo que a numeração mude.

Rejeitadas na revisão de 2026-10-25: buraco no recorte (o esmalte escuro vira fundo na
segmentação) nas fotos do vídeo `cT3l6iP7NXY` de L, I e R; borradas: uma de I (`jml2fai1I5s`) e
duas de B que entraram pela folga (`YYj1lkqPHy8`, `GidjkBp2OWs`); X amarelado (`23YCQl1L2yE`) e X
com o dedo cortado (`ZHUqjtJewOY`). Com isso e com a folga: L, I, B, R e A com 10 fotos diferentes
no vídeo e X com 6 (repetidas até 10).
