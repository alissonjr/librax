# Plano: lições depois do treino por vídeo

Status: proposta de 2026-10-25. Feito em 2026-10-25: seções 1 e 2 (com as letras fortes) e as duas leituras
seguidas da seção 5; o que entrou está descrito na spec-03 (seções 3 e 5.4).

O treino com vídeos do YouTube e de dicionários mudou o que a câmera consegue avaliar e mostrou
erros no conteúdo. Este plano lista o que mudaria nas lições por causa disso, em ordem de
prioridade. Os números citados vêm do teste fixo (`ml-training/teste_fixo.py`, canais que nunca
entram no treino) e do piloto de sinais (`ml-training/train_sinais.py`).

## O que mudou na base

| Antes | Agora |
|---|---|
| Câmera reconhecia 10 letras, por regras de dedos | Modelo v6 reconhece 24 letras paradas e "nenhuma letra" |
| Mão parada ou aberta virava letra (o "A" fantasma) | Mão em repouso vira letra em 2,7% dos casos (antes 29,5%) |
| Sem medida honesta de acerto | Teste fixo: 83,5% das letras em pessoas nunca vistas |
| Sinais com movimento só como prática livre | App pronto para avaliar sinais quando houver modelo; piloto de 20 sinais acerta cerca de 50% |
| Descrições escritas sem conferir com quem sinaliza | Descrições comparadas com dezenas de professores (o T estava no alfabeto americano) |

## 1. Câmera em mais letras (prioridade alta)

Hoje só 10 letras têm exercício de câmera (A, B, F, G, K, L, P, Q, U, V), mas o modelo lê 24.

- Acrescentar `perform_sign` nas lições da unidade 1 para C, D, E, H, I, M, N, O, R, S, T, W, X, Y.
- Começar pelas que o modelo lê bem no teste fixo e deixar por último as fracas (U, K, R, X, M, N).
  Letra fraca entra só quando o teste fixo dela passar de 80%.
- J, Z e Ç têm movimento: ficam com prática livre até entrarem no modelo de sinais.

Feito em 2026-10-25 (letras com movimento, spec-01 seção 3.3): modelo próprio, só com as mãos, para H, J, K, X, Z e
Ç. Com ele publicado em `public/ml/letras-mov/`, H, K e J são avaliadas com o movimento (J entrou no `produce` da
U1 L2). X (3/6) e Z (4/7) ficaram abaixo de 70% com pessoas nunca vistas e seguem como prática livre; o Y fica nas
letras paradas (nos vídeos a mão não se mexe).

Feito: C, D, E, H, I, O, S, W e Y ganharam câmera (`produce` de cada lição da U1). M, N, R, T e X
esperam passar de 80%. F (3/4), Q (4/6) e U (1/3) já tinham câmera e continuam, mas estão abaixo de
80%: decidir se saem do `produce` até o próximo treino.

## 2. Soletração de verdade (prioridade alta)

A soletração (`fingerspell`) existe em uma lição só (u4-l4: DAVI, BIA, LIA) e já usa a regra de
soltar a mão entre letras (`src/lib/fingerspell.ts`).

- Com 24 letras, soletrar o próprio nome passa a funcionar para a maioria dos nomes. Exercício
  "soletre seu nome" na unidade de apresentação, pulando nomes com J, Z ou Ç (ou aceitando a
  prática livre nessas letras).
- Palavras curtas de revisão ao fim de cada lição do alfabeto, só com letras já ensinadas.
- A classe "nenhuma letra" ajuda aqui: a pausa entre letras deixa de ser lida como letra.

Feito: "soletre seu nome" no fim da U4 L4 (nome com J, Z, Ç, vazio ou com mais de 8 letras usa a
palavra de reserva LIDIA) e revisão CHEGA, BOLO, SAPO e YAGO no fim das lições 2 a 5 da U1.

## 3. Dicas de erro específicas (prioridade média)

O teste fixo mostra as trocas mais comuns: K lida como H, P como K, R como U, F e T entre si, X
como H ou N. Em vez de só "tente de novo", a lição diz o que diferencia a letra pedida da letra que
a câmera leu.

- O texto de cada dica sai da diferença entre os `CM` das duas letras no `signs.json`, conferida
  nos vídeos (seção 4) antes de ir para a lição. Não escrever dica de memória: foi assim que o T
  do alfabeto americano entrou no curso.
- As dicas ficam em `signs.json` (um campo por troca) e aparecem depois de duas leituras seguidas
  da letra errada, para não reagir a leituras passageiras.

## 4. Conteúdo conferido com os dados (prioridade média)

