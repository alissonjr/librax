# SPEC 03 - Currículo, fases e avaliação (executável)

> Aprofundamento do doc `03-curriculo-fases-avaliacao.md` até nível de implementação.
> Liga-se à SPEC 01 (o que o reconhecimento permite) e à SPEC 02 (como o conteúdo é entregue/medido).
> Conteúdo co-criado e validado com a comunidade surda (requisito, não opcional).

## 1. Modelo pedagógico

Todo sinal é descrito pelos **5 parâmetros da Libras**, que estruturam ensino E avaliação:
1. Configuração de mão (CM)  2. Ponto de articulação (PA)  3. Movimento (MOV)
4. Orientação da palma (OR)  5. Expressões não manuais (ENM)

Regra de progressão ditada pela Camada 1: começa só com **CM/OR estáticos** (confiável, ~95-97%), introduz **MOV** depois (sinais isolados, ~88%), e **ENM** por último. Um sinal só vira exercício **expressivo** (com câmera) quando o modelo atinge a meta de acurácia; até lá fica **receptivo**.

Níveis: **A1** (iniciante), **A2** (básico), **B1** (intermediário). MVP entrega **A1**.

## 2. Inventário de conteúdo - Curso A1 "Libras do Zero"

Cada sinal no bundle (`signs.json`) tem: `id`, `gloss`, `category`, `recognition` (static|dynamic), `params` (5 parâmetros), `video_url`, `video_caption`, `region`. Exemplos preenchidos:

```jsonc
{
  "id": "letra-A", "gloss": "A", "category": "alfabeto", "recognition": "static",
  "params": { "CM": "mão em punho, polegar ao lado", "PA": "espaço neutro",
              "MOV": "nenhum", "OR": "palma para frente", "ENM": "neutra" },
  "video_url": "cf://A1/v1/signs/A.mp4",
  "video_caption": "Mão direita em punho com polegar apoiado ao lado, palma voltada para frente, sem movimento.",
  "region": "nacional"
}
{
  "id": "OBRIGADO", "gloss": "OBRIGADO", "category": "cortesia", "recognition": "dynamic",
  "params": { "CM": "mão aberta", "PA": "queixo", "MOV": "afasta do queixo para frente",
              "OR": "palma para dentro -> para frente", "ENM": "leve sorriso/aceno" },
  "video_url": "cf://A1/v1/signs/OBRIGADO.mp4",
  "video_caption": "Mão aberta parte do queixo com palma para dentro e se afasta para frente, virando a palma. Expressão de leve sorriso.",
  "region": "nacional"
}
```

O campo `video_caption` e uma descricao textual do que ocorre no video de referencia. Exibido
como legenda abaixo do `SignVideoPlayer` ao toque longo no video (acessibilidade) e sempre visivel
no `RefVideoThumb` dos exercicios expressivos para usuarios surdos. Validado com a comunidade surda
junto ao video correspondente. Obrigatorio para todos os sinais do bundle antes de publicar.

### Árvore A1 (inventário-alvo do MVP)

| Unidade | Tipo reconh. | Sinais (gloss) |
|---|---|---|
| U1 Alfabeto | static (J e Z dynamic) | A..Z (26) |
| U2 Números | mix | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 (11) |
| U3 Saudações e cortesia | dynamic | OI, TCHAU, BOM-DIA, BOA-TARDE, BOA-NOITE, TUDO-BEM, PRAZER, BEM-VINDO, ATÉ-LOGO, PARABÉNS, OBRIGADO, POR-FAVOR, DESCULPA, DE-NADA, COM-LICENÇA (15) |
| U4 Apresentação | dynamic | EU, VOCÊ, ELE, NÓS, MEU, SEU, NOME, SINAL, SURDO, OUVINTE, LIBRAS, IDADE, MORAR, NASCER, CIDADE (15); soletrar nome com letras da U1 (DAVI, BIA, LIA) |
| U5 Perguntas | dynamic | O-QUE, QUEM, ONDE, QUAL, COMO, QUANDO, POR-QUE, QUANTO, SIM, NÃO, ENTENDER, SABER (12) |
| U6 Família | mix | FAMÍLIA, MÃE, PAI, FILHO, FILHA, BEBÊ, HOMEM, MULHER, IRMÃO, IRMÃ, AVÔ, AVÓ, TIO, TIA, PRIMO, MARIDO, ESPOSA (17) |
| U7 Sentimentos e estados | mix | FELIZ, TRISTE, RAIVA, MEDO, CALMO, CANSADO, DOENTE, FOME, SONO, NERVOSO, PREOCUPADO, SAUDADE, GOSTAR, AMAR (14) |
| U8 Tempo | mix | HOJE, ONTEM, AMANHÃ, AGORA, DEPOIS, ANTES, DIA, SEMANA, MÊS, ANO, SÁBADO, DOMINGO, SEGUNDA-FEIRA, TERÇA-FEIRA, QUARTA-FEIRA, QUINTA-FEIRA, SEXTA-FEIRA, MANHÃ, TARDE, NOITE, MEIO-DIA, HORA, MINUTO, JANEIRO, FEVEREIRO, MARÇO, ABRIL, MAIO, JUNHO, JULHO, AGOSTO, SETEMBRO, OUTUBRO, NOVEMBRO, DEZEMBRO (35) |
| U9 Cores | dynamic | COR, BRANCO, PRETO, VERMELHO, AZUL, AMARELO, VERDE, LARANJA, ROSA, ROXO, MARROM, CINZA (12) |
| U10 Comida e bebida | dynamic | COMER, BEBER, ÁGUA, CAFÉ, LEITE, CAFÉ-DA-MANHÃ, ALMOÇO, JANTAR, PÃO, SUCO, ARROZ, FEIJÃO, CARNE, FRANGO, PEIXE, OVO, FRUTA, MAÇÃ, BANANA, GOSTOSO (20) |
| U11 Casa e lugares | mix | CASA, QUARTO, COZINHA, BANHEIRO, SALA, CAMA, MESA, AQUI, PERTO, LONGE, ESCOLA, HOSPITAL, IGREJA, MERCADO, BANCO, RESTAURANTE, FARMÁCIA, RUA, PRAIA (19) |
| U12 Verbos do dia a dia | dynamic | IR, VIR, DAR, AJUDAR, AVISAR, ESPERAR, PERGUNTAR, RESPONDER, CONVERSAR, VER, OLHAR, ENSINAR, TRABALHAR, ESTUDAR, APRENDER, LER, ESCREVER, FAZER, DORMIR, ACORDAR, QUERER, PODER, PRECISAR, COMPRAR (24) |
| U13 Números 11 a 100 e dinheiro | dynamic | 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30, 40, 50, 60, 70, 80, 90, 100, DINHEIRO, REAL, CUSTAR, PAGAR, CARO, BARATO (24) |
| U14 Conversa e cultura surda | dynamic | AMIGO, ENCONTRAR, DEVAGAR, DE-NOVO, COMUNIDADE, CULTURA, INTÉRPRETE, LÍNGUA, ASSOCIAÇÃO, APLAUSO (10); revisão: OI, NOME, SURDO, OUVINTE, ONDE, MORAR, HOJE, TRABALHAR, ESTUDAR, CASA, COMER, OBRIGADO |

