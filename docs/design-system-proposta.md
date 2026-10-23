# Librax - Design System (proposta v0.1)

> Status: proposta para aprovação. Não substitui ainda o `design-system.md`; quando aprovada, a ideia é
> que este documento passe a ser a referência e o antigo vire histórico.
>
> Fonte única da verdade dos valores: [`design-tokens.json`](./design-tokens.json) (formato W3C Design Tokens).
> Este documento explica o porquê e o como; o JSON guarda o quanto.
>
> Premissas do produto (decididas em out/2026):
> - Produto **só mobile web**: abre no navegador do celular, mesma experiência em iPhone (Safari) e Android (Chrome).
>   A implementação é em **CSS custom properties**. O protótipo Flutter está congelado; gerar tema Flutter a partir
>   dos tokens continua possível, mas é opcional e não prioritário.
> - Ícones: **Material Symbols Rounded em SVG** (sai o FontAwesome do web-poc).
> - Tela da câmera: vídeo da própria pessoa com o **esqueleto 2D** por cima. O avatar 3D sai do MVP.
> - Fonte: **Nunito auto-hospedada em woff2**.
> - MVP só em **pt-BR**.
> - Háptica nunca é essencial (iOS não vibra no navegador) e **nada depende de som**.

---

## Sumário

1. Avaliação do que existe hoje
2. Princípios e tom visual
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
15. Decisões em aberto

---

## 1. Avaliação do que existe hoje

### 1.1 Veredito

**Existe, mas está incompleto e inconsistente.** O `design-system.md` é um bom manual de intenção (tom de voz,
componentes, fluxos), mas não é um design system operável:

- não há tokens de verdade nem fonte única: os valores estão em tabelas de Markdown e foram copiados à mão,
  com divergências, para o CSS do web-poc e para o tema Flutter;
- os dois protótipos não batem nem com a doc nem entre si (marca, verde de acerto, XP, abas, esqueleto da mão);
- não existe modo escuro implementado em nenhum dos dois, e a doc delega o escuro ao `fromSeed` do Material 3;
- o contraste WCAG AA é exigido na doc, mas várias combinações reais reprovam;
- o público descrito na doc (crianças) contradiz a visão do produto (adultos);
- faltam peças centrais do jogo: cores e insígnias de liga, estados da tela da câmera (mão não encontrada, pouca
  luz), mapa de fases, ranking, e o que fazer quando o navegador não tem vibração.

### 1.2 Evidências

**Documento (`docs/design-system.md`)**

| Problema | Onde |
|---|---|
| Público infantil, contra "adultos" da visão | `design-system.md:22` ("criança de 8 anos"), `:212` ("menos familiar para crianças") x `00-visao-geral.md:3` ("app para **adultos**") |
| Diz que ensina "para ouvintes", mas a spec trata surdos como público primário | `design-system.md:10` x `spec-05-experiencia-wow.md:684-694` |
| Cor de marca indefinida ("manter ou ajustar") e gerada por semente | `design-system.md:72-78` |
| "Concluída: fundo secondary (verde)", mas secondary é violeta `#7C6ACF` | `design-system.md:361` x `:86` |
| Esqueleto da mão em teal, enquanto a spec 05 define branco/azul/verde/âmbar | `design-system.md:917` x `spec-05-experiencia-wow.md:35-42` |
| Retry com "banner laranja", spec 05 pede verde suave no `accept_soft` | `design-system.md:934` x `spec-05-experiencia-wow.md:495` |
| Erro com háptica (`notificationError`), spec 05 diz "erro: sem háptico"; `notificationSuccess/Error` nem existem no `HapticFeedback` do Flutter | `design-system.md:1067-1082` x `spec-05-experiencia-wow.md:174` |
| Durações divergentes: push 280 ms e sheet 300 ms na doc; 300 ms e 350 ms na spec 05 | `design-system.md:1016`, `:680` x `spec-05-experiencia-wow.md:197`, `:209` |
| Modo escuro "automático" via Material 3, sem valores | `design-system.md:151-156`, `:1098-1110` |
| Ícones Material Symbols na doc, FontAwesome no web | `design-system.md:301` x `apps/web-poc/package.json:15-18` |
| Erro de digitação na fonte ("Nunuito") | `design-system.md:164` |
| Sem ligas, sem estados de pouca luz com visual, sem mapa de fases, sem fallback de vibração no navegador | ausente |

**Web (`apps/web-poc/`)**

| Problema | Onde |
|---|---|
| Há um `:root` com variáveis (bom começo), mas com aliases duplicados "retrocompatibilidade" (`--blue` = `--primary`, `--green` = `--success`) | `src/style.css:1-55`, `:23-28` |
| 102 cores hexadecimais soltas fora das variáveis e 48 `rgba()` | `src/style.css` (ex.: `:670`, `:1382-1383`) |
| 34 tamanhos de fonte diferentes e 59 combinações de padding, sem escala | `src/style.css` |
| Nenhum `prefers-color-scheme`: não há modo escuro | `src/style.css` |
| Nenhum `env(safe-area-inset-*)` e o viewport não tem `viewport-fit=cover`: a tab bar fica sob a barra de gestos do iPhone | `src/style.css:108-119`, `index.html:5` |
| Rótulo da aba com `.68rem` (10,9 px), abaixo do mínimo legível | `src/style.css:135` |
| Botão de acerto com texto branco sobre `#10B981` (2,54:1, reprova) | `src/style.css:288` |
| `--animate-duration` definido duas vezes (600 ms e 720 ms) | `src/style.css:2913`, `:3067` |
| Cor do tema do PWA diferente da página | `vite.config.ts:32` (`#1A56A0`) x `index.html:6` (`#4F46E5`) |
| Paleta Duolingo solta numa tela | `src/screens/ProgressScreen.tsx:68-71` (`#FF9600`, `#FFC800`, `#58CC02`) |
| Esqueleto em cinza/indigo/verde, fora da spec 05 | `src/lib/cameraUtils.ts:33-36` |
| Erro vibra (`[80, 60, 80]`), contra a spec 05 | `src/lib/haptics.ts:3` |
| Fonte carregada do CDN do Google (dependência de rede no PWA e envio de IP a terceiro) | `index.html:8-12` |
| Ponto positivo: já respeita `prefers-reduced-motion` em parte e usa `100dvh` | `src/style.css:3015-3057`, `:74` |

**Flutter (`apps/mobile_flutter/`, congelado)**

| Problema | Onde |
|---|---|
| Marca `#6C5CE7` (doc: `#4F46E5`), acerto `#58CC02` "verde Duolingo", XP `#FFC800` (doc: `#F59E0B`) | `lib/ui/app_theme.dart:9`, `:15`, `:26` |
| Só tema claro; `darkTheme` nunca é passado | `lib/app.dart:13` |
| `ThemeExtension` prevista na doc não existe; cores são `static const` | `lib/ui/app_theme.dart:5` x `design-system.md:1167` |
| Texto secundário `#8A8AA0` sobre `#F7F7FB` (3,16:1, reprova) | `lib/ui/app_theme.dart:36` |
| Cores literais fora do tema | `lib/hand_skeleton.dart:30-33` (ciano e rosa), `lib/screens/home_screen.dart:135`, `lib/lessons/screens/lesson_complete_screen.dart:25` |
| Abas Início, Aprender, Praticar, Perfil; doc e web usam Aprender, Praticar, Social, Perfil | `lib/widgets/librax_nav.dart:10-13` x `design-system.md:656`, `web-poc/src/components/Nav.tsx:16-19` |
| Erro com `heavyImpact` (mais forte que o acerto) | `lib/lessons/widgets/word_choose_video_view.dart:35` |

