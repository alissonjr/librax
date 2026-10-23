# Librax - Manual de Design (Design System)

> Fonte da verdade para identidade visual, componentes, linguagem e experiencia de uso.
> Todo desenvolvedor, designer e stakeholder deve ler este documento antes de construir qualquer tela.

---

## 0. Principios de design

Librax e o "Duolingo de Libras": um app que ensina a Lingua Brasileira de Sinais para ouvintes, com
reconhecimento real de gestos pela camera. Isso define cinco principios inegociaveis que guiam
cada decisao de design.

### 0.1 Acolhedor antes de correto

A interface nao pune. Quando o usuario erra ou o reconhecimento falha, a resposta e sempre de
encorajamento, nunca de julgamento. O tom e o de um professor paciente e entusiasmado, nao o
de uma maquina de avaliar acertos.

### 0.2 Clareza para todos os publicos

Uma crianca de 8 anos usando com os pais e um gestor de RH avaliando para a empresa precisam
entender o mesmo app sem customizacoes. Hierarquia visual explícita, icones literais, texto
curto e direto.

### 0.3 Celula de aprendizado, nao joguinho

O design celebra o progresso real. Isso significa que as cores, as animacoes e os feedbacks nao
sao apenas decorativos: eles ensinam, orientam e constroem confianca. Nada e frívolo por si so.

### 0.4 Inclusivo por design

O app ensina uma lingua da comunidade surda. O design nunca depende de audio para instrucoes
criticas. Contraste minimo WCAG AA em todo texto. Suporte nativo a fontes grandes do sistema.
Feedback tactil (haptics) como camada adicional, nunca unica.

### 0.5 B2C e B2B no mesmo frame

A experiencia B2C (individual, game-like) e a B2B (institucional, profissional) vivem no mesmo
app com a mesma linguagem visual. O que muda e o contexto, nao o idioma de design.

---

## 1. Identidade e personalidade da marca

### 1.1 Arquetipo

Librax e o **Mentor Entusiasmado**: sabe muito, transmite confianca, mas nao se leva a serio
demais. Celebra cada conquista com genuina empolgacao. Convida para o proximo desafio sem
pressionar.

Compare com:
- Duolingo: Professor brincalhao (mascote forte, humor presente)
- Librax: Mentor que respeita a profundidade do que ensina, mas torna tudo acessivel

### 1.2 Voz da marca (ver secao 9 para tom nos dialogos)

| Atributo | O que significa |
|---|---|
| Encorajador | Sempre existe um proximo passo positivo |
| Claro | Nenhuma instrucao exige re-leitura |
| Respeitoso | A Libras e uma lingua real; o design reflete isso |
| Direto | Sem rodeios, sem jargao tecnico exposto |
| Leve | Errar faz parte; o app continua sorrindo |

---

## 2. Sistema de cores

### 2.1 Paleta primaria

O sistema usa Material 3 com ColorScheme.fromSeed. A cor-semente e o ponto de partida;
o sistema gera os tokens automaticamente.

```dart
// Cor-semente atual (manter ou ajustar para #4B46D9 conforme calibragem visual)
const Color seedColor = Color(0xFF4F46E5); // Indigo Librax
```

| Token | Hex | Nome interno | Uso |
|---|---|---|---|
| primary | #4F46E5 | Indigo Librax | Botoes principais, tabs ativas, icones de acao |
| onPrimary | #FFFFFF | Branco | Texto e icones sobre primary |
| primaryContainer | #E0DEFF | Indigo palido | Cards de unidade, fundos de destaque suave |
| onPrimaryContainer | #120C6E | Indigo profundo | Texto sobre primaryContainer |
| secondary | #7C6ACF | Violeta | Estados secundarios, chips, badges |
| tertiary | #009688 | Teal | Elementos de Libras (camera, gestos, sinais) |
| tertiaryContainer | #C8EFE9 | Teal palido | Fundo de telas de pratica com camera |

### 2.2 Paleta semantica (estados de feedback)

| Estado | Token | Hex | Uso |
|---|---|---|---|
| Sucesso | success | #10B981 | Resposta correta, exercicio concluido, streak ativo |
| Erro/Retry | error | #EF4444 | Resposta incorreta, vidas perdidas |
| Aviso | warning | #F59E0B | Streak em risco, prazo se encerrando |
| Info | info | #3B82F6 | Dicas contextuais, tooltips |
| Streak | streak | #FF7800 | Icone de fogo, contador de dias |
| XP | xp | #F59E0B | Moedas de XP, conquistas |
| Locked | locked | #94A3B8 | Licoes bloqueadas, conteudo indisponivel |

```dart
// Constantes semanticas (adicionar ao ThemeExtension do app)
const successColor = Color(0xFF10B981);
const errorColor   = Color(0xFFEF4444);
const warningColor = Color(0xFFF59E0B);
const streakColor  = Color(0xFFFF7800);
const xpColor      = Color(0xFFF59E0B);
const lockedColor  = Color(0xFF94A3B8);
const tealLibras   = Color(0xFF009688);
```

### 2.3 Neutrals e superficies

| Token Material 3 | Uso pratico |
|---|---|
| surface | Fundo de telas, cards sem destaque |
| surfaceContainerLow | Fundo de telas de lista (leve contraste do card) |
| surfaceContainerHighest | Chips, campos de texto, dividers |
| outline | Bordas, separadores, icones de estado inativo |
| onSurface | Texto principal |
| onSurfaceVariant | Texto secundario, placeholders, labels |

### 2.4 Gradientes

Usar com moderacao. So em fundos de cabecalhos de unidade ou telas de celebracao.