> **Nota de 2026-10-22:** o currículo A1 foi ampliado de 6 para 14 unidades (cerca de 250 sinais), conforme a tabela acima. Tudo o que está nela (sinais, parâmetros, descrições, frases de exemplo e notas de cultura em `course.json` e `signs.json`) é **rascunho** (`status: "rascunho"`, `validated: false`) até a validação pela comunidade surda. Ficaram sem sinal por falta de fonte confiável: SEDE (U7), CENTAVO (U13) e SINALIZAR (U14).

MVP mínimo jogável ponta a ponta: **U1 completa** (valida pipeline estático) + amostra de U3 (valida dinâmico). O resto entra incremental via novos bundles (SPEC 02).

## 3. Tipos de exercício (catálogo + schema)

Schema base de `exercise` no bundle:
```jsonc
{ "id": "u1-l1-ex01", "lesson_id": "u1-l1", "type": "<tipo>", "order": 1, "payload": { ... } }
```

O bundle tem um arquivo por lição (`apps/web-poc/src/assets/content/lessons/<lesson_id>.json`), gerado por script
versionado a partir de `course.json` e `signs.json` (`tools/content/build-lessons.mjs`, composição em
`tools/content/compose.mjs`; no web-poc: `npm run content`, e `npm run content:check` no `prebuild`). O app carrega
o arquivo só quando a lição abre. O bundle fixa a **composição** (quais exercícios, em que ordem, com quais
sinais); o app sorteia a cada lição aberta o que precisa variar: distratores e ordem das opções, ordem das
demonstrações do `word_choose_video`, distratores e ordem dos blocos da frase.

Nomes finais (decisão 10 do `plano-mobile-web.md`): `intro` virou `sign_intro`; `mc4` foi fundido em
`watch_choose_word` (mesmo payload: sinal + 4 glosas); `sign_camera` virou `perform_sign`.

### Apresentação
| type | payload |
|---|---|
| `sign_intro` | `{ sign_id }` (passo "apresenta" da regra de composição: vídeo ou avatar, glosa e parâmetros) |

### Receptivos (sem câmera - fáceis de produzir, fallback de acessibilidade)
| type | payload |
|---|---|
| `watch_choose_word` | `{ sign_id, correct, options[]? }` (`options` opcional: sem ele, o app sorteia 3 distratores, da mesma categoria primeiro, e embaralha; com ele, só embaralha) |
| `word_choose_video` | `{ word, video_options[], correct_sign_id }` (4 sinais em `video_options`, o certo entre eles; os distratores preferem sinais da lição já apresentados, depois sinais da mesma categoria de lições anteriores; o app só embaralha a ordem) |
| `match_pairs` | `{ pairs: [{sign_id, gloss}] }` |
| `order_sequence` | `{ steps: [...], correct_order: [...], word? }` (`word`: soletração sem câmera; o app gera este formato a partir do `fingerspell` quando a câmera não avalia todas as letras) |
| `build_phrase` | `{ pt, glosses[], distractors[], source }` (U3 em diante: 1 frase da unidade por lição; monta as glosas na ordem da Libras tocando nos blocos. `distractors` são os candidatos, glosas das outras frases da unidade que não repetem a frase; o app sorteia 2 em frases de até 4 glosas e 1 nas maiores) |

### Expressivos (com câmera - o diferencial)
| type | payload |
|---|---|
| `perform_sign` | `{ sign_id, recognition: "static"\|"dynamic", min_confidence, max_attempts, hint_video_url }` (`min_confidence` e `max_attempts` ficam `null`, padrão do reconhecedor, até a calibração da seção 5.3) |
| `fingerspell` | `{ word, letters[], per_letter_confidence, own_name? }` (nomes da U4 e palavras de revisão do alfabeto; `per_letter_confidence` fica `null` até a calibração. Com a câmera só quando o classificador em uso avalia todas as letras da palavra; senão o app mostra como `order_sequence`. `own_name: true` é o "soletre seu nome": o app troca a palavra pelo primeiro nome do perfil e `word` fica de reserva, ver seção 5.4) |
| `mirror_practice` | `{ sign_id }` (prática livre, sem nota) |

**Regra de composição da lição**: toda lição mistura receptivo + expressivo, na sequência apresenta (vídeo) ->
reconhece receptivo -> produz expressivo, com a frase no fim. Receptivo cobre quem está sem câmera. A sessão tem
**de 7 a 12 exercícios** (seção 4; a única exceção é o `match_pairs` dividido do item 2), gerada por
`composeLessonExercises` em `tools/content/compose.mjs`:

1. **Apresenta e reconhece.** Cada sinal novo ganha um `sign_intro` e, logo depois, um exercício receptivo próprio,
   alternando `watch_choose_word` (vê o sinal, escolhe a palavra) e `word_choose_video` (vê a palavra, escolhe o
   sinal). Sinal de revisão, já apresentado em lição anterior (U4 L4 e U14 L3 e L4), não repete o `sign_intro`:
   ganha só o receptivo.
