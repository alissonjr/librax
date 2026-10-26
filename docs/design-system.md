# Librax - Design System

> Status: **versão aprovada** (out/2026), com a marca **Traço** aplicada em 2026-10-23 (seção 15). É a referência
> de design do produto. Substitui o manual de design de
> junho/2026, escrito para Flutter, e a proposta v0.1 que deu origem a este texto (ver seção 1).
>
> Fonte única da verdade dos valores: [`design-tokens.json`](./design-tokens.json) (formato W3C Design Tokens).
> Este documento explica o porquê e o como; o JSON guarda o quanto.
>
> Premissas do produto (decididas em out/2026, ver [`plano-mobile-web.md`](./plano-mobile-web.md)):
> - Produto **só mobile web**: abre no navegador do celular, mesma experiência em iPhone (Safari) e Android (Chrome).
>   A implementação é em **CSS custom properties**. O protótipo Flutter está congelado; gerar tema Flutter a partir
>   dos tokens continua possível, mas é opcional e não prioritário.
> - Ícones: **Material Symbols Rounded em SVG** (sai o FontAwesome do web-poc).
> - Tela da câmera: vídeo da própria pessoa com o **esqueleto 2D** por cima. O avatar 3D sai do MVP.
> - Fontes: **Anybody** (títulos, larga) e **Figtree** (texto), auto-hospedadas em woff2.
> - Marca: **Traço** (estudo em [`../estudo/marca/traco.html`](../estudo/marca/traco.html) e
>   [`../estudo/identidade-visual.md`](../estudo/identidade-visual.md)).
> - MVP só em **pt-BR**.
> - Háptica nunca é essencial (iOS não vibra no navegador) e **nada depende de som**.

---

## Sumário

1. Histórico
2. Princípios, tom visual, assinatura e voz
3. Arquitetura dos tokens
4. Cor
5. Tipografia
6. Espaço, grid e layout mobile-first
7. Raio, borda e elevação
8. Iconografia
9. Motion
10. Háptica e som
11. Componentes
12. Acessibilidade e respeito à cultura surda
13. Implementação (tokens -> CSS, e opcionalmente Flutter)
14. Divergências resolvidas
15. Decisões aplicadas

---

## 1. Histórico

O primeiro manual de design (versão 1.0, junho/2026) foi escrito para o app Flutter com Material 3. Ele acertava
no tom de voz, nos estados de exercício, no "modo sem câmera" e na regra de nunca depender de áudio, mas não era
um design system operável. A avaliação feita na proposta v0.1 (out/2026) encontrou:

- nenhum token nem fonte única: valores em tabelas de Markdown, copiados à mão e com divergências para o CSS do
  web-poc e para o tema Flutter;
- protótipos que não batiam com a doc nem entre si (marca, verde de acerto, XP, abas, esqueleto da mão);
- modo escuro nunca implementado e delegado ao `fromSeed` do Material 3;
- pares de cor em uso que reprovavam no WCAG AA (por exemplo, branco sobre o verde de acerto `#10B981`, 2,54:1,
  e o laranja da streak `#FF7800` sobre branco, 2,65:1);
- público descrito como infantil, contra a visão do produto (adultos);
- peças do jogo ausentes: ligas, estados da câmera com pouca luz ou mão fora do quadro, mapa de fases e o que
  fazer quando o navegador não vibra.

Esta versão mantém o que o manual antigo tinha de bom (o tom de voz está na seção 2.5), usa a spec 05 como base
de motion, som e câmera, corrige as divergências (tabela da seção 14) e transforma tudo em tokens. O texto
completo do manual antigo e da avaliação fica no histórico do git (commit `f638aea`).

---

## 2. Princípios, tom visual, assinatura e voz

### 2.1 Princípios

1. **A mão é a protagonista.** Não há mascote. O personagem do Librax é a mão da própria pessoa, desenhada pelo
   esqueleto de pontos, e o movimento dela vira desenho: a seta de trajetória (seção 2.4). A câmera é um palco
   escuro onde a mão aparece em luz.
2. **Jogo de adulto.** Competência, ritmo e progresso real, sem fofura. Formas firmes, números grandes, celebração
   curta e precisa. Nada de bichinhos, balões de fala ou linguagem de criança.
3. **Visual primeiro.** Tudo o que importa aparece na tela: instrução, feedback, tempo, ranking. Som e vibração
   só reforçam. Uma pessoa surda com o celular no mudo tem a experiência completa.
4. **Errar é ensaio.** Erro usa framboesa (um rosa escuro, nunca vermelho e longe da tangerina da ação), nunca
   vibra, nunca toca som negativo e sempre vem com ícone, texto e uma dica do que ajustar.
5. **Libras é uma língua.** O design trata Libras com a seriedade de uma língua com gramática própria: créditos
   a quem sinaliza nos vídeos, nada de "deficiência" como enquadramento, imagens validadas pela comunidade surda.
6. **Uma fonte da verdade.** Nenhuma cor, tamanho ou duração nasce no componente. Tudo vem de token.

### 2.2 Tom visual

Personalidade do Traço: **cinético, quente, de jogo**.

- **Tangerina sobre grafite.** Neutros quentes (família `grafite`), tangerina para ação, marca e a seta de
  trajetória, **petróleo** para tudo que é mão, câmera e Libras, e ouro reservado para XP e conquistas. Acerto em
  verde; erro em framboesa, sempre com ícone e texto.
- **Contraste de energia.** Telas de navegação são calmas; câmera e celebração são o momento de luz, sempre
  sobre o palco escuro, nos dois modos. Nos exercícios com câmera a lição inteira vira palco.
- **Formas.** Botões e campos em pílula (`radius.button`), alternativas com raio 20 (`radius.choice`), cards com
  raio 22 (`radius.lg`). Botão primário com efeito "tecla" (base de 3 px que afunda ao tocar): tátil e de jogo,
  sem cartum.
- **Tipografia.** Anybody, de largura variável, nos títulos, botões, números e glosas: larga e pesada nos
  momentos de jogo (800 e 900, de 112,5% a 125% de largura). Figtree no texto, redonda e legível (400 a 700).
- **Regra: nunca usar faixa colorida lateral em cards.** Vale para borda esquerda (ou direita) grossa de destaque,
  `border-left` colorido, `box-shadow` interno simulando faixa e barra vertical de acento, em qualquer card,
  linha de lista, banner ou painel. É um clichê de interface gerada automaticamente. Para dar identidade ou estado
  a um card, use selo/chip com fundo suave, ícone, cor de fundo do card inteiro ou contorno completo. A regra
  entra no checklist da seção 12.1 e vale também para revisão de código. Faixa colorida no topo do card também
  não entra: o selo escrito diz o estado.

### 2.3 Por que tangerina e petróleo

A tangerina é a energia do jogo e a cor do movimento (a seta). Texto sobre ela é sempre grafite, nunca branco
(`#F05A0C` com `#1B1510` dá 5,32:1). O petróleo mantém o aceno à identidade surda: no Brasil, o **Setembro Azul**
é o mês de visibilidade da comunidade surda e a fita azul é o símbolo usado. Ele fica com tudo que é mão, câmera
e sinal, sem caricatura. O erro sai do coral e vai para a framboesa para não se confundir com a tangerina da
ação. Paleta e símbolo ainda precisam passar por consultores surdos (seção 15).

### 2.4 Assinatura: a seta de trajetória

O movimento do sinal vira desenho, com as setas curvas que os dicionários de Libras usam para mostrar a
trajetória da mão. **Ponto cheio** marca onde o movimento começa; **ponta de seta**, onde termina. Cinco formas:
reta, curva, circular, repetida e para a frente e para trás. Na câmera, o sinal sem movimento ganha a palavra
"parado", nunca uma seta.

| Onde | Como | Componente |
|---|---|---|
| Logo e palavra-marca | o L desenhado como um movimento: ponto inicial, descida, curva e ponta; "librax" em Anybody 900 a 125% | `BrandMark`, `Wordmark` (`src/components/Brand.tsx`) |
| Ícone do app e favicon | a mão 3D do app fazendo joinha (pele parda `#A86F4C`) sobre grafite `#1B1510`; ver 2.6 | `tools/pwa/build-icons.mjs` (`brand.icon.*`) |
| Boas-vindas | o L desenhado pelos 21 pontos da mão, com uma seta tangerina e uma petróleo | `WelcomeIllustration`, `HandSketchL` |
| Mapa | a seta gira em volta da lição atual (`motion.duration.orbit`, parada com menos movimento); trecho feito em tangerina, caminho bloqueado pontilhado | `TraceOrbit` |
| Card de continuar | arco tangerina sobre o palco | `TraceArc` |
| Barra da lição | termina numa ponta de seta | `.progress-bar-wrap--lesson` |
| Demonstração do sinal | botão "Ver o movimento" com a seta curva, sobre a tangerina suave | `SignDemo`, `DemoToggle`, `TraceArrowIcon` |
| Acerto na câmera | setas curtas em volta do cartão de acerto | `TraceCameraArcs` |
| Lição concluída | explosão de 12 setas (tangerina e petróleo) saindo do +XP; substitui o confete | `TraceBurst` |
| Ligas | seta curva para cima dentro da insígnia | `LeagueBadge` |

Tamanho mínimo do símbolo: 16 px (até 24 px o traço engrossa de 6,5 para 8 e o ponto cresce de 5 para 6). A
assinatura com o nome vale a partir de 90 px de largura. Cores da marca: `brand.ink` e `brand.mark` (mudam com o
tema) e `brand.icon.*` (fixas no ícone).

### 2.5 Voz e textos de interface

Vem do manual antigo (seção 9), ajustado para adultos e para a regra de que nada presume que a pessoa ouve.

**Princípios de linguagem**

- Falar direto com a pessoa, em "você": "Você acertou!", nunca "O usuário acertou".
- Frases curtas: até 15 palavras em feedback e 20 em instrução.
- Imperativo positivo: "Mostre o sinal", não "O usuário deverá mostrar".
- Sem palavras negativas desnecessárias no feedback; nunca "ERRADO".
- Linguagem da seção 12.2 ao falar da comunidade surda. Nada de "ouça", "escute" ou "som de acerto".
- Mesmo tom no B2C e no B2B: o que muda é o contexto (selo da organização, seção de equipes), não a voz.

**Feedback de exercício** (usado no `FeedbackOverlay`, seção 11.6)

| Situação | Texto |
|---|---|
| Acerto | varia entre "Isso aí!", "Perfeito!", "Muito bem!", "Excelente!", "Acertou!", "Correto!" |
| Erro, primeira tentativa | "Quase! Tente de novo.", "Não foi dessa vez. Tente mais uma vez." ou "Quase lá! Tente novamente." |
| Erro com resposta revelada | sempre "A resposta certa é [SINAL]. Vamos continuar!"; nunca "Você errou. A resposta é..." |
| Retry da câmera com dica | "Quase! [dica do parâmetro, ex.: Abra um pouco mais os dedos.]" |
| Retry da câmera sem dica | "Quase lá! Ajuste o sinal e tente de novo." |
| Problema de captura | textos dos estados da seção 11.7; instrucionais, nunca contam como erro |

**Instrução por tipo de exercício**

| Tipo | Instrução |
|---|---|
| `watch_choose_word` | "Qual é o significado deste sinal?" |
| `word_choose_video` | "Qual vídeo mostra o sinal de [PALAVRA]?" |
| `match_pairs` | "Relacione os sinais com os significados." |
| `perform_sign` | "Agora é sua vez. Mostre o sinal de [PALAVRA]." |
| `fingerspell` | "Soletre a palavra [PALAVRA] em datilologia." |
| `mirror_practice` | "Pratique o sinal livremente. Sem avaliação desta vez." |

**Engajamento**