```dart
// Gradiente de unidade (aprender)
LinearGradient(
  colors: [Color(0xFF4F46E5), Color(0xFF7C3AED)],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
)

// Gradiente de celebracao (conclusao de licao)
LinearGradient(
  colors: [Color(0xFF10B981), Color(0xFF059669)],
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
)

// Gradiente teal (telas com camera)
LinearGradient(
  colors: [Color(0xFF009688), Color(0xFF00796B)],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
)
```

### 2.5 Modo escuro

O sistema Material 3 gera o esquema escuro automaticamente. Verificar que:
- O streak laranja permaneca legivel sobre fundos escuros (usar `streakColor` com 10% de luminosidade adicional no dark mode se necessario)
- Cards de exercicio mantenham contraste WCAG AA minimo
- A camera/visualizacao de landmarks seja sempre sobre fundo muito escuro (quase preto) para visibilidade dos gestos

---

## 3. Tipografia

### 3.1 Familia de fonte

**Nunuito** como fonte primaria. Razoes: alta legibilidade em corpos pequenos, geometrica e amigavel
sem ser infantil, excelente suporte a Unicode/PT-BR, weights claros de light a black.

Fallback: `sans-serif` do sistema operacional.

```dart
// pubspec.yaml
fonts:
  - family: Nunito
    fonts:
      - asset: assets/fonts/Nunito-Regular.ttf
      - asset: assets/fonts/Nunito-Medium.ttf   weight: 500
      - asset: assets/fonts/Nunito-SemiBold.ttf weight: 600
      - asset: assets/fonts/Nunito-Bold.ttf     weight: 700
      - asset: assets/fonts/Nunito-ExtraBold.ttf weight: 800
```

### 3.2 Escala tipografica (Material 3 TextTheme)

| Token M3 | Tamanho | Peso | Uso |
|---|---|---|---|
| displayLarge | 57sp | ExtraBold 800 | Telas de celebracao (XP ganho grande) |
| displayMedium | 45sp | Bold 700 | Numeros destacados (XP, streak) |
| displaySmall | 36sp | Bold 700 | Titulos de onboarding |
| headlineLarge | 32sp | Bold 700 | Cabecalho de secao principal |
| headlineMedium | 28sp | SemiBold 600 | Titulo de card de unidade |
| headlinesmall | 24sp | SemiBold 600 | Titulo de tela |
| titleLarge | 22sp | SemiBold 600 | Nome de licao, nome de squad |
| titleMedium | 16sp | SemiBold 600 | Labels de card, cabecalhos de lista |
| titleSmall | 14sp | SemiBold 600 | Subtitulos, badge text |
| bodyLarge | 16sp | Regular 400 | Texto de exercicio, enunciado |
| bodyMedium | 14sp | Regular 400 | Descricao de opcao, texto de instrucao |
| bodySmall | 12sp | Regular 400 | Metadados, timestamps, labels de campo |
| labelLarge | 14sp | Bold 700 | Texto de botao primario |
| labelMedium | 12sp | SemiBold 600 | Texto de botao secundario, chip |
| labelSmall | 11sp | Medium 500 | Badge numerico, contador |

### 3.3 Altura de linha e espacamento

- Altura de linha padrao: 1.4x o tamanho da fonte (ex: 16sp -> 22.4 de linha)
- Letter-spacing em displays grandes: -0.5 (tightening para titulos grandes)
- Letter-spacing em labels de botao: +0.5 (abertura leve para legibilidade)

### 3.4 Regras de uso

- **Nunca mais de 2 tamanhos diferentes numa linha/coluna de texto**
- Maximo 45 caracteres por linha em bodyLarge (conforto de leitura no celular)
- Texto de instrucao de exercicio: sempre bodyLarge, centralizado, maximo 2 linhas
- Nao usar itálico no app (menos familiar para criancas, mais dificil de scanear)

---

## 4. Espacamento e layout

### 4.1 Escala de espacamento (multiplos de 4)

```
4dp   - micro (separacao de icon + label dentro de um chip)
8dp   - pequeno (padding interno de badge, gap entre icone e texto curto)
12dp  - base (gap entre itens de lista, padding de ListTile pequeno)
16dp  - padrao (padding horizontal da tela, padding de card)
20dp  - confortavel (gap entre cards, padding vertical de tela)
24dp  - amplo (separacao de secoes)
32dp  - grande (separacao de grupos/unidades)
48dp  - extra (margem superior de telas de celebracao)
```

### 4.2 Margens horizontais da tela

- Margem lateral: 16dp (minimo), 20dp (padrao)
- Nunca < 12dp exceto elementos que sangram ate a borda (imagens de header)
- Em tablets (largura > 600dp): aumentar para 32dp e centralizar conteudo em coluna de 560dp max

### 4.3 Grid e alinhamento

- Layout de 4 colunas no celular
- Elementos de exercicio (botoes de multipla escolha): grid 2x2 com gutter de 12dp
- Cards de unidade: largura total (1 coluna)
- Botao primario: largura total quando sozinho na tela, auto-width em linha com outros elementos

### 4.4 Safe areas

- Bottom navigation bar: respeitar `SafeArea` do sistema + 0dp adicional
- Telas de camera: usar `SafeArea` no topo; camera pode sangrar ate a borda inferior
- Conteudo scrollavel: padding-bottom de 16dp acima da bottom bar

---

## 5. Bordas, formas e raios

### 5.1 Principio

Formas arredondadas em tudo. Nenhum elemento com angulo reto exposto ao usuario.

### 5.2 Escala de raios