**Contraste de valores que estão em uso hoje (calculado, WCAG 2.x)**

| Par | Razão | Resultado |
|---|---|---|
| branco sobre `#10B981` (acerto doc/web) | 2,54:1 | reprova |
| branco sobre `#EF4444` (erro doc/web) | 3,76:1 | só texto grande |
| `#F59E0B` (XP e aviso) sobre branco | 2,15:1 | reprova |
| `#FF7800` (streak) sobre branco | 2,65:1 | reprova |
| branco sobre `#58CC02` (acerto Flutter) | 2,09:1 | reprova |
| `#FFC800` (XP Flutter) sobre branco | 1,55:1 | reprova |
| `#8A8AA0` (texto secundário Flutter) sobre `#F7F7FB` | 3,16:1 | reprova |
| `#009688` (teal) sobre branco | 3,67:1 | só texto grande |
| branco sobre `#4F46E5` (primário doc/web) | 6,29:1 | aprova |

### 1.3 O que aproveitar

O manual antigo acerta no tom de voz (seção 9), nos estados de exercício, no "modo sem câmera" e na regra de
nunca depender de áudio. A spec 05 é o melhor material de motion, som e câmera do projeto. Esta proposta mantém
essas decisões, corrige o que diverge e transforma tudo em tokens.

---

## 2. Princípios e tom visual

### 2.1 Princípios

1. **A mão é a protagonista.** Não há mascote. O personagem do Librax é a mão da própria pessoa, desenhada pelo
   esqueleto de pontos. A câmera é um palco escuro onde a mão aparece em luz.
2. **Jogo de adulto.** Competência, ritmo e progresso real, sem fofura. Formas firmes, números grandes, celebração
   curta e precisa. Nada de bichinhos, balões de fala ou linguagem de criança.
3. **Visual primeiro.** Tudo o que importa aparece na tela: instrução, feedback, tempo, ranking. Som e vibração
   só reforçam. Uma pessoa surda com o celular no mudo tem a experiência completa.
4. **Errar é ensaio.** Erro usa coral (não vermelho), nunca vibra, nunca toca som negativo e sempre vem com
   uma dica do que ajustar.
5. **Libras é uma língua.** O design trata Libras com a seriedade de uma língua com gramática própria: créditos
   a quem sinaliza nos vídeos, nada de "deficiência" como enquadramento, imagens validadas pela comunidade surda.
6. **Uma fonte da verdade.** Nenhuma cor, tamanho ou duração nasce no componente. Tudo vem de token.

### 2.2 Tom visual

- **Noturno e preciso.** Fundos neutros azulados (família "noite"), um azul elétrico para ação, turquesa para
  tudo que é mão, câmera e Libras, e ouro reservado para XP e conquistas.
- **Contraste de energia.** Telas de navegação são calmas; câmera e celebração são o momento de luz, sempre
  sobre o palco escuro, nos dois modos.
- **Formas.** Raio médio (14 px) em botões e alternativas, 20 px em cards, pílula só para chips. Botão primário
  com efeito "tecla" (base de 3 px que afunda ao tocar): tátil e de jogo, sem cartum.
- **Tipografia.** Nunito, com pesos altos (800 e 900) para títulos e números, e 400 a 700 para leitura. O
  arredondado da Nunito traz calor; a seriedade vem da paleta, do espaçamento generoso e dos pesos contidos.
- **Proibido: faixa colorida lateral em cards** (borda esquerda grossa de destaque, `border-left` ou barra
  vertical de acento). É um clichê de interface gerada automaticamente. Para dar identidade ou estado a um card,
  use selo/chip com fundo suave, ícone, cor de fundo do card inteiro ou contorno completo.

### 2.3 Por que turquesa e azul

O azul turquesa é associado à identidade surda (no Brasil, o **Setembro Azul** é o mês de visibilidade da
comunidade surda, e a fita azul é o símbolo usado). Usar turquesa para "mão, câmera, sinal" e azul para
"ação" é um aceno a essa cultura, sem caricatura. Isso precisa ser validado com consultores surdos (ver seção 15).

---

## 3. Arquitetura dos tokens

Três camadas, todas no mesmo arquivo `docs/design-tokens.json`:

| Camada | O que é | Exemplo | Quem usa |
|---|---|---|---|
| Primitivos | Paletas e escalas cruas | `color.azul.600 = #3651E6`, `space.4 = 16px` | Só os tokens semânticos |
| Semânticos | Papel na interface, por modo | `theme.light.action.primary.bg -> {color.azul.600}` | Componentes |
| Domínio | Partes do jogo com regra própria | `stage.landmark.ready`, `league.safira.fill`, `haptic.correctCamera` | Componentes do jogo |

Regras:

- Componente nunca usa primitivo direto. Se faltar um papel, cria-se um token semântico.
- `theme.light` e `theme.dark` têm exatamente as mesmas chaves. Trocar de modo é trocar o conjunto, não o componente.
- `stage` (câmera e celebração) e `league` não mudam com o modo.
- No CSS, cada token vira `--lx-<caminho-em-kebab>`: `theme.light.feedback.success.strong` -> `--lx-feedback-success-strong`.

Formato: DTCG (W3C Design Tokens Community Group) com `$value`, `$type`, `$description` e aliases `{grupo.token}`.
Os valores estão em string (`"#3651E6"`, `"16px"`, `"150ms"`), forma aceita pelo Style Dictionary 4 e pelo
script próprio da seção 13. A versão estável do DTCG também aceita valores em objeto (cor com espaço de cor,
dimensão com unidade); se um dia for preciso, a conversão é mecânica.

---

## 4. Cor

### 4.1 Primitivos

| Família | Papel | 100 | 300 | 400 | 600 | 700 | 800 |
|---|---|---|---|---|---|---|---|
| `azul` (Azul Sinal) | ação, marca, foco, info | `#DFE6FF` | `#9BB0FF` | `#7290FF` | `#3651E6` | `#2A3FBF` | `#223293` |
| `turquesa` (Turquesa Mãos) | mão, câmera, Libras | `#CFF7F1` | `#5FDECF` | `#27C9B8` | `#0B8C81` | `#0B6F67` | `#0A5550` |
| `verde` | acerto, progresso | `#D9F7E3` | `#74DE9B` | `#3CC873` | `#14834A` | `#126D39` | `#0F532C` |
| `coral` | erro não punitivo, perigo | `#FFE5DF` | `#FF9C87` | `#FF7A5F` | `#C63F24` | `#9C311C` | `#702415` |
| `ambar` | aviso, streak em risco, dedo a ajustar | `#FFEFD1` | `#FFC35C` | `#FFAA2B` | `#B86E00` | `#8F5500` | `#663D00` |
| `ouro` | XP, conquista | `#FFF6CC` | `#FFDB4D` | `#FACB1E` | `#A98500` | `#7D6200` | `#574500` |
| `chama` | streak | `#FFE6D9` | `#FF9E6B` | `#FF7A3D` | `#C24410` | `#94340D` | `#69250A` |