- Streak ativa: "Você está em [N] dias seguidos! Continue hoje."
- Streak em risco: "Sua sequência de [N] dias está em risco. Faça uma lição."
- Streak perdida: "Sua sequência terminou. Sem problemas, comece uma nova hoje!" (nunca culpar: "Você perdeu
  sua sequência por não praticar").
- Lição concluída: "Lição concluída! +[N] XP"; primeira lição: "Primeira lição concluída! Você está aprendendo
  Libras!"; novo recorde: "Incrível! [N] dias seguidos, um novo recorde!"
- Meta do dia: "Meta do dia atingida! Até amanhã."
- Unidade concluída: "Unidade [N] concluída! Você aprendeu [lista de sinais]."

**Confirmação de ação destrutiva** (diálogo da seção 11.12): o que acontece, a consequência e botões claros.

| Ação | Título | Corpo | Botões |
|---|---|---|---|
| Sair da lição | "Sair da lição?" | "Seu progresso nesta lição será perdido." | "Continuar" / "Sair" |
| Sair de squad | "Sair de [Nome]?" | "Você perde sua posição no ranking e vai precisar de convite para voltar (se a squad for privada)." | "Cancelar" / "Sair" |
| Dissolver squad | "Dissolver [Nome]?" | "Todos os [N] membros serão removidos. Esta ação não pode ser desfeita." | "Cancelar" / "Dissolver" (perigo) |
| Regenerar código de convite | "Regenerar código?" | "O código atual ([CÓDIGO]) deixa de funcionar." | "Cancelar" / "Regenerar" |

Textos de estados vazios: os da spec 05 seção 11 (seção 11.11 abaixo).

---

### 2.6 Ícone do app: o joinha

Decidido em 2026-10-26: o ícone do app (tela inicial do iPhone, do Android e do computador, ícone adaptativo e
temático do Android, Play Store e favicon) é a **mão 3D do próprio app fazendo joinha**: punho fechado, polegar
para cima. Em Libras é o "joia/legal" e também o número 1 do curso. A palavra-marca e o símbolo (Traço) continuam
em todo o resto: abertura, cabeçalhos, landing e vídeo.

- **Render de verdade**, não desenho: a mesma mão (`mao-3d.glb`, `apps/landing/scripts/mao3d/gerar.py`) posada e
  renderizada no Blender (Cycles) por `apps/landing/scripts/mao3d/joinha.py`, em 3/4 pelo lado da palma, luz de
  estúdio suave e contorno por trás. O polegar não é torcido: a unha fica virada para o lado do pulso, como na
  mão de verdade. O polegar é 25% mais grosso que o natural para se ler nos tamanhos pequenos.
- **Pele parda** `brand.icon.skin` `#A86F4C` (o 4º tom da paleta da mão, `SKIN_TONES`) é a cor do material; no
  render, com luz e sombra, a pele vai de `#723F20` a `#C68C69` (quartis), mediana `#925633`: um pardo médio.
- **Fundo** grafite `brand.icon.bg`, com uma luz branca bem leve (7%) atrás da mão, sem gradiente de cor. A pele
  passa 4,34:1 sobre o grafite.
- **Tamanhos**: imagem-mestra em `tools/pwa/icone-joinha.png`; `npm run pwa-icons` (no web-poc) gera o favicon
  (ICO 16/32/48 e PNG 32/48: punho e polegar até a borda, o pulso sai pela direita), "any" 192/512, maskable 512
  (a mão dentro do círculo de 80%), apple-touch-icon 180 e, no Android, as camadas do ícone adaptativo por
  densidade (frente dentro do círculo de 66 dp, fundo e silhueta monocromática), os ícones antigos (quadrado e
  redondo) e o da Play Store. O `favicon.svg` continua sendo o símbolo, usado como logo no admin e no login local.

## 3. Arquitetura dos tokens

Três camadas, todas no mesmo arquivo `docs/design-tokens.json`:

| Camada | O que é | Exemplo | Quem usa |
|---|---|---|---|
| Primitivos | Paletas e escalas cruas | `color.tangerina.500 = #F05A0C`, `space.4 = 16px` | Só os tokens semânticos |
| Semânticos | Papel na interface, por modo | `theme.light.action.primary.bg -> {color.tangerina.500}` | Componentes |
| Domínio | Partes do jogo com regra própria | `stage.landmark.ready`, `league.safira.fill`, `haptic.correctCamera` | Componentes do jogo |

Regras:

- Componente nunca usa primitivo direto. Se faltar um papel, cria-se um token semântico.
- `theme.light` e `theme.dark` têm exatamente as mesmas chaves. Trocar de modo é trocar o conjunto, não o componente.
- `stage` (câmera e celebração) e `league` não mudam com o modo.
- No CSS, cada token vira `--lx-<caminho-em-kebab>`: `theme.light.feedback.success.strong` -> `--lx-feedback-success-strong`.

Formato: DTCG (W3C Design Tokens Community Group) com `$value`, `$type`, `$description` e aliases `{grupo.token}`.
Os valores estão em string (`"#F05A0C"`, `"16px"`, `"150ms"`), forma aceita pelo Style Dictionary 4 e pelo
script próprio da seção 13. A versão estável do DTCG também aceita valores em objeto (cor com espaço de cor,
dimensão com unidade); se um dia for preciso, a conversão é mecânica.

---

## 4. Cor

### 4.1 Primitivos

Valores copiados de `estudo/marca/traco.html`. Escala completa no JSON.

| Família | Papel | Valores |
|---|---|---|
| `tangerina` | ação, marca, seta de trajetória, sequência | `100 #FFE8D9`, `200 #FFA772`, `300 #FF9A5C`, `400 #FF8A45`, `450 #FF7F33`, `460 #FF7A2E` (ícone), `500 #F05A0C`, `550 #E8560A`, `600 #B8430A`, `700 #A83B00`, `750 #A33B00`, `800 #6B2600`, `900 #4A2310` |
| `petroleo` | mão, câmera, Libras | `100 #D2F1EE`, `200 #6FDCD5`, `300 #3FC9C1`, `600 #0E7C7B`, `700 #0B6463`, `800 #0F3D3B` |
| `verde` | acerto | `100 #D9F7E3`, `300 #74DE9B`, `400 #3CC873`, `600 #14834A`, `700 #126D39`, `800 #0F532C` |
| `framboesa` | erro não punitivo, perigo | `100 #FCE4EE`, `200 #FF9DBD`, `300 #FF7BA6`, `600 #B42A5E`, `700 #8F1F49`, `800 #5E1230`, `850 #5A1530` |
| `ambar` | aviso (sequência em risco, dedo a ajustar na câmera) | `100 #FFEFD1`, `300 #FFC35C`, `400 #FFAA2B`, `700 #8F5500`, `800 #663D00` |
| `ouro` | XP, conquista | `100 #FFF6CC`, `300 #FFDB4D`, `400 #FACB1E`, `600 #A98500`, `700 #7D6200`, `800 #574500` |

Neutros `grafite` (quentes): `0 #FFFFFF`, `15 #F7F2EC`, `25 #F7F5F2`, `40 #F2EFEA`, `50 #EEEAE4`, `100 #E4DED6`,
`200 #CFC7BC`, `300 #BDB2A6`, `350 #A09588`, `400 #8A7F73`, `450 #81776B`, `500 #62574C`, `600 #4A4037`,
`700 #3D352E`, `750 #2B2520`, `800 #241E19`, `850 #1E1915`, `900 #1B1510` (tinta da marca), `925 #1A1511`,
`950 #14110E`, `975 #0E0B09` (o palco), `1000 #0C0A08`.

Dois valores não estão no protótipo e foram derivados: `grafite.800 #241E19` (a elevação `bg.raised` do escuro,
entre a superfície e a borda) e `grafite.40 #F2EFEA` (o trilho das barras no claro; o `#EEEAE4` do protótipo
deixava o ouro do XP em 2,90:1 sobre o trilho, abaixo de 3:1).

### 4.2 Semânticos (claro e escuro)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `bg.canvas` | `#F7F5F2` | `#14110E` | Fundo da tela |
| `bg.surface` | `#FFFFFF` | `#1E1915` | Card, tab bar, sheet |
| `bg.raised` | `#FFFFFF` + sombra | `#241E19` | Modal, popover (no escuro a cor eleva) |
| `bg.sunken` | `#EEEAE4` | `#0C0A08` | Campo, área recuada |
| `bg.inverse` | `#1B1510` | `#F7F2EC` | Toast, tooltip |
| `bg.scrim` | `#0E0B09` 56% | `#000000` 70% | Atrás de modal |
| `text.primary` | `#1B1510` | `#F7F2EC` | Texto principal |
| `text.secondary` | `#4A4037` | `#BDB2A6` | Texto de apoio |
| `text.tertiary` | `#62574C` | `#A09588` | Placeholder, metadado (ainda AA) |
| `text.disabled` | `#81776B` | `#62574C` | Só desabilitado (isento), nunca informação |
| `text.brand` | `#A83B00` | `#FF9A5C` | Link, ação em texto, aba ativa |
| `border.subtle` / `default` / `strong` | `#E4DED6` / `#CFC7BC` / `#81776B` | `#2B2520` / `#3D352E` / `#8A7F73` | Separador, card, controle (>= 3:1) |
| `border.focus` | `#A83B00` | `#FF9A5C` | Anel de foco de 3 px |
| `action.primary.bg` / `fg` | `#F05A0C` / `#1B1510` | `#FF7F33` / `#1B1510` | Botão primário (texto sempre grafite) |
| `action.primary.bgPressed` / `base` | `#E8560A` / `#B8430A` | `#FF9A5C` / `#B8430A` | Pressionado e base da "tecla" |
| `action.secondary.fg` / `border` | `#A83B00` / `#81776B` | `#FF9A5C` / `#8A7F73` | Botão secundário |
| `action.danger.bg` / `fg` | `#B42A5E` / branco | `#FF7BA6` / `#14110E` | Ação destrutiva |
| `feedback.success.strong` / `text` / `soft` | `#14834A` / `#126D39` / `#D9F7E3` | `#3CC873` / `#74DE9B` / `#0F532C` | Acerto |
| `feedback.error.strong` / `text` / `soft` / `onSoft` | `#B42A5E` / `#8F1F49` / `#FCE4EE` / `#5E1230` | `#FF7BA6` / `#FF9DBD` / `#5A1530` / `#FCE4EE` | Erro (framboesa) |
| `feedback.warning.strong` / `text` / `soft` | `#FFAA2B` / `#8F5500` / `#FFEFD1` | `#FFAA2B` / `#FFC35C` / `#663D00` | Aviso |
| `feedback.info.soft` / `onSoft` | `#FFE8D9` / `#6B2600` | `#4A2310` / `#FFE8D9` | Selecionado (aba, opção, "Você") |
| `game.xp.fill` / `text` / `soft` | `#A98500` / `#7D6200` / `#FFF6CC` | `#FACB1E` / `#FFDB4D` / `#574500` | XP |
| `game.streak.fill` / `text` | `#E8560A` / `#A33B00` | `#FF8A45` / `#FFA772` | Sequência |
| `game.hand.fill` / `onFill` / `text` / `soft` | `#0E7C7B` / branco / `#0B6463` / `#D2F1EE` | `#3FC9C1` / `#14110E` / `#6FDCD5` / `#0F3D3B` | Mão e Libras fora da câmera; nó concluído |
| `game.trace.fill` / `text` / `soft` / `onSoft` | `#E8560A` / `#A33B00` / `#FFE8D9` / `#6B2600` | `#FF8A45` / `#FFA772` / `#4A2310` / `#FFE8D9` | Seta de trajetória, fundo da demonstração, chips de glosa |
| `game.track` | `#F2EFEA` | `#3D352E` | Trilho das barras |
| `game.progress` | `#E8560A` | `#FF8A45` | Barra da lição |
| `game.locked.bg` / `fg` | `#EEEAE4` / `#62574C` | `#2B2520` / `#BDB2A6` | Nó bloqueado (anel e cadeado) |
| `brand.ink` / `mark` | `#1B1510` / `#E8560A` | `#F7F2EC` / `#FF8A45` | Palavra-marca e símbolo |

Fixos (não mudam com o tema): `brand.icon.bg #1B1510`, `brand.icon.bgDark #0C0A08`, `brand.icon.mark #FF7A2E`,
`brand.icon.dot #FFFFFF`, `brand.icon.skin #A86F4C` (pele da mão do ícone do app).

Observações:

- Texto sobre a tangerina é sempre grafite, nos dois modos. No escuro, as cores fortes ficam claras e o texto
  sobre elas fica escuro (`#14110E`).
- O ouro no claro é um ouro velho (`#A98500`): é o único ouro que passa 3:1 sobre branco. O brilho do ouro
  (`#FACB1E`) aparece no escuro e no palco.
- `.lx-theme-dark` (gerado no `tokens.css`) aplica o tema escuro num trecho da tela nos dois modos: é como os
  exercícios com câmera viram palco inteiro.

### 4.3 Palco da câmera e das celebrações (`stage`)

Igual nos dois modos, sempre escuro.

| Token | Valor | Uso |
|---|---|---|
| `stage.bg` | `#0E0B09` | Fundo atrás do vídeo, dos exercícios com câmera e das celebrações |
| `stage.surface` / `border` | `#1A1511` / `#3D352E` | Cartão sobre o palco (acerto da câmera) |
| `stage.scrim` | `#0E0B09` 64% | Escurece o vídeo sob texto (garante 6:1 mesmo com vídeo branco) |
| `stage.pill` | `#0E0B09` 85% | Fundo das mensagens de status sobre o vídeo |
| `stage.text` / `textSecondary` | `#FFFFFF` / `#EEEAE4` | Texto no palco |
| `stage.trace` | `#FF8A45` | Seta de trajetória sobre o palco |
| `stage.landmark.halo` | `#0E0B09` 85% | Contorno sob cada linha do esqueleto (legível sobre qualquer vídeo) |
| `stage.landmark.idle` | branco 80% | Mão detectada, confiança baixa |
| `stage.landmark.tracking` | `#6FDCD5` | Confiança subindo (> 40%) |
| `stage.landmark.ready` | `#3CC873` | No limiar de aceite |
| `stage.landmark.correct` | `#74DE9B` + brilho | Acerto confirmado |
| `stage.landmark.retry` | `#FFAA2B` | Dedo a ajustar (pisca 2 vezes) |
| `stage.landmark.reference` | `#FFA772` 80%, tracejado | Esqueleto de referência no retry |
| `stage.guide.idle` / `ok` / `warn` | branco 70% / `#74DE9B` / `#FFC35C` | Guia de enquadramento |
| `stage.glow.brand` / `gold` | `#F05A0C` 30% / `#FACB1E` 35% | Brilho das celebrações |

### 4.4 Ligas (`league`)

Sete ligas, em ordem: Bronze, Prata, Ouro, Safira, Rubi, Ametista, Diamante (nomes a confirmar, seção 15).
A cor nunca vem sozinha: cada liga tem forma própria, o nome sempre escrito e, no Traço, uma seta curva para cima
dentro da insígnia, na cor do texto sobre ela.

| Liga | Preenchimento | Texto e seta sobre ela | Contorno (2 px) | Forma da insígnia |
|---|---|---|---|---|
| Bronze | `#B0703A` | `#14110E` | `#6B4A1F` | círculo |
| Prata | `#A7B2C2` | `#14110E` | `#6E7A8C` | escudo |
| Ouro | `#E0AE12` | `#14110E` | `#8A6A00` | escudo com coroa |
| Safira | `#3460E6` | `#FFFFFF` | `#1B2768` | hexágono |
| Rubi | `#CC2B57` | `#FFFFFF` | `#7A1733` | octógono |
| Ametista | `#7B4FE0` | `#FFFFFF` | `#45288F` | estrela de 5 pontas |
| Diamante | `#6FD9E8` | `#14110E` | `#1A7A88` | diamante facetado |

### 4.5 Contraste verificado

Calculado pelo `tools/tokens/check-contrast.mjs` (roda no `npm run build`) com a fórmula de luminância relativa
do WCAG 2.x sobre os valores reais do `design-tokens.json`: **267 pares, 0 reprovações**. Cores com transparência
foram compostas sobre o fundo antes do cálculo; no palco, o pior caso considerado é vídeo totalmente branco.
Mínimos: 4,5:1 para texto, 3:1 para componentes e gráficos (WCAG 1.4.11). Menor razão em texto: 4,68 (texto
sobre a insígnia Bronze); em gráfico: 3,03 (ouro do XP sobre o trilho, no claro).

Os pares novos do Traço: ícone sobre o nó concluído (`game.hand.onFill`), seta e legenda sobre a demonstração
(`game.trace.*`), botão "Ver o movimento" (grafite sobre a tangerina suave), palavra-marca e símbolo
(`brand.ink`, `brand.mark`), seta e cartão de acerto sobre o palco (`stage.trace`, `stage.surface`) e o ícone do
app (`brand.icon.*`).

| Par (frente / fundo) | Claro | Escuro | Mínimo |
|---|---|---|---|
| text.primary / bg (pior de canvas, surface, raised) | 16.62 | 14.80 | 4.5 |
| text.secondary / bg (pior de canvas, surface, raised) | 9.28 | 7.91 | 4.5 |
| text.tertiary / bg (pior de canvas, surface, raised) | 6.46 | 5.61 | 4.5 |
| text.brand / bg (pior de canvas, surface, raised) | 5.86 | 7.87 | 4.5 |
| feedback.success.text / bg (pior de canvas, surface, raised) | 5.90 | 9.93 | 4.5 |
| feedback.error.text / bg (pior de canvas, surface, raised) | 7.84 | 8.48 | 4.5 |
| feedback.warning.text / bg (pior de canvas, surface, raised) | 5.57 | 10.36 | 4.5 |
| feedback.info.text / bg (pior de canvas, surface, raised) | 5.86 | 7.87 | 4.5 |
| game.xp.text / bg (pior de canvas, surface, raised) | 5.33 | 12.15 | 4.5 |
| game.streak.text / bg (pior de canvas, surface, raised) | 6.06 | 8.65 | 4.5 |
| game.hand.text / bg (pior de canvas, surface, raised) | 6.40 | 10.10 | 4.5 |
| game.trace.text / bg (pior de canvas, surface, raised) | 6.06 | 8.65 | 4.5 |
| brand.ink / bg (pior de canvas, surface, raised) | 16.62 | 14.80 | 4.5 |
| border.strong (não texto) / bg (pior de canvas, surface, raised) | 4.03 | 4.21 | 3 |
| border.focus (não texto) / bg (pior de canvas, surface, raised) | 5.86 | 7.87 | 3 |
| action.primary.bg (não texto) / bg (pior de canvas, surface, raised) | 3.13 | 6.54 | 3 |
| feedback.success.strong (não texto) / bg (pior de canvas, surface, raised) | 4.41 | 7.61 | 3 |
| feedback.error.strong (não texto) / bg (pior de canvas, surface, raised) | 5.62 | 6.77 | 3 |
| game.xp.fill (não texto) / bg (pior de canvas, surface, raised) | 3.19 | 10.69 | 3 |
| game.streak.fill (não texto) / bg (pior de canvas, surface, raised) | 3.35 | 7.04 | 3 |
| game.hand.fill (não texto) / bg (pior de canvas, surface, raised) | 4.61 | 8.11 | 3 |
| game.trace.fill (não texto) / bg (pior de canvas, surface, raised) | 3.35 | 7.04 | 3 |
| game.progress (não texto) / bg (pior de canvas, surface, raised) | 3.35 | 7.04 | 3 |
| brand.mark (não texto) / bg (pior de canvas, surface, raised) | 3.35 | 7.04 | 3 |
| text.tertiary / bg.sunken | 5.87 | 6.73 | 4.5 |
| text.inverse / bg.inverse | 16.62 | 16.90 | 4.5 |
| action.primary.fg / action.primary.bg | 5.32 | 7.18 | 4.5 |
| action.primary.fg / action.primary.bgPressed | 4.97 | 8.64 | 4.5 |
| action.secondary.fg / action.secondary.bg | 6.38 | 8.32 | 4.5 |
| action.danger.fg / action.danger.bg | 6.12 | 7.74 | 4.5 |
| feedback.success.onStrong / feedback.success.strong | 4.80 | 8.69 | 4.5 |
| feedback.error.onStrong / feedback.error.strong | 6.12 | 7.74 | 4.5 |
| feedback.warning.onStrong / feedback.warning.strong | 9.50 | 9.89 | 4.5 |
| feedback.info.onStrong / feedback.info.strong | 6.38 | 8.98 | 4.5 |
| feedback.success.onSoft / feedback.success.soft | 8.01 | 8.01 | 4.5 |
| feedback.error.onSoft / feedback.error.soft | 10.88 | 11.02 | 4.5 |
| feedback.warning.onSoft / feedback.warning.soft | 8.30 | 8.30 | 4.5 |
| feedback.info.onSoft / feedback.info.soft | 9.35 | 11.56 | 4.5 |
| game.xp.text / game.xp.soft | 5.33 | 6.87 | 4.5 |
| game.streak.text / game.streak.soft | 5.59 | 7.16 | 4.5 |
| game.hand.text / game.hand.soft | 5.82 | 7.35 | 4.5 |
| text.primary / game.locked.bg | 15.09 | 13.59 | 4.5 |
| game.locked.fg / game.locked.bg (não texto) | 5.87 | 7.26 | 3 |
| game.progress / game.track (não texto) | 3.18 | 5.14 | 3 |
| game.xp.fill / game.track (não texto) | 3.03 | 7.80 | 3 |
| text.secondary / bg.sunken | 8.43 | 9.49 | 4.5 |
| text.brand / feedback.info.soft | 5.41 | 6.52 | 4.5 |
| text.primary / feedback.info.soft | 15.32 | 12.26 | 4.5 |
| feedback.success.strong / feedback.success.soft (não texto) | 4.20 | 4.23 | 3 |
| feedback.error.strong / feedback.error.soft (não texto) | 5.09 | 5.45 | 3 |
| game.hand.onFill / game.hand.fill (não texto) | 5.01 | 9.26 | 3 |
| game.trace.onSoft / game.trace.soft | 9.35 | 11.56 | 4.5 |
| game.trace.text / game.trace.soft | 5.59 | 7.16 | 4.5 |
| game.trace.fill / game.trace.soft (não texto) | 3.09 | 5.83 | 3 |
| text.primary / game.trace.soft | 15.32 | 12.26 | 4.5 |
| bg.canvas / text.primary | 16.62 | 16.90 | 4.5 |
| game.progress / game.trace.soft (não texto) | 3.09 | 5.83 | 3 |
| game.locked.fg / bg (pior de canvas, surface, raised) (não texto) | 7.03 | 8.37 | 3 |

| Grupo | Par | Razão | Mínimo |
|---|---|---|---|
| stage | stage.text / scrim sobre vídeo branco | 5.98 | 4.5 |
| stage | stage.textSecondary / scrim sobre vídeo branco | 4.99 | 4.5 |
| stage | stage.text / pill sobre vídeo branco | 13.24 | 4.5 |
| stage | stage.textSecondary / pill sobre vídeo branco | 11.05 | 4.5 |
| stage | stage.text / stage.bg | 19.62 | 4.5 |
| stage | stage.textSecondary / stage.bg | 16.37 | 4.5 |
| stage | landmark.idle / halo sobre vídeo branco (não texto) | 9.07 | 3 |
| stage | landmark.idle / stage.bg (não texto) | 12.50 | 3 |
| stage | landmark.tracking / halo sobre vídeo branco (não texto) | 8.11 | 3 |
| stage | landmark.tracking / stage.bg (não texto) | 12.03 | 3 |
| stage | landmark.ready / halo sobre vídeo branco (não texto) | 6.11 | 3 |
| stage | landmark.ready / stage.bg (não texto) | 9.06 | 3 |
| stage | landmark.correct / halo sobre vídeo branco (não texto) | 7.98 | 3 |
| stage | landmark.correct / stage.bg (não texto) | 11.83 | 3 |
| stage | landmark.retry / halo sobre vídeo branco (não texto) | 6.96 | 3 |
| stage | landmark.retry / stage.bg (não texto) | 10.31 | 3 |
| stage | landmark.reference / halo sobre vídeo branco (não texto) | 5.03 | 3 |
| stage | landmark.reference / stage.bg (não texto) | 6.83 | 3 |
| stage | stage.gold / stage.bg (não texto) | 12.73 | 3 |
| stage | stage.trace / stage.bg (não texto) | 8.38 | 3 |
| stage | stage.trace / stage.surface (não texto) | 7.74 | 3 |
| stage | stage.text / stage.surface | 18.11 | 4.5 |
| stage | stage.textSecondary / stage.surface | 15.12 | 4.5 |
| stage | landmark.correct / stage.surface | 10.92 | 4.5 |
| stage | stage.gold / stage.surface (+XP) | 11.75 | 4.5 |
| stage | guide.idle / stage.bg (não texto) | 9.72 | 3 |
| stage | guide.ok / stage.bg (não texto) | 11.83 | 3 |
| stage | guide.warn / stage.bg (não texto) | 12.34 | 3 |
| liga | bronze: onFill / fill | 4.68 | 4.5 |
| liga | bronze: edge / surface claro (não texto) | 8.00 | 3 |
| liga | bronze: fill / surface escuro (não texto) | 4.34 | 3 |
| liga | prata: onFill / fill | 8.77 | 4.5 |
| liga | prata: edge / surface claro (não texto) | 4.35 | 3 |
| liga | prata: fill / surface escuro (não texto) | 8.12 | 3 |
| liga | ouro: onFill / fill | 9.17 | 4.5 |
| liga | ouro: edge / surface claro (não texto) | 5.07 | 3 |
| liga | ouro: fill / surface escuro (não texto) | 8.49 | 3 |
| liga | safira: onFill / fill | 5.30 | 4.5 |
| liga | safira: edge / surface claro (não texto) | 13.67 | 3 |
| liga | safira: fill / surface escuro (não texto) | 3.29 | 3 |
| liga | rubi: onFill / fill | 5.18 | 4.5 |
| liga | rubi: edge / surface claro (não texto) | 10.51 | 3 |
| liga | rubi: fill / surface escuro (não texto) | 3.36 | 3 |
| liga | ametista: onFill / fill | 5.20 | 4.5 |
| liga | ametista: edge / surface claro (não texto) | 10.75 | 3 |
| liga | ametista: fill / surface escuro (não texto) | 3.35 | 3 |
| liga | diamante: onFill / fill | 11.44 | 4.5 |
| liga | diamante: edge / surface claro (não texto) | 5.02 | 3 |
| liga | diamante: fill / surface escuro (não texto) | 10.59 | 3 |
| marca | brand.icon.mark / bg (não texto) | 6.95 | 3 |
| marca | brand.icon.dot / bg (não texto) | 18.08 | 3 |
| marca | brand.icon.skin / bg (não texto) | 4.34 | 3 |
| marca | brand.icon.mark / bgDark (não texto) | 7.60 | 3 |
| marca | brand.icon.dot / bgDark (não texto) | 19.76 | 3 |
| marca | brand.icon.skin / bgDark (não texto) | 4.75 | 3 |

Regras que o contraste não resolve sozinho:

- **Cor nunca é a única pista.** Acerto tem ícone de check e a palavra "Correto"; erro tem ícone e dica escrita;
  zonas do ranking têm seta e texto; ligas têm forma e nome; estados do esqueleto mudam também a espessura e o
  traço (referência é tracejada); o nó bloqueado tem cadeado e o rótulo "bloqueada".
- Texto sobre vídeo só com `stage.scrim` ou `stage.pill` por baixo.
- Desabilitado (`text.disabled`) é isento pelo WCAG, mas nunca carrega informação necessária.

---

## 5. Tipografia

### 5.1 Fontes

Duas famílias, ambas SIL Open Font License 1.1, auto-hospedadas em woff2 com subset latino (cobre todo o pt-BR),
servidas de `/fonts/` com as licenças ao lado (`Anybody-OFL.txt`, `Figtree-OFL.txt`). Vieram dos pacotes
`@fontsource-variable/anybody` e `@fontsource-variable/figtree`.

- **Anybody** variável, com os eixos de peso (100 a 900) e de **largura** (50% a 150%): títulos, botões, números,
  glosas e a palavra-marca. A largura entra por `font-stretch`. Arquivo `Anybody-latin-wdth-wght.woff2`.
- **Figtree** variável (300 a 900): texto e interface. Arquivo `Figtree-latin-wght.woff2`.
- Fallback: `system-ui, -apple-system, Roboto, sans-serif`. `font-display: swap` e
  `<link rel="preload" as="font" type="font/woff2" crossorigin>` das duas no `index.html` (e nas páginas
  `coleta.html` e `teste-camera.html`).
- O service worker do PWA põe as duas no precache: o app abre offline com a tipografia certa. Nenhuma requisição
  a terceiros (LGPD).

```css
@font-face {
  font-family: "Anybody";
  src: url("/fonts/Anybody-latin-wdth-wght.woff2") format("woff2-variations"),
       url("/fonts/Anybody-latin-wdth-wght.woff2") format("woff2");
  font-weight: 100 900;
  font-stretch: 50% 150%;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Figtree";
  src: url("/fonts/Figtree-latin-wght.woff2") format("woff2-variations"),
       url("/fonts/Figtree-latin-wght.woff2") format("woff2");
  font-weight: 300 900;
  font-style: normal;
  font-display: swap;
}
```

Números de XP, ranking e cronômetro usam `font-variant-numeric: tabular-nums` para não "pularem" ao mudar.

### 5.2 Escala (pensada para 360 x 640)

A largura da Anybody vai no token (`fontStretch`) como palavra-chave, porque o atalho `font` do CSS só aceita
palavra-chave: `semi-expanded` = 112,5% e `expanded` = 125% (`font.stretch.semi` e `font.stretch.wide`). O gerador
emite também `--lx-typography-<nome>-stretch`.

| Token | Família | Tamanho / linha | Peso | Largura | Uso |
|---|---|---|---|---|---|
| `typography.displayXl` | Anybody | 40 / 42 | 900 | 125% | Título das boas-vindas |
| `typography.display` | Anybody | 34 / 37 | 900 | 112,5% | "Lição concluída!", resultado de liga |
| `typography.headline` | Anybody | 28 / 32 | 900 | 112,5% | Título de tela, nome da liga |
| `typography.title` | Anybody | 22 / 26 | 800 | 112,5% | Card, unidade, modal, enunciado (em 900) |
| `typography.titleSm` | Anybody | 18 / 23 | 800 | 112,5% | Nome de lição, título de item |
| `typography.button` | Anybody | 17 / 21 | 800 | 112,5% | Botões grandes |
| `typography.numericXl` | Anybody | 52 / 52 | 900, tabular | 125% | +XP da celebração, letra em destaque |
| `typography.numeric` | Anybody | 20 / 24 | 800, tabular | 112,5% | Ranking, placar, chips de XP e sequência |
| `typography.bodyLg` | Figtree | 18 / 27 | 400 | | Texto de destaque |
| `typography.body` | Figtree | 16 / 24 | 400 | | Texto padrão |
| `typography.bodySm` | Figtree | 14 / 20 | 400 | | Texto secundário |
| `typography.label` | Figtree | 16 / 20 | 700 | | Rótulo, item de configuração, nome no ranking |
| `typography.labelSm` | Figtree | 13 / 16 | 700 | | Aba, chip, badge |
| `typography.caption` | Figtree | 12 / 16 | 600 | | Menor texto permitido |

Regras:

- No CSS, tamanhos em `rem` (16 px = 1 rem), para respeitar o zoom e o tamanho de texto do navegador. Testar
  com zoom de 200% (WCAG 1.4.4) sem perder conteúdo; usar quebra de linha, nunca `text-overflow` em instrução.
- Nada abaixo de 12 px.
- Linha de leitura com no máximo 45 caracteres no enunciado; instrução em até 2 linhas. Títulos alinhados à
  esquerda nas telas do Traço (boas-vindas, enunciado, lição concluída).
- Sem itálico. Ênfase com peso.
- Glosa de sinal (o nome do sinal em Libras, como `OBRIGADO`) sempre em caixa alta, Anybody 800 em 112,5%, com
  `letter-spacing: 0.04em`. É convenção de escrita de glosa, não grito.

---

## 6. Espaço, grid e layout mobile-first

### 6.1 Espaçamento (base 4)

`space.0_5 2px`, `space.1 4px`, `space.2 8px`, `space.3 12px`, `space.4 16px`, `space.5 20px`, `space.6 24px`,
`space.8 32px`, `space.10 40px`, `space.12 48px`, `space.16 64px`.

Usos de referência: gap ícone e rótulo 8; gap entre itens de lista 12; padding de card 16 a 20; margem de tela 16;
separação de seções 32.

### 6.2 Grid

| Faixa | Largura | Colunas | Margem | Gutter |
|---|---|---|---|---|
| compact (celular) | < 600 px | 4 | 16 px | 12 px |
| medium (celular deitado, tablet pequeno) | 600 a 839 px | 8 | 24 px | 16 px |
| expanded | >= 840 px | 12 | 32 px | 16 px |

- O conteúdo do app vive numa coluna de no máximo `size.contentMax` (560 px), centralizada. Em telas largas o
  app continua com cara de app. A partir de 768 px a navegação vira a barra lateral que o web-poc já tinha
  (decisão 8 da seção 15); abaixo disso, tab bar embaixo.
- Alternativas de múltipla escolha: grade 2 x 2 com gutter 12; em telas < 360 px ou com texto grande, vira 1 coluna.

### 6.3 Altura da tela e safe areas

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F6F7FA" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0C101A" media="(prefers-color-scheme: dark)" />
```

```css
.app {
  min-height: 100dvh;                 /* acompanha a barra do navegador que some e aparece */
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
.top-bar   { padding-top: env(safe-area-inset-top); min-height: calc(var(--lx-size-top-bar) + env(safe-area-inset-top)); }
.tab-bar   { padding-bottom: env(safe-area-inset-bottom); height: calc(var(--lx-size-tab-bar) + env(safe-area-inset-bottom)); }
.page      { padding-bottom: calc(var(--lx-size-tab-bar) + env(safe-area-inset-bottom) + var(--lx-space-4)); }
.lesson-footer { padding-bottom: max(var(--lx-space-4), env(safe-area-inset-bottom)); }
```

- `100dvh` para telas cheias; `100svh` como mínimo quando o layout não pode pular ao rolar (palco da câmera).
- Com teclado aberto (campo de nome, código de squad), usar `window.visualViewport` para manter o botão visível.
- O vídeo da câmera pode sangrar sob a barra de status; um degradê de `stage.scrim` no topo garante a leitura
  do relógio e dos controles.
- **Cor do tema única.** A `theme-color` do `index.html` e o `theme_color` / `background_color` do manifest do
  PWA saem do mesmo token (`bg.canvas` de cada modo), preenchidos no build pelo `vite.config.ts`. Nenhum desses
  valores é escrito à mão. Ao trocar o tema nas Configurações, o app ajusta a `theme-color` da barra do navegador.

### 6.4 Tamanhos fixos

| Token | Valor | Observação |
|---|---|---|
| `size.touchMin` | 48 px | Alvo mínimo (acima dos 44 pt do iOS) |
| `size.buttonLg` / `buttonMd` / `buttonSm` | 56 / 48 / 40 px | O pequeno tem área de toque de 48 |
| `size.choiceMin` | 64 px | Alternativa de exercício |
| `size.topBar` / `tabBar` | 56 / 64 px | Mais a safe area |
| `size.lessonNode` / `lessonNodeCurrent` | 64 / 76 px | Nó do mapa |
| `size.progressLesson` / `progressGoal` / `confidenceBar` | 12 / 10 / 8 px | Barras |
| Ícones | 16 / 20 / 24 / 32 / 64 px | `size.iconSm` a `size.iconHero` |

Entre dois alvos de toque vizinhos, pelo menos 8 px.

### 6.5 Gestos do navegador

O app roda dentro do navegador, que tem gestos próprios (puxar para atualizar, rolagem elástica, zoom com dois
toques). Na lição e na câmera eles atrapalham:

- `overscroll-behavior: contain` na área do exercício e `overscroll-behavior-y: none` no `body`: arrastar um
  bloco ou rolar até o fim não dispara o "puxar para atualizar" nem rola a página de trás.
- `touch-action: manipulation` em botões (sem atraso de toque nem zoom com dois toques) e `touch-action: none`
  só no elemento que está sendo arrastado (ordenar blocos), para o arrasto não virar rolagem.
- Nunca bloquear o zoom da página (`user-scalable=no` ou `maximum-scale=1`): quem precisa de zoom continua tendo
  (seção 12.1).

---

## 7. Raio, borda e elevação

| Raio | Valor | Uso |
|---|---|---|
| `radius.xs` | 6 px | Badge pequeno, barra, célula do calendário |
| `radius.sm` | 10 px | Chip retangular, campo pequeno |
| `radius.md` | 16 px | Linha de ranking, cabeçalho de unidade, toast |
| `radius.lg` | 22 px | Card, demonstração do sinal, vídeo, modal |
| `radius.xl` | 28 px | Topo de bottom sheet, ilustração das boas-vindas |
| `radius.choice` | 20 px | Alternativa de exercício |
| `radius.button` | pílula (`radius.full`) | Botão, campo de texto, "Começar" do mapa |
| `radius.full` | 999 px | Chip de XP e sequência, avatar, nó do mapa |

Borda: `borderWidth.thin 1px` (card), `thick 2px` (alternativa, insígnia), `selected 3px` (alternativa
selecionada), anel de foco `3px` com afastamento de `2px`.

Elevação:

| Nível | Claro | Escuro | Uso |
|---|---|---|---|
| 0 | nenhuma | nenhuma | Conteúdo plano |
| 1 | sombra curta (6% e 10%) | sombra 40% + `bg.surface` | Card |
| 2 | `0 4px 12px -2px` 12% | sombra 50% + `bg.raised` | Tab bar, feedback de exercício |
| 3 | `0 12px 32px -8px` 24% | sombra 65% + `bg.raised` | Modal, sheet de conquista |

No escuro quem eleva é a cor (`surface` -> `raised`); a sombra só ajuda a separar.

---

## 8. Iconografia

**Material Symbols Rounded**, Apache 2.0, em **SVG** (não a fonte de ícones). Sai o FontAwesome do web-poc.

- Exportar cada ícone usado (estilo Rounded, peso 500, grade 0, tamanho óptico 24) como SVG com
  `fill="currentColor"`, nas variantes contorno e preenchida (`fill 1`) quando houver estado ativo.
- Guardar em `src/icons/` e importar como componente (no Vite, via `?raw` ou um plugin de SVG); a cor vem do
  `color` do pai, então segue o tema sem nada extra.
- Tamanhos: 24 na tab bar e top bar, 20 em lista, 16 em chip, 32 no feedback, 64 em estado vazio.
- Ícone sozinho como botão sempre com `aria-label` em pt-BR e área de 48 x 48.
- Aba ativa: ícone preenchido; inativa: contorno. A troca de forma, além da cor, mostra a aba atual.

| Função | Ícone |
|---|---|
| Aprender / Praticar / Social / Perfil | `school` / `sign_language` / `group` / `person` |
| Streak / XP / Conquista / Liga | `local_fire_department` / `bolt` / `military_tech` / `trophy` |
| Câmera / sem câmera / pouca luz | `videocam` / `videocam_off` / `light_mode` |
| Bloqueada / concluída / atual / revisão | `lock` / `check` / `play_arrow` / `replay` |
| Promovido / rebaixado | `arrow_upward` / `arrow_downward` |
| Dica / fechar / voltar | `lightbulb` / `close` / `arrow_back` |

Regra cultural: nunca usar orelha (cortada ou não) para representar pessoas surdas, nem ilustrar mãos com
configurações de outra língua de sinais (o alfabeto manual da ASL, o gesto "I love you"). Ícone de mão é
genérico; mão ensinando sinal vem de vídeo ou ilustração validada.

---

## 9. Motion

### 9.1 Durações e curvas

| Token | Valor | Uso |
|---|---|---|
| `motion.duration.instant` | 80 ms | Toque, troca de estado de botão |
| `motion.duration.fast` | 150 ms | Feedback de alternativa, overlay entrando |
| `motion.duration.base` | 250 ms | Componente, crossfade entre exercícios |
| `motion.duration.page` | 300 ms | Transição de tela |
| `motion.duration.slow` | 400 ms | Bottom sheet, modal |
| `motion.duration.emphasis` | 600 ms | Fase desbloqueada, insígnia |
| `motion.duration.celebrate` | 800 ms | "+XP" subindo, contador |
| `motion.duration.ambient` | 2400 ms | Loops calmos (chama, brilho) |
| `motion.duration.orbit` | 6000 ms | Volta completa da seta em volta da lição atual |
| `motion.stagger` | 70 ms | Entrada escalonada |
| `motion.autoAdvance` | 1200 ms | Pausa após acerto antes de avançar |

| Curva | `cubic-bezier` | Uso |
|---|---|---|
| `motion.easing.standard` | 0.2, 0, 0, 1 | Padrão |
| `motion.easing.decelerate` | 0, 0, 0.2, 1 | Entradas |
| `motion.easing.accelerate` | 0.4, 0, 1, 1 | Saídas |
| `motion.easing.overshoot` | 0.34, 1.56, 0.64, 1 | Só celebração (é o `--wow-ease-spring` atual) |

As molas da spec 05 (`celebrate`, `unlock`, `crystallize`) ficam no JSON com `mass`, `stiffness`, `damping` e a
duração equivalente para web, onde viram `overshoot` com essa duração.

### 9.2 Mapa dos momentos da spec 05

| Momento | Animação | Tokens |
|---|---|---|
| Toque em botão | escala 0.97 e base da tecla afunda 2 px | `instant`, `standard` |
| Selecionar alternativa | borda 3 px e escala 0.98 | `fast` |
| Acerto receptivo | tile vira verde, check entra com escala 0.6 -> 1 | `fast`, `overshoot` |
| Erro receptivo | tile vira framboesa, deslocamento lateral de 4 px uma vez | `fast` |
| Acerto com câmera | barra trava (50 ms), esqueleto "cristaliza" 1.0 -> 1.08 -> 1.0, anel de luz, "+XP" sobe | `crystallize`, `celebrate` |
| Barra de progresso | largura anima | `slow`, `decelerate` |
| Fase desbloqueada | nó cresce com mola e anel pulsa uma vez | `emphasis`, `overshoot` |
| Lição atual no mapa | a seta de trajetória gira em volta do nó, sem parar | `orbit`, linear |
| Lição concluída | as 12 setas saem do +XP, uma depois da outra (meio `stagger` entre elas) | `emphasis`, `overshoot`, `stagger` |
| Sheet de conquista | sobe com mola, insígnia gira 8 graus e assenta | `slow`, `overshoot` |
| Troca de aba | fade de conteúdo, sem deslizar | `base` |

### 9.3 Reduzir movimento

Vale para `prefers-reduced-motion: reduce` e para a opção "Reduzir animações" nas Configurações do app (útil
para quem não acha a opção do sistema).

- Troca deslocamento, escala e mola por fade de `fast`.
- Confete desligado: a conquista aparece estática, com o mesmo texto. A explosão de setas da lição concluída
  aparece já desenhada.
- A seta em volta da lição atual fica parada.
- Chama da streak e brilhos param (imagem estática da faixa certa).
- O esqueleto da mão continua (é informação), mas sem pulso, sem brilho e sem "cristalizar"; a mudança de cor e
  de espessura permanece.
- Barra de confiança sem oscilação: suavização mais forte no valor.
- Nada pisca mais de 3 vezes por segundo, com ou sem a preferência (WCAG 2.3.1). O "pisca 2 vezes" do dedo em
  âmbar fica em 2 ciclos de 300 ms.

```css
:root { --lx-motion-scale: 1; }
@media (prefers-reduced-motion: reduce) { :root { --lx-motion-scale: 0; } }
:root[data-reduced-motion="true"] { --lx-motion-scale: 0; }
/* nos componentes: transform só quando --lx-motion-scale = 1; opacidade sempre */
```

---

## 10. Háptica e som

### 10.1 Regra de ouro

**Todo evento tem um equivalente visual, sempre exibido.** Vibração e som são camadas opcionais por cima. O
equivalente visual não é "fallback": ele existe para todo mundo, inclusive no Android com vibração.

### 10.2 Háptica

| Evento | Web (`navigator.vibrate`, ms) | Equivalente visual obrigatório |
|---|---|---|
| `tap` | 10 | Botão afunda (tecla) |
| `select` | 8 | Borda de seleção |
| `correct` | 25 | Tile verde + check |
| `correctCamera` | 40 | Esqueleto cristaliza + anel de luz |
| `wrong` | nenhum | Tile framboesa + ícone + dica. Erro nunca vibra |
| `achievement` | 100, 50, 100 | Insígnia com brilho |
| `streak` | 50, 30, 50 | Chama cresce |
| `goalMet` | 80, 40, 80, 40, 80 | Barra passa de 100% e assenta |
| `freeze` | 200 | Cristal sobre a chama |
| `courseDone` | 100, 50, 100, 50, 200 | Sequência coreografada |

Comportamento por plataforma:

| Plataforma | O que acontece | O que fazer |
|---|---|---|
| Safari e qualquer navegador no iOS | Não há Vibration API | Não chamar; só o visual. Não usar truques de WebKit para simular háptica |
| Chrome Android | Funciona após o primeiro toque do usuário na página; ignorado com a aba em segundo plano | Chamar só em resposta a gesto ou evento de exercício |
| Firefox Android e outros | Suporte inconsistente | Tratar como opcional |
| Qualquer um | Usuário desligou "Vibração" nas Configurações do app | Não chamar |

```ts
// src/lib/haptics.ts (esboço; o arquivo real lê os padrões de styles/tokens.ts)
import tokens from '../../docs/design-tokens.json'; // ou o módulo gerado
type HapticEvent = keyof typeof tokens.haptic;
const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

export function haptic(event: HapticEvent, enabled: boolean) {
  const pattern = (tokens.haptic[event] as any)?.$value?.web as number[] | undefined;
  if (!enabled || !canVibrate || !pattern?.length) return; // iOS cai aqui: nada a fazer
  try { navigator.vibrate(pattern); } catch { /* sem efeito colateral */ }
}
```

### 10.3 Som

- Catálogo e prioridades da spec 05 (seção 3) estão em `sound.*` no JSON. Nenhum som carrega informação que
  não esteja na tela.
- Formato: **AAC (`.m4a`)**, que toca no Safari iOS e no Chrome Android. Pasta `public/audio/`.
- Tocar via Web Audio API (`AudioContext` com buffers pré-carregados), que dá latência baixa. O contexto precisa
  ser destravado no primeiro toque do usuário (`audioContext.resume()` dentro de um evento de clique); antes
  disso, nada toca e nada quebra.
- O botão de silencioso do iPhone e o volume do aparelho mandam. Onde existir `navigator.audioSession`, usar o
  tipo `ambient` para não interromper a música do usuário.
- Opções em Configurações: "Sons" e "Vibração", independentes. O padrão dos sons é perguntado no onboarding (seção 15, item 4).
- Legenda: vídeos de sinal não têm áudio relevante; quando houver qualquer narração, ela tem legenda.

---

## 11. Componentes

Cada componente lista anatomia, tokens e estados. Nomes seguem as specs (`CourseMapScreen`, `LessonNode`, etc.).

### 11.1 Botões

| Variante | Visual | Tokens |
|---|---|---|
| Primário ("tecla") | Pílula tangerina `action.primary.bg`, texto grafite `action.primary.fg` em Anybody, base de 3 px em `action.primary.base` | `size.buttonLg`, `radius.button`, `typography.button` |
| Secundário | Pílula `action.secondary.bg`, borda 2 px `border.strong`, texto `text.brand` | `size.buttonMd`, `radius.button` |
| "Ver o movimento" | Pílula grafite (`text.primary`) com texto `bg.canvas` e a seta curva (`TraceArrowIcon`) | `typography.label`, 48 px |
| Terciário (texto) | Sem fundo, texto `text.brand`, sublinhado no foco | área de toque 48 |
| Perigo | Fundo `action.danger.bg`, texto `action.danger.fg`, só em confirmação | |
| Ícone | 48 x 48, ícone 24, fundo transparente ou `bg.sunken` | `aria-label` obrigatório |

Estados: repouso; pressionado (base some, conteúdo desce 2 px, `instant`); foco (anel `border.focus` 3 px,
afastado 2 px, só com teclado: `:focus-visible`); carregando (spinner 20 px no lugar do texto, largura mantida,
`aria-busy`); desabilitado (`action.disabled.*`, sem base, `aria-disabled`). Botão primário ocupa a largura toda
no rodapé de exercício. Rótulo sempre verbo: "Verificar", "Continuar", "Tentar de novo".

### 11.2 Alternativa de exercício (`ChoiceTile`)

Altura mínima 64, raio `choice` (20), borda 2 px, glosa em Anybody 800 (ou cartão de opção com demonstração no
palco de cima, no "Qual é o sinal de").

| Estado | Borda | Fundo | Extra |
|---|---|---|---|
| Neutro | `border.default` | `bg.surface` | |
| Selecionada | 3 px `border.focus` | `feedback.info.soft` | número preenchido em `action.primary.bg`, escala 0.98 |
| Correta | 3 px `feedback.success.strong` | `feedback.success.soft` | ícone check |
| Incorreta | 3 px `feedback.error.strong` | `feedback.error.soft` | ícone `close` |
| Revelada (a certa, após erro) | 2 px tracejada `feedback.success.strong` | `bg.surface` | "Resposta certa" em `caption` |
| Desabilitada (após verificar) | `border.default` | `bg.surface` | opacidade 0.6 nas não envolvidas |

Grupo com `role="radiogroup"`; cada tile `role="radio"` com `aria-checked`. O resultado é anunciado por uma região
`aria-live="polite"` no feedback.

No "Qual é o sinal de [PALAVRA]" (`ExerciseWordChooseVideo`), tocar em qualquer parte do cartão seleciona a
opção e toca a demonstração dela no palco de cima, sem corrigir; a pessoa compara quantas quiser e a seleção
acompanha o último toque (setas do teclado também movem). Antes de verificar, os cartões não mostram a glosa. A
correção só acontece no botão "Verificar" fixo embaixo, desabilitado até haver seleção.

### 11.3 Card de lição e cabeçalho de unidade

- **Topo do mapa**: palavra-marca (`Wordmark`, 18 px) sobre a saudação "Bom dia, Ana" e os chips de sequência e XP.
- **Cabeçalho de unidade** (`UnitSection`): fica fixo no topo ao rolar o mapa. Fundo `bg.surface`, "Unidade 2" num
  selo arredondado (`game.hand.soft` com texto `game.hand.text`, `labelSm`), título em `title` (Anybody), progresso
  "3 de 6 lições" e barra fina. Botão "Guia" (lista de sinais da unidade) à direita.
- **Card de continuar** (`ResumeBanner` / `ContinueLessonCard`): a faixa "Retomar" do mapa. Fundo liso
  `stage.bg` com o arco da seta (`TraceArc`, `stage.trace` a 55%), ícone de play em `stage.trace` e botão
  redondo tangerina. É o único card escuro no modo claro: antecipa o palco. Leva à lição em andamento, no ponto
  onde a pessoa parou (a lição guarda o andamento por 12 horas, `src/lib/lessonRun.ts`).
- **Card de meta diária** (`DailyGoalBar`): ícone `bolt`, "12 de 20 XP hoje", barra `progressGoal` em
  `game.xp.fill`.

Regras de card (todos os cards do app): fundo `bg.surface`, raio `lg`, borda `border.default` de 1 px ou
elevação 1, padding de 16 a 20. Estado e identidade aparecem em selo/chip, ícone, fundo do card inteiro ou
contorno completo. **Nunca usar faixa colorida lateral** (borda esquerda grossa, `border-left` colorido ou barra
vertical de acento), como diz a seção 2.2.

### 11.4 Mapa e trilha de fases (`CourseMapScreen` / `LessonNode`)

Uma trilha vertical, como uma linha de metrô: um conector de 4 px liga os nós, alinhados ao centro
para o conector passar sempre pelo meio deles (a proposta previa nós alternando 24 px para os lados; ver os
ajustes da seção 15). Diferente de um mapa infantil, **cada nó tem rótulo
escrito ao lado** (nome da lição e "3 sinais"), o que ajuda leitura e leitor de tela.

| Estado | Nó | Conector até ele | Rótulo |
|---|---|---|---|
| Bloqueada | 64 px, fundo `bg.surface` com anel de 3 px `game.locked.bg`, ícone `lock` em `game.locked.fg` | pontilhado `border.strong` (pontos de 3 px a cada 10 px) | `text.secondary` |
| Disponível | 64 px, `action.primary.bg`, ícone de play | sólido `border.strong` | `text.primary` |
| Atual | 76 px, `action.primary.bg` com a base da tecla e a **seta de trajetória girando em volta** (`TraceOrbit`, `motion.duration.orbit`, parada com menos movimento), pílula "Começar" em `action.primary.bg` | sólido `game.trace.fill` se vem de uma concluída | `titleSm` em 900 |
| Concluída | 64 px, `game.hand.fill` (petróleo), ícone `check` em `game.hand.onFill`, três marcas de domínio abaixo | sólido `game.trace.fill` (o trecho já feito) | `text.primary` |
| Revisão devida | 64 px, `game.hand.soft` com borda `game.hand.fill`, ícone `replay` | sólido | "Revisar" |
| Desafio da unidade | hexágono 76 px, `league` da cor ouro, ícone `trophy` | sólido | "Desafio" |

- Ao abrir, a lista rola até o nó atual (sem animação se reduzir movimento).
- Estrutura semântica: `<ol>` de lições; cada nó é um botão com `aria-label` completo ("Lição 4, Cumprimentos,
  disponível") e `aria-disabled` quando bloqueado. Toque em bloqueado mostra o motivo ("Conclua a lição 3").
- Os nós e rótulos ficam dentro da coluna de 4 colunas; o conector é decorativo (`aria-hidden`).

### 11.5 Barras de progresso

| Barra | Altura | Preenchimento | Trilho | Texto obrigatório |
|---|---|---|---|---|
| Lição (`LessonProgressBar`, topo do exercício) | 12, termina numa **ponta de seta** de 14 x 22 | `game.progress` | `game.track` | `aria-valuenow` e "4 de 10" para leitor de tela; contador em Anybody |
| Meta diária | 10 | `game.xp.fill` | `game.track` | "12 de 20 XP" visível |
| Confiança (`ConfidenceBar`, câmera) | 8 | `stage.landmark.idle` -> `tracking` -> `ready` | branco 20% | marca do limiar visível + estado em texto |
| XP da squad | 6 | `action.primary.bg` | `game.track` | valor ao lado |

Todas com raio `full` (a da lição só à esquerda, por causa da ponta), `role="progressbar"`. A barra de confiança tem um traço vertical no limiar e, ao atingir,
"trava" (pisca uma vez em `ready`). Com leitor de tela, ela não anuncia cada oscilação: só "Mão detectada",
"Quase lá" e "Reconhecido".

### 11.6 Feedback de acerto e erro (`FeedbackOverlay` / painel do rodapé)

Painel que sobe do rodapé (`slow`, `decelerate`), cobre o botão e fica acima da safe area. Elevação 2.

| Estado | Fundo | Ícone (32) | Título | Corpo | Botão |
|---|---|---|---|---|---|
| Correto | `feedback.success.soft` | `check_circle` em `feedback.success.strong` | "Correto!" (varia, seção 2.5) em `title`, cor `feedback.success.onSoft` | glosa do sinal | primário "Continuar" (ou avanço automático de 1,2 s na câmera, com botão visível) |
| Quase (erro receptivo) | `feedback.error.soft` (framboesa) | `lightbulb` em `feedback.error.strong` | "Quase!" | "A resposta certa é OBRIGADO." | primário "Continuar" |
| Retry (câmera) | `feedback.warning.soft` | `lightbulb` | "Quase!" | dica do parâmetro (`nearestErrorHint`) | primário "Tentar de novo" e secundário "Ver o movimento" |
| `accept_soft` | `feedback.success.soft` | `check_circle` | "Bom trabalho!" | "Este sinal é desafiador. Continue praticando." | "Continuar" |

- O painel é uma região `aria-live="assertive"` só no momento da verificação.
- O avanço automático nunca acontece sem um botão visível e para se o usuário tocar no painel (ninguém perde a
  dica por ler devagar; WCAG 2.2.1).

### 11.7 Tela da câmera (o palco)

**Layout em retrato (360 x 640 como referência)**

```
[safe area topo + top bar no palco: voltar | barra da lição com ponta de seta | contador]
[palco: vídeo espelhado 4:3 (formato do quadro da câmera, ver seção 15), raio lg só embaixo]
   - esqueleto 2D por cima (canvas), guia de enquadramento, pílula de status
   - barra de confiança na base do palco
[painel de instrução: miniatura do sinal de referência (RefVideoThumb) + "Faça o sinal de OBRIGADO"]
[rodapé: "Pular este sinal" (terciário) | estado ou botão]
```

- Vídeo da própria pessoa espelhado (`transform: scaleX(-1)` no vídeo e no canvas). Sem avatar 3D no MVP.
- Fundo do palco `stage.bg`, também no modo claro. Nos exercícios com câmera (`perform_sign`, `mirror_practice`,
  `fingerspell`) a lição inteira vira palco: `.lesson-screen--stage` com `.lx-theme-dark`, a letra-alvo em
  `stage.trace` e o botão "Ver o movimento" (pausa a câmera e mostra a demonstração; "Voltar para a câmera" volta).
- **Acerto**: cartão `stage.surface` com contorno `stage.border`, check em `stage.landmark.correct` e setas curtas
  em volta (`TraceCameraArcs`, `stage.trace`).
- **Esqueleto 2D**: linhas de 2,5 px e articulações de raio 4 em cor do estado (`stage.landmark.*`), sempre
  desenhadas sobre um contorno `stage.landmark.halo` 2 px mais largo, para ler sobre qualquer vídeo. No acerto:
  3,5 px e raio 6, com brilho. Esqueleto de referência (retry): `stage.landmark.reference`, **tracejado**, por
  baixo do esqueleto do usuário.
- **Guia de enquadramento**: contorno tracejado de cabeça e ombros (`stage.guide.idle`) com uma "zona do sinal"
  em volta do peito e do rosto. O rosto entra no enquadramento porque expressão facial é gramática em Libras
  (cartão cultural `cc-04` da spec 05). Na datilologia a zona é a área ao lado do ombro da mão dominante. Quando
  a mão está na zona e estável, o guia fica sólido em `stage.guide.ok` e some após 1 s.
- **Mão dominante**: opção "Sou canhoto(a)" no perfil inverte a zona e as dicas.
- Texto sobre o vídeo sempre em `stage.pill` (pílula de status) com ícone, nunca solto.

**Estados**

| Estado | Como detectar | O que aparece | Conta como erro? |
|---|---|---|---|
| Pedindo permissão | antes de `getUserMedia` | `PermissionRationaleCard`: "Sua câmera é sua sala de aula. A imagem não sai do seu celular." + "Permitir câmera" e "Continuar sem câmera" | não |
| Câmera bloqueada | `NotAllowedError` | `CameraBlockedCard` com passo a passo do navegador (Safari: Ajustes > Safari > Câmera; Chrome: cadeado na barra) e "Continuar sem câmera" | não |
| Carregando modelo | MediaPipe iniciando | palco com vídeo, pílula "Preparando o reconhecimento..." e skeleton loader na barra | não |
| Procurando a mão | sem mão por 1,2 s com câmera pronta | guia tracejado pulsando devagar, pílula com ícone `sign_language`: "Mostre sua mão dentro do quadro." | não |
| Mão parcial ou na borda | algum ponto a menos de 3% da borda | guia `warn` no lado cortado + "Afaste um pouco a mão da borda." | não |
| Mão longe | caixa da mão < 12% da altura do quadro | "Aproxime a mão da câmera." | não |
| Pouca luz | luminância média de um quadro reduzido (32 x 24) abaixo de 60/255 por 1,5 s, ou confiança de detecção baixa com mão presente | ícone `light_mode` + "Procure um lugar mais iluminado." e dica "Fique de frente para a luz" | não |
| Instável | mão presente, pontos variando muito | barra oscila; pílula "Segure o sinal por um instante." | não |
| Analisando | confiança no limiar | barra trava, esqueleto `ready` | não |
| Acerto | aceite | sequência da spec 05 seção 1.3 com os tokens da seção 9 | não |
| Retry | rejeite com dica | dedo em âmbar pisca 2 vezes, referência tracejada (tangerina clara) aparece, painel de retry | não, é ensaio |
| Sem câmera | escolha do usuário ou falha | vídeo de referência + "Já sei fazer este sinal" (sem penalizar streak) | não |

Nenhum desses estados depende de som. Mensagens de status entram por `aria-live="polite"`, no máximo uma a cada
3 s, para não inundar o leitor de tela.

**Modo livre** (`FreeModeScreen`, rota `/camera/livre`, dentro da aba Praticar; atalhos no cartão de Praticar e no
topo da tela da câmera): a pessoa soletra o que quiser e o texto se forma, como um ditado. Seletor "Letras |
Números" no estilo das abas da `HandDemo` (um reconhecedor por vez, para O e 0 ou S e 8 não se confundirem);
palco 4:3 com raio `lg`; a leitura atual numa pílula `stage.pill` no canto (rótulo "Lendo", letra em `display` e a
barra de confiança, sem número); dicas e avisos numa pílula na base do vídeo. Embaixo, o texto lido em `headline`
num campo `bg.surface` com borda fina, cursor em `text.brand` (parado com menos movimento) e quatro botões de 48
px com ícone e rótulo: Espaço, Apagar, Limpar e Copiar. Regras de leitura em `lib/freeSpell.ts`: letra parada
vale depois de 600 ms com a mão parada; H, J, K, X e Ç só pelo movimento (a forma parada vira a dica "O K tem
movimento"); a mesma letra seguida pede soltar a mão; mão fora do quadro por 1,2 s põe um espaço; 4 s sem letra
nova mostra "Segure a mão parada por um instante." Cada letra nova é anunciada numa região `aria-live` à parte.
Nada vai para o progresso das lições nem sai do aparelho.

### 11.8 Modal de conquista (sheet de celebração)

- Bottom sheet de altura automática, fundo `stage.bg` (sempre escuro), topo com raio `xl`, `elevation 3`.
- Insígnia de 96 px no centro com brilho `stage.glow.gold`; título em `display` (`stage.text`), descrição em
  `body` (`stage.textSecondary`), "+50 XP" em `numeric` `game.xp.fill` do escuro.
- Botões: primário "Continuar" e secundário "Compartilhar".
- Confete (tangerina, petróleo e ouro) só nas conquistas maiores (regras da spec 05 seção 5.2); desligado com
  reduzir movimento.
- **Lição concluída**: a explosão de setas (`TraceBurst`) no lugar do ícone, do selo de +XP e do confete. Doze
  setas curvas (tangerina e petróleo) saem do "+15" em Anybody 900 a 125%, com "XP" em `game.xp.text`. Título e
  frase alinhados à esquerda; glosas praticadas em chips `game.trace.soft`.
- Foco vai para o título ao abrir, `role="dialog"`, `aria-modal="true"`, fecha com o botão e com arrastar.
- No máximo 2 celebrações por sessão (spec 05 seção 6.2); o resto fica para a próxima abertura.

### 11.9 Ranking da liga (`LeagueScreen` / `RankingList`)

- **Cabeçalho**: insígnia da liga (forma, cor e a seta para cima, seção 4.4), "Liga Safira" em `headline`, "Semana 12" e
  `LeagueTimer` "Encerra em 2d 5h" com ícone de relógio.
- **Legenda de zonas** (`PromotionLegend`): "Top 3 sobem para Rubi" com `arrow_upward` em
  `feedback.success.text`; "Últimos 10 descem para Ouro" com `arrow_downward` em `feedback.error.text`.
- **Linha** (altura 64, raio `md`): posição em `numeric` (tabular, largura fixa de 3 dígitos), avatar 40,
  nome em `label` (Figtree, até 1 linha, depois reticências), XP da semana em `label` 800 alinhado à direita.
- **Divisórias de zona**: "Zona de promoção" e "Zona de rebaixamento" em caixa alta, com seta e tracejado na cor
  da zona dos dois lados; as linhas da zona têm a seta ao lado da posição. A informação nunca está só na cor.
- **Usuário atual**: fundo `feedback.info.soft` (tangerina suave), borda 2 px `border.focus`, avatar tangerina,
  "Você" junto ao nome, e fica fixa no rodapé da lista quando sair da tela.
- **Resultado do período** (`LeagueResultSheet`): mesmo modelo do modal de conquista; promoção com confete
  na cor da nova liga, rebaixamento sem confete e com tom neutro ("Acontece. Uma semana constante te traz de volta.").
- Lista com `<ol>`; cada linha anuncia "3º lugar, Ana, 420 XP, zona de promoção".

### 11.10 Navegação por abas

- Quatro abas: **Aprender, Praticar, Social, Perfil** (a doc antiga e o web já usam essas; o Flutter tinha
  "Início", que sai). Social reúne Ligas e Squads.
- Barra fixa embaixo, fundo `bg.surface`, borda superior `border.subtle`, altura 64 + safe area inferior.
- Item: ícone 24 + rótulo `labelSm` sempre visível; área mínima 48 x 48. Ativo: ícone preenchido, cor
  `text.brand`, indicador em pílula `feedback.info.soft` atrás do ícone. Inativo: contorno, `text.secondary`.
- `<nav aria-label="Navegação principal">` com `aria-current="page"` (já existe em `Nav.tsx`).
- Some em lição, câmera e celebração (imersão total).
- **Top bar do app** (abas): título da tela à esquerda, chips de streak (`local_fire_department` +
  número em `game.streak.text`) e XP (`bolt` + número em `game.xp.text`) à direita, cada chip com área de 48.

### 11.11 Estados vazios, carregamento e erro

- **Vazio**: ícone 64 (ou animação do esqueleto, spec 05 seção 11), título em `title`, uma frase em `body`
  `text.secondary`, um botão primário com a próxima ação e, no máximo, um secundário. Textos da spec 05 seção 11.
- **Carregamento**: skeleton com as formas do conteúdo real, cor `bg.sunken`, brilho passando em 1,5 s
  (desligado com reduzir movimento: fica estático). Spinner só dentro de botão. Nada de tela branca: o shell
  (top bar e abas) aparece de imediato.
- **Abertura do app**: antes de o JS chegar, o `index.html` já pinta a palavra-marca e uma barra com ponta de
  seta (`game.progress` sobre `border.subtle` no claro e `game.track` no escuro), com CSS inline que recebe os
  tokens no build. A barra anda por etapas reais (página, código, banco local, tela, conteúdo) e a tela sai
  com fade `page` (`fast` com reduzir movimento). Abriu em menos de `motion.duration.base`: nem aparece.
- **Offline**: banner discreto no topo, `feedback.warning.soft`, "Você está offline. Seu progresso fica salvo
  e sincroniza depois." As lições baixadas continuam disponíveis.
- **Erro de carregamento**: ícone, "Não foi possível carregar.", botão "Tentar de novo". Nunca código de erro
  na cara do usuário.

### 11.12 Outros

- **Toast**: `bg.inverse`, `text.inverse`, raio `md`, acima da tab bar e da safe area, 4 s (6 s com ação),
  `role="status"`.
- **Diálogo de confirmação**: `bg.raised`, raio `lg`, título `title`, botões "Cancelar" (secundário) e a ação
  (primário ou perigo). Textos da seção 2.5.
- **Bottom sheet**: topo `radius.xl`, alça de 4 x 32 px, fundo `bg.raised`, `bg.scrim` atrás.
- **Faixa de instalar** (`InstallBanner`, regra na spec-02 12.1): card inteiro no topo do mapa, sem faixa
  lateral: `bg.surface`, borda `border.subtle` fina, raio `md`, ícone 24 em `text.brand`, título `body-sm` em
  negrito, uma linha `caption` em `text.secondary`, botão secundário pequeno e fechar (48 x 48, `aria-label`).
  Em telas menores que 560 px, o botão ocupa uma segunda linha para preservar a leitura e os alvos de toque.
  Entra junto com o conteúdo do mapa, sem animação própria e sem empurrar a tela depois.
- **+XP da lição concluída**: dentro da explosão de setas (seção 11.8).
- **Cartão cultural** (spec 05 seção 8): fundo `game.hand.soft`, ícone 64, título `title`, texto `body`,
  "Continuar". O `bg_color` livre do schema da spec 05 passa a ser um nome de token, para manter o contraste.
- **Demonstração do sinal** (`SignDemo`): ordem de prioridade vídeo com pessoa real, depois avatar VLibras, depois
  a descrição em texto (`video_caption`). Enquanto os vídeos gravados com a comunidade surda não existem, o
  avatar VLibras é a demonstração provisória. Regras: legenda do avatar sempre desligada (ela escreveria a glosa
  e entregaria a resposta); velocidades 1x, 0,75x e 0,5x; crédito "Avatar: VLibras (Governo Federal), licença
  LGPL-3.0" discreto junto ao avatar e nas Configurações; fora da tela o avatar fica pausado, para não disputar
  a GPU com a câmera. Ver [`conteudo-e-validacao.md`](./conteudo-e-validacao.md).
- **Mão em 3D na apresentação das letras e dos números** (`HandDemo` e `src/mao3d/`): a mão da abertura da landing
  (modelo próprio do Librax) com mãos de pessoas reais, lidas pelos modelos do app. Mostra a forma da mão (gira
  com o dedo, pelos botões ou pelas setas) e, nas letras H, J, K, X, Z e Ç, o movimento real em 1x ou 0,5x.
  Quando o sinal tem avatar, as duas ficam em abas "Mão 3D | Avatar" (fundo `feedback.info.soft` e texto
  `text.brand` na atual), abrindo na mão; no Ç, sem avatar, a mão é a demonstração. Palco quadrado na altura do
  avatar, fundo `stage.bg` dentro da moldura das demonstrações; botões de 48 px sobre o palco (outra pessoa, tom
  de pele, girar e ver de frente) e, embaixo, tocar/pausar e a velocidade. Tom de pele em seis opções
  ilustrativas (o do meio sem escolha). Com menos movimento a mão abre parada. Sem 3D no navegador, fica o
  `SignDemo`. No "Ver o movimento" dos exercícios com câmera, letras e números mostram a mesma mão, compacta
  (palco largo e baixo, sem abas nem legenda); palavras seguem com o avatar. Na apresentação, "Entendi,
  continuar" fica num rodapé que gruda no pé da tela (`position: sticky`, fundo `bg.canvas`, acima da safe
  area), sem cobrir o fim do conteúdo; em tela baixa (até 740 px de altura) o cartão fica mais enxuto e o palco
  encolhe para 30% da altura. Nos sinais de palavras o avatar continua sozinho: lugar no corpo e expressão fazem parte do sinal.

### 11.13 Rotas e o voltar do navegador

No navegador, o botão voltar (do Android, do gesto do iPhone ou da barra do navegador) precisa fazer o que a
pessoa espera. Por isso toda tela tem URL e o voltar do navegador equivale à seta de voltar do app.

Rotas implementadas no web-poc (`src/router.tsx`, nomes em `src/lib/routes.ts`), em português como as abas.
Roteador: react-router 6 (`createBrowserRouter`), escolhido pelo `useBlocker` (diálogo "Sair da lição?" no
voltar do Android) e pelo `ScrollRestoration` (topo ao abrir tela nova, posição de volta ao voltar).

```
/                          -> /aprender (ou /boas-vindas na primeira visita)
/boas-vindas               -> OnboardingScreen
/aprender                  -> CourseMapScreen (aba Aprender)
/praticar                  -> PracticeScreen (aba Praticar, fila de revisão do dia)
/camera                    -> CameraScreen (dentro de Praticar, com abas)
/social                    -> SocialScreen (aba Social: ligas e squads)
/social/liga               -> LeagueScreen (sem abas)
/perfil                    -> ProfileScreen (aba Perfil)
/sequencia                 -> StreakScreen (sem abas)
/conquistas                -> AchievementsScreen (sem abas)
/configuracoes             -> SettingsScreen (sem abas)
/configuracoes/camera      -> CameraStatsScreen, desempenho da câmera por sinal (sem abas)
/entrar                    -> AuthScreen, modo Entrar (sem abas; fora do onboarding)
/criar-conta               -> AuthScreen, modo Criar conta (sem abas; fora do onboarding)
/auth/callback             -> volta do Google: conclui o login e segue para /aprender
/privacidade               -> LegalScreen, Política de Privacidade (sem abas; fora do onboarding)
/termos                    -> LegalScreen, Termos de Uso (sem abas; fora do onboarding)
/licao/:lessonId           -> LessonScreen (sem abas; exercícios do bundle da lição)
/licao/:lessonId/concluida -> LessonCompletionScreen (sem abas)
/unidade/:unitId/concluida -> UnitCompletionScreen (sem abas)
/curso/concluido           -> CourseCompletionScreen (sem abas)
qualquer outra             -> /
```

Previstas (ainda sem tela): `/social/squads/nova`, `/social/squads/diretorio`, `/social/squads/entrar`,
`/social/squads/:id`, `/social/squads/:id/configuracoes` e `/convite/:code` (spec 04).

Regras:

- **Sair da lição**: ao voltar (seta do app, botão do Android ou gesto) durante uma lição aparece o diálogo
  "Sair da lição?" da seção 2.4. Cancelar mantém a pessoa no exercício em que estava; confirmar volta para o
  mapa. O botão de sair fica sempre no canto superior esquerdo da lição.
- **Sheets e modais**: abrir um bottom sheet ou modal cria uma entrada no histórico; o voltar fecha o sheet em
  vez de sair da tela. No web-poc: hook `useCloseOnBack`, usado pelo `Dialog` e pelos sheets. Com o "Sair da
  lição?" aberto, um novo voltar fecha o diálogo e mantém a pessoa na lição.
- **Lição bloqueada**: `/licao/:id` de uma lição ainda bloqueada no mapa volta ao mapa com um toast. A regra de
  desbloqueio é uma só, em `src/lib/progress.ts`, usada pelo mapa e pela rota.
- **Telas de conclusão** substituem a entrada da lição (`replace`): voltar a partir delas leva ao mapa, nunca
  de novo para a lição terminada. Sem o resultado na memória (página recarregada na conclusão), a rota leva ao
  mapa.
- **Abas**: Aprender é a aba de partida. Sair dela para outra aba cria uma entrada; trocar entre as outras abas
  substitui a entrada atual. Assim o voltar de qualquer aba leva a Aprender, e de Aprender sai do app.
- **Recarregar** a página reabre a mesma URL. Numa lição, a lição recomeça do primeiro exercício. O servidor de
  desenvolvimento e o `vite preview` respondem `index.html` para as rotas; o service worker faz o mesmo
  (`navigateFallback`) e o CDN de produção precisa da mesma regra.
- **Rolagem**: tela nova abre no topo (inclusive cada exercício da lição); ao voltar, a posição anterior é
  restaurada. Telas que leem os dados depois de aparecer (o mapa) restauram só quando o conteúdo já está na tela
  (`useScrollRestore`).
- **Convite**: o link `/convite/:code` é resolvido antes da verificação de conta, para o código não se perder
  no caminho do login.
- **Conta**: `/entrar`, `/criar-conta` e `/auth/callback` ficam fora da exigência de onboarding (o link "Entrar"
  das boas-vindas leva a elas). Trocar entre Entrar e Criar conta substitui a entrada atual. Ao concluir, a tela
  volta para onde a pessoa estava; vinda do convite do fim da lição (`state.returnTo`), segue para a próxima tela
  do fluxo (unidade, curso ou mapa). Sem as variáveis `VITE_COGNITO_*`, as duas telas mostram "Login
  indisponível neste ambiente" e o app segue como convidado.
- **Política e Termos** (`/privacidade`, `/termos`): abrem pelo link direto, sem conta e sem onboarding (o
  Google pede a URL da política na tela de consentimento do login). Texto em `src/legal/*.md`, só em português,
  com versão e vigência em selos no topo, índice das seções e coluna de leitura; os dados de quem responde pelo
  app ficam em `src/legal/responsavel.ts`. Os links aparecem nas boas-vindas, em Entrar e Criar conta ("Ao criar
  a conta, você concorda com os Termos de Uso e a Política de Privacidade") e nas Configurações. Voltar leva à
  tela de origem ou, aberta pelo link direto, ao início.
- **Volta do Google** (`/auth/callback`): nenhum redirecionamento acontece antes de `configureAuth()` e de a
  sessão estar pronta, porque o Amplify precisa ler o `?code=` da URL (PKCE). Depois a rota troca a entrada
  por `/aprender`. Com erro do Google ou sem resposta, mostra "Não foi possível entrar com o Google." e
  "Tentar de novo" (leva a `/entrar`).
- Ao trocar de rota, o foco vai para o título da nova tela (`<h1>` com `tabindex="-1"`) e o título da aba do
  navegador muda junto, para o leitor de tela anunciar a troca.

---

## 12. Acessibilidade e respeito à cultura surda

### 12.1 Checklist (todas as telas)

- [ ] Nenhuma informação só em som: instrução, feedback, tempo e resultado estão na tela.
- [ ] Nenhuma informação só em vibração (o iPhone não vibra no navegador).
- [ ] Nenhuma informação só em cor (ícone, texto, forma ou traço junto).
- [ ] Contraste conforme a seção 4.5, usando apenas tokens.
- [ ] Alvos de toque de 48 x 48, com 8 px entre alvos.
- [ ] Safe areas respeitadas (`env(safe-area-inset-*)`, `viewport-fit=cover`), testado em iPhone com notch e
      Android com navegação por gestos.
- [ ] Altura com `100dvh`; nada some atrás da barra do navegador.
- [ ] `prefers-reduced-motion` e a opção do app respeitados (seção 9.3).
- [ ] `prefers-color-scheme` respeitado; escolha manual "Claro, Escuro, Sistema" nas Configurações grava
      `data-theme` no `<html>`.
- [ ] Zoom e texto grande até 200% sem perder conteúdo nem quebrar a câmera.
- [ ] Foco visível (`:focus-visible`) em tudo que é interativo; ordem de foco igual à visual.
- [ ] Rótulos e `aria-label` em pt-BR; `lang="pt-BR"` no `<html>` (já existe).
- [ ] Nada pisca mais de 3 vezes por segundo.
- [ ] Tempo: nenhum exercício com limite de tempo obrigatório; avanço automático sempre com botão visível.
- [ ] Vídeos de sinal com `video_caption` disponível e controles de repetir e de velocidade (0,5x e 0,75x).
- [ ] Semântica por HTML e ARIA (`role`, `aria-label`, `aria-live`, `aria-current`), testada com VoiceOver no
      iPhone e TalkBack no Android.
- [ ] A tela tem URL e o voltar do navegador faz o que a seção 11.13 diz (lição pergunta "Sair da lição?").
- [ ] Gestos do navegador controlados na lição e na câmera (seção 6.5), sem bloquear o zoom.
- [ ] Nenhum card, linha de lista, banner ou painel com faixa colorida lateral (seção 2.2).
- [ ] Textos seguem a voz da seção 2.4 (você, frases curtas, sem culpa no erro).
- [ ] Estados de carregamento, vazio, erro e offline existem (seção 11.11).

### 12.2 Cultura surda

- Escrever "pessoa surda" e "comunidade surda". Evitar "deficiente auditivo", "portador" e "sofre de surdez".
- Não usar orelha como símbolo, nem imagens de "consertar" a audição.
- Libras é uma língua, não "português com as mãos": usar glosa em caixa alta para sinais e nunca traduzir
  palavra por palavra em exemplos de frase.
- Vídeos gravados por pessoas surdas sinalizantes, com crédito visível no detalhe do sinal. (Gravação própria
  engavetada em 2026-10-25; a regra vale se o tema voltar.)
- Variantes regionais: quando houver, mostrar "Variante" em vez de "certo e errado".
- Não usar sinais ou alfabeto de outra língua de sinais (ASL) em ilustração, ícone ou marca.
- Validar paleta (tangerina, petróleo e framboesa), o símbolo do Traço, ícones e ilustrações de mão com
  consultores surdos antes de publicar.
- Pessoas surdas podem usar o Librax para estudar a forma padronizada: nada no fluxo presume que a pessoa
  ouve (por exemplo, nada de "ouça", "escute" ou "som de acerto" em texto de interface).

---

## 13. Implementação

### 13.1 Fluxo

```
docs/design-tokens.json            (fonte da verdade, editado à mão e revisado em PR)
        |
        v
tools/tokens/build.mjs             (Node, sem dependência)
        |
        +--> apps/web-poc/src/styles/tokens.css    (prioridade: CSS custom properties)
        +--> apps/web-poc/src/styles/tokens.ts     (valores para JS: háptica, som, canvas da câmera)
        +--> apps/mobile_flutter/lib/ui/tokens.g.dart   (opcional, Flutter congelado)
tools/tokens/check-contrast.mjs    (falha se algum par da seção 4.5 cair abaixo do mínimo)
```

Os arquivos gerados levam o aviso "Gerado de docs/design-tokens.json. Não editar." e entram no repositório
(assim o app compila sem rodar o gerador). No `package.json` do web-poc: `npm run tokens` gera os arquivos e roda
antes do `dev` e do `build`; o `build` também roda a verificação de contraste; `npm run tokens:check` não grava
nada e falha se os gerados estiverem desatualizados ou se algum contraste reprovar. Quando houver CI, ele roda o
`tokens:check` em todo PR, o que impede edição manual dos gerados.

Ferramenta: script próprio, sem dependência (decisão 13 da seção 15). O **Style Dictionary 4** lê o mesmo formato
e continua sendo alternativa se um dia for preciso.

### 13.2 Gerador

O gerador real está em `tools/tokens/build.mjs`. O esboço abaixo mostra a ideia central (percorrer o JSON,
resolver aliases e escrever um bloco por modo); o arquivo real também emite as partes de cada tipografia e os
aliases por modo descritos nos ajustes da seção 15.

```js
// tools/tokens/build.mjs  ->  node tools/tokens/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const T = JSON.parse(readFileSync('docs/design-tokens.json', 'utf8'));
const get = (path) => path.split('.').reduce((n, k) => n[k], T);
const resolve = (v) => {
  while (typeof v === 'string' && v.startsWith('{')) v = get(v.slice(1, -1)).$value;
  return v;
};

// Percorre um grupo herdando $type e devolve { path, type, value }
const walk = (node, path = [], type) => {
  const t = node.$type ?? type;
  return Object.entries(node).flatMap(([k, v]) => {
    if (k.startsWith('$') || typeof v !== 'object' || v === null) return [];
    if ('$value' in v) return [{ path: [...path, k], type: v.$type ?? t, value: v.$value }];
    return walk(v, [...path, k], t);
  });
};

const kebab = (p) => p.join('-').replace(/_/g, '-').replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const family = (f) => resolve(f).map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(', ');

const cssValue = ({ type, value }) => {
  const v = resolve(value);
  switch (type) {
    case 'cubicBezier': return `cubic-bezier(${v.join(', ')})`;
    case 'fontFamily':  return family(v);
    case 'shadow':      return v.map((s) => `${s.offsetX} ${s.offsetY} ${s.blur} ${s.spread} ${s.color}`).join(', ');
    case 'typography':  return `${resolve(v.fontWeight)} ${v.fontSize}/${v.lineHeight} ${family(v.fontFamily)}`;
    default:            return typeof v === 'object' ? null : String(v); // háptica, som, molas: vão para o tokens.ts
  }
};

const block = (list, indent = '  ') => list
  .map((t) => [t, cssValue(t)])
  .filter(([, v]) => v !== null)
  .map(([t, v]) => `${indent}--lx-${kebab(t.path)}: ${v};`)
  .join('\n');

const globals = walk(T).filter((t) => t.path[0] !== 'theme' && !['haptic', 'sound'].includes(t.path[0]));
const light = walk(T.theme.light);
const dark = walk(T.theme.dark);
// letter-spacing não cabe no shorthand "font": vira variável própria
const tracking = walk(T.typography, ['typography'])
  .map((t) => `  --lx-${kebab(t.path)}-tracking: ${t.value.letterSpacing};`).join('\n');

writeFileSync('apps/web-poc/src/styles/tokens.css', `/* Gerado de docs/design-tokens.json. Nao editar. */
:root {
${block(globals)}
${tracking}
${block(light)}
  color-scheme: light;
}
:root[data-theme="dark"] {
${block(dark)}
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${block(dark, '    ')}
    color-scheme: dark;
  }
}
`);

// Valores que o JS precisa (canvas do esqueleto, háptica, som, durações)
const js = Object.fromEntries(walk(T).map((t) => [t.path.join('.'), resolve(t.value)]));
writeFileSync('apps/web-poc/src/styles/tokens.ts',
  `// Gerado de docs/design-tokens.json. Nao editar.\nexport const tokens = ${JSON.stringify(js, null, 2)} as const;\n`);
```

Exemplo do CSS gerado:

```css
:root {
  --lx-color-tangerina-500: #F05A0C;
  --lx-space-4: 16px;
  --lx-radius-md: 16px;
  --lx-motion-duration-fast: 150ms;
  --lx-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --lx-typography-body: 400 1rem/1.5 Figtree, system-ui, -apple-system, Roboto, sans-serif;
  --lx-typography-headline: 900 semi-expanded 1.75rem/1.15 Anybody, system-ui, -apple-system, Roboto, sans-serif;
  --lx-typography-body-tracking: 0px;
  --lx-stage-landmark-ready: #3CC873;
  --lx-bg-canvas: #F7F5F2;
  --lx-action-primary-bg: #F05A0C;
  color-scheme: light;
}
```

Uso nos componentes:

```css
.btn-primary {
  min-height: var(--lx-size-button-lg);
  padding: 0 var(--lx-space-6);
  border-radius: var(--lx-radius-md);
  background: var(--lx-action-primary-bg);
  color: var(--lx-action-primary-fg);
  box-shadow: 0 3px 0 var(--lx-action-primary-base);
  font: var(--lx-typography-label);
  letter-spacing: var(--lx-typography-label-tracking);
  transition: transform var(--lx-motion-duration-instant) var(--lx-motion-easing-standard),
              box-shadow var(--lx-motion-duration-instant) var(--lx-motion-easing-standard);
}
.btn-primary:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--lx-action-primary-base); }
.btn-primary:focus-visible { outline: var(--lx-border-width-focus-ring) solid var(--lx-border-focus); outline-offset: var(--lx-border-width-focus-offset); }
```

No canvas do esqueleto (`cameraUtils.ts`), as cores vêm de `tokens['stage.landmark.ready']` em vez de literais.
Os tamanhos de fonte no CSS podem ser convertidos para `rem` no próprio gerador (dividir px por 16) se a equipe
preferir; o essencial é que nenhum componente escreva o número.

### 13.3 Flutter (opcional)

Se o Flutter voltar, o mesmo `walk` gera `tokens.g.dart` com: `class LxTokens` (constantes `Color`, `double`,
`Duration`, `Cubic`), uma `ThemeExtension<LxColors>` com `light` e `dark` a partir de `theme.*`, e o
`ColorScheme` montado explicitamente desses tokens (sem `fromSeed`). Cor `#RRGGBBAA` vira `Color(0xAARRGGBB)`.
A Anybody e a Figtree iriam como asset no `pubspec.yaml`, com `google_fonts` em modo sem busca em tempo de execução. Não é
trabalho do MVP.