| Classe | Raio | Uso |
|---|---|---|
| xs | 4dp | Chips de progresso, badges pequenos |
| sm | 8dp | Progress bar (LinearProgressIndicator) |
| md | 12dp | Tiles de licao, ListTile, campos de formulario |
| lg | 16dp | Cards principais (DailyGoalCard, ContinueLessonCard) |
| xl | 24dp | Botoes de acao principal em exercicios |
| xxl | 32dp | Bottom sheets, cabecalhos de unidade (radius nos cantos superiores) |
| pill | 100dp (full) | FABs, badges numericos, chips de XP, botoes de alternativa |
| circle | 50% | Avatares, icones de licao (CircleAvatar), indicadores de estado |

```dart
// ShapeTheme do app
const appShapes = {
  'cardShape': RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
  'tileShape': RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
  'buttonShape': RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
  'chipShape': StadiumBorder(), // pill automatico
  'sheetShape': RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
  ),
};
```

### 5.3 Regras de forma por componente

- Botao primario (FilledButton): raio 24dp, altura minima 52dp
- Botao de multipla escolha (exercicio): raio 16dp, altura 64dp minima, borda 2dp
- Cards de unidade: raio 16dp, sem borda
- Cards de squad: raio 16dp, sem borda
- Campos de texto: raio 12dp (InputBorder)
- Bottom sheets: raio superior 32dp, sem raio inferior
- CircleAvatar de licao: diametro 48dp
- Badge de XP: pill, altura 24dp

---

## 6. Iconografia

### 6.1 Biblioteca

Usar **Material Symbols** (variante Rounded). Razoes: consistente com Flutter/Material 3,
variante Rounded harmoniza com o sistema de formas arredondadas do app.

```dart
// pubspec.yaml - usar material_symbols_icons
dependencies:
  material_symbols_icons: ^4.x.x
```

### 6.2 Tamanhos de icone

| Contexto | Tamanho |
|---|---|
| Bottom navigation bar | 24dp |
| ListTile leading/trailing | 20-24dp |
| Botao com icone | 18dp |
| Chip com icone | 16dp |
| Badge/indicador inline | 14-16dp |
| Tela de estado vazio (ilustracao) | 64-80dp |
| Icone de conquista | 48dp |

### 6.3 Icones padrao por funcao

| Funcao | Icone Material Rounded |
|---|---|
| Aprender (aba) | `Symbols.school_rounded` |
| Praticar (aba) | `Symbols.fitness_center_rounded` |
| Social/Squads (aba) | `Symbols.group_rounded` |
| Perfil (aba) | `Symbols.person_rounded` |
| Streak/Fogo | `Symbols.local_fire_department_rounded` |
| XP/Troféu | `Symbols.military_tech_rounded` |
| Conquista | `Symbols.emoji_events_rounded` |
| Camera | `Symbols.videocam_rounded` |
| Camera desligada | `Symbols.videocam_off_rounded` |
| Licao bloqueada | `Symbols.lock_rounded` |
| Licao concluida | `Symbols.check_circle_rounded` |
| Licao disponivel | `Symbols.play_circle_rounded` |
| Revisao/SRS | `Symbols.refresh_rounded` |
| Configuracoes | `Symbols.settings_rounded` |
| Compartilhar | `Symbols.share_rounded` |
| Codigo de convite | `Symbols.key_rounded` |
| Squad publica | `Symbols.public_rounded` |
| Squad privada | `Symbols.lock_outline_rounded` |
| Squad B2B/Org | `Symbols.corporate_fare_rounded` |
| Classificacao/Ranking | `Symbols.leaderboard_rounded` |
| Fechar | `Symbols.close_rounded` |
| Voltar | `Symbols.arrow_back_rounded` |
| Expandir | `Symbols.expand_more_rounded` |
| Menu contextual | `Symbols.more_vert_rounded` |
| Sucesso (grande) | `Symbols.check_circle_rounded` (filled) |
| Erro/Fechar sessao | `Symbols.cancel_rounded` (filled) |
| Dica/Coach | `Symbols.lightbulb_rounded` |
| Microfone/Sinalizacao | `Symbols.sign_language_rounded` |

### 6.4 Icones de estado em licoes

```
Bloqueada:  [cadeado cinza] fundo surfaceContainerHighest
Disponivel: [numero] fundo primary
Em curso:   [numero] fundo primary + borda animada pulsante
Concluida:  [check] fundo secondary (verde)
Revisao:    [refresh] fundo tertiaryContainer
```

---

## 7. Ilustracoes e graficos

### 7.1 Estilo de ilustracao

Estilo: **flat illustration com contorno suave**. Sem gradientes complexos nas ilustracoes.
Personagens com proporcoes levemente cartunescas (cabecas um pouco maiores), expressivos.
Paleta de pele diversa e representativa.

Uso principal:
- Telas de estado vazio (EmptyState)
- Celebracoes de conclusao de unidade
- Onboarding
- Conquistas desbloqueadas

### 7.2 Regras de ilustracao

- Sempre mostrar maos em movimento ou sinalizando quando o contexto for Libras
- Representar diversidade de usuarios (idade, etnia, genero)
- Evitar representacoes condescendentes ou "baby-ish" mesmo nas licoes iniciais
- Personagens surdos devem ser representados com positividade, nunca como "limitados"

### 7.3 Animacoes Lottie

Usar Lottie para:
- Confetti na conclusao de licao
- Check de sucesso no exercicio
- X de erro no exercicio
- Icone de fogo do streak animado

```dart
// pubspec.yaml
dependencies:
  lottie: ^3.x.x
```

Convencoes de arquivo:
```
assets/lottie/
  success_check.json      - check verde animado (0.8s, nao loop)
  error_x.json            - X vermelho animado (0.8s, nao loop)
  confetti.json           - confetti explosao (2s, nao loop)
  streak_fire.json        - chama animada (loop continuo, lento)
  star_burst.json         - estrela para conquista (1.2s, nao loop)
  loading_hands.json      - maos sinalizando (loop, tela de loading)
```