A comparação das letras F e T com os vídeos mostrou que a descrição do T era a do alfabeto
americano. O mesmo cruzamento vale para todo o alfabeto e os números:

- Script que mede, para cada letra, quais dedos ficam esticados e qual dedo toca o polegar nas
  paradas aceitas, e compara com o `CM` do `signs.json`. Divergência vira nota "A CONFERIR".
- Revisar F e T no dicionário do INES (nota já gravada nas duas).
- Feito em 2026-10-25: alfabeto e números conferidos no vídeo do INES e no avatar VLibras (notas
  em cada entrada do `signs.json`). G, H, M, N, P e Q eram do alfabeto americano; H, K e X têm
  movimento nas duas fontes, mas seguem `static` porque o modelo da câmera lê a forma parada (com o modelo das
  letras com movimento publicado, H e K passam a ser avaliadas com o movimento; X ainda não).
  Ficaram "A CONFERIR": Y (vídeo do INES não abre), 1, 5, 7, 11, 17, 40 e 70 (avatar diferente do
  INES).
- Sinais com mais de uma forma (MESA apareceu com variantes diferentes entre canais): registrar a
  variante ensinada no `signs.json` e, se o modelo aprender as duas, aceitar as duas na câmera.

## 5. Sinais com movimento avaliados (prioridade média, depende do modelo)

O app já avalia sinais quando existe `public/ml/sinais/model.json` (componente
`ExerciseCameraMotionSign`). Para ligar isso nas lições:

- Instalar o modelo só com os sinais que passarem de 70% no teste com pessoas nunca vistas; os
  outros continuam como prática livre, sem nota. O app já faz essa separação por glosa.
- (Feito) Exigir duas leituras seguidas da mesma glosa antes de mostrar "Vimos X", porque no teste ao vivo
  apareceram leituras passageiras erradas antes do acerto.
- Mão dominante calculada por janela também no treino (hoje é por vídeo inteiro), para bater com
  o app.
- Começar pelas unidades com mais sinais que o modelo já cobre (comida, sentimentos, tempo).

## 6. Números (prioridade baixa)

Os números de 0 a 9 são formas de mão paradas, como as letras, e já existem vídeos de números entre
os baixados. Dá para treinar um modelo de números com o mesmo caminho das letras (rótulo por
parada, conferência por OCR do número na tela) e ligar a câmera na unidade 2. Números com movimento
(como 11, 12, 16, 17) seguem o caminho dos sinais.

## 7. Medir nas lições (prioridade baixa)

- Registrar, sem imagem, quantas tentativas cada letra e sinal precisou e quantas vezes a pessoa
  pulou. Letra ou sinal com muitos pulos indica modelo fraco ou descrição confusa.
- Usar esses números para decidir a ordem dos próximos treinos.

Feito em 2026-10-25, só no aparelho:

- `src/lib/cameraStats.ts` guarda no IndexedDB do app (store `camera_stats`, banco na versão 3), por
  sinal: acertos, pulos, tentativas até acertar e quantas vezes a câmera leu outra letra ou glosa no
  lugar (K lida como H). Uma tentativa é cada leitura estável diferente da anterior. Grava nas letras
  paradas, em cada letra da soletração (pulo conta só para a letra da vez) e nos sinais com
  movimento. Pulo com a câmera que nunca ligou (permissão negada, modelo ausente) não conta.
- Tela em Configurações, "Desempenho da câmera" (`/configuracoes/camera`): do mais difícil para o
  mais fácil (taxa de pulo, depois média de tentativas), com as leituras erradas mais comuns, exportar
  JSON e apagar. A Política de Privacidade (1.1) cita esses números entre os dados do aparelho.
- Também vai ao servidor (2026-10-25), para somar os números de todas as pessoas: a conclusão de
  lição leva `cameraStats: { "<signId>": { successes, skips, attempts, wrong: { "<rótulo>": n } } }`
  só com a diferença daquela lição (nunca o acumulado), pela fila offline e só com conta (o
  convidado manda na migração). O servidor aceita só sinais e glosas do curso, com tetos, e
  descarta o que vier fora do formato sem recusar a conclusão; soma no item `DAY#<dia>#CAMERA`
  (`success:`, `skip:`, `attempts:` e `wrong:<signId>:<rótulo>`), sem id de pessoa. O painel tem
  a tela "Câmera" (docs/painel-admin.md) e a Política (1.1) diz isso nos itens 3, 4, 5 e 6.

## Ordem sugerida

1. Câmera em mais letras (começando pelas fortes) e soletração do nome.
2. Dicas de erro e conferência do conteúdo do alfabeto.
3. Modelo de sinais nas lições, sinal a sinal, conforme o teste liberar.
4. Números e medição.