### 13.4 Migração do web-poc (estado em out/2026)

Os passos 1 a 9 foram aplicados no web-poc, com duas pendências: o esqueleto de referência tracejado do retry (o
canvas já sabe desenhá-lo, mas ainda não há pontos de referência por sinal) e a opção "Vibração" nas
Configurações (`haptic(evento, enabled)` já aceita). O passo 10 depende de existir CI no repositório.

1. Adicionar `tools/tokens/`, gerar `tokens.css` e importá-lo antes de `style.css`.
2. Trocar o `:root` atual (`style.css:1-55`) por aliases temporários para os novos tokens
   (`--primary: var(--lx-action-primary-bg)` etc.) e remover os aliases "retrocompatibilidade" aos poucos.
3. Substituir os 102 hex soltos e os 34 tamanhos de fonte por tokens, tela por tela.
4. Ajustar `index.html`: `viewport-fit=cover`, `theme-color` por modo, preload das fontes locais; remover o Google
   Fonts. Alinhar `theme_color` do manifest (`vite.config.ts:32`).
5. Safe areas na tab bar, top bar e rodapé de lição.
6. Modo escuro: testar cada tela com `data-theme="dark"`.
7. Trocar FontAwesome por Material Symbols Rounded em SVG (`Nav.tsx` e telas).
8. Esqueleto da câmera com `stage.landmark.*`, halo e referência tracejada; remover o avatar 3D do fluxo do MVP.
9. `haptics.ts` com o padrão da seção 10.2 (erro sem vibração) e opção nas Configurações.
10. Ligar o `check-contrast.mjs` e o "gerado não editado" no CI.