2. **Agrupa quando não cabe.** Se a lição passaria de 12 (6 sinais novos, ou 5 com a frase), os últimos 3 ou 4
   sinais dividem um `match_pairs` no lugar dos receptivos individuais; os `sign_intro` deles vêm antes do
   `match_pairs`. O tamanho do grupo é o menor que faz a lição caber (mínimo 3, máximo 4; até 6 na lição com
   `produce`, item 3). Um `match_pairs` nunca passa de 4 pares (com 6 letras ele ocupava cerca de 2,4 telas no
   celular): grupo maior é dividido em `match_pairs` equilibrados (6 viram 3 + 3, 5 viram 3 + 2), cada um logo
   depois dos `sign_intro` dos seus sinais. Só nesse caso a lição passa de 12, com um exercício a mais por grupo
   extra (hoje só a U1 L5, com 13).
3. **Produz.** 2 `perform_sign` com sinais novos da lição (estáticos primeiro, que a câmera tem mais chance de
   avaliar). A lição pode listar em `produce` (course.json) quais sinais a pessoa faz na câmera: as do alfabeto
   listam cada letra que o modelo lê bem (ver abaixo). Depois vêm os `fingerspell`, um por palavra de
   `spellWords` (nomes da U4, palavras de revisão no fim das lições do alfabeto) e, se a lição tiver
   `spellOwnName`, o "soletre seu nome". Na lição de nomes da U4, sem `produce`, os `fingerspell` fazem o papel do
   `perform_sign`. Se nem agrupando a lição coubesse, a produção sem lista cairia para 1 `perform_sign`; se ainda
   assim não coubesse, o script falha e pede para dividir a lição (nenhuma lição do A1 chega nisso: elas têm de 4
   a 6 sinais). O script também falha se uma palavra soletrada usa letra que ainda não teve `perform_sign` até a
   lição: a soletração só pede letras já ensinadas e que a câmera lê bem.
4. **Frase.** Da U3 em diante, o `build_phrase` fecha a sessão.

**Câmera no alfabeto** (plano `plano-licoes-pos-treino.md`, seção 1): cada lição da U1 tem `perform_sign` para as
letras que o modelo v6 lê com 80% ou mais no teste fixo (C, D, E, H, I, O, S, W, Y), além das 10 que já tinham
(A, B, F, G, K, L, P, Q, U, V; F, Q e U ficaram abaixo de 80% e seguem em observação; o U saiu da U1 L5 para dar lugar ao X). M, N, R e T entram quando
passarem de 80%. As letras com movimento (H, J, K, X, Z e Ç) têm um modelo próprio, que lê a forma da mão e o
movimento (`ml-training/train_letras_mov.py`, spec-01 seção 3.3): quando ele está publicado em
`public/ml/letras-mov/`, o `perform_sign` de H, K, J e X usa esse modelo (só as letras de `camera_letters` do
`model.json`, que passaram de 70% com pessoas nunca vistas); sem ele, H e K seguem com o modelo das letras paradas e J
vira prática livre. J está no `produce` da U1 L2 e X no da U1 L5 (no lugar do U: a lição só cabe 4 letras com
câmera); Z ficou abaixo de 70% e segue como prática livre; Ç não tem lição. Para acrescentar uma letra, basta pô-la no
`produce` da lição em que ela é ensinada. As palavras de revisão usam só letras com câmera até a lição: CHEGA
(U1 L2), BOLO (U1 L3), SAPO (U1 L4) e YAGO (U1 L5); a U1 L1 não tem, para a primeira lição começar leve (as letras
dela voltam em CHEGA).

Lição que ficasse com menos de 7 ganharia uma rodada de `watch_choose_word` antes da frase (não acontece no A1).

Exemplos (bundle atual):

| Lição | Sinais | Sequência | Total |
|---|---|---|---|
| U1 L1 (A, B, C, D, E) | 5 novos, sem frase, `produce` A a E | intro A, watch A, intro B, C, D e E, match_pairs dos 4, perform A, B, C, D e E | 12 |
| U1 L5 (U, V, W, X, Y, Z) | 6 novos, `produce` V, W, X e Y, revisão YAGO | intro U, V e W, match_pairs dos 3, intro X, Y e Z, match_pairs dos 3, perform V, W, X e Y, fingerspell YAGO | 13 |
| U3 L1 (OI, TCHAU, BOM-DIA, BOA-TARDE, BOA-NOITE) | 5 novos + frase | intro e watch OI, intro e word_choose_video TCHAU, intro BOM-DIA, BOA-TARDE e BOA-NOITE, match_pairs dos 3, perform OI, perform TCHAU, build_phrase | 11 |
| U6 L1 (FAMÍLIA, MÃE, PAI, FILHO, FILHA, BEBÊ) | 6 novos + frase | intro e watch FAMÍLIA, intro e word_choose_video MÃE, intro PAI, FILHO, FILHA e BEBÊ, match_pairs dos 4, perform FAMÍLIA, perform MÃE, build_phrase | 12 |
| U4 L4 (D, A, V, I, B, L; nomes DAVI, BIA, LIA e o da pessoa) | 6 de revisão + frase | watch e word_choose_video alternados para os 6 sinais, fingerspell DAVI, BIA e LIA, "soletre seu nome" (reserva LIDIA), build_phrase | 11 |
| U14 L3 (OI, NOME, SURDO, OUVINTE, ONDE, MORAR) | 6 de revisão + frase | 6 receptivos alternados, perform OI, perform NOME, build_phrase | 9 |

**Revisão fora da lição**: a repetição do mesmo sinal várias vezes saiu da lição e fica na prática diária (aba
Praticar, seção 11.12). Todo sinal da lição tem ao menos um exercício com nota (o receptivo individual ou o
`match_pairs`, em que quem errou o par revisa mais cedo), e o resultado vai para o SRS (seção 6) ao concluir a
lição; no dia seguinte a fila da prática traz todos os sinais da lição. O teste de conteúdo do web-poc confere isso
lição por lição.

**Câmera que não avalia o sinal**: se o reconhecedor do aparelho não dá nota para o sinal (hoje, letras estáticas
fora da lista do reconhecedor, números e sinais com movimento; e qualquer sinal em aparelho no modo receptivo), o
app mostra o `perform_sign` como `mirror_practice` e pula a prática livre repetida do mesmo sinal. Assim ninguém
perde ponto por um erro que não cometeu, e o bundle não precisa ser gerado de novo quando o reconhecedor passar a
conhecer mais sinais.