Neutros `noite` (azulados): `0 #FFFFFF`, `25 #F6F7FA`, `50 #EDEFF5`, `100 #DFE3EC`, `200 #C5CBD8`, `300 #9EA7BA`,
`400 #7F89A0`, `500 #5B6479`, `600 #454D60`, `700 #333A4B`, `800 #242A38`, `850 #1B2130`, `900 #141926`,
`950 #0C101A`, `1000 #06080E` (o palco). A escala completa de cada família está no JSON.

### 4.2 Semânticos (claro e escuro)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `bg.canvas` | `#F6F7FA` | `#0C101A` | Fundo da tela |
| `bg.surface` | `#FFFFFF` | `#141926` | Card, tab bar, sheet |
| `bg.raised` | `#FFFFFF` + sombra | `#1B2130` | Modal, popover (no escuro a cor eleva) |
| `bg.sunken` | `#EDEFF5` | `#06080E` | Campo, área recuada |
| `bg.inverse` | `#141926` | `#F6F7FA` | Toast, tooltip |
| `bg.scrim` | `#06080E` 56% | `#000000` 70% | Atrás de modal |
| `text.primary` | `#141926` | `#F6F7FA` | Texto principal |
| `text.secondary` | `#454D60` | `#9EA7BA` | Texto de apoio |
| `text.tertiary` | `#5B6479` | `#7F89A0` | Placeholder, metadado (ainda AA) |
| `text.disabled` | `#7F89A0` | `#5B6479` | Só desabilitado (isento), nunca informação |
| `text.brand` | `#2A3FBF` | `#9BB0FF` | Link, ação em texto |
| `border.default` | `#C5CBD8` | `#333A4B` | Borda de card |
| `border.strong` | `#7F89A0` | `#7F89A0` | Borda de controle (>= 3:1) |
| `border.focus` | `#3651E6` | `#9BB0FF` | Anel de foco de 3 px |
| `action.primary.bg` / `fg` | `#3651E6` / branco | `#7290FF` / `#0C101A` | Botão primário |
| `action.primary.base` | `#223293` | `#3651E6` | Base da "tecla" |
| `action.danger.bg` / `fg` | `#C63F24` / branco | `#FF7A5F` / `#0C101A` | Ação destrutiva |
| `feedback.success.strong` / `text` / `soft` | `#14834A` / `#126D39` / `#D9F7E3` | `#3CC873` / `#74DE9B` / `#0F532C` | Acerto |
| `feedback.error.strong` / `text` / `soft` | `#C63F24` / `#9C311C` / `#FFE5DF` | `#FF7A5F` / `#FF9C87` / `#702415` | Erro |
| `feedback.warning.strong` / `text` / `soft` | `#FFAA2B` / `#8F5500` / `#FFEFD1` | `#FFAA2B` / `#FFC35C` / `#663D00` | Aviso |
| `game.xp.fill` / `text` | `#A98500` / `#7D6200` | `#FACB1E` / `#FFDB4D` | XP |
| `game.streak.fill` / `text` | `#F05A1A` / `#94340D` | `#FF7A3D` / `#FF9E6B` | Streak |
| `game.hand.fill` / `text` | `#0B8C81` / `#0B6F67` | `#27C9B8` / `#5FDECF` | Elementos de Libras fora da câmera |
| `game.track` | `#EDEFF5` | `#333A4B` | Trilho das barras |
| `game.progress` | `#14834A` | `#3CC873` | Barra da lição |

Observações:

- No escuro, os botões e cores "fortes" ficam claros e o texto sobre eles fica escuro (`#0C101A`). Isso mantém
  contraste e evita o "neon sobre preto" cansativo.
- O ouro no claro é um ouro velho (`#A98500`): é o único ouro que passa 3:1 sobre branco. O brilho do ouro
  (`#FACB1E`) aparece no escuro e no palco.

### 4.3 Palco da câmera e das celebrações (`stage`)

Igual nos dois modos, sempre escuro.

| Token | Valor | Uso |
|---|---|---|
| `stage.bg` | `#06080E` | Fundo atrás do vídeo e das celebrações |
| `stage.scrim` | `#06080E` 64% | Escurece o vídeo sob texto (garante 6:1 mesmo com vídeo branco) |
| `stage.pill` | `#0C101A` 80% | Fundo das mensagens de status sobre o vídeo |
| `stage.text` / `textSecondary` | `#FFFFFF` / `#DFE3EC` | Texto no palco |
| `stage.landmark.halo` | `#06080E` 85% | Contorno sob cada linha do esqueleto (legível sobre qualquer vídeo) |
| `stage.landmark.idle` | branco 80% | Mão detectada, confiança baixa |
| `stage.landmark.tracking` | `#5FDECF` | Confiança subindo (> 40%) |
| `stage.landmark.ready` | `#3CC873` | No limiar de aceite |
| `stage.landmark.correct` | `#74DE9B` + brilho | Acerto confirmado |
| `stage.landmark.retry` | `#FFAA2B` | Dedo a ajustar (pisca 2 vezes) |
| `stage.landmark.reference` | `#9BB0FF` 80%, tracejado | Esqueleto de referência no retry |
| `stage.guide.idle` / `ok` / `warn` | branco 70% / `#74DE9B` / `#FFC35C` | Guia de enquadramento |

### 4.4 Ligas (`league`)

Sete ligas, em ordem: Bronze, Prata, Ouro, Safira, Rubi, Ametista, Diamante (nomes a confirmar, seção 15).
A cor nunca vem sozinha: cada liga tem forma própria e o nome sempre escrito.

| Liga | Preenchimento | Texto sobre ela | Contorno (2 px) | Forma da insígnia |
|---|---|---|---|---|
| Bronze | `#B0703A` | `#0C101A` | `#6B4A1F` | círculo |
| Prata | `#A7B2C2` | `#0C101A` | `#6E7A8C` | escudo |
| Ouro | `#E0AE12` | `#0C101A` | `#8A6A00` | escudo com coroa |
| Safira | `#3460E6` | `#FFFFFF` | `#1B2768` | hexágono |
| Rubi | `#CC2B57` | `#FFFFFF` | `#7A1733` | octógono |
| Ametista | `#7B4FE0` | `#FFFFFF` | `#45288F` | estrela de 5 pontas |
| Diamante | `#6FD9E8` | `#0C101A` | `#1A7A88` | diamante facetado |

### 4.5 Contraste verificado

Calculado com a fórmula de luminância relativa do WCAG 2.x sobre os valores reais do `design-tokens.json`
(196 pares, 0 reprovações). Cores com transparência foram compostas sobre o fundo antes do cálculo; no palco, o
pior caso considerado é vídeo totalmente branco. Mínimos: 4,5:1 para texto, 3:1 para componentes e gráficos
(WCAG 1.4.11).