---

## 14. Divergências resolvidas

| Tema | Antes | Agora |
|---|---|---|
| Público | crianças e adultos | adultos, sem infantilização |
| Plataforma | Flutter (doc) e web | mobile web; Flutter opcional |
| Marca | `#4F46E5` (doc/web), `#6C5CE7` (Flutter), depois Azul Sinal `#3651E6` | Traço: tangerina `#F05A0C` claro, `#FF7F33` escuro, sobre grafite |
| Acerto | `#10B981` / `#58CC02` | `verde.600 #14834A` claro, `verde.400 #3CC873` escuro |
| Erro | vermelho `#EF4444` / `#FF4B4B`, depois coral `#C63F24` | framboesa `#B42A5E` claro, `#FF7BA6` escuro |
| XP | `#F59E0B` / `#FFC800` | ouro `#A98500` claro, `#FACB1E` escuro |
| Esqueleto | teal (doc), ciano e rosa (Flutter), cinza/indigo/verde (web) | `stage.landmark.*` da spec 05, com halo |
| Háptica no erro | vibra (doc, web, Flutter) | não vibra |
| Durações | 280 / 300 / 350 ms | `page 300`, `slow 400`, `fast 150` |
| Abas | Início (Flutter) x Social (doc/web) | Aprender, Praticar, Social, Perfil |
| Ícones | Material Symbols (doc), FontAwesome (web) | Material Symbols Rounded em SVG |
| Fonte | Nunito via CDN, depois Nunito local | Anybody e Figtree woff2 auto-hospedadas |
| Modo escuro | automático por semente, nunca implementado | tokens explícitos, verificados |
| Botão primário | pílula (Flutter), raio 24 (doc), depois raio 14 | pílula com efeito tecla (Traço) |
| Avatar 3D | presente no web-poc | fora do MVP |