## 4. Estrutura de uma sessão (lição)
- 7-12 exercícios, dificuldade crescente, tipos misturados, na sequência apresenta -> reconhece -> produz -> frase
  (regra de composição na seção 3; a lição com `match_pairs` dividido em dois grupos fica com 13, como a U1 L5). O teste `content.test.ts` do web-poc garante os limites em todas as lições, com
  e sem câmera avaliada (quando o `perform_sign` vira `mirror_practice` e o `fingerspell` vira `order_sequence`, a
  contagem não muda).
- Toda lição apresenta (`sign_intro`) todos os seus sinais novos e reconhece cada sinal ao menos uma vez com nota.
- **Revisão SRS** (sinais devidos, seção 6) fica na prática diária (aba Praticar, seção 11.12), não dentro da lição:
  a lição só reconhece cada sinal uma vez, e a repetição espaçada acontece nos dias seguintes.
- Barra de progresso; **sem vidas** (decisão SPEC 02): erro vira nova tentativa com dica.
- Tela final: XP, streak, sinais aprendidos/revisados.
- `lesson_completed{score,xp}` enviado ao backend (SPEC 02 calcula XP/streak/SRS/conquistas).

## 5. Avaliação do sinal (rubrica calibrável)

A premissa vem da Camada 1: dinâmico acerta ~88%, então **avaliação não é binária**.

### 5.1 Estados de resultado (não só certo/errado)
| Estado | Quando | Ação |
|---|---|---|
| `correct` | confidence >= limiar do sinal | acerto, +XP |
| `retry` | confidence abaixo, mas houve mão detectada | dica construtiva + nova tentativa (não conta como falha definitiva) |
| `no_capture` | sem mão / luz ruim / mão cortada | orientar enquadramento; **não** conta erro |
| `accept_soft` | perto do limiar após N tentativas | aceita com feedback "quase lá, atenção em X" |

### 5.2 Lógica (estático)
```ts
function evaluatePerformSign(scoreStream, payload) {
  const s = peakStableConfidence(scoreStream, payload.sign_id); // mão parada ~400ms
  if (s.signMissing) return { state: 'no_capture', coach: 'Posicione a mão no quadro' };
  if (s.lowLight)    return { state: 'no_capture', coach: 'Procure mais luz' };
  if (s.confidence >= payload.min_confidence) return { state: 'correct', confidence: s.confidence };
  return { state: 'retry', confidence: s.confidence, coach: nearestErrorHint(s, payload.sign_id) };
}
```
- `nearestErrorHint`: compara landmarks do aluno com o protótipo do sinal e gera dica por parâmetro ("abra mais os dedos" = CM; "vire a palma" = OR).
- **Dinâmico**: avalia a janela temporal completa; tolera velocidade (DTW contra protótipo como sinal auxiliar); mesma máquina de estados.

### 5.3 Limiares por sinal, não global
`min_confidence` mora no payload do exercício e é **calibrado com dados reais**, não chutado:
- Coletar distribuição de confidence de acertos vs erros por sinal (via telemetria, SPEC 02).
- Escolher limiar que equilibra falso-aceite e falso-rejeite (alvo inicial: priorizar não frustrar => tolerante).
- Sinais difíceis ganham limiar mais baixo + mais tentativas; reavaliar com o tempo.

### 5.4 Soletração (`fingerspell`)
- Avalia letra a letra (estático) em sequência; aceita a palavra se cada letra passou `per_letter_confidence`; permite repetir letra que falhou sem reiniciar a palavra.
- Letra igual à anterior (o SS de OSSO) só conta de novo depois que a mão sai do quadro ou muda de forma (seção 11.8).
- Só usa a câmera em palavra cujas letras o classificador em uso avalia; senão vira `order_sequence`.
- A pausa entre letras (a classe "nenhuma letra" do modelo, ou a mão fora do quadro) chega como leitura vazia: não
  conta como letra, não volta a palavra e libera a letra repetida.
- **Soletre seu nome** (U4 L4, `own_name`): o app pega o nome que a pessoa deu no onboarding (`librax_displayName`
  no aparelho, então funciona offline e sem conta), fica com o primeiro nome, passa para caixa alta, tira os acentos
  (Á vira A, mas Ç continua Ç) e guarda só as letras (`ownNameLetters` em `src/lib/fingerspell.ts`). Se o nome
  ficar vazio ou com uma letra, tiver mais de 8 letras ou tiver J, Z ou Ç (letras com movimento, que a câmera não
  avalia), o exercício usa a palavra de reserva do bundle (LIDIA) como uma soletração comum. Nomes com letras que o
  modelo ainda lê mal (M, N, R, T, X) seguem com a câmera; a pessoa pode pular.

## 6. Repetição espaçada (algoritmo concreto - SM-2 adaptado)

Item por `(usuário, sinal)` na tabela DynamoDB (`SRS#<signId>`, SPEC 02). Campos: `ef` (easiness, inicia 2.5), `interval` (dias), `reps`, `dueAt`.

```ts
// quality q em 0..5 derivada do resultado da avaliação:
//   correct alta confidence = 5; correct = 4; accept_soft = 3; retry resolvido = 2; falhou = 0-1
function updateSRS(item, q, today) {
  if (q < 3) { item.reps = 0; item.interval = 1; }       // errou: revisa amanhã
  else {
    item.ef = Math.max(1.3, item.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    item.reps += 1;
    item.interval = item.reps === 1 ? 1 : item.reps === 2 ? 3 : Math.round(item.interval * item.ef);
  }
  item.dueAt = addDays(today, item.interval); // grava no fuso do usuário
  return item;
}
```
- A montagem da sessão (Lambda `getDailyQueue`, SPEC 02) puxa itens com `dueAt <= hoje` (GSI1), prioriza menor `ef`/maior atraso, e completa com conteúdo novo até o tamanho da lição.
- Evoluir para half-life regression quando houver volume de dados (mais preciso para previsão de esquecimento).