| Par (frente / fundo) | Claro | Escuro | Mínimo |
|---|---|---|---|
| text.primary / bg (pior de canvas, surface, raised) | 16.38 | 15.00 | 4.5 |
| text.secondary / bg (pior de canvas, surface, raised) | 7.89 | 6.65 | 4.5 |
| text.tertiary / bg (pior de canvas, surface, raised) | 5.53 | 4.58 | 4.5 |
| text.brand / bg (pior de canvas, surface, raised) | 7.65 | 7.69 | 4.5 |
| feedback.success.text / bg (pior de canvas, surface, raised) | 5.99 | 9.69 | 4.5 |
| feedback.error.text / bg (pior de canvas, surface, raised) | 6.83 | 7.93 | 4.5 |
| feedback.warning.text / bg (pior de canvas, surface, raised) | 5.65 | 10.11 | 4.5 |
| feedback.info.text / bg (pior de canvas, surface, raised) | 7.65 | 7.69 | 4.5 |
| game.xp.text / bg (pior de canvas, surface, raised) | 5.42 | 11.85 | 4.5 |
| game.streak.text / bg (pior de canvas, surface, raised) | 7.11 | 7.92 | 4.5 |
| game.hand.text / bg (pior de canvas, surface, raised) | 5.63 | 9.82 | 4.5 |
| border.strong / bg (pior de canvas, surface, raised) (não texto) | 3.27 | 4.58 | 3 |
| border.focus / bg (pior de canvas, surface, raised) (não texto) | 5.64 | 7.69 | 3 |
| action.primary.bg / bg (pior de canvas, surface, raised) (não texto) | 5.64 | 5.47 | 3 |
| feedback.success.strong / bg (pior de canvas, surface, raised) (não texto) | 4.48 | 7.42 | 3 |
| feedback.error.strong / bg (pior de canvas, surface, raised) (não texto) | 4.74 | 6.28 | 3 |
| game.xp.fill / bg (pior de canvas, surface, raised) (não texto) | 3.24 | 10.43 | 3 |
| game.streak.fill / bg (pior de canvas, surface, raised) (não texto) | 3.17 | 6.20 | 3 |
| game.hand.fill / bg (pior de canvas, surface, raised) (não texto) | 3.86 | 7.75 | 3 |
| text.tertiary / bg.sunken | 5.15 | 5.71 | 4.5 |
| text.inverse / bg.inverse | 17.55 | 17.75 | 4.5 |
| action.primary.fg / action.primary.bg | 6.04 | 6.47 | 4.5 |
| action.primary.fg / action.primary.bgPressed | 8.20 | 9.10 | 4.5 |
| action.secondary.fg / action.secondary.bg | 8.20 | 8.40 | 4.5 |
| action.danger.fg / action.danger.bg | 5.08 | 7.42 | 4.5 |
| feedback.success.onStrong / feedback.success.strong | 4.80 | 8.78 | 4.5 |
| feedback.error.onStrong / feedback.error.strong | 5.08 | 7.42 | 4.5 |
| feedback.warning.onStrong / feedback.warning.strong | 9.99 | 9.99 | 4.5 |
| feedback.info.onStrong / feedback.info.strong | 6.04 | 6.47 | 4.5 |
| feedback.success.onSoft / feedback.success.soft | 8.01 | 8.01 | 4.5 |
| feedback.error.onSoft / feedback.error.soft | 8.98 | 8.98 | 4.5 |
| feedback.warning.onSoft / feedback.warning.soft | 8.30 | 8.30 | 4.5 |
| feedback.info.onSoft / feedback.info.soft | 8.69 | 11.00 | 4.5 |
| game.xp.text / game.xp.soft | 5.33 | 6.87 | 4.5 |
| game.streak.text / game.streak.soft | 6.38 | 5.54 | 4.5 |
| game.hand.text / game.hand.soft | 5.23 | 5.29 | 4.5 |
| text.primary / game.locked.bg | 13.65 | 13.40 | 4.5 |
| game.locked.fg / game.locked.bg (icone) | 4.61 | 5.94 | 3 |
| game.progress / game.track (não texto) | 4.17 | 5.25 | 3 |
| game.xp.fill / game.track (não texto) | 3.02 | 7.37 | 3 |

| Grupo | Par | Razão | Mínimo |
|---|---|---|---|
| stage | stage.text / scrim sobre vídeo branco | 6.19 | 4.5 |
| stage | stage.textSecondary / scrim sobre vídeo branco | 4.81 | 4.5 |
| stage | stage.text / pill sobre vídeo branco | 10.37 | 4.5 |
| stage | stage.text / stage.bg | 20.02 | 4.5 |
| stage | landmark.idle / halo sobre vídeo branco (não texto) | 9.39 | 3 |
| stage | landmark.idle / stage.bg (não texto) | 12.71 | 3 |
| stage | landmark.tracking / halo sobre vídeo branco (não texto) | 8.42 | 3 |
| stage | landmark.tracking / stage.bg (não texto) | 12.24 | 3 |
| stage | landmark.ready / halo sobre vídeo branco (não texto) | 6.37 | 3 |
| stage | landmark.ready / stage.bg (não texto) | 9.25 | 3 |
| stage | landmark.correct / halo sobre vídeo branco (não texto) | 8.31 | 3 |
| stage | landmark.correct / stage.bg (não texto) | 12.07 | 3 |
| stage | landmark.retry / halo sobre vídeo branco (não texto) | 7.24 | 3 |
| stage | landmark.retry / stage.bg (não texto) | 10.52 | 3 |
| stage | landmark.reference / halo sobre vídeo branco (não texto) | 4.81 | 3 |
| stage | landmark.reference / stage.bg (não texto) | 6.33 | 3 |
| stage | guide.idle / stage.bg (não texto) | 9.78 | 3 |
| stage | guide.ok / stage.bg (não texto) | 12.07 | 3 |
| stage | guide.warn / stage.bg (não texto) | 12.60 | 3 |
| liga | bronze: onFill / fill | 4.73 | 4.5 |
| liga | bronze: edge / surface claro (não texto) | 8.00 | 3 |
| liga | bronze: fill / surface escuro (não texto) | 4.37 | 3 |
| liga | prata: onFill / fill | 8.86 | 4.5 |
| liga | prata: edge / surface claro (não texto) | 4.35 | 3 |
| liga | prata: fill / surface escuro (não texto) | 8.18 | 3 |
| liga | ouro: onFill / fill | 9.26 | 4.5 |
| liga | ouro: edge / surface claro (não texto) | 5.07 | 3 |
| liga | ouro: fill / surface escuro (não texto) | 8.55 | 3 |
| liga | safira: onFill / fill | 5.30 | 4.5 |
| liga | safira: edge / surface claro (não texto) | 13.67 | 3 |
| liga | safira: fill / surface escuro (não texto) | 3.31 | 3 |
| liga | rubi: onFill / fill | 5.18 | 4.5 |
| liga | rubi: edge / surface claro (não texto) | 10.51 | 3 |
| liga | rubi: fill / surface escuro (não texto) | 3.38 | 3 |
| liga | ametista: onFill / fill | 5.20 | 4.5 |
| liga | ametista: edge / surface claro (não texto) | 10.75 | 3 |
| liga | ametista: fill / surface escuro (não texto) | 3.37 | 3 |
| liga | diamante: onFill / fill | 11.56 | 4.5 |
| liga | diamante: edge / surface claro (não texto) | 5.02 | 3 |
| liga | diamante: fill / surface escuro (não texto) | 10.67 | 3 |

Regras que o contraste não resolve sozinho:

- **Cor nunca é a única pista.** Acerto tem ícone de check e a palavra "Correto"; erro tem ícone e dica escrita;
  zonas do ranking têm seta e texto; ligas têm forma e nome; estados do esqueleto mudam também a espessura e o
  traço (referência é tracejada).
- Texto sobre vídeo só com `stage.scrim` ou `stage.pill` por baixo.
- Desabilitado (`text.disabled`) é isento pelo WCAG, mas nunca carrega informação necessária.

---

## 5. Tipografia