---

## 8. Componentes de UI

### 8.1 Botoes

#### Botao primario (acao principal da tela)

```
Estilo: FilledButton
Altura: 52dp minima
Raio: 24dp
Texto: labelLarge, 14sp, Bold
Padding horizontal: 24dp
Largura: geralmente 100% da area util
Estado disabled: opacity 0.38, nao clickavel
```

Usos: "Comecar licao", "Verificar resposta", "Criar squad", "Entrar".

#### Botao secundario (acao alternativa)

```
Estilo: OutlinedButton
Altura: 48dp
Raio: 24dp
Texto: labelMedium, 12sp, SemiBold
Borda: 1.5dp, cor outline
```

Usos: "Pular", "Ver modelo de novo", "Cancelar".

#### Botao de texto

```
Estilo: TextButton
Texto: labelMedium, 12sp, primary color
Padding: 8dp vertical, 12dp horizontal
```

Usos: "Ja tenho conta", "Continuar sem camera", links de politica.

#### Botao destrutivo (danger)

```
Estilo: FilledButton com backgroundColor: errorColor
Texto: branco
```

Usos: "Dissolver squad", "Sair da squad" (confirmacao final).

#### Botao de alternativa de exercicio (multipla escolha)

```
Container customizado (nao usar Button)
Altura: 64dp minima
Raio: 16dp
Borda: 2dp solid
  - Neutro: outline color (nao selecionado)
  - Selecionado: primary color (aguardando confirmacao)
  - Correto: successColor borda + successColor/10 fundo
  - Incorreto: errorColor borda + errorColor/10 fundo
Texto: bodyLarge, 16sp, Regular, centralizado
Padding: 16dp horizontal, 12dp vertical
```

### 8.2 Cards

#### Card de unidade (UnitCard)

```
Material elevation: 0 (sem sombra, usa cor de fundo)
Fundo: gradient primary
Raio: 16dp
Padding: 16dp
Conteudo: label "Unidade N", titulo bold grande, descricao small
Largura: 100% da tela menos margens
```

#### Card de licao (LessonTile)

```
Fundo: surface (disponivel) / secondaryContainer (concluida) / surfaceContainerHighest (bloqueada)
Raio: 12dp
Altura: 72dp
Leading: CircleAvatar 48dp (icone de estado)
Title: titleMedium
Subtitle: bodySmall (estado)
Trailing: icon arrow (disponivel) / nada (bloqueada/concluida)
```

#### Card de meta diaria (DailyGoalCard)

```
Fundo: surface
Borda: 1dp outline/20 (muito sutil)
Raio: 16dp
Padding: 20dp
Conteudo:
  - Row: icone de fogo (streak) + label da meta
  - LinearProgressIndicator (altura 10dp, raio 8dp)
  - Texto "N / M XP"
```

#### Card de squad (SquadCard)

```
Fundo: surface
Borda: none
Raio: 16dp
Padding: 16dp
Sombra: elevation 1 (muito sutil)
Conteudo:
  - Row: nome (titleMedium bold) + badge de tipo
  - Spacer
  - "N membros - X XP esta semana" (bodySmall)
  - Barra de XP proporcional ao lider
  - "Voce: #N de M" (labelSmall, primary color)
```

#### Card de exercicio (ExerciseCard) - tela de licao

```
Fundo: surface
Raio: 24dp (mais arredondado, mais "safe")
Padding: 20dp
Sombra: elevation 2
Conteudo: varia por tipo de exercicio (ver secao 10)
```

### 8.3 Badges e chips

#### Badge de tipo de squad

```
Estilo: Chip Material (FilterChip sem interacao)
Tamanho: small (altura 24dp)
Raio: pill
Publica: fundo tertiaryContainer, texto onTertiaryContainer
Privada: fundo surfaceContainerHighest, texto onSurfaceVariant
Org/B2B: fundo primaryContainer, texto onPrimaryContainer
```

#### Badge de XP (ganho de XP)

```
Pill amarela: fundo xpColor/20, texto xpColor bold
Formato: "+N XP"
Tamanho: labelSmall, altura 24dp
Animacao: aparece de baixo (slide up + fade in, 300ms)
```

#### Streak counter (header)

```
Row: icone de fogo (streakColor, 20dp) + numero (titleMedium bold, streakColor)
Posicao: trailing do AppBar
```

#### Badge de conquista desbloqueada

```
Container circular ou hexagonal
Icone: 32dp no centro
Fundo: gradiente da categoria da conquista
Bloqueada: grayscale + opacity 0.5
```

### 8.4 Progress indicators

#### Barra de progresso de licao (topo da tela de exercicio)

```
LinearProgressIndicator
Altura: 8dp
Raio: 8dp (pill)
Cor: successColor (verde)
Fundo: outline/30
Animacao: transicao suave entre exercicios (300ms ease-in-out)
```

#### Barra de XP de meta diaria

```
LinearProgressIndicator
Altura: 10dp
Raio: 8dp
Cor: xpColor (amarelo/amber)
Fundo: surfaceContainerHighest
```

#### Barra de XP relativa da squad

```
LinearProgressIndicator
Altura: 6dp
Raio: 6dp
Cor: primary
Fundo: primaryContainer
```

#### Loading skeleton (shimmer)

```
Cor base: surfaceContainerHighest
Cor shimmer: outline/30 passando em animacao de 1.5s loop
Formas: espelham o layout real do componente
```

### 8.5 Input fields

```
Estilo: OutlinedInputBorder (nao filled)
Raio: 12dp
Padding interno: 16dp
Label flutuante: sim (FloatingLabelBehavior.auto)
Cor focus: primary
Cor erro: errorColor
Counter: exibir quando ha limite de caracteres (ex: nome de squad)
```