## 7. Teste de nivelamento (placement)
- Opcional no onboarding; pula unidades que o usuário já domina.
- Formato: ~10-15 itens crescentes, mistura receptivo (rápido) + alguns `perform_sign`.
- Resultado mapeia para o ponto de entrada na árvore (ex.: "já sabe alfabeto -> começa em U3") e semeia o SRS dos sinais demonstrados.

## 8. Produção de conteúdo (pipeline + comunidade surda)

**Não negociável**: vídeos de referência, glosas, os 5 parâmetros e a validação dos sinais são feitos **com pessoas surdas e profissionais/intérpretes de Libras**. Razões: correção linguística e legitimidade do produto.

Pipeline operacional (liga-se à SPEC 02 - bundle em S3):
1. Equipe de conteúdo edita uma planilha/JSON de autoria (gloss, categoria, parâmetros, arquivo de vídeo).
2. Gravação dos vídeos de referência com sinalizantes surdos.
3. Script de build valida contra schema, sobe vídeos ao S3, gera `course.json`/`signs.json` versionado.
4. Revisão linguística (comunidade surda) aprova antes do publish.
5. Publish para CloudFront; app baixa nova versão.

**Formato dos vídeos de referência** (mobile web, mesmo arquivo para iPhone e Android):
- H.264 em MP4, com o índice no início do arquivo (faststart, `-movflags +faststart`), para começar a tocar antes de baixar tudo e aceitar Range requests do Safari.
- Resolução de 360p a 480p, enquadrando mãos, rosto e tronco.
- Duração de 2 a 3 s por sinal, sem áudio.
- Até 400 KB por sinal. O script de build (passo 3) reprova o arquivo que passar disso.
- Um quadro estático do sinal exportado como pôster (imagem leve), usado nas telas que mostram vários sinais ao mesmo tempo (11.4).

**Variação regional**: definir cedo o padrão ensinado; marcar variantes em `signs.region`; permitir, no futuro, escolher região.

## 9. Acessibilidade e inclusão
- Público adulto, muitos com vínculo pessoal com a surdez: tom respeitoso, sem infantilizar.
- **Modo sem câmera completo**: dá para progredir só com exercícios receptivos.
- Sem depender de áudio para nenhuma instrução crítica (parte do público pode ser surda).
- Legendas, alto contraste, fontes grandes, leitor de tela onde fizer sentido.

## 10. Como as 3 camadas se fecham (ciclo)
- Camada 1 define **o que é avaliável** (estático antes de dinâmico) -> ordena o currículo (seção 1-2).
- Camada 3 gera **telemetria de confidence por sinal** -> Camada 2 mede -> realimenta Camada 1 (mais dados para sinais fracos) e a calibração de limiares (seção 5.3).
- Um sinal "promovido" para expressivo só entra quando passa a meta de acurácia da SPEC 01.

## 11. Frontend - telas de curriculo e exercicios

### 11.1 CourseMapScreen (aba Aprender - tela principal)

**Acesso:** aba "Aprender" (tela raiz). Mapa da arvore de unidades e licoes.

**Componentes:**
- `TopBar`: titulo do curso "A1: Libras do Zero"; icone de chama com contagem de dias; badge de XP total.
- `DailyGoalBar` (abaixo da `TopBar`): barra horizontal com progresso XP do dia; texto "<X> / <meta> XP hoje". Quando meta atingida: troca o texto por "Meta de hoje concluida!" com icone de confirmacao e a barra preenchida.
- `StreakAtRiskBanner` (condicional, abaixo da `DailyGoalBar`): faixa amarela com texto "Sua sequencia de <N> dias esta em risco! Estude antes da meia-noite." Aparece se >= 20h no fuso do usuario e o dia atual nao tem estudo registrado.
- `UnitSection` (por unidade): rotulo (ex.: "U1 Alfabeto manual"), estrelas agregadas, trilha de `LessonNode`.
- `LessonNode`: no tocavel por licao, com indicador de estado.
- `ResumeBanner` (rodape fixo): exibe a proxima licao disponivel ou a ultima incompleta.

**Estados (LessonNode):**
| Estado | Aparencia | Toque |
|---|---|---|
| `locked` | cinza com cadeado | inerte; desbloqueia ao concluir a anterior |
| `available` | colorido | abre LessonScreen (11.2) |
| `completed` | estrelas 1-3 (proporcional ao melhor score) | dialogo "Refazer licao" ou "Revisar sinais" (SRS rapido) |
| `due_srs` | borda pulsante | abre LessonScreen priorizando a revisao SRS |

**Estados (ResumeBanner):**
| Estado | Condicao | Texto |
|---|---|---|
| normal | dia sem estudo ou meta nao atingida | "Retomar: <titulo da proxima licao>" |
| meta atingida | XP do dia >= `dailyGoalXp` | "Meta concluida! Continue praticando" (com icone de confirmacao) |
| curso concluido | todas as licoes do curso completadas | "Revisar: <N> sinais pendentes no SRS" |

**Acoes:**
| Acao | Resultado |
|---|---|
| icone de chama | abre StreakScreen (SPEC 02 secao 12.5) |
| badge de XP | abre ProfileScreen (SPEC 02 secao 12.4) |
| `ResumeBanner` | abre a ultima licao incompleta, a proxima disponivel, ou o DailyQueueScreen (estado curso concluido) |
| `StreakAtRiskBanner` | abre StreakScreen (SPEC 02 secao 12.5) |

### 11.2 LessonScreen (container do fluxo de exercicios)

**Acesso:** toque em licao `available`/`completed`/`due_srs` no CourseMapScreen; "Iniciar revisao" no DailyQueueScreen (11.12).

**Componentes:**
- `AppBar`: botao sair "<"; `LessonProgressBar` "<i> / <n>".
- `ExerciseSlot`: renderiza o exercicio atual conforme o `type` (11.3-11.9).

**Estados:**
| Estado | O que muda |
|---|---|
| em andamento | exibe o exercicio atual; barra avanca a cada conclusao |
| confirmando saida | dialogo "Sair da licao? Voce perdera o progresso desta tentativa." -> "Ficar" / "Sair" |
| concluida | ultimo exercicio respondido -> LessonCompletionScreen (11.10) |