### 5.1 Fonte

**Nunito** (SIL Open Font License 1.1), auto-hospedada em woff2. Uma só família; o papel muda pelo peso.

- Arquivo variável `Nunito[wght].woff2` (eixo 200 a 1000) com subset latino (cobre todo o pt-BR), servido de
  `/fonts/`. Fallback: `system-ui, -apple-system, Roboto, sans-serif`.
- `font-display: swap` e `<link rel="preload" as="font" type="font/woff2" crossorigin>` no `index.html`.
- O service worker do PWA faz cache da fonte: o app abre offline com a tipografia certa.
- Sai o `<link>` do Google Fonts (`index.html:8-12`): sem dependência de rede e sem enviar IP a terceiro (LGPD).

```css
@font-face {
  font-family: "Nunito";
  src: url("/fonts/Nunito-latin-wght.woff2") format("woff2-variations"),
       url("/fonts/Nunito-latin-wght.woff2") format("woff2");
  font-weight: 200 1000;
  font-style: normal;
  font-display: swap;
}
```

Números de XP, ranking e cronômetro usam `font-variant-numeric: tabular-nums` para não "pularem" ao mudar.
Conferir no arquivo baixado se a versão da Nunito tem a feature `tnum`; se não tiver, a propriedade é ignorada
sem quebrar nada.

### 5.2 Escala (pensada para 360 x 640)

| Token | Tamanho / linha | Peso | Uso |
|---|---|---|---|
| `typography.displayXl` | 40 / 44 | 900 | "Lição concluída!" |
| `typography.display` | 32 / 37 | 800 | Onboarding, resultado de liga |
| `typography.headline` | 26 / 31 | 700 | Título de tela |
| `typography.title` | 20 / 26 | 700 | Card, cabeçalho de unidade, modal |
| `typography.titleSm` | 17 / 23 | 700 | Nome de lição, linha de lista |
| `typography.bodyLg` | 18 / 27 | 400 | Enunciado do exercício |
| `typography.body` | 16 / 24 | 400 | Texto padrão |
| `typography.bodySm` | 14 / 20 | 400 | Texto secundário |
| `typography.label` | 16 / 20 | 700 | Botão |
| `typography.labelSm` | 13 / 16 | 700 | Aba, chip, badge |
| `typography.caption` | 12 / 16 | 600 | Menor texto permitido |
| `typography.numericXl` | 48 / 48 | 900, tabular | Contador de XP, streak em destaque |
| `typography.numeric` | 20 / 24 | 700, tabular | Ranking, placar |

Regras:

- No CSS, tamanhos em `rem` (16 px = 1 rem), para respeitar o zoom e o tamanho de texto do navegador. Testar
  com zoom de 200% (WCAG 1.4.4) sem perder conteúdo; usar quebra de linha, nunca `text-overflow` em instrução.
- Nada abaixo de 12 px. O rótulo da aba sobe de 10,9 px para 13 px.
- Linha de leitura com no máximo 45 caracteres no enunciado; instrução em até 2 linhas.
- Sem itálico (pouca diferença visual na Nunito e pior leitura em tela pequena). Ênfase com peso.
- Glosa de sinal (o nome do sinal em Libras, como `OBRIGADO`) sempre em caixa alta, peso 800, com
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
  app continua com cara de app (coluna central, tab bar embaixo da coluna); não há sidebar de desktop no MVP.
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

---

## 7. Raio, borda e elevação

| Raio | Valor | Uso |
|---|---|---|
| `radius.xs` | 6 px | Badge pequeno, barra |
| `radius.sm` | 10 px | Chip retangular, campo pequeno |
| `radius.md` | 14 px | Botão, alternativa, campo, linha de ranking |
| `radius.lg` | 20 px | Card, vídeo de sinal, modal |
| `radius.xl` | 28 px | Topo de bottom sheet |
| `radius.full` | 999 px | Chip de XP e streak, avatar, nó do mapa |

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
| Erro receptivo | tile vira coral, deslocamento lateral de 4 px uma vez | `fast` |
| Acerto com câmera | barra trava (50 ms), esqueleto "cristaliza" 1.0 -> 1.08 -> 1.0, anel de luz, "+XP" sobe | `crystallize`, `celebrate` |
| Barra de progresso | largura anima | `slow`, `decelerate` |
| Fase desbloqueada | nó cresce com mola e anel pulsa uma vez | `emphasis`, `overshoot` |
| Sheet de conquista | sobe com mola, insígnia gira 8 graus e assenta | `slow`, `overshoot` |
| Troca de aba | fade de conteúdo, sem deslizar | `base` |

### 9.3 Reduzir movimento

Vale para `prefers-reduced-motion: reduce` e para a opção "Reduzir animações" nas Configurações do app (útil
para quem não acha a opção do sistema).

- Troca deslocamento, escala e mola por fade de `fast`.
- Confete desligado: a conquista aparece estática, com o mesmo texto.
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
| `wrong` | nenhum | Tile coral + ícone + dica. Erro nunca vibra |
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
// src/lib/haptics.ts (proposta)
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
- Opções em Configurações: "Sons" e "Vibração", independentes. O padrão dos sons é uma decisão em aberto (seção 15).
- Legenda: vídeos de sinal não têm áudio relevante; quando houver qualquer narração, ela tem legenda.

---

## 11. Componentes

Cada componente lista anatomia, tokens e estados. Nomes seguem as specs (`CourseMapScreen`, `LessonNode`, etc.).

### 11.1 Botões

| Variante | Visual | Tokens |
|---|---|---|
| Primário ("tecla") | Fundo `action.primary.bg`, texto `action.primary.fg`, base de 3 px em `action.primary.base` | `size.buttonLg`, `radius.md`, `typography.label` |
| Secundário | Fundo `action.secondary.bg`, borda 2 px `border.strong`, texto `text.brand` | `size.buttonMd` |
| Terciário (texto) | Sem fundo, texto `text.brand`, sublinhado no foco | área de toque 48 |
| Perigo | Fundo `action.danger.bg`, texto `action.danger.fg`, só em confirmação | |
| Ícone | 48 x 48, ícone 24, fundo transparente ou `bg.sunken` | `aria-label` obrigatório |

Estados: repouso; pressionado (base some, conteúdo desce 2 px, `instant`); foco (anel `border.focus` 3 px,
afastado 2 px, só com teclado: `:focus-visible`); carregando (spinner 20 px no lugar do texto, largura mantida,
`aria-busy`); desabilitado (`action.disabled.*`, sem base, `aria-disabled`). Botão primário ocupa a largura toda
no rodapé de exercício. Rótulo sempre verbo: "Verificar", "Continuar", "Tentar de novo".

### 11.2 Alternativa de exercício (`ChoiceTile`)

Altura mínima 64, raio `md`, borda 2 px, texto `bodyLg` peso 700 (ou miniatura de vídeo 16:9 com raio `md`).

| Estado | Borda | Fundo | Extra |
|---|---|---|---|
| Neutro | `border.default` | `bg.surface` | |
| Selecionada | 3 px `border.focus` | `bg.surface` | escala 0.98 |
| Correta | 3 px `feedback.success.strong` | `feedback.success.soft` | ícone check |
| Incorreta | 3 px `feedback.error.strong` | `feedback.error.soft` | ícone `close` |
| Revelada (a certa, após erro) | 2 px tracejada `feedback.success.strong` | `bg.surface` | "Resposta certa" em `caption` |
| Desabilitada (após verificar) | `border.default` | `bg.surface` | opacidade 0.6 nas não envolvidas |