---

## 15. Decisões aplicadas

A proposta v0.1 deixou 14 decisões em aberto. Treze foram fechadas ao aplicar o design system em `apps/web-poc/`
(out/2026) e na aprovação deste documento; a validação cultural (item 2) continua pendente. A numeração é a
mesma da proposta, porque o código cita os itens por número (por exemplo, "seção 15 item 8").

1. **Paleta**: Azul Sinal (`#3651E6` no claro, `#7290FF` no escuro) no lugar do indigo `#4F46E5`, e turquesa
   para mão e câmera. Substituída pelo Traço em 2026-10-23 (abaixo).
2. **Validação cultural**: continua pendente; não é decisão de código. Falta definir quem são os consultores
   surdos que validam paleta (tangerina, petróleo e framboesa), o símbolo, ícones, cartões culturais e ilustrações, e em que momento do
   cronograma. Até lá, paleta, ícones e textos seguem este documento.
3. **Ligas**: as 7 ligas (Bronze, Prata, Ouro, Safira, Rubi, Ametista, Diamante) ficam nos tokens (`league.*`,
   com contraste verificado). A `LeagueScreen` e o `LeagueResultSheet` usam insígnias com forma própria
   (`src/components/LeagueBadge.tsx`), zonas com seta e texto e a pessoa destacada com contorno completo.
   Enquanto não há API de ligas, o domínio roda no aparelho com concorrentes simulados de forma determinística
   por semana (`src/lib/leagueLocal.ts`, modo local/demo). Os nomes passam pela mesma validação do item 2.