**Regras:**
- 7-12 exercicios, tipos misturados, dificuldade crescente, revisao SRS intercalada (secao 4).
- Transicao: slide horizontal (proximo) ou fade (feedback).
- Sem vidas: erro nunca encerra a licao (SPEC 02 secao 5.3).

### 11.3 Exercicio: watch_choose_word (receptivo)

**Enunciado:** "Qual e este sinal?"

**Componentes:** `SignVideoPlayer` (loop; toque pausa/retoma) + botao "Ver de novo"; grade de 4 `OptionButton` com as glosas (`options`).

**Estados (OptionButton apos toque):**
| Estado | Aparencia | Avanco |
|---|---|---|
| correto | verde | auto-avanca em 1s |
| errado | vermelho; a opcao correta fica verde | aguarda toque para avancar |

**Regra:** sem penalidade por erro (sem vidas - SPEC 02 secao 5.3). `payload`: `{ sign_id, options[], correct }`.

### 11.4 Exercicio: word_choose_video (receptivo)

**Enunciado:** "Qual e o sinal de <PALAVRA>?"

**Componentes:** 4 `VideoOption`, cada um mostrando o poster estatico do sinal. O video so toca quando a pessoa toca na opcao (tocar em outra pausa a anterior); nunca 4 videos em loop ao mesmo tempo, que pesam no celular fraco e no download. Selecionar a opcao e um gesto separado (botao ou toque no rotulo da opcao), para ver o video nao contar como resposta.

**No web-poc** (`ExerciseWordChooseVideo`): as opcoes sao cartoes "Opcao 1" a "Opcao 4", sem a glosa, cada um com o botao de escolher (o rotulo) e o botao "Ver" separado. A demonstracao toca num palco unico acima dos cartoes, com o `SignDemo` (video, senao avatar VLibras, senao texto), uma opcao por vez: o avatar e uma instancia so (`src/lib/vlibras.ts`) e so carrega quando a pessoa toca em "Ver". Opcao sem video nem avatar (ou com o avatar em erro) mostra a descricao no proprio cartao, com a glosa da opcao e a palavra do enunciado mascaradas (`maskGloss`). Depois da resposta, os cartoes mostram as glosas.

**Feedback:** identico ao 11.3 (verde/vermelho, mesma regra de avanco). `payload`: `{ word, video_options[], correct_sign_id }`.

### 11.5 Exercicio: match_pairs (receptivo)

**Enunciado:** "Conecte os pares."

**Componentes:** dois paineis - esquerda (`SignThumb`, miniatura de video), direita (`GlossLabel`, texto).

**Estados:**
| Acao | Resultado |
|---|---|
| toque em um item de cada lado | tentativa de par |
| par correto | linha verde conecta os dois; itens travados |
| par errado | linha vermelha breve; itens liberados para nova tentativa |
| todos pareados | exercicio concluido |

`payload`: `{ pairs: [{sign_id, gloss}] }`.

### 11.6 Exercicio: order_sequence (receptivo)

**Enunciado:** "Ordene os passos de <SINAL>."

**Componentes:** lista de `StepCard` arrastaveis com Pointer Events (`pointerdown`/`pointermove`/`pointerup`, um so codigo para dedo e mouse, com `touch-action: none` no item arrastado para a pagina nao rolar junto); cada `StepCard` tem tambem botoes "Subir" e "Descer" (alvo de 48 px, com `aria-label`), que funcionam sem arrastar e com leitor de tela; botao "Confirmar ordem".

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| editavel | itens embaralhados | "Confirmar ordem" habilita assim que o usuario toca qualquer item |
| correto | ordem == `correct_order` | avanca |
| errado | ordem incorreta | destaca em vermelho os itens fora de lugar; aguarda nova tentativa |

`payload`: `{ steps: [...], correct_order: [...] }`.

### 11.7 Exercicio: perform_sign (expressivo)

**Enunciado:** "Faca o sinal: <ALVO>." Usa `CameraExerciseLayout` + `FeedbackOverlay` (SPEC 01 secao 9).

**Componentes (no ExercisePanel):**
- `RefVideoThumb`: video de referencia pequeno + glosa do alvo.
- `AttemptCounter`: "Tentativa <i> de <max_attempts>".
- Botao "Ver o sinal novamente".
- HUD na `CameraPane`: "Mostre a mao no quadro" / "Aguardando estabilidade..." / "<alvo> detectada!" (com confidence).

**Estados:**
| Estado | Gatilho | O que muda |
|---|---|---|
| capturando | sem mao estavel | HUD orienta enquadramento |
| avaliando | mao parada ~400ms | roda `peakStableConfidence` (SPEC 01) |
| feedback | resultado da avaliacao | sobrepoe `FeedbackOverlay` (SPEC 01 secao 9.4) |

**Acoes:**
| Acao | Resultado |
|---|---|
| "Ver o sinal novamente" | modal com o video em loop + botao "Fechar" |
| frame da camera | atualiza HUD (HandLandmarkerPlugin -> HandCameraView -> callback) |

`payload`: `{ sign_id, recognition: "static"|"dynamic", min_confidence, max_attempts, hint_video_url }`.

### 11.8 Exercicio: fingerspell (expressivo)

**Enunciado:** "Soletre: <PALAVRA>." Usa `CameraExerciseLayout` (SPEC 01 secao 9).

**Componentes (no ExercisePanel):**
- `LetterStrip`: uma celula por letra de `letters[]`, com checkmark ao confirmar.
- `CurrentLetterRef`: "Letra atual: <X>" + video de referencia da letra.
- HUD na `CameraPane`: estado da letra atual.

**Estados:**
| Estado | O que muda |
|---|---|
| letra pendente | celula vazia; avalia a letra corrente (estatico) |
| letra confirmada | celula marcada; avanca para a proxima |
| palavra concluida | todas as celulas marcadas -> `FeedbackOverlay` |

**Regra:** avalia letra a letra; cada letra precisa passar `per_letter_confidence`; pode repetir a letra que falhou sem reiniciar a palavra (secao 5.4). `payload`: `{ word, letters[], per_letter_confidence }`.