Grupo com `role="radiogroup"`; cada tile `role="radio"` com `aria-checked`. O resultado é anunciado por uma região
`aria-live="polite"` no feedback.

### 11.3 Card de lição e cabeçalho de unidade

- **Cabeçalho de unidade** (`UnitSection`): fica fixo no topo ao rolar o mapa. Fundo `bg.surface`, "Unidade 2" num
  selo arredondado (`game.hand.soft` com texto `game.hand.text`, `labelSm`), título em `title`, progresso "3 de 6
  lições" e barra fina. Botão "Guia" (lista de sinais da unidade) à direita.
- **Card de continuar** (`ResumeBanner` / `ContinueLessonCard`): o card de destaque da tela inicial. Fundo
  `stage.bg` com brilho `stage.glow.brand`, glosa do próximo sinal em destaque, botão primário "Continuar".
  É o único card escuro no modo claro: antecipa o palco.
- **Card de meta diária** (`DailyGoalBar`): ícone `bolt`, "12 de 20 XP hoje", barra `progressGoal` em
  `game.xp.fill`.

### 11.4 Mapa e trilha de fases (`CourseMapScreen` / `LessonNode`)

Uma trilha vertical, como uma linha de metrô: um conector contínuo de 4 px liga os nós, que alternam
levemente à esquerda e à direita (deslocamento de 24 px). Diferente de um mapa infantil, **cada nó tem rótulo
escrito ao lado** (nome da lição e "3 sinais"), o que ajuda leitura e leitor de tela.

| Estado | Nó | Conector até ele | Rótulo |
|---|---|---|---|
| Bloqueada | 64 px, `game.locked.bg`, ícone `lock` em `game.locked.fg` | tracejado `border.default` | `text.tertiary` |
| Disponível | 64 px, `action.primary.bg`, número da lição | sólido `border.strong` | `text.primary` |
| Atual | 76 px, `action.primary.bg` + anel de 4 px `game.hand.fill` pulsando (`ambient`), balão "Começar" | sólido | `titleSm` |
| Concluída | 64 px, `feedback.success.strong`, ícone `check`, três marcas de domínio abaixo | sólido `game.progress` | `text.secondary` |
| Revisão devida | 64 px, `game.hand.soft` com borda `game.hand.fill`, ícone `replay` | sólido | "Revisar" |
| Desafio da unidade | hexágono 76 px, `league` da cor ouro, ícone `trophy` | sólido | "Desafio" |