4. **Som padrão**: perguntar no onboarding, junto com a tela de motivo, sem presumir nada pela resposta "sou
   surdo(a)". Sem escolha, o som fica desligado; o interruptor "Sons" fica sempre visível em Configurações >
   Preferências. Sistema em `src/lib/sound.ts` (Web Audio, buffers prontos no primeiro toque, `audioSession`
   'ambient', fila de prioridade da spec 05 seção 3.2). Os sons são gerados por síntese em
   `tools/audio/build.mjs` (AAC `.m4a` em `public/audio/`) e, se um arquivo não carregar, sintetizados na hora
   (`src/lib/sfxSynth.js`). Token `sound.leagueUp` (subida de liga, prioridade 6). No modo reduzido, os sons de
   interface (prioridade 0) não tocam.
5. **Vibração padrão no Android**: ligada (mantido o comportamento do web-poc). `haptic(evento, enabled)` já
   aceita a futura opção "Vibração"; erro nunca vibra e no iOS nada é chamado.
6. **Botão "tecla"**: adotado (base de 3 px em `action.primary.base` que afunda ao tocar).
7. **Mascote**: não há mascote; a mão (esqueleto) é a protagonista.
8. **Telas largas**: mantida a barra lateral do web-poc a partir de 768 px; o conteúdo usa a coluna de
   `size.contentMax` (560 px).