#### Campo OTP (codigo de squad 6 digitos)

```
6 containers individuais, cada um:
  - Tamanho: 48dp x 56dp
  - Raio: 12dp
  - Borda: 2dp
  - Cor neutra -> primary ao focar -> successColor ao completar
  - Texto: titleLarge, centralizado, Bold
  - Gap entre caixas: 8dp
```

### 8.6 Bottom navigation bar

```
Estilo: NavigationBar (Material 3)
Altura: 80dp (mais espaco para tap targets)
Indicador: pill arredondada sobre a aba ativa
Cor indicador: secondaryContainer
Icone ativo: cor primary, filled
Icone inativo: cor outline, outlined
Label: sempre visivel (nao esconder em scroll)
Abas: Aprender | Praticar | Social | Perfil
```

### 8.7 AppBar

```
Estilo: AppBar Material 3 (CenterAligned para telas de conteudo)
Altura: padrao (56dp)
Titulo: titleLarge, centralizado
Fundo: surface (transparent over content em scroll)
Trailing: slot padrao para streak counter
Leading: botao voltar arredondado em telas de detalhe
Elevacao: 0 (sem sombra em repouso), elevation 2 em scroll
```

### 8.8 Bottom sheets

```
Raio superior: 32dp
Handle: pill de 4dp x 32dp, cor outline, centralizado 8dp abaixo do topo
Padding interno: 20dp horizontal, 16dp vertical
Drag: habilitado para fechar
Fundo: surface
Overlay: 60% black opacity
Animacao: slide-up 300ms ease-out
```

### 8.9 Dialogs de confirmacao

```
Raio: 28dp (Material 3 AlertDialog)
Icone: 48dp, cor conforme contexto (errorColor para destruticao)
Titulo: headlineSmall
Descricao: bodyMedium, cor onSurfaceVariant
Botoes: Text "Cancelar" | Filled ou Text "Acao principal"
Acao destrutiva: errorColor no botao de confirmacao
```

### 8.10 Snackbars e toasts

```
Estilo: SnackBar Material 3
Raio: 8dp
Posicao: bottom, acima da navigation bar
Duracao: 3s (informativo) / 5s (com acao)
Texto: bodyMedium, branco
Acao (opcional): TextButton branco, "Desfazer" ou "Ver"
Sucesso: fundo successColor
Erro: fundo errorColor
Neutro: fundo onSurface (escuro)
```

---

## 9. Linguagem, tom e dialogos

### 9.1 Principios de linguagem

- Sempre tutear o usuario ("Voce acertou!", nao "O usuario acertou")
- Frases curtas: maximo 15 palavras em feedbacks, 20 em instrucoes
- Verbos de acao no imperativo positivo: "Mostre o sinal", nao "O usuario devera mostrar"
- Nunca usar palavras negativas desnecessarias em feedbacks
- Linguagem inclusiva e neutra quando se referir a comunidade surda

### 9.2 Feedbacks de exercicio

#### Resposta correta

```
Variando entre:
- "Isso ai!"
- "Perfeito!"
- "Muito bem!"
- "Excelente!"
- "Acertou!"
- "Correto!"
Tom: curto, entusiasmado, sem excesso
```

#### Resposta incorreta (primeira tentativa)

```
Variando entre:
- "Quase! Tente de novo."
- "Nao foi dessa vez. Tente mais uma vez."
- "Quase la! Tente novamente."
Tom: encorajador, nunca punitivo, jamais "ERRADO"
```

#### Resposta incorreta (resposta revelada)

```
Sempre: "A resposta certa e [SINAL]. Vamos continuar!"
Nunca: "Voce errou. A resposta e..."
```

#### Problema de captura (camera)

```
Sem deteccao de mao:
  "Posicione sua mao no quadro."

Luz insuficiente:
  "Procure um lugar mais iluminado."

Mao fora do frame:
  "Centralize sua mao na tela."

Tom: instrucional, nao acusatorio, sem contar como erro
```

#### Feedback de reconhecimento ("Quase")

```
Com dica de melhoria:
  "Quase! [Dica especifica, ex: Abra um pouco mais os dedos.]"
  "Bom progresso! [Dica especifica]"

Sem dica especifica:
  "Quase la! Tente ajustar o gesto e tente de novo."
```

### 9.3 Instrucoes de exercicio por tipo

| Tipo | Instrucao |
|---|---|
| watch_choose_word | "Qual e o significado deste sinal?" |
| word_choose_video | "Qual video mostra o sinal de [PALAVRA]?" |
| match_pairs | "Relacione os sinais com os significados." |
| perform_sign | "Agora e sua vez. Mostre o sinal de [PALAVRA]." |
| fingerspell | "Soletre a palavra [PALAVRA] em datilologia." |
| mirror_practice | "Pratique o sinal livremente. Sem avaliacao desta vez." |

### 9.4 Mensagens de engajamento

#### Streak

```
Inicio do dia (streak ativo):
  "Voce esta em [N] dias seguidos! Continue hoje."

Streak em risco (fim de dia sem progresso):
  "Seu streak de [N] dias esta em risco! Faca uma licao."

Streak perdido:
  "Seu streak terminou. Sem problemas - comece um novo hoje!"
  (nunca: "Voce perdeu seu streak de X dias por nao praticar")
```

#### Conclusao de licao

```
Simples:
  "Licao concluida! +[N] XP"

Com streak novo recorde:
  "Incrivel! [N] dias seguidos - um novo recorde!"

Primeira licao:
  "Primeira licao concluida! Voce esta aprendendo Libras!"
```

#### Meta diaria atingida

```
"Meta do dia atingida! Ate amanha."
```

#### Conclusao de unidade