- Ao abrir, a lista rola até o nó atual (sem animação se reduzir movimento).
- Estrutura semântica: `<ol>` de lições; cada nó é um botão com `aria-label` completo ("Lição 4, Cumprimentos,
  disponível") e `aria-disabled` quando bloqueado. Toque em bloqueado mostra o motivo ("Conclua a lição 3").
- Os nós e rótulos ficam dentro da coluna de 4 colunas; o conector é decorativo (`aria-hidden`).

### 11.5 Barras de progresso

| Barra | Altura | Preenchimento | Trilho | Texto obrigatório |
|---|---|---|---|---|
| Lição (`LessonProgressBar`, topo do exercício) | 12 | `game.progress` | `game.track` | `aria-valuenow` e "4 de 10" para leitor de tela |
| Meta diária | 10 | `game.xp.fill` | `game.track` | "12 de 20 XP" visível |
| Confiança (`ConfidenceBar`, câmera) | 8 | `stage.landmark.idle` -> `tracking` -> `ready` | branco 20% | marca do limiar visível + estado em texto |
| XP da squad | 6 | `action.primary.bg` | `game.track` | valor ao lado |

Todas com raio `full`, `role="progressbar"`. A barra de confiança tem um traço vertical no limiar e, ao atingir,
"trava" (pisca uma vez em `ready`). Com leitor de tela, ela não anuncia cada oscilação: só "Mão detectada",
"Quase lá" e "Reconhecido".

### 11.6 Feedback de acerto e erro (`FeedbackOverlay` / painel do rodapé)

Painel que sobe do rodapé (`slow`, `decelerate`), cobre o botão e fica acima da safe area. Elevação 2.

| Estado | Fundo | Ícone (32) | Título | Corpo | Botão |
|---|---|---|---|---|---|
| Correto | `feedback.success.soft` | `check_circle` em `feedback.success.strong` | "Correto!" (varia, seção 9.2 do manual antigo) em `title`, cor `feedback.success.onSoft` | glosa do sinal | primário "Continuar" (ou avanço automático de 1,2 s na câmera, com botão visível) |
| Quase (erro receptivo) | `feedback.error.soft` | `lightbulb` em `feedback.error.strong` | "Quase!" | "A resposta certa é OBRIGADO." | primário "Continuar" |
| Retry (câmera) | `feedback.warning.soft` | `lightbulb` | "Quase!" | dica do parâmetro (`nearestErrorHint`) | primário "Tentar de novo" e terciário "Ver o sinal" |
| `accept_soft` | `feedback.success.soft` | `check_circle` | "Bom trabalho!" | "Este sinal é desafiador. Continue praticando." | "Continuar" |

- O painel é uma região `aria-live="assertive"` só no momento da verificação.
- O avanço automático nunca acontece sem um botão visível e para se o usuário tocar no painel (ninguém perde a
  dica por ler devagar; WCAG 2.2.1).

### 11.7 Tela da câmera (o palco)

**Layout em retrato (360 x 640 como referência)**

```
[safe area topo + top bar transparente: X | barra da lição | "Ver o sinal"]
[palco: vídeo espelhado 3:4, ~58% da altura, raio lg só embaixo]
   - esqueleto 2D por cima (canvas), guia de enquadramento, pílula de status
   - barra de confiança na base do palco
[painel de instrução: miniatura do sinal de referência (RefVideoThumb) + "Faça o sinal de OBRIGADO"]
[rodapé: "Pular este sinal" (terciário) | estado ou botão]
```

- Vídeo da própria pessoa espelhado (`transform: scaleX(-1)` no vídeo e no canvas). Sem avatar 3D no MVP.
- Fundo do palco `stage.bg`, também no modo claro.
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
| Retry | rejeite com dica | dedo em âmbar pisca 2 vezes, referência tracejada aparece, painel de retry | não, é ensaio |
| Sem câmera | escolha do usuário ou falha | vídeo de referência + "Já sei fazer este sinal" (sem penalizar streak) | não |

Nenhum desses estados depende de som. Mensagens de status entram por `aria-live="polite"`, no máximo uma a cada
3 s, para não inundar o leitor de tela.

### 11.8 Modal de conquista (sheet de celebração)

- Bottom sheet de altura automática, fundo `stage.bg` (sempre escuro), topo com raio `xl`, `elevation 3`.
- Insígnia de 96 px no centro com brilho `stage.glow.gold`; título em `display` (`stage.text`), descrição em
  `body` (`stage.textSecondary`), "+50 XP" em `numeric` `game.xp.fill` do escuro.
- Botões: primário "Continuar" e secundário "Compartilhar".
- Confete só nas conquistas maiores (regras da spec 05 seção 5.2); desligado com reduzir movimento.
- Foco vai para o título ao abrir, `role="dialog"`, `aria-modal="true"`, fecha com o botão e com arrastar.
- No máximo 2 celebrações por sessão (spec 05 seção 6.2); o resto fica para a próxima abertura.

### 11.9 Ranking da liga (`LeagueScreen` / `RankingList`)

- **Cabeçalho**: insígnia da liga (forma e cor, seção 4.4), "Liga Safira" em `headline`, "Semana 12" e
  `LeagueTimer` "Encerra em 2d 5h" com ícone de relógio.
- **Legenda de zonas** (`PromotionLegend`): "Top 3 sobem para Rubi" com `arrow_upward` em
  `feedback.success.text`; "Últimos 10 descem para Ouro" com `arrow_downward` em `feedback.error.text`.
- **Linha** (altura 64, raio `md`): posição em `numeric` (tabular, largura fixa de 3 dígitos), avatar 40,
  nome em `titleSm` (até 1 linha, depois reticências), XP da semana em `numeric` alinhado à direita.
- **Divisórias de zona**: uma linha com texto "Zona de promoção" e "Zona de rebaixamento" separa os grupos;
  as linhas da zona têm a seta ao lado da posição. A informação nunca está só no fundo colorido.
- **Usuário atual**: fundo `brandSoft` (`azul.100` no claro, `azul.900` no escuro), borda 2 px `border.focus`,
  "Você" junto ao nome, e fica fixa no rodapé da lista quando sair da tela.
- **Resultado do período** (`LeagueResultSheet`): mesmo modelo do modal de conquista; promoção com confete
  na cor da nova liga, rebaixamento sem confete e com tom neutro ("Acontece. Uma semana constante te traz de volta.").
- Lista com `<ol>`; cada linha anuncia "3º lugar, Ana, 420 XP, zona de promoção".

### 11.10 Navegação por abas

- Quatro abas: **Aprender, Praticar, Social, Perfil** (a doc antiga e o web já usam essas; o Flutter tinha
  "Início", que sai). Social reúne Ligas e Squads.
- Barra fixa embaixo, fundo `bg.surface`, borda superior `border.subtle`, altura 64 + safe area inferior.
- Item: ícone 24 + rótulo `labelSm` sempre visível; área mínima 48 x 48. Ativo: ícone preenchido, cor
  `text.brand`, indicador em pílula `azul.100` / `azul.900` atrás do ícone. Inativo: contorno, `text.secondary`.
- `<nav aria-label="Principal">` com `aria-current="page"` (já existe em `Nav.tsx:30-39`).
- Some em lição, câmera e celebração (imersão total).
- **Top bar do app** (abas): título da tela à esquerda, chips de streak (`local_fire_department` +
  número em `game.streak.text`) e XP (`bolt` + número em `game.xp.text`) à direita, cada chip com área de 48.

### 11.11 Estados vazios, carregamento e erro

- **Vazio**: ícone 64 (ou animação do esqueleto, spec 05 seção 11), título em `title`, uma frase em `body`
  `text.secondary`, um botão primário com a próxima ação e, no máximo, um secundário. Textos da spec 05 seção 11.
- **Carregamento**: skeleton com as formas do conteúdo real, cor `bg.sunken`, brilho passando em 1,5 s
  (desligado com reduzir movimento: fica estático). Spinner só dentro de botão. Nada de tela branca: o shell
  (top bar e abas) aparece de imediato.
- **Offline**: banner discreto no topo, `feedback.warning.soft`, "Você está offline. Seu progresso fica salvo
  e sincroniza depois." As lições baixadas continuam disponíveis.
- **Erro de carregamento**: ícone, "Não foi possível carregar.", botão "Tentar de novo". Nunca código de erro
  na cara do usuário.

### 11.12 Outros

- **Toast**: `bg.inverse`, `text.inverse`, raio `md`, acima da tab bar e da safe area, 4 s (6 s com ação),
  `role="status"`.
- **Diálogo de confirmação**: `bg.raised`, raio `lg`, título `title`, botões "Cancelar" (secundário) e a ação
  (primário ou perigo). Textos do manual antigo seção 9.6.
- **Bottom sheet**: topo `radius.xl`, alça de 4 x 32 px, fundo `bg.raised`, `bg.scrim` atrás.
- **Chip de XP ganho** ("+20 XP"): pílula `game.xp.soft` com texto `game.xp.text`, sobe 12 px e some (`celebrate`).
- **Cartão cultural** (spec 05 seção 8): fundo `game.hand.soft`, ícone 64, título `title`, texto `body`,
  "Continuar". O `bg_color` livre do schema da spec 05 passa a ser um nome de token, para manter o contraste.

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

### 12.2 Cultura surda

- Escrever "pessoa surda" e "comunidade surda". Evitar "deficiente auditivo", "portador" e "sofre de surdez".
- Não usar orelha como símbolo, nem imagens de "consertar" a audição.
- Libras é uma língua, não "português com as mãos": usar glosa em caixa alta para sinais e nunca traduzir
  palavra por palavra em exemplos de frase.
- Vídeos gravados por pessoas surdas sinalizantes, com crédito visível no detalhe do sinal.
- Variantes regionais: quando houver, mostrar "Variante" em vez de "certo e errado".
- Não usar sinais ou alfabeto de outra língua de sinais (ASL) em ilustração, ícone ou marca.
- Validar paleta (o uso do azul turquesa), ícones e ilustrações de mão com consultores surdos antes de publicar.
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
tools/tokens/check-contrast.mjs    (CI: reprova o PR se algum par da seção 4.5 cair abaixo do mínimo)
```

Os arquivos gerados levam o aviso "Gerado de docs/design-tokens.json. Não editar." e entram no repositório
(assim o app compila sem rodar o gerador). Um passo de CI roda o gerador e falha se houver diferença (`git diff
--exit-code`), o que impede edição manual.

Alternativa ao script próprio: **Style Dictionary 4**, que lê esse formato. O script próprio cabe em ~80 linhas,
não adiciona dependência e trata os casos específicos (modos, palco, háptica). A escolha é a decisão 13 da seção 15.

### 13.2 Gerador (esboço)

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
  --lx-color-azul-600: #3651E6;
  --lx-space-4: 16px;
  --lx-radius-md: 14px;
  --lx-motion-duration-fast: 150ms;
  --lx-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --lx-typography-body: 400 16px/1.5 Nunito, system-ui, -apple-system, Roboto, sans-serif;
  --lx-typography-body-tracking: 0px;
  --lx-stage-landmark-ready: #3CC873;
  --lx-bg-canvas: #F6F7FA;
  --lx-action-primary-bg: #3651E6;
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
A Nunito iria como asset no `pubspec.yaml`, com `google_fonts` em modo sem busca em tempo de execução. Não é
trabalho do MVP.

### 13.4 Migração do web-poc (ordem sugerida)

1. Adicionar `tools/tokens/`, gerar `tokens.css` e importá-lo antes de `style.css`.
2. Trocar o `:root` atual (`style.css:1-55`) por aliases temporários para os novos tokens
   (`--primary: var(--lx-action-primary-bg)` etc.) e remover os aliases "retrocompatibilidade" aos poucos.
3. Substituir os 102 hex soltos e os 34 tamanhos de fonte por tokens, tela por tela.
4. Ajustar `index.html`: `viewport-fit=cover`, `theme-color` por modo, preload da Nunito local; remover o Google
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
| Marca | `#4F46E5` (doc/web), `#6C5CE7` (Flutter) | `azul.600 #3651E6` claro, `azul.400 #7290FF` escuro |
| Acerto | `#10B981` / `#58CC02` | `verde.600 #14834A` claro, `verde.400 #3CC873` escuro |
| Erro | vermelho `#EF4444` / `#FF4B4B` | coral `#C63F24` claro, `#FF7A5F` escuro |
| XP | `#F59E0B` / `#FFC800` | ouro `#A98500` claro, `#FACB1E` escuro |
| Esqueleto | teal (doc), ciano e rosa (Flutter), cinza/indigo/verde (web) | `stage.landmark.*` da spec 05, com halo |
| Háptica no erro | vibra (doc, web, Flutter) | não vibra |
| Durações | 280 / 300 / 350 ms | `page 300`, `slow 400`, `fast 150` |
| Abas | Início (Flutter) x Social (doc/web) | Aprender, Praticar, Social, Perfil |
| Ícones | Material Symbols (doc), FontAwesome (web) | Material Symbols Rounded em SVG |
| Fonte | Nunito via CDN | Nunito woff2 auto-hospedada |
| Modo escuro | automático por semente, nunca implementado | tokens explícitos, verificados |
| Botão primário | pílula (Flutter) e raio 24 (doc) | raio 14 com efeito tecla |
| Avatar 3D | presente no web-poc | fora do MVP |

---

## 15. Decisões em aberto

1. **Paleta**: aprovar a troca do indigo atual pelo Azul Sinal (`#3651E6`) e o turquesa para mão e câmera, ou
   manter o indigo `#4F46E5` (que também passa no contraste com texto branco).
2. **Validação cultural**: quem são os consultores surdos que validam paleta, ícones, cartões culturais e
   ilustrações, e em que momento do cronograma.
3. **Ligas**: confirmar quantidade (7 propostas) e nomes (Bronze, Prata, Ouro, Safira, Rubi, Ametista, Diamante).
4. **Som padrão**: ligado (como diz a spec 05) ou perguntar no onboarding. Sugestão: perguntar junto com a tela
   de motivo, sem presumir nada pela resposta "sou surdo(a)".
5. **Vibração padrão** no Android: ligada ou desligada.
6. **Botão "tecla"** (base de 3 px) ou botão plano.
7. **Mascote**: confirmar que não haverá mascote e que a mão (esqueleto) é a protagonista.
8. **Telas largas**: coluna central de 560 px com tab bar (proposto) ou manter a sidebar de desktop do web-poc.
9. **Modo escuro manual**: a doc antiga dizia "só seguir o sistema"; a proposta inclui "Claro, Escuro, Sistema"
   nas Configurações. Confirmar.
10. **Enquadramento com rosto**: o guia da câmera inclui cabeça e ombros por causa das expressões faciais.
    Confirmar com quem cuida do reconhecimento se isso não atrapalha a detecção da mão em celulares mais fracos.
11. **Estrelas ou marcas de domínio** nos nós do mapa (a spec 05 fala em "estrelas"; a proposta usa três marcas).
12. **Substituir o `design-system.md`** por este documento após aprovação (não foi alterado nesta proposta).
13. **Ferramenta de geração**: script próprio (proposto) ou Style Dictionary.
14. **Formato dos valores**: manter strings (`"16px"`) ou migrar para a forma em objeto da versão estável do DTCG.

---

## Decisões aplicadas (web-poc, out/2026)

O que foi usado ao aplicar este design system em `apps/web-poc/`, item a item da seção 15:

1. **Paleta**: Azul Sinal (`#3651E6` no claro, `#7290FF` no escuro) e turquesa para mão e câmera, como proposto.
2. **Validação cultural**: pendente; não é decisão de código. Paleta, ícones e textos seguem a proposta até a
   consultoria surda validar.
3. **Ligas**: as 7 ligas propostas ficam nos tokens (`league.*`, com contraste verificado). A `LeagueScreen` e o
   `LeagueResultSheet` usam as insígnias com forma própria (`src/components/LeagueBadge.tsx`), zonas com seta e
   texto e a pessoa destacada com contorno completo. Enquanto não há API de ligas, o domínio roda no aparelho
   com concorrentes simulados de forma determinística por semana (`src/lib/leagueLocal.ts`, modo local/demo).
4. **Som padrão**: perguntar no onboarding (passo do motivo, sem nada marcado e sem presumir nada pela resposta
   "sou surdo(a)"). Sem escolha, o som fica desligado; o interruptor "Sons" fica sempre visível em
   Configurações > Preferências. Sistema em `src/lib/sound.ts` (Web Audio, buffers prontos no primeiro toque,
   `audioSession` 'ambient', fila de prioridade da spec 05 seção 3.2). Os sons são gerados por síntese em
   `tools/audio/build.mjs` (AAC `.m4a` em `public/audio/`, via ffmpeg ou GStreamer) e, se um arquivo não
   carregar, sintetizados na hora pelo mesmo código (`src/lib/sfxSynth.js`). Novo token `sound.leagueUp`
   (subida de liga, prioridade 6). No modo reduzido, os sons de interface (prioridade 0) não tocam.
5. **Vibração padrão no Android**: ligada (a proposta não recomenda um padrão; mantido o comportamento atual).
   `haptic(evento, enabled)` já aceita a futura opção "Vibração"; erro nunca vibra e no iOS nada é chamado.
6. **Botão "tecla"**: adotado (base de 3 px em `action.primary.base` que afunda ao tocar).
7. **Mascote**: não há mascote; a mão (esqueleto) é a protagonista.
8. **Telas largas**: mantida a barra lateral atual do web-poc (a partir de 768 px); o conteúdo usa a coluna de
   `size.contentMax` (560 px).
9. **Modo escuro manual**: adotado. Configurações > Preferências > Tema ("Seguir o sistema", "Claro", "Escuro")
   grava `data-theme` no `<html>` e ajusta a `theme-color` da barra do navegador.
10. **Enquadramento com rosto**: por enquanto o guia da câmera mostra só a zona da mão; o rosto entra quando o
    reconhecimento usar rosto (U3 em diante).
11. **Estrelas ou marcas**: três marcas de domínio nos nós concluídos do mapa.
12. **Substituir o `design-system.md`**: ainda não; o arquivo antigo foi mantido sem alteração.
13. **Ferramenta de geração**: script próprio, sem dependência (`tools/tokens/build.mjs` e
    `tools/tokens/check-contrast.mjs`), ligado ao `package.json` do web-poc (`npm run tokens`, roda antes do
    `dev` e do `build`; o `build` também roda a verificação de contraste).
14. **Formato dos valores**: strings, como está no JSON.

Ajustes feitos durante a aplicação:

- Novo token `stage.gold` (`{color.ouro.400}`): ouro das celebrações sobre o palco, que faltava como papel
  semântico (componente não usa primitivo). Entrou na verificação de contraste.
- O gerador também emite as partes de cada tipografia (`--lx-typography-<nome>-size`, `-weight`,
  `-line-height`, `-tracking`) e aliases por modo para grupos com `light`/`dark` (ex.: `--lx-elevation-2`).
- O palco da câmera continua em 4:3 (formato do quadro da câmera) em vez de 3:4, para não cortar a mão nas
  laterais; revisar junto com o layout de retrato da seção 11.7.
- A trilha do mapa ficou reta (sem o deslocamento alternado de 24 px) para o conector de 4 px passar sempre pelo
  centro dos nós.