9. **Modo escuro manual**: adotado. Configurações > Preferências > Tema ("Seguir o sistema", "Claro", "Escuro")
   grava `data-theme` no `<html>` e ajusta a `theme-color` da barra do navegador.
10. **Enquadramento com rosto**: por enquanto o guia da câmera mostra só a zona da mão; o rosto entra quando o
    reconhecimento usar rosto (U3 em diante).
11. **Estrelas ou marcas**: três marcas de domínio nos nós concluídos do mapa.
12. **Substituir o `design-system.md`**: feito em 2026-10-23. A proposta virou este documento, o manual antigo
    ficou no histórico do git (seção 1) e `design-system-proposta.md` só aponta para cá.
13. **Ferramenta de geração**: script próprio, sem dependência (`tools/tokens/build.mjs` e
    `tools/tokens/check-contrast.mjs`), ligado ao `package.json` do web-poc (seção 13.1).
14. **Formato dos valores**: strings (`"16px"`), como está no JSON.

Ajustes feitos durante a aplicação:

- Novo token `stage.gold` (`{color.ouro.400}`): ouro das celebrações sobre o palco, que faltava como papel
  semântico (componente não usa primitivo). Entrou na verificação de contraste.
- O gerador também emite as partes de cada tipografia (`--lx-typography-<nome>-size`, `-weight`,
  `-line-height`, `-tracking`) e aliases por modo para grupos com `light`/`dark` (ex.: `--lx-elevation-2`).