**Letra repetida:** depois de confirmar uma letra, a mesma letra so conta de novo quando a leitura estavel deixa de ser ela (a mao saiu do quadro ou mudou de forma). Assim o SS de OSSO exige fazer o S duas vezes, e a letra seguinte diferente e aceita direto. A regra e pura, em `src/lib/fingerspell.ts` (`spellStep`); o reconhecimento (`useCameraRecognizer`, `src/recognition`) nao muda. A HUD avisa "Tire a mao ou mude de forma e faca S de novo".

**Sem camera avaliada:** so entra com camera a palavra cujas letras o classificador em uso avalia (as do MLP quando existe, senao as do heuristico). Senao o exercicio vira `order_sequence` com as letras da palavra (no `resolveExercises` e, se o classificador mudar durante a licao, no proprio componente).

### 11.9 Exercicio: mirror_practice (expressivo, sem nota)

**Enunciado:** "Pratique: <SINAL>." Usa `CameraExerciseLayout` (SPEC 01 secao 9).

**Componentes:**
- HUD/`ConfidenceBar` em tempo real (decorativa, nao reprova).
- `RefVideoThumb` + glosa.
- Texto "Pratique a vontade, sem avaliacao.".
- Botao "Pronto".

**Acoes:**
| Acao | Resultado |
|---|---|
| "Pronto" | avanca sem avaliar (aquecimento antes de perform_sign) |

`payload`: `{ sign_id }`.

### 11.10 LessonCompletionScreen

**Acesso:** apos o ultimo exercicio da licao (ou da fila SRS).

**Componentes:**
- Animacao celebratoria + titulo "Licao concluida!".
- `XpGainAnimation`: "+<N> XP" subindo para a barra.
- `StreakRow`: "Sequencia: <N> dias".
- `DailyGoalBar`: progresso "<Y> / <X> min".
- `SignsPracticedRow`: icones dos sinais praticados/revisados.
- Botao "Continuar".

**Sequencia de overlays e navegacao (ordem estrita):**
| Passo | Condicao | O que aparece | Momento |
|---|---|---|---|
| 1 | conquista desbloqueada na licao | bottom sheet celebratorio (badge animado) | ANTES desta tela |
| 2 | meta diaria atingida | banner "Meta de hoje concluida!" | NESTA tela |
| 3 | primeira licao de convidado | ConvertAccountSheet (SPEC 02 secao 12.2) | APOS toque em "Continuar" nesta tela |
| 4 | ultima licao da ultima unidade do curso | CourseCompletionScreen (11.15) | APOS o passo 3 (ou direto se nao e convidado) |
| 5 | ultima licao de uma unidade intermediaria | UnitCompletionScreen (11.13) | APOS o passo 3 (ou direto se nao e convidado) |

Passos 4 e 5 sao mutuamente exclusivos. Se a licao nao e a ultima de uma unidade, o app volta ao CourseMapScreen apos o passo 3.

**Regra:** `lesson_completed{score,xp}` enviado ao backend (SPEC 02 calcula XP/streak/SRS/conquistas). O campo `unit_completed` e incluido na resposta quando a unidade e concluida pela primeira vez, permitindo ao app acionar o fluxo correto.

### 11.11 PlacementTestScreen

**Acesso:** opcional no onboarding.

**Componentes:**
- `AppBar`: "Teste de nivelamento" + progresso "<i> / 12".
- `ExerciseSlot` reusado do LessonScreen (sequencia de ~12 exercicios mistos crescentes).
- Botao "Pular - comecar do inicio".
- `ResultView` (ao final): "Voce vai comecar em: <Unidade>" + botoes "Aceitar" / "Comecar do inicio".

**Acoes:**
| Acao | Resultado |
|---|---|
| "Pular" | encerra o teste; usuario comeca em U1 |
| "Aceitar" | entra no ponto mapeado e semeia o SRS com os sinais demonstrados |
| "Comecar do inicio" | ignora o resultado; comeca em U1 |

**Regra:** mistura receptivo (rapido) + alguns `perform_sign`; o resultado mapeia para o ponto de entrada na arvore (secao 7).

### 11.12 DailyQueueScreen (aba Praticar)

**Acesso:** aba "Praticar" (tela raiz).

**Componentes:**
- `DueHeader`: "Revisao de hoje - <N> sinais pendentes".
- Lista de `SrsItemTile`: icone do sinal, glosa, "Visto ha <N> dias".
- Botao primario "Iniciar revisao".
- `FreePracticeCard`: "Pratique sinais que voce ja conhece" + botao "Pratica livre".

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| com pendencias | ha itens SRS devidos | lista + "Iniciar revisao" |
| sem pendencias | nenhum item devido | empty state "Nao ha nada para revisar hoje!" + somente "Pratica livre" |

**Acoes:**
| Acao | Resultado |
|---|---|
| "Iniciar revisao" | abre LessonScreen com a fila do Lambda `getDailyQueue` (SPEC 02 secao 6) |
| "Pratica livre" | abre LessonScreen com sinais ja concluidos em ordem aleatoria, sem afetar o SRS |

### 11.13 UnitCompletionScreen

**Acesso:** automatico apos o toque em "Continuar" na LessonCompletionScreen quando a licao concluida era a ultima de uma unidade (nao a ultima do curso). O backend sinaliza isso via campo `unit_completed` na resposta do `lesson_completed`.

**Componentes:**
- Animacao comemorativa + `UnitHero`: titulo "Unidade <N> concluida!" + subtitulo com o nome da unidade (ex.: "Alfabeto manual").
- `StatsRow`: "<N> sinais aprendidos nesta unidade", "<N> XP ganhos", "<N> licoes concluidas".
- `NextUnitPreview`: card com titulo "A seguir: Unidade <N+1> - <Nome>" + descricao curta da proxima unidade (extraida do bundle do curso).
- Botao primario "Continuar para U<N+1>" -> volta ao CourseMapScreen com scroll automatico para a proxima unidade desbloqueada.

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| unidade intermediaria | ainda ha unidades seguintes bloqueadas | exibe `NextUnitPreview` e botao "Continuar para U<N+1>" |
| ultima unidade do curso | U6 concluida | este estado nao ocorre; o fluxo vai para CourseCompletionScreen (11.15) |