```
"Unidade [N] concluida! Voce aprendeu [lista de sinais]. Continue para a proxima unidade!"
```

### 9.5 Mensagens de estado vazio

| Tela | Mensagem | Subtexto |
|---|---|---|
| SquadHub sem squads | "Aprenda junto com amigos." | "Crie uma squad, convide pessoas e compitam o progresso semanal." |
| Diretorio sem resultados | "Nenhuma squad encontrada." | "Que tal criar a sua?" |
| Perfil sem conquistas | "Suas conquistas aparecerao aqui." | "Complete licoes para desbloquear." |
| Pratica sem itens | "Tudo em dia!" | "Voce revisou tudo que precisava. Volte amanha." |

### 9.6 Confirmacoes de acoes destrutivas

Sempre seguir o padrao: "O que acontece" + "A consequencia" + botoes claros.

```
Sair de squad:
  Titulo: "Sair de [Nome]?"
  Corpo: "Voce perdera sua posicao no ranking e precisara de convite para voltar (se a squad for privada)."
  Botoes: "Cancelar" | "Sair"

Dissolver squad:
  Titulo: "Dissolver [Nome]?"
  Corpo: "Todos os [N] membros serao removidos. Esta acao nao pode ser desfeita."
  Botoes: "Cancelar" | "Dissolver" (errorColor)

Regenerar codigo de convite:
  Titulo: "Regenerar codigo?"
  Corpo: "O codigo atual ([CODIGO]) deixara de funcionar."
  Botoes: "Cancelar" | "Regenerar"
```

### 9.7 Tom B2B vs B2C

O tom e o mesmo. O que muda e o contexto de entrada (painel institucional vs app consumer).
Dentro do app mobile, usuarios B2B veem o mesmo idioma amigavel. As diferencas visuais B2B
(badge [org], secao de equipes) nao mudam o tom dos dialogos.

---

## 10. Telas de exercicio (game loop)

### 10.1 Estrutura da tela de exercicio

```
[SafeArea topo]
  AppBar minimalista:
    - botao X (fechar/sair da licao) | barra de progresso | vidas (se houver)

[Corpo - 80% da altura]
  Zona do exercicio:
    - Instrucao (bodyLarge, centralizado, max 2 linhas)
    - Conteudo principal (video OU area de camera OU texto)
    - Opcoes de resposta (grid ou lista)

[Footer - 20% da altura]
  Botao de acao:
    - "Verificar" (primario, desabilitado ate ter selecao)
    - Transforma em "Continuar" apos verificacao
    - "Ver modelo de novo" (secundario, aparece em erro)
  
  Feedback banner (aparece apos verificar):
    - Sucesso: fundo successColor/15, icone check, texto de encorajamento
    - Erro: fundo errorColor/15, icone X, texto de dica
    - Altura: 88dp fixo
```

### 10.2 Exercicio watch_choose_word

```
Instrucao: "Qual e o significado deste sinal?"

Video player (16:9 ou quadrado, raio 16dp):
  - Player inline, sem fullscreen obrigatorio
  - Botao de replay sempre visivel
  - Poster frame: frame central do video

Grid 2x2 de alternativas:
  - Cada botao: raio 16dp, borda 2dp, bodyLarge bold
  - Feedback visual imediato ao selecionar
  - Correto fica verde, incorreto vermelho, outras ficam em cinza
  - Haptic feedback (HapticFeedback.lightImpact no select, mediumImpact no submit)
```

### 10.3 Exercicio perform_sign (camera)

```
Area de camera (topo, 55-60% da tela):
  - Camera occupando a area com overlay de landmarks
  - Cor de landmarks: tertiaryColor (teal) linhas finas
  - Barra de confianca: pill embaixo da camera, 0-100%
    - < 40%: outline
    - 40-75%: warningColor
    - >= 75%: successColor com animacao de pulso
  - Botao "Ver modelo" (overlay, canto superior direito, botao small outlined)
  - Instrucao de posicionamento (se mao ausente): texto overlay branco sobre camera escurecida

Zona de instrucao (abaixo da camera):
  - Icone/imagem de referencia do sinal (miniatura)
  - Texto: "Mostre o sinal de [PALAVRA]"
  - Tentativas restantes (se houver limite): "Tentativas: N"

Footer:
  - Estado aguardando: "Posicione a mao e faca o sinal"
  - Estado analisando: CircularProgressIndicator sutil
  - Estado sucesso: banner verde + "Continuar"
  - Estado retry: banner laranja + dica + "Tentar novamente"
```

### 10.4 Exercicio fingerspell (datilologia)

```
Area de camera identica ao perform_sign

Sequencia de letras no footer:
  [A] [N] [A]
  - Cada letra: pill 48dp, letra bold titleLarge
  - Concluida: successColor fundo
  - Atual: primary com pulsacao
  - Pendente: surfaceContainerHighest

Progresso em tempo real: a letra atual e destacada enquanto o modelo reconhece
```

### 10.5 Tela de conclusao de licao (LessonComplete)

```
Fundo: gradiente verde (successColor -> emerald escuro)
Confetti Lottie (2s, nao loop)

Conteudo centralizado:
  1. Animacao Lottie de check ou estrela
  2. Titulo: "Licao concluida!" (displaySmall, branco)
  3. Grid de stats (3 colunas):
     - XP ganho: "+N XP" (displayMedium, bold)
     - Precisao: "N%" (titleLarge)
     - Streak: "N dias" (titleLarge)
  4. Botao "Continuar" (FilledButton branco com texto primary)

Animacao de entrada: elementos caem de cima com spring physics, staggered 100ms entre cada
```

### 10.6 Tela de conclusao de unidade (UnitComplete)