- O palco da câmera continua em 4:3 (formato do quadro da câmera) em vez de 3:4, para não cortar a mão nas
  laterais; revisar junto com o layout de retrato da seção 11.7.
- A trilha do mapa ficou reta (sem o deslocamento alternado de 24 px) para o conector de 4 px passar sempre pelo
  centro dos nós.

Acrescentado na aprovação (out/2026), a partir do [`plano-mobile-web.md`](./plano-mobile-web.md):

- Voz e textos de interface do manual antigo, revisados (seção 2.5).
- Regra explícita contra faixa colorida lateral em cards (seções 2.2 e 11.3).
- Cor do tema única para página e manifest (seção 6.3) e gestos do navegador na lição (seção 6.5).
- Demonstração do sinal com o avatar VLibras como solução provisória (seção 11.12).
- Rotas com URL e o voltar do navegador, incluindo "Sair da lição?" (seção 11.13).

### Marca Traço (decidida em 2026-10-23)

O dono escolheu o caminho **Traço** no estudo de marca (`estudo/identidade-visual.md`, protótipo em
`estudo/marca/traco.html`), no lugar da recomendação Constelação. Aplicado ao app no mesmo dia:

- **Paleta**: grafite, tangerina, petróleo e framboesa (seção 4), com os nomes semânticos de sempre. Tokens novos:
  `game.trace.*` (a seta), `game.hand.onFill`, `brand.*` (palavra-marca e símbolo), `brand.icon.*` (ícone),
  `stage.surface`, `stage.border`, `stage.trace`, `radius.button`, `radius.choice`, `font.stretch.*`,
  `typography.button` e `motion.duration.orbit`. Contraste: 265 pares, 0 reprovações.
- **Fontes**: Anybody (largura variável) e Figtree no lugar da Nunito (seção 5).
- **Marca**: símbolo e palavra-marca em SVG (`src/components/Brand.tsx`), favicon e ícones do PWA refeitos,
  `background_color` do manifest no grafite do ícone (tela de abertura do app instalado) e `theme_color` no
  fundo claro.
- **Assinatura** nas telas (seção 2.4): órbita da lição atual, conectores, "Ver o movimento", explosão de setas,
  barra com ponta, insígnias com seta, palco inteiro nos exercícios com câmera.
- **Microcópia**: só onde o `traco.html` define: "Ver de novo", "Repetir" e "Ver o sinal" viram "Ver o
  movimento". Os demais textos funcionais ficaram como estavam.

Diferenças em relação ao protótipo, por decisão de implementação:

- Os valores frios que o protótipo herdou do visual antigo no palco (`#DFE3EC`, `#0C101A`, `rgba(12,16,26,.85)`)
  viraram os equivalentes quentes do grafite; o texto de apoio do palco foi a `#EEEAE4` para passar 4,5:1 sobre
  vídeo branco.
- O trilho das barras no claro ficou `#F2EFEA` (o `#EEEAE4` reprovava o ouro do XP) e a elevação do escuro
  ganhou `#241E19` (seção 4.1).
- As larguras de 115% a 120% do protótipo viraram 112,5% (`semi-expanded`) e as de 125%, `expanded`, porque o
  atalho `font` só aceita palavra-chave.
- A seta das demonstrações não é desenhada por sinal: o avatar VLibras (ou o vídeo) mostra o movimento, e o
  botão "Ver o movimento" repete a demonstração. Seta por sinal pede dado de trajetória que o conteúdo ainda
  não tem (custo apontado no estudo).
- A boas-vindas mantém o seletor de idioma e os pontos dos passos, que o protótipo não mostra, porque são
  funcionais.