**Acoes:**
| Acao | Resultado |
|---|---|
| "Continuar para U<N+1>" | retorna ao CourseMapScreen; scroll automatico exibe a unidade recem-desbloqueada |
| botao voltar no AppBar | retorna ao CourseMapScreen sem scroll especial |

**Regra:** se a conclusao da unidade tambem desbloqueia uma conquista (ex.: "Completou o Alfabeto"), o bottom sheet de conquista (secao 12.6 da SPEC 02) ja foi exibido antes da LessonCompletionScreen, portanto nao reaparece aqui.

---

### 11.14 DynamicSignIntroSheet

**Acesso:** bottom sheet automatico, exibido uma unica vez imediatamente ao iniciar a primeira licao de uma unidade com `recognition: "dynamic"` (a partir de U3). Controlado pela flag local `dynamicIntroSeen` (armazenada no `localStorage` como `librax_dynamicIntroSeen`, ver `apps/web-poc/src/lib/flags.ts`; nao precisa de servidor).

**Componentes:**
- Titulo: "Chegou a hora dos sinais com movimento!"
- Descricao: "A partir desta unidade voce vai praticar sinais que usam movimento das maos e do corpo. O reconhecimento considera a trajetoria completa do sinal, entao faca o movimento com naturalidade."
- `DynamicExampleThumb`: miniatura de video loop de um sinal dinamico simples (ex.: OI) com o esqueleto de pontos sobreposto, ilustrando o movimento.
- Texto de conforto: "O Librax e tolerante com a velocidade: faca o sinal no seu ritmo."
- Botao primario "Entendido, vamos la!" -> fecha o sheet e inicia a licao normalmente.

**Regra:** o sheet e exibido ANTES do primeiro exercicio da LessonScreen, logo apos a LessonScreen ser aberta. Ao fechar, a flag `dynamicIntroSeen` e gravada e o sheet nunca mais aparece, mesmo que o usuario entre em outras unidades dinamicas.

---

### 11.15 CourseCompletionScreen

**Acesso:** automatico apos o toque em "Continuar" na LessonCompletionScreen quando a licao concluida era a ultima do curso (ultima licao de U14). Substitui o UnitCompletionScreen neste caso.

**Componentes:**
- Animacao de confete por toda a tela + `CourseHero`: titulo "Voce completou A1: Libras do Zero!".
- `CompletionStats`:
  - "<N> sinais aprendidos"
  - "<N> dias de sequencia maxima"
  - "<N> XP total ganhos no curso"
- `ShareButton`: "Compartilhar conquista" -> Web Share API com arquivo: `navigator.share({ files: [certificado.png], text: "Aprendi Libras basica com o Librax! (A1 completo)" })`, com a imagem de certificado gerada localmente num Canvas (`toBlob`, sem enviar dados ao servidor). Antes, conferir `navigator.canShare({ files })`. Se o navegador nao compartilhar arquivo, o botao vira "Baixar certificado" (download do PNG) e o texto vai para a area de transferencia.
- `NextStepsCard`: titulo "O que vem a seguir?" com duas opcoes:
  - Botao "Revisar o que aprendi" -> navega para DailyQueueScreen (11.12).
  - Botao "A2: Libras Basica - Em breve" (desabilitado, com badge "Em breve"). Quando o curso A2 estiver disponivel no bundle, este botao e habilitado e navega para o CourseMapScreen do A2.
- Botao textual "Ver meu perfil" -> navega para ProfileScreen (SPEC 02 secao 12.4).

**Regra de exibicao unica:** no web-poc a flag fica no `localStorage` do navegador (`librax_courseA1Completed`, via `Flags.setCourseA1Completed` em `src/lib/flags.ts`), gravada por `useSession` (`src/hooks/useSession.tsx`) na primeira vez que a ultima licao e concluida, junto com a exibicao da tela. Se o usuario refizer a ultima licao, a tela nao reaparece; o fluxo pos-LessonCompletionScreen volta ao CourseMapScreen normalmente. Por ser local, a flag nao acompanha a pessoa em outro aparelho; gravar `course_A1_completed` no perfil (DynamoDB) pelo Lambda continua como evolucao quando o servidor passar a decidir essa tela.

**Analytics:** `course_completed{courseId: "A1", xpTotal, signsLearned, streakAtCompletion}` disparado ao exibir esta tela.

**Regra de conquista:** a conquista "A1 Completo" e concedida pelo Lambda (mesmo fluxo das outras conquistas, SPEC 02 secao 5.4 e 12.6) e seu bottom sheet celebratorio ja foi exibido antes da LessonCompletionScreen, portanto nao reaparece aqui.

---

### 11.16 Adicao a definicao de pronto desta camada

- CourseMapScreen com arvore de unidades, estrelas por licao, `DailyGoalBar`, `StreakAtRiskBanner` e banner "Retomar" com estados corretos.
- LessonScreen gerenciando sequencia de ate 12 exercicios com progresso.
- Todos os 7 tipos de exercicio implementados (secoes 11.3 a 11.9).
- LessonCompletionScreen com animacao de XP, integracao com conquistas, meta e gatilhos de conclusao de unidade/curso.
- PlacementTestScreen com tela de resultado e semeio do SRS.
- DailyQueueScreen exibindo itens SRS devidos e pratica livre.
- UnitCompletionScreen com stats da unidade e preview da proxima.
- DynamicSignIntroSheet exibido na primeira licao com sinais dinamicos.
- CourseCompletionScreen com celebracao, compartilhamento e navegacao pos-curso.

## 12. Definição de pronto (Camada 3)
- `signs.json` da U1 (alfabeto) com os 5 parâmetros e vídeos validados pela comunidade surda.
- Schemas de exercício implementados no app (4 receptivos + 3 expressivos).
- Máquina de estados de avaliação (`correct`/`retry`/`no_capture`/`accept_soft`) integrada ao reconhecimento (SPEC 01).
- SRS (SM-2 adaptado) calculando `dueAt` e alimentando a fila diária (SPEC 02).
- Processo de produção de conteúdo documentado e acordado com parceiros surdos.
- `lesson_completed` retorna `unit_completed` e `course_completed` para o app acionar UnitCompletionScreen e CourseCompletionScreen.
- Flag `course_A1_completed` gravada no perfil (DynamoDB) ao concluir o curso.