```
Ainda mais celebratorio: background com ilustracao de personagem sinalizando
Lista de sinais aprendidos: "Voce aprendeu: [SINAL1], [SINAL2], ..."
Botao "Ver proxima unidade"
Badge desbloqueado (se houver conquista): sheet que sobe automaticamente antes do botao
```

---

## 11. Navegacao e fluxos

### 11.1 Estrutura de navegacao principal

```
Root: NavigationBar (tabs sempre visiveis)
  |
  +-- /home        -> HomeScreen (meta diaria + continuar licao)
  |
  +-- /learn       -> LearnScreen (arvore de habilidades)
  |     |
  |     +-- /learn/unit/:id/lesson/:id -> ExerciseScreen (sem bottom bar)
  |     +-- /learn/unit/:id/complete   -> LessonComplete (sem bottom bar)
  |
  +-- /practice    -> PracticeScreen (fila SRS diaria)
  |
  +-- /social      -> SquadHub
  |     |
  |     +-- /social/squads/new
  |     +-- /social/squads/directory
  |     +-- /social/squads/join
  |     +-- /social/squads/:id
  |     +-- /social/squads/:id/settings
  |
  +-- /profile     -> ProfileScreen
        |
        +-- /profile/achievements
        +-- /profile/leagues
        +-- /profile/settings
```

### 11.2 Transicoes de tela

| Tipo de transicao | Quando usar | Animacao |
|---|---|---|
| Push horizontal (slide) | Avancar em hierarquia (ex: licao -> exercicio) | Slide left, 280ms |
| Modal slide up | Bottom sheets, dialogs, telas de celebracao | Slide up, 350ms ease-out |
| Fade | Transicao entre abas do NavigationBar | Fade 200ms |
| Hero | Abertura de detalhe a partir de card (squad, conquista) | Hero animation padrao |
| None | Dentro de exercicio (entre questoes) | Crossfade suave 150ms |

### 11.3 Fluxo de licao (game loop)

```
1. Tap em licao disponivel na LearnScreen
2. Tela de introducao da licao (briefing opcional, 0.5s)
3. Loop: Exercicio -> Verificar -> Feedback -> Continuar
4. [ao zerar barra de progresso ou exercicios acabarem]
5. LessonComplete screen (sem bottom bar)
6. [botao "Continuar"] -> volta para LearnScreen na posicao da licao
```

### 11.4 Regras de navegacao

- Telas de exercicio: bottom navigation BAR OCULTA (imersao total)
- Botao de saida da licao: sempre no canto superior esquerdo (icone X)
- Ao sair da licao no meio: dialogo de confirmacao ("Sair da licao? Seu progresso desta sessao sera perdido.")
- Deep links de convite de squad: sempre resolver antes de verificar autenticacao

### 11.5 Estados de carregamento e erro

| Estado | Comportamento |
|---|---|
| Loading inicial (tela) | Skeleton shimmer ocupando o layout completo |
| Loading de botao | CircularProgressIndicator de 20dp dentro do botao, botao desabilitado |
| Erro de rede (tela) | Ilustracao + "Sem conexao" + botao "Tentar novamente" |
| Erro de rede (acao) | Snackbar errorColor + "Sem conexao. Tente novamente." |
| Cache expirado | Banner discreto no topo da lista: "Dados de HH:MM - Atualizando..." |
| Offline (acao de escrita) | Snackbar: "Voce esta offline. Conecte-se para realizar esta acao." |

---

## 12. Acessibilidade

### 12.1 Requisitos minimos (todos obrigatorios)

- Contraste de texto: WCAG AA em todo texto (4.5:1 para texto normal, 3:1 para texto grande/bold >= 18sp)
- Tap targets: minimo 48dp x 48dp em todos os elementos interativos
- Semantica: todo elemento interativo tem `semanticsLabel` ou `Tooltip` meaningful
- Navegacao por leitor de tela: ordem logica de leitura, foco visivel claro
- Nenhuma instrucao critica depende exclusivamente de audio
- Fontes do sistema: `textScaleFactor` respeitado (testar ate 1.5x sem quebrar layout)
- Cores: nunca usar cor como unica forma de transmitir informacao (sempre acompanhar de icone ou texto)

### 12.2 Haptics (feedback tactil)

```dart
// Selecionar alternativa de exercicio
HapticFeedback.selectionClick();

// Resposta correta
HapticFeedback.notificationSuccess(); // iOS / equivalente Android

// Resposta incorreta
HapticFeedback.notificationError();

// Acao destrutiva confirmada
HapticFeedback.heavyImpact();

// Botao primario pressionado
HapticFeedback.lightImpact();
```

### 12.3 Modo sem camera

Toda licao deve ser completavel sem camera (so exercicios receptivos). A tela `perform_sign` oferece:
- Botao "Continuar sem camera" sempre visivel
- Modo alternativo: exibe video de referencia + botao "Entendi, ja sei este sinal" (auto-correto, sem penalizar streak)

### 12.4 Suporte a portugues e acessibilidade linguistica

- Nunca usar abreviacoes sem expandir na primeira ocorrencia
- Termos de Libras sempre explicados na primeira vez que aparecem
- Textos de instrucao revisados para nivel de leitura acessivel (evitar subordinadas longas)

---

## 13. Modo escuro

O sistema Material 3 gera automaticamente um esquema escuro a partir da cor-semente.
Verificar e calibrar manualmente os seguintes pontos:

- Streak laranja: verificar contraste no dark background (pode exigir #FF9D3D no dark)
- Cards de exercicio: fundo `surfaceContainerHigh` no dark (nao preto puro, evitar fadiga visual)
- Area de camera: fundo sempre quase preto (#0D0D0D) para maxima visibilidade dos landmarks
- Progress bars: cores semanticas (verde, amarelo) podem precisar de lightness +10% no dark
- Botao FilledButton primary: verificar onPrimary continua branco no dark scheme automatico

Implementar: `ThemeMode.system` para seguir preferencia do sistema operacional.
Nao implementar toggle manual de dark mode dentro do app na versao 1 (adicionar complexidade desnecessaria).

---

## 14. Diferenciacao visual B2C e B2B

Dentro do app mobile, a diferenciacao e minima e sutil:

| Elemento | B2C | B2B/Org |
|---|---|---|
| Badge de squad | Publica/Privada (teal/cinza) | [org] (primaryContainer) |
| Secao no SquadHub | "Suas squads" | "Equipes - [Nome da Org]" acima das squads |
| Opcoes de saida | Voluntaria | Desabilitada (so org admin remove) |
| Tom dos dialogos | Identico | Identico |
| Cores | Identicas | Identicas |

O painel institucional B2B (web) pode ter visual mais corporativo, mas isso e fora do escopo
do design do app mobile.

---

## 15. Design de onboarding

### 15.1 Fluxo de primeiro acesso

```
1. Splash screen (logo + animacao loading_hands.lottie)
2. Welcome screen:
   - Ilustracao de maos sinalizando
   - "Aprenda Libras de verdade." (headlineLarge)
   - "Com reconhecimento de gestos pela sua camera." (bodyLarge, onSurfaceVariant)
   - Botao "Comecar" (primario, largo)
   - Link "Ja tenho conta" (TextButton)
3. (Opcional) Slides de como funciona (max 3 telas, pulavel)
4. Selecao de meta diaria (5/10/15/20 XP) - estilo Duolingo
5. Permissao de camera (com explicacao clara do motivo e da privacidade)
6. HomeScreen
```

### 15.2 Tela de permissao de camera

```
Ilustracao: smartphone com maos sinalizando visivel na tela
Titulo: "Sua camera e sua sala de aula"
Corpo: "Usamos a camera para reconhecer seus sinais em tempo real. Nada sai do seu celular - so voce ve."
Detalhe de privacidade: icone de cadeado + "Imagens nunca saem do dispositivo"
Botoes:
  - "Permitir camera" (primario)
  - "Continuar sem camera" (secundario) -> sempre acessar o app em modo receptivo
```

---

## 16. Referencia rapida de tokens Flutter

```dart
// Cores semanticas (ThemeExtension)
class LibraxColors extends ThemeExtension<LibraxColors> {
  final Color success;
  final Color onSuccess;
  final Color error;
  final Color warning;
  final Color streak;
  final Color xp;
  final Color locked;
  final Color tealLibras;

  const LibraxColors({
    this.success = const Color(0xFF10B981),
    this.onSuccess = Colors.white,
    this.error = const Color(0xFFEF4444),
    this.warning = const Color(0xFFF59E0B),
    this.streak = const Color(0xFFFF7800),
    this.xp = const Color(0xFFF59E0B),
    this.locked = const Color(0xFF94A3B8),
    this.tealLibras = const Color(0xFF009688),
  });
  // ... copyWith, lerp
}

// Raios de borda
class LibraxRadius {
  static const xs  = Radius.circular(4);
  static const sm  = Radius.circular(8);
  static const md  = Radius.circular(12);
  static const lg  = Radius.circular(16);
  static const xl  = Radius.circular(24);
  static const xxl = Radius.circular(32);
}

// Duracao de animacoes
class LibraxDuration {
  static const fast   = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 280);
  static const slow   = Duration(milliseconds: 400);
  static const lottie = Duration(milliseconds: 800);
}

// Espacamento
class LibraxSpacing {
  static const xs  = 4.0;
  static const sm  = 8.0;
  static const base = 12.0;
  static const md  = 16.0;
  static const lg  = 20.0;
  static const xl  = 24.0;
  static const xxl = 32.0;
  static const xxxl = 48.0;
  static const screenH = 20.0; // margem horizontal padrao de tela
}
```

---

## 17. Checklist de revisao de tela

Antes de entregar qualquer nova tela ou componente, verificar:

- [ ] Todos os tap targets >= 48dp x 48dp
- [ ] Contraste de texto WCAG AA em todos os textos
- [ ] Estados de loading, erro, vazio e dado implementados
- [ ] Nunca depende de cor sozinha para transmitir informacao
- [ ] Funciona com textScaleFactor 1.3 sem quebrar layout
- [ ] Sem angulos retos expostos (verificar raios em todos os containers)
- [ ] Fonte Nunito aplicada (nao fonte padrao do sistema)
- [ ] Tom de linguagem seguindo a secao 9 (encorajador, tutear, frases curtas)
- [ ] Haptics implementados nos eventos de feedback de exercicio
- [ ] Dark mode testado (pelo menos visualmente no emulador)
- [ ] Bottom navigation bar oculta em telas de exercicio
- [ ] Acoes destrutivas tem confirmacao com dialogo padrao (secao 9.6)
- [ ] Snackbars em vez de alerts para mensagens de feedback de acao
- [ ] SafeArea respeitada em todas as bordas relevantes

---

## 18. Referencias e inspiracoes

- **Duolingo**: estrutura de licao, gamification, tom acolhedor, acessibilidade universal
- **Material 3 Design**: sistema de tokens, componentes, typografia
- **Google Classroom**: hierarquia de unidades e licoes, clareza de progresso
- **Headspace**: telas de celebracao, gradientes suaves, tom encorajador
- **Kahoot**: grid de alternativas, feedback visual imediato, feedback de cor
- **Comunidade surda brasileira**: validar toda representacao visual de Libras com pessoas surdas reais antes de publicar

---

*Versao 1.0 - Junho/2026. Manter este documento atualizado a cada ciclo de design.*
