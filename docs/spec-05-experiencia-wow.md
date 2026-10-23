# SPEC 05 - Experiência WoW: momentos de encantamento

> Esta spec nao define novas features de negocio. Define como as features ja especificadas
> (SPEC 01-04) devem ser executadas para criar experiencias memoraveis. E a camada de
> polimento emocional que separa "funciona" de "impressiona".
>
> Plataforma: **mobile web** (navegador do celular, mesma experiencia no iPhone e no Android;
> ver `plano-mobile-web.md`). As implementacoes abaixo sao web (`apps/web-poc/`); o Flutter esta congelado.
>
> Premissa central: o diferencial do Librax e o momento em que a camera reconhece o sinal
> do usuario. Tudo o que encanta gira em torno desse triangulo: **camera + Libras + impacto real**.

---

## 0. Filosofia: o triangulo do encantamento

O Librax tem tres fontes de WoW que nenhum outro app de aprendizado combina:

1. **A camera te ve** - a tecnologia reconhece seu gesto em tempo real. Isso e magico para
   qualquer pessoa que nunca usou reconhecimento de landmarks.
2. **Voce esta aprendendo uma lingua de verdade** - nao vocabulario generico. Libras e usada
   por 2,7 milhoes de pessoas no Brasil. O usuario sente que esta fazendo algo que importa.
3. **Voce pode usar agora** - diferente de um idioma oral que leva anos para usar na rua,
   voce pode cumprimentar uma pessoa surda na proxima semana.

Todo elemento de design emocional deve amplificar um desses tres pilares.
Efeitos que nao se conectam a nenhum deles sao decoracao; corte sem piedade.

---

## 1. A camera como palco (o nucleo do WoW)

O esqueleto 2D (SPEC 01 secao 9.3), desenhado num `<canvas>` 2D por cima do `<video>` da propria
pessoa (espelhado), nao e apenas um overlay tecnico. E o elemento mais poderoso do app - o momento
em que o usuario ve o app "enxergar" sua mao. Nao ha avatar 3D no MVP (decisao 5 do
`plano-mobile-web.md`): a pessoa ve o proprio sinal, e a GPU fica livre para o reconhecimento.

### 1.1 Design visual do esqueleto

As cores vem dos tokens `stage.landmark.*` (`design-system.md` secao 4.3), sempre com o contorno
`stage.landmark.halo` por baixo para ler sobre qualquer video.

| Estado | Cor dos landmarks | Cor das conexoes | Espessura | Efeito adicional |
|---|---|---|---|---|
| nenhuma mao | nada | nada | - | - |
| mao detectada, confidence baixa | branco, 80% opacidade | branco, 50% | 2px / 4px raio | nenhum |
| confidence subindo (> 40%) | azul claro | azul claro | 2px / 4px | glow suave no pulso |
| confidence no limiar (> min_confidence) | verde | verde | 2.5px / 5px | pulso radial a partir do pulso |
| `correct` confirmado | verde vivo | verde vivo | 3px / 6px | escala 1.0 -> 1.08 -> 1.0 (200ms spring) + glow intenso 600ms |
| dedo especifico com erro (retry) | landmarks do dedo em ambar | conexoes do dedo em ambar | 2px / 5px | pisca 2x para chamar atencao |

O esqueleto de **referencia** (exibido no estado `retry` para comparacao) aparece como fantasma azul
semitransparente (40% opacidade) por baixo do esqueleto do usuario (amarelo/ambar). A diferenca
visual entre os dois e a "coaching moment" mais eficaz do produto - mais do que qualquer texto.

### 1.2 A ConfidenceBar como termometro ao vivo

Nao e apenas um progress bar. E o feedback mais imediato de que o app "ta vendo" o usuario:

- Cor muda progressivamente do cinza ao verde conforme a confidence sobe.
- A barra nao e estatica: oscila suavemente para refletir o stream de scores do frame atual.
- Quando atinge o limiar: a barra "trava" (animacao de lock: barra pisca uma vez em verde brilhante)
  e imediatamente dispara a avaliacao.
- A oscilacao ao vivo e o que faz o usuario entender intuitivamente que precisa manter a mao firme.

### 1.3 O momento do acerto com camera

Este e o pico emocional do produto. A sequencia deve ser precisa:

1. Barra atinge o limiar -> trava com pulso verde (50ms).
2. FeedbackOverlay entra com fade rapido (100ms).
3. Esqueleto faz a animacao de "cristalizacao" (escala 1.0 -> 1.08 -> 1.0, spring 200ms).
4. Som de acerto toca (ver secao 3).
5. Vibracao `correctCamera` (40ms) dispara junto com o som, onde houver suporte (secao 4).
6. Badge "+XP" sobe do centro da tela para a barra de XP (animacao 800ms, easeOut).
7. Texto "Correto!" aparece em verde, fonte grande, centralizado.
8. Auto-avanca apos 1.2s.

Nao economize nenhuma dessas etapas. O acerto com camera e 10x mais satisfatorio que um acerto
receptivo e merece 10x mais celebracao.

---

## 2. O Momento Zero (primeiro exercicio expressivo)

A primeira vez que o usuario abre um exercicio `perform_sign` e um momento de produto critico.
Muitos usuarios nunca viram reconhecimento de landmarks ao vivo. A revelacao precisa de cerimonia.

### 2.1 Sequencia do Momento Zero

Depois do fluxo de permissao de camera (SPEC 01 secao 9.1) e do CalibrationOverlay (SPEC 01
secao 9.2), mas ANTES do primeiro exercicio iniciar:

1. Camera ativa, CalibrationOverlay concluido (mao estavel por 2s).
2. O esqueleto da mao ja esta visivel na tela (estamos saindo do CalibrationOverlay).
3. Uma mensagem contextual aparece por 2s: "O Librax consegue enxergar sua mao!" com o esqueleto
   pulsando suavemente em azul. Isso nomeia explicitamente o que o usuario esta vendo.
4. Mensagem some com fade (300ms) e o primeiro exercicio inicia normalmente.

Este momento nao deve ser um modal ou um tutorial. Deve ser integrado ao fluxo, quase subliminar.
O usuario experimenta a magica primeiro, o texto confirma o que ja viu.

### 2.2 Primeiro acerto expressivo - celebracao amplificada

O PRIMEIRO sinal correto avaliado pela camera (flag `firstCameraSuccess`, armazenada localmente)
recebe uma celebracao adicional apos o FeedbackOverlay padrao:

- Overlay adicional (aparece apos o padrao, antes do auto-avanco): texto "Incrivel! Voce acabou
  de fazer um sinal real de Libras." por 2s, fundo escuro semitransparente.
- Animacao de particulas suaves (nao confete - mais elegante) ao redor do esqueleto da mao.
- Este overlay nao aparece em acertos subsequentes.

---

## 3. Design de som

Filosofia: sons sao **expressivos, nao punitivos**. O app nunca toca um som negativo para
um erro. Sons reforcam celebracoes e dao textura ao ritmo de uso.

Default: perguntado no onboarding, sem presumir nada pela resposta "sou surdo(a)" (`design-system.md` secao 15, item 4).
Toggle em Configuracoes (SPEC 02 secao 12.8) e **toggle de som sempre visivel** na barra do topo da
licao, para ligar e desligar sem sair do exercicio. O volume e a chave de silencioso do aparelho
mandam: com o celular no mudo, nenhum som toca. Nada depende de som (secao 16.1).

**Implementacao web:**
- Web Audio API: um unico `AudioContext` para o app, com os sons decodificados em `AudioBuffer`
  (`decodeAudioData`) e tocados por `AudioBufferSourceNode`, o que da latencia baixa.
- O contexto so toca depois de destravado no primeiro toque da pessoa (`audioContext.resume()`
  dentro de um evento de clique). Antes disso nada toca e nada quebra.
- Onde existir `navigator.audioSession` (Safari), usar `navigator.audioSession.type = 'ambient'`,
  para nao interromper a musica da pessoa e respeitar a chave de silencioso.
- Formato dos arquivos: **AAC (`.m4a`)** ou **MP3**, que tocam no Safari iOS e no Chrome Android.
  OGG Vorbis nao serve: falha no Safari.
- Pasta: `public/audio/`, guardada pelo service worker para funcionar offline.
- Pre-carregar ao entrar no `LessonScreen` os sons frequentes (`sfx_correct_soft`, `sfx_correct_camera`, `sfx_advance`) para o disparo ser imediato.
- Sons de evento unico (course, unit, achievement) carregados sob demanda.
- Para `sfx_xp_tick` (pitch crescente conforme XP sobe): pre-gravar 3 variantes em tons distintos (grave, medio, agudo) e alternar por faixa de XP, em vez de manipular pitch em runtime (menos artefatos).

### 3.1 Catalogo de sons

| Evento | Som | Descricao tecnica | Duracao |
|---|---|---|---|
| Acerto receptivo (opcao correta) | `sfx_correct_soft` | Toque curto em Mi5, reverb leve | ~300ms |
| Acerto com camera (perform_sign) | `sfx_correct_camera` | Acorde em Do-Mi-Sol, sustain de 0.8s, leve reverb de sala | ~1000ms |
| Erro receptivo | `sfx_neutral` | Whoosh suave descendente, sem timbre negativo | ~200ms |
| Auto-avanco de exercicio | `sfx_advance` | Click seco, tipo page-turn | ~80ms |
| XP incrementando (animacao) | `sfx_xp_tick` | Bip curto, grave-para-agudo conforme contador sobe | ~50ms por tick |
| Conquista desbloqueada | `sfx_achievement` | Chime de 3 notas ascendentes, distinto do completion | ~600ms |
| Licao concluida (LessonCompletion) | `sfx_lesson_done` | Fanfarra curta ascendente (4 notas) | ~800ms |
| Unidade concluida (UnitCompletion) | `sfx_unit_done` | Fanfarra media (6 notas) + eco | ~1200ms |
| Curso concluido (CourseCompletion) | `sfx_course_done` | Fanfarra completa + resolucao harmonica | ~2500ms |
| Streak estendida | `sfx_streak` | Whoosh ascendente + crackle (fogo) | ~500ms |
| Meta diaria atingida | `sfx_goal_met` | Acorde de resolucao, alegre | ~600ms |
| Freeze usado | `sfx_freeze` | Cristal gelado, descendente | ~400ms |

### 3.2 Regras de sobreposicao

- Nunca dois sons simultaneos. Fila FIFO com descarte de sons de baixa prioridade se outro esta
  tocando.
- Prioridade (maior = toca por cima): course > unit > achievement > lesson > goal > streak > correct.
- Sons de UI (advance, tick) sao sempre cancelados se qualquer som de celebracao iniciar.

**Implementacao da fila (web):**
```ts
const PRIORITY: Record<string, number> = {
  sfx_course_done: 8, sfx_unit_done: 7, sfx_achievement: 6,
  sfx_lesson_done: 5, sfx_goal_met: 4, sfx_streak: 3,
  sfx_correct_camera: 2, sfx_correct_soft: 1,
  sfx_advance: 0, sfx_xp_tick: 0, sfx_neutral: 0,
};
// Se currentPriority >= PRIORITY do novo som, descartar o novo.
// Se currentPriority < PRIORITY do novo som, parar o atual (source.stop()) e tocar o novo.
```

---

## 4. Haptica (feedback tatil)

Haptica e **melhoria opcional**: `navigator.vibrate` vibra no Chrome Android (so depois do
primeiro toque da pessoa na pagina e com a aba visivel) e nao existe no iPhone, em nenhum
navegador. Todo evento abaixo ja tem um equivalente visual sempre exibido; a vibracao so reforca.
Toggle "Vibracao" em Configuracoes (secao 12.8, grupo "Aprendizado"). Os padroes vem dos tokens
`haptic.*` (`design-system.md` secao 10.2; implementado em `apps/web-poc/src/lib/haptics.ts`).

| Evento | Padrao web (`navigator.vibrate`, ms) | Notas |
|---|---|---|
| Toque em botao primario | `[10]` | Feedback de toque generico |
| Selecao de opcao (receptivo) | `[8]` | Confirma o toque |
| Acerto receptivo | `[25]` | Satisfatorio sem ser exagerado |
| Erro receptivo | sem vibracao | Nao punir |
| Acerto com camera | `[40]` | O maior feedback; o corpo sente o acerto |
| Conquista desbloqueada | `[100, 50, 100]` | Distinto, chamativo |
| Streak estendida | `[50, 30, 50]` | Leve, ritimico |
| Meta diaria atingida | `[80, 40, 80, 40, 80]` | Tres pulsos |
| Freeze usado | `[200]` | Unico, "cristalizando" |
| Curso concluido | `[100, 50, 100, 50, 200]` | Ritmo celebratorio |

---

## 5. Sistema de motion design

Principio: **velocidade comunica emocao**. Rapido = energico, responsivo. Lento = grandioso,
emocional. Bounciness = celebratorio.

### 5.1 Curvas de easing e duracoes padrao

Todas as animacoes sao CSS (`transition`, `@keyframes`) ou Web Animations API (WAAPI,
`element.animate()`), com curvas `cubic-bezier()`. As molas viram `cubic-bezier` com overshoot ou,
quando o navegador suporta, a funcao `linear()` com os pontos da mola amostrados (Safari 17.2+,
Chrome 113+); sem `linear()`, cai no `cubic-bezier` de overshoot. Duracoes e curvas vem dos tokens
`motion.*` (`design-system.md` secao 9); as molas guardam `mass`, `stiffness` e `damping` no JSON
para referencia (overshoot quando `zeta = c / (2 * sqrt(k * m)) < 1`).

| Categoria | Duracao | Curva web | Quando usar |
|---|---|---|---|
| Transicao de pagina | 300ms | `cubic-bezier(0.2, 0, 0, 1)` | Navegacao entre telas |
| Feedback de opcao (correto/errado) | 150ms | `cubic-bezier(0, 0, 0.2, 1)` | Rapido e decisivo |
| Auto-avanco pos-acerto | 200ms | `cubic-bezier(0, 0, 0.2, 1)` | Nao deve parecer lento |
| Barra de progresso | 500ms | `cubic-bezier(0, 0, 0.2, 1)` | Satisfatorio |
| Contador de XP | 800ms | `cubic-bezier(0, 0, 0.2, 1)` (com ticks por intervalo) | Lento o suficiente para apreciar |
| Badge "+XP" subindo | 800ms | `cubic-bezier(0, 0, 0.2, 1)` | Desacelera ao chegar na barra |
| Achievement badge | 400ms | mola `celebrate` (mass 1, stiffness 300, damping 20; zeta=0.58, overshoot ~8%): `linear()` ou `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bounce celebratorio |
| LessonNode desbloqueado | 600ms | mola `unlock` (mass 1, stiffness 200, damping 18; zeta=0.64, overshoot ~5%): `linear()` ou `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bounce visivel, novo conteudo |
| Streak number change | 300ms | `cubic-bezier(0.4, 0, 1, 1)` | Odometro flip |
| Confete caindo | 2000-3000ms | fisica do `canvas-confetti` (sec 5.2) | Natural, nao robotico |
| Overlay de feedback appear | 150ms | `cubic-bezier(0, 0, 0.2, 1)` | Entrar rapido e decisivo |
| Overlay de feedback disappear | 200ms | `cubic-bezier(0.4, 0, 1, 1)` | Sair gracioso |
| Bottom sheets | 400ms | `cubic-bezier(0, 0, 0.2, 1)` | Token `motion.duration.slow` |
| DailyGoalBar - meta atingida | 1000ms | `linear()` com oscilacao amortecida (fallback `cubic-bezier(0.34, 1.56, 0.64, 1)`) | Supera 100%, oscila e estabiliza |

**Mola em WAAPI:**
```ts
// linear() com a mola amostrada quando houver suporte; senao, overshoot em cubic-bezier
// springToLinear: amostra a mola (mass, stiffness, damping do token) em pontos para linear()
const springEase = CSS.supports('animation-timing-function', 'linear(0, 1)')
  ? springToLinear(tokens['motion.spring.celebrate'])
  : 'cubic-bezier(0.34, 1.56, 0.64, 1)';
el.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }], { duration: 400, easing: springEase });
```

**Reduzir movimento:** com `prefers-reduced-motion: reduce` (ou a opcao "Reduzir animacoes" do app),
deslocamento, escala e mola viram fade curto; confete desligado; chama da streak estatica. O
esqueleto continua (e informacao), sem pulso nem brilho (`design-system.md` secao 9.3).

### 5.2 Confete

Confete e usado criteriosamente - quando usado muito, perde o impacto.

| Evento | Intensidade | Duracao | Cores |
|---|---|---|---|
| Conquista importante (ex.: streak 7 dias) | leve (20 particulas) | 1.5s | verde, azul, branco |
| UnitCompletion | media (50 particulas) | 2.5s | verde, amarelo, branco |
| CourseCompletion (A1) | intensa (150 particulas, tela cheia) | 5s | azul royal, dourado, branco (referencia bandeira surda) |
| Liga: promovido | media (40 particulas) | 2s | cor do tier novo |

Particulas de confete: formas mistas (retangulos, circulos, estrelas pequenas). Fisica simples:
gravidade constante + rotacao aleatoria + leve desvio horizontal.

**Implementacao web:**
- Biblioteca: `canvas-confetti` (canvas proprio, leve). Hoje o web-poc usa um confete proprio em
  canvas (`apps/web-poc/src/lib/confetti.ts`); a troca segue os parametros abaixo.
- Desligado com `prefers-reduced-motion` (a biblioteca aceita `disableForReducedMotion: true`).
- Parametros por evento:
```ts
// UnitCompletion (media, ~50 particulas)
confetti({ particleCount: 50, spread: 90, startVelocity: 35, gravity: 1, ticks: 250,
           disableForReducedMotion: true });

// CourseCompletion (intensa, tela cheia, ~150 particulas em rajadas durante 5s)
confetti({ particleCount: 150, spread: 160, startVelocity: 45, gravity: 0.8, ticks: 400,
           colors: ['#1A56A0', '#D4AF37', '#FFFFFF'], // azul royal, dourado, branco
           disableForReducedMotion: true });
```
- Para conquistas leves: `particleCount: 20`, disparar de um ponto especifico (centro-topo,
  `origin: { x: 0.5, y: 0 }`, `angle: 270`, para baixo) em vez de tela cheia.

### 5.3 A chama da streak (StreakHero)

A chama muda de aparencia conforme a streak cresce. Ela e a representacao visual do esforco acumulado.

| Faixa | Aparencia da chama | Animacao |
|---|---|---|
| 1-2 dias | pequena, azul-acinzentada | oscilacao leve (loop 3s) |
| 3-6 dias | media, laranja | oscilacao media (loop 2s) |
| 7-14 dias | grande, laranja vivo | oscilacao energica (loop 1.5s) + glow suave |
| 15-29 dias | grande, laranja profundo | oscilacao energica + glow intenso |
| 30+ dias | grande, nucleo azul (chama mais quente) | oscilacao energica + glow azul + particulas de brasa |
| Em risco | qualquer tamanho, ambar/amarelo | tremula (flickering 500ms loop), mais agitada |
| Zerada | outline da chama, cinza | nenhuma animacao; estatica |

A transicao entre faixas deve ser suave (300ms crossfade) para que o usuario sinta a chama "crescendo".

Implementacao: SVG animado com CSS ou dotLottie (`.lottie`, mais leve que o JSON do Lottie) no
lugar de Lottie classico. Com reduzir movimento, a chama fica estatica na faixa certa.

---

## 6. Marcos emocionais de progressao

Momentos especificos que merecem celebracao alem do padrao. Cada marco deve ter:
a exata sequencia de o que aparece, quando e quanto tempo dura.

### 6.1 Catalogo de marcos

| Marco | Quando | Celebracao especifica |
|---|---|---|
| Primeiro acerto com camera | flag `firstCameraSuccess` | Overlay "Incrivel!" (sec 2.2) |
| Streak 3 dias | fim de sessao do terceiro dia | Banner inline na LessonCompletionScreen: "Voce esta criando um habito!" |
| Streak 7 dias | fim de sessao | Achievement "Semana Completa" + bottom sheet + confete leve |
| Streak 30 dias | fim de sessao | Achievement "Um mes de Libras" + confete intenso + chama especial (30+) |
| Primeiros 10 sinais aprendidos | ao concluir o 10o sinal no SRS | Banner na proxima abertura do app: "Voce ja conhece 10 sinais de Libras!" |
| Primeiros 50 sinais | idem ao 50o | Achievement + tela modal rapida: "Metade do basico do A1!" |
| Primeiro sinal dinamico correto | flag `firstDynamicSuccess` | FeedbackOverlay padrao + overlay extra 2s: "Incrivel! Voce fez um sinal com movimento!" |
| U1 concluida (alfabeto completo) | UnitCompletionScreen | + sequencia especial "Soletre seu nome" (sec 7) |
| A1 concluido | CourseCompletionScreen | Celebracao maxima (sec 15) |

### 6.2 Regra de empilhamento de marcos

Se multiplos marcos ocorrem na mesma sessao (ex.: streak 7 dias + primeiro sinal dinamico),
exibir em sequencia, mais importante primeiro (por prioridade: curso > unidade > streak > sinais).
Nao sobrecarregar com mais de 2 marcos por sessao; diferir o menos importante para o proximo acesso.

---

## 7. "Agora voce pode se apresentar em Libras" - o Fingerspell do nome proprio

Este e o momento mais pessoal do app. Acontece uma unica vez, apos a conclusao da U1 (alfabeto),
dentro do fluxo do UnitCompletionScreen.

### 7.1 Sequencia

Apos a animacao da UnitCompletionScreen (sec 11.13 da SPEC 03) e ANTES do botao "Continuar para U2":

**Tela especial: NameFingerspellScreen**

**Componentes:**
- Titulo: "Voce agora sabe o alfabeto de Libras!"
- Subtitulo: "Que tal soletrar seu nome?"
- `NameInput` (so aparece se o usuario e anonimo ou se `displayName` nao tem apenas letras do A-Z):
  campo simples "Seu nome:" para o usuario digitar. Maximo 10 caracteres.
- Abaixo: `LetterStrip` com as letras do nome (extraidas do `displayName` ou do `NameInput`).
- `CameraPane` ativo: avalia letra a letra, igual ao exercicio `fingerspell` (SPEC 03 sec 11.8).
- Botao "Pular por enquanto" (texto pequeno, nao destaque).

**Feedback ao completar:**
- Todas as letras marcadas -> FeedbackOverlay especial: "Incrivel! Agora voce pode se apresentar em
  Libras. Qualquer pessoa surda vai entender seu nome."
- Animacao: as letras do nome sobem uma a uma com fade, formando o nome completo na tela.
- Botao: "Continuar para U2".

**Regras:**
- Aparece uma unica vez (flag `nameFingerspellDone` local).
- Se o usuario pular, o botao "Soletrar meu nome" aparece no ProfileScreen como tarefa pendente
  ate que ele complete. Remover apos completar.
- O nome soletrado e adicionado como item SRS pessoal com `sign_id: "user_name"` - o app vai
  perguntar de novo no futuro como revisao.
- Esta sequencia ocorre somente se o usuario tiver camera ativada. Sem camera: exibir apenas
  a animacao com o nome escrito, sem avaliacao, mas com a mesma mensagem motivacional.

---

## 8. Conexao com a cultura surda (cartoes culturais)

Entre certas licoes, o app exibe um "Cartao Cultural" de leitura rapida. Nao e uma feature de
gamificacao - e conteudo genuinamente interessante que faz o usuario sentir que esta aprendendo
algo com profundidade, nao so jogando.

### 8.1 Formato e regras de posicionamento

- Aparece como tela intermediaria dentro do `LessonScreen`, substituindo 1 exercicio da sequencia.
- **Slot fixo: posicao 4** da licao (apos o 3o exercicio, antes do 4o). Se a licao tiver menos
  de 5 exercicios, o cartao nao e exibido nessa licao.
- **Frequencia: uma vez por unidade**, na primeira licao de cada unidade em que o cartao daquela
  unidade ainda nao foi exibido. Controlado pela flag local `culturalCardShown: Set<cardId>` no IndexedDB.
- **O cartao e vinculado a licao no bundle:** o campo `cultural_card_id` (opcional, string) no
  objeto `lesson` do `course.json` indica qual cartao exibir. Se `null`, nenhum cartao e exibido.
  Isso evita logica de "qual cartao vai em qual licao" no app - e definido no conteudo pelo time.
- Layout: fundo colorido suave + icone grande + titulo curto (max 8 palavras) + texto (2-3 frases).
- Botao: "Continuar" (avanca para o proximo exercicio).
- Nao avanca automaticamente - o usuario le no seu ritmo.
- Validado com a comunidade surda antes de publicar (requisito, nao opcional).

**Schema do `lesson` no `course.json` (adicao):**
```jsonc
{
  "id": "u1-l2",
  "unit_id": "u1",
  "order": 2,
  "xp_reward": 10,
  "cultural_card_id": "cc-01",   // null se sem cartao
  "exercises": [...]
}
```

**Schema do `cultural_card` no `course.json` (nova secao):**
```jsonc
{
  "cultural_cards": [
    {
      "id": "cc-01",
      "title": "Libras e uma lingua completa",
      "body": "Libras tem gramatica propria...",
      "icon": "hands_circle",   // nome do SVG em public/icons/cultural/
      "bg_color": "#E8F4F8"     // cor de fundo suave (hex)
    }
  ]
}
```

### 8.2 Catalogo inicial de cartoes culturais

| ID | Aparece em | Titulo | Texto |
|---|---|---|---|
| `cc-01` | U1, licao 2 | "Libras e uma lingua completa" | "Libras tem gramatica propria, estrutura de frases e sotaque regional. Ela nao e uma versao manual do portugues - e uma lingua independente com 5 parametros que determinam cada sinal." |
| `cc-02` | U1, licao 4 | "O alfabeto manual em Libras" | "A datilologia (soletrar com as maos) e usada para nomes proprios, palavras tecnicas e termos sem sinal equivalente. Pessoas surdas soletram com fluencia e velocidade surpreendente." |
| `cc-03` | U2, licao 1 | "Libras no Brasil" | "Libras foi reconhecida como lingua oficial do Brasil em abril de 2002. Mais de 2,7 milhoes de brasileiros surdos usam Libras como primeira lingua." |
| `cc-04` | U3, licao 1 | "A face tambem fala" | "Em Libras, expressoes faciais nao sao opcionais: sao gramaticais. Uma pergunta sem a expressao facial correta nao e uma pergunta - e uma afirmacao. Isso e o que torna os sinais com movimento mais complexos." |
| `cc-05` | U3, licao 2 | "OBRIGADO vem do coracao" | "O sinal de OBRIGADO parte do queixo (grato, do latim gratus) e se move em direcao a quem voce agradece. Muitos sinais de Libras tem origem historica direta em gestos naturais." |
| `cc-06` | U4, licao 1 | "Comunidade, nao deficiencia" | "Muitas pessoas surdas nao se identificam como portadoras de deficiencia - mas como membros de uma comunidade linguistica e cultural propria, com historia, humor, arte e identidade." |
| `cc-07` | U4, licao 2 | "Surdos no Brasil" | "O Brasil tem um dos maiores movimentos de educacao bilingue para surdos da America Latina. Escolas bilingues ensinam Libras como primeira lingua e portugues escrito como segunda." |
| `cc-08` | U5, licao 1 | "Sinais de familia variam" | "Alguns sinais de familia, como MAE e PAI, variam por regiao. O padrao nacional e o mais difundido, mas interpretes respeitam a variante regional do sinalizante." |
| `cc-09` | U6, licao 1 | "Um interprete faz a diferenca" | "Interpretes de Libras atuam em hospitais, audiencias, escolas e eventos publicos. A Lei 10.436/2002 garante o direito a servicos de interpretacao em orgaos publicos." |

Novos cartoes sao adicionados a cada nova unidade publicada. O pipeline de conteudo (SPEC 02
secao 4) inclui validacao dos cartoes culturais pela comunidade surda.

---

## 9. Personalizacao que surpreende

O app deve parecer que "sabe quem voce e" ao longo do tempo, sem ser invasivo.

### 9.1 Sinal favorito (emergente)

O sinal com o maior `ef` (easiness factor, SPEC 03 sec 6) entre os itens SRS do usuario com
`reps >= 3` e o "sinal mais forte". O `ef` do SM-2 sobe a cada acerto qualificado e reflete
diretamente o quao bem o usuario domina aquele sinal, sem precisar de telemetria externa.

**Fonte de dados:** DynamoDB, query `PK=USER#<id>, SK begins_with SRS#` (ja existente, SPEC 02
sec 3). Client-side: filtrar `reps >= 3`, ordenar por `ef desc`, pegar o primeiro.

**Exibicao:** apos conclusao de U1, o ProfileScreen exibe um `FavoriteSignCard`:
"Seu sinal mais forte: <GLOSS> (facilidade <ef arredondado>)."
Nenhuma acao necessaria do usuario para configurar isso.

**Regra:** nao exibir se nenhum sinal tem `reps >= 3` ainda (perfil novo). Remover o card se
o usuario resetar o progresso.

### 9.2 Sinal de desafio (coaching nao-punitivo)

O sinal com o menor `ef` entre os itens SRS com `reps >= 1` e o "sinal de desafio". Sinais com
`ef < 1.8` e pelo menos uma revisao sao candidatos (SM-2 desce o `ef` quando o usuario erra,
entao `ef` baixo e proxy direto de dificuldade para aquele usuario especifico - sem telemetria).

**Fonte de dados:** mesma query da sec 9.1. Client-side: filtrar `reps >= 1 AND ef < 1.8`,
ordenar por `ef asc`, pegar o primeiro. Se nenhum sinal tem `ef < 1.8`, nao ha sinal de desafio.

**Exibicao:** ao abrir o DailyQueueScreen, se o sinal de desafio estiver na fila SRS do dia,
a `SrsItemTile` correspondente exibe um badge discreto: "Pratica especial".
Nenhum texto de julgamento. O badge apenas sinaliza atencao extra.

### 9.3 Lembretes adaptativos

O horario do lembrete diario (Configuracoes, SPEC 02 sec 12.8) tem um modo automatico:
o app observa os horarios reais de abertura nas primeiras 2 semanas e sugere o horario ideal.
Exibir banner no CourseMapScreen: "Voce costuma estudar por volta das 20h. Quer que eu te
lembre nesse horario?" com botoes "Sim, use este horario" / "Escolher outro".

### 9.4 Mensagem de boas-vindas contextual

O app nunca diz "Bem-vindo de volta!" de forma generica. A mensagem da TopBar (ou um
banner discreto que aparece por 3s ao abrir) e contextualizada:

| Contexto | Mensagem |
|---|---|
| Mesmo dia, segunda sessao | "Segunda sessao do dia - dedicacao!" |
| Dia seguinte, cedo (antes das 9h) | "Bom dia! Praticar cedo e um otimo habito." |
| Dia seguinte, noite (apos as 20h) | "Boa noite! Um pouco de Libras antes de dormir?" |
| Apos 2 dias sem estudar | "De volta! Seus sinais te esperavam." |
| Streak >= 7 dias | "Dia <N> da sua sequencia. Voce esta comprometido." |

Mensagens sao exibidas como texto pequeno abaixo do titulo do curso na TopBar, por 3 segundos,
com fade in/out. Nao sao modais nem banners - devem ser sutis.

---

## 10. Feedback construtivo como coaching (nao como critica)

O `nearestErrorHint` (SPEC 01 sec 9.4) e o `FeedbackOverlay` no estado `retry` precisam soar
como um professor paciente, nao como um sistema de erros.

### 10.1 Linguagem do feedback

| Parametro com erro | Exemplo de dica atual (generica) | Dica WoW (especifica e encorajadora) |
|---|---|---|
| CM (configuracao de mao) | "Posicao da mao errada" | "Quase! Abra um pouco mais os dedos - eles devem estar separados." |
| OR (orientacao da palma) | "Orientacao incorreta" | "Vire a palma um pouco mais para frente. Voce ja esta perto!" |
| PA (ponto de articulacao) | "Posicao errada" | "Suba a mao um pouco - este sinal acontece proximo ao queixo." |
| MOV (movimento) | "Movimento incorreto" | "O movimento vai de dentro para fora. Tente novamente com calma." |
| Baixa confidence geral | "Nao reconhecido" | "Mantenha a mao parada por um momento para eu avaliar melhor." |

Regra de escrita: toda dica comeca com reconhecimento ("Quase!", "Voce esta perto!") e termina
com instrucao especifica. Nunca comecar com "Errado" ou "Incorreto".

### 10.2 O esqueleto de comparacao (retry visual)

Conforme descrito na sec 1.1, o estado `retry` exibe dois esqueletos sobrepostos:
- Azul semitransparente: posicao de referencia do sinal correto.
- Ambar: posicao atual do usuario.

A distancia visual entre os dois e suficiente para o usuario entender o que ajustar, mesmo sem
ler o texto de dica. O `nearestErrorHint` apenas confirma em palavras o que os esqueletos ja
mostraram visualmente.

### 10.3 `accept_soft` como vitoria parcial

Quando o usuario chega ao `accept_soft` (apos N tentativas), a mensagem nao deve soar como
consolacao, mas como reconhecimento genuino de progresso:

"Bom trabalho! Este sinal e desafiador. Continue praticando e voce vai chegar la."

Cor: verde suave (nao vermelho; nao amarelo). O usuario avanca. O SRS marca este sinal com
`quality: 3` (SM-2), que gera um intervalo de revisao curto - o app sabe que precisa voltar a
ele logo, sem dizer isso explicitamente.

---

## 11. Empty states como oportunidades

Estados vazios sao momentos de conversacao com o usuario, nao apenas ausencia de conteudo.

### 11.1 DailyQueueScreen sem pendencias

Estado atual (SPEC 03 sec 11.12): "Nao ha nada para revisar hoje!" + pratica livre.

Estado WoW:
- Animacao: um sinal de "perfeito" (polegar para cima) desenhado pelo esqueleto de pontos,
  pulsando suavemente.
- Titulo: "Sua memoria esta em dia!"
- Texto: "Voce nao tem nenhum sinal para revisar agora. Isso significa que seu cerebro
  esta guardando bem o que aprendeu."
- Botao primario: "Aprender algo novo" -> vai para o CourseMapScreen na proxima licao disponivel.
- Botao secundario: "Pratica livre" (como antes).

### 11.2 SquadHub sem squads (SPEC 04 sec 4.1)

O estado atual ja e bom. Complementar com:
- Texto adicional: "Aprender em grupo aumenta em ate 3x a retencao. (Pesquisa de aprendizado
  colaborativo)" - referencia a dado real, nao marketese.

### 11.3 Primeiro acesso ao LeagueScreen (sem liga ainda)

Se o usuario nunca participou de uma liga (recente cadastro), exibir estado especial:
- Titulo: "Sua primeira liga comecar em breve"
- Texto: "O Librax vai te colocar em uma liga com outros usuarios do mesmo nivel assim que
  houver uma abertura. Continue estudando para entrar com mais XP."
- `LeagueTimer` mostra o tempo ate o proximo fechamento de periodo (segunda-feira 00:00 UTC).

### 11.4 CourseMapScreen com todas as licoes concluidas

Estado: usuario completou o curso A1 e nao ha mais licoes no mapa.

- Todos os `LessonNode` exibem estrelas maximas.
- A `UnitSection` de cada unidade tem um badge "Concluida".
- `ResumeBanner` troca para: "Revisar: <N> sinais pendentes no SRS" (ja definido na SPEC 03).
- Adicional: um cartao fixo no topo do mapa (abaixo da DailyGoalBar): "Parabens! Voce concluiu
  A1. Continue revisando seus sinais enquanto o A2 chega." com o `NextCourseCard` miniaturizado
  da CourseCompletionScreen.

---

## 12. Notificacoes como presenca humana

Push notifications sao o canal mais delicado. Mal feitas, viram spam e o usuario desativa.
Bem feitas, sao a ponte que traz o usuario de volta com genuina expectativa.

**Canais (iguais para todos, conforme o suporte do aparelho):**
- **Web Push (VAPID)**: no Android sempre; no iPhone **so com o app instalado na tela inicial**
  (iOS 16.4+). Pedido de permissao so depois de um gesto da pessoa, nunca na primeira abertura.
- **Lembrete dentro do app** (base para todos): banner ao abrir, com o mesmo copy do catalogo.
- **E-mail opcional** (SES, com opt-in): garante lembrete para quem nao tem push, inclusive iPhone
  sem instalar.

O catalogo abaixo vale para os tres canais.

### 12.1 Principios de voz

- **Tom: coloquial, nao corporativo.** "Seus sinais te esperavam" > "Estude Libras hoje".
- **Especificidade: citar o que o usuario fez.** "Sua sequencia de 12 dias..." > "Sua sequencia...".
- **Nunca culpa.** "Que tal continuar?" > "Voce nao estudou hoje".
- **Curtas.** Maximo 60 caracteres no corpo. O titulo nao precisa de mais de 4 palavras.

### 12.2 Catalogo de notificacoes com copy final

| Tipo | Condicao de disparo | Titulo | Corpo |
|---|---|---|---|
| Lembrete diario | usuario nao estudou hoje, no horario configurado | "Libras te espera" | "Sao so 5 minutinhos. Sua sequencia de <N> dias agradece." |
| Streak em risco | 20h no fuso do usuario, sem estudo hoje, streak >= 3 | "Sua sequencia vai ate meia-noite" | "<N> dias nao se perdem hoje. Voce chega em 5 min." |
| Retorno apos 2 dias | ultimo acesso ha 2 dias, sem estudo hoje | "Voce sumiu!" | "Seus sinais continuaram te esperando. Que tal retomar?" |
| Retorno apos 5+ dias | ultimo acesso ha 5+ dias | "Uma semana sem Libras" | "Tudo bem! O Librax esta aqui quando voce quiser voltar." |
| SRS urgente (5+ devidos) | >= 5 itens SRS com dueAt <= hoje | "Sinais esquecendo..." | "<N> sinais estao prontos para revisao. Refrescar a memoria leva 3 min." |
| Nova unidade desbloqueada | conclusao de unidade detectada | "U<N> desbloqueada!" | "Voce conquistou acesso a '<Nome da Unidade>'. Pronto para o proximo nivel?" |
| Meta diaria atingida (encorajamento extra) | ao atingir a meta diaria | "Meta do dia concluida!" | "Mais um dia de dedicacao. Sua sequencia de <N> dias continua." |
| Liga: lembrete de fim de semana | sexta-feira, posicao na zona de rebaixamento | "A liga encerra em 2 dias" | "Voce esta em #<N>. <X> XP te tiram da zona de rebaixamento." |
| Squad: membro ativo | membro da squad estuda e entra no top 3 semanal | "<Nome> esta dominando!" | "<Nome> subiu para #1 em <Squad>. Que tal responder?" |

### 12.3 Inteligencia de timing

- Nunca disparar entre 22h e 7h no fuso do usuario (push e e-mail).
- Se o usuario abriu o app nas ultimas 3h, nao disparar o lembrete diario (ja esta ativo).
- Maximo 2 notificacoes por dia (exceto emergencias de streak).
- Se o usuario nao interage com nenhuma notificacao em 7 dias seguidos, pausar todas por 3 dias
  e depois retomar apenas o lembrete diario. Nao bombardear usuarios que ignoram.

---

## 13. Social WoW

### 13.1 A energia da squad no fim da semana

Na quinta e sexta-feira, o SquadDetail (SPEC 04 sec 4.2) exibe um estado especial:
- `XpWeeklyCard` com uma barra de energia pulsante (ao inves de estatica).
- Texto adicional: "Ultimos dias da semana! Cada licao conta para o ranking."
- Se o usuario esta no top 3: "Voce esta liderando! Mantenha o ritmo."
- Se esta proximo do top 3: "Voce esta a <X> XP do #<N>. Uma licao pode mudar isso."

### 13.2 Convite com contexto humano

O link de convite (SPEC 04 sec 4.8) tem copy padrao para o compartilhamento:
"Estou aprendendo Libras no Librax! Entre na minha squad e vamos aprender juntos:
https://<dominio>/convite/<X>"

O app gera esse texto automaticamente e chama `navigator.share({ text, url })`, que abre a folha
de compartilhar do sistema (o usuario pode editar antes de enviar). Sem Web Share, o texto e
copiado com a Clipboard API e aparece "Link copiado!". O link e HTTPS: abre no navegador de
qualquer aparelho, sem precisar do app instalado.

### 13.3 In-app notification (alternativa ao push para usuarios ativos)

Se o usuario esta com o app aberto e um evento de squad ocorre (novo membro, membro no top 3),
exibir um snackbar discreto no rodape em vez de push:
"<Nome> entrou em <Squad>!" ou "<Nome> esta em #1 esta semana."
Duracao: 4s. Toque no snackbar: abre SquadDetail.

---

## 14. Onboarding com primeiro "aha" antes do primeiro exercicio

O onboarding atual (SPEC 02 sec 12.1) e bom no fluxo. Adicionar um momento de "preview magico"
na tela 4 (camera):

**Modificacao na tela 4 do onboarding:**

Apos o texto de privacidade e ANTES dos botoes "Usar camera" / "Agora nao":
- O preview so acontece com consentimento explicito: tocar em "Usar camera" e conceder a
  permissao. Antes dele, o app baixa os arquivos de reconhecimento (WASM e modelo do MediaPipe,
  de 8 a 12 MB comprimidos) com **barra de progresso** visivel e opcao "Agora nao"; com
  `Save-Data` ligado, avisa o tamanho antes de baixar. Depois do primeiro download, os arquivos
  ficam no service worker e a camera funciona offline.
- Se o usuario tocar em "Usar camera" e a permissao for concedida, ao inves de ir direto
  para o CourseMapScreen, o app exibe um **preview de 5 segundos** com:
  - Camera ativa.
  - Esqueleto 2D rodando sobre o video.
  - Texto sobreposto: "Mova sua mao e veja o Librax aprender a te conhecer."
  - Nenhuma avaliacao, nenhuma cobranca. Apenas a magica do esqueleto sobre a mao do usuario.
  - Apos 5s (ou toque em qualquer lugar): vai para o CourseMapScreen.
- Este preview nao e obrigatorio. Se o usuario tocar "Agora nao", va direto para o CourseMapScreen.

O objetivo e que o usuario experimente a tecnologia central do app antes de qualquer exercicio.
A reacao emocional ("nossa, o app ve minha mao!") cria expectativa para os exercicios expressivos.

---

## 15. CourseCompletion - a grande celebracao (orquestracao completa)

A tela do CourseCompletionScreen (SPEC 03 sec 11.15) merece uma sequencia coreografada,
nao apenas componentes na tela.

### 15.1 Sequencia coreografada (timing preciso)

| t=0ms | Tela em preto; som `sfx_course_done` inicia |
|---|---|
| t=200ms | Confete jorra de cima (150 particulas, cores azul royal e dourado) |
| t=400ms | `CourseHero` entra com scale 0.5 -> 1.0 (spring, 500ms) |
| t=600ms | Titulo "Voce completou A1: Libras do Zero!" aparece com fade |
| t=1200ms | `CompletionStats` enumera os numeros, um a um, com ticks de som |
| t=2500ms | `ShareButton` aparece com slide-up suave |
| t=3000ms | `NextStepsCard` aparece com fade |
| t=3500ms | Haptico padrao celebratorio (100ms + 50ms + 100ms + 50ms + 200ms) |

Confete continua caindo durante os primeiros 5 segundos, desacelerando gradualmente.

### 15.2 Certificado compartilhavel

O certificado gerado localmente (sem dados ao servidor) tem:
- Fundo: gradiente azul royal -> indigo.
- Texto: "Completei A1: Libras do Zero" + nome do usuario (grande) + data de conclusao.
- Logo Librax.
- Decoracao: silhueta de maos em Libras formando um circulo.
- Formato: imagem PNG 1080x1080 (padrao Instagram). Desenhado num `<canvas>` (Canvas 2D) e
  exportado com `canvas.toBlob('image/png')`.
- Compartilhar: `navigator.share({ files: [new File([blob], 'librax-a1.png', { type: 'image/png' })] })`
  quando `navigator.canShare({ files })` for verdadeiro (Android e iPhone recentes). Sem suporte,
  o botao vira "Baixar imagem" (download do PNG por link `download`).

Este certificado e simples e com dignidade - nao deve ter aparencia de videogame, mas de conquista
real. O usuario deve se sentir orgulhoso de postar.

---

## 16. Acessibilidade como WoW (nao como afterthought)

Acessibilidade bem feita e WoW para quem precisa e para quem nao precisa mas percebe o cuidado.

### 16.1 Sem dependencia de audio para nenhuma instrucao

Todas as instrucoes criticas sao visuais. Sons e hapticos sao camadas adicionais, nunca
a unica fonte de informacao. Isso serve tanto para usuarios surdos (publico alvo!) quanto
para quem usa o app no silencio.

### 16.2 Modo escuro (automatico)

O app segue a preferencia do sistema via `prefers-color-scheme` (com escolha manual "Claro, Escuro,
Sistema" nas Configuracoes, `design-system.md` secao 15, item 9). O esqueleto de maos e a ConfidenceBar
ficam sobre o palco escuro (`stage.*`) nos dois modos e mantem contraste adequado. Verificar com
WCAG AA minimo.

### 16.3 Tamanho de fonte adaptativo

Tamanhos em `rem` (16px = 1rem), para respeitar o tamanho de texto e o zoom do navegador. Nenhum
texto deve truncar com zoom de texto de 200% (WCAG 1.4.4). Testar com zoom de 200% em todos os
exercicios, inclusive na tela da camera.

### 16.4 Usuarios surdos como publico primario real

Parte do publico aprende Libras porque ja e surdo e quer a forma padronizada, ou quer ensinar
familiares. Para eles:
- Nenhuma instrucao de voz (ja garantido acima).
- Legenda de video: campo `video_caption` do `signs.json` (SPEC 03 sec 2) e exibido no
  `SignVideoPlayer` ao toque longo no video, e sempre visivel no `RefVideoThumb` dos exercicios
  expressivos. O `video_caption` descreve o que acontece no video sem depender de audio.
- Os 5 parametros do sinal (`params` do `signs.json`) aparecem em tela de detalhe acessivel
  pelo icone "i" no `RefVideoThumb`.
- O app inteiro navegavel sem audio.

---

## 17. Velocidade como WoW

O app precisa parecer instantaneo. Performance e uma feature de produto, nao uma feature tecnica.

Metas separadas para a **primeira visita** (nada em cache) e o **retorno** (shell, conteudo e ML
no service worker).

| Metrica | Primeira visita | Retorno | Por que importa |
|---|---|---|---|
| LCP da primeira tela (aparelho classe Moto G, 4G) | < 2,5s | < 1s | Usuario nao pode esperar para estudar |
| JS inicial | < 200 KB gzip | (cache) | Pagina leve abre rapido em celular de entrada |
| Tempo para o primeiro exercicio | < 3s | < 1s | App de habito diario precisa abrir rapido |
| Download do ML (WASM + modelo do `HandLandmarker`) | 8 a 12 MB comprimidos, com progresso, so com consentimento (sec 14) | 0 (cache) | Pesa no 4G pre-pago |
| Inicializacao do `HandLandmarker` | < 10s em 4G | < 1,5s | Nao pode haver delay ao abrir exercicio expressivo |
| Frame rate do skeleton | >= 15fps (minimo 10fps em Android de entrada) | igual | Abaixo disso o skeleton parece "morto" |
| Latencia de avaliacao (estatico) | < 500ms apos estabilidade | igual | Feedback imediato; delays quebram a magia |
| Download do bundle de conteudo (U1) | <= 10MB sem o ML | (cache) | Usuario pode baixar no 4G sem frustracao |

Estrategia: conteudo pre-baixado (SPEC 02 sec 4) garante que exercicios nao esperem rede.
O `HandLandmarker` e criado uma vez por sessao e aquecido assim que a camera e ativada, nao
apenas quando o exercicio expressivo inicia. O WASM e servido **pre-comprimido em brotli** (`.br`)
com `Content-Type: application/wasm`, porque a compressao automatica do CloudFront so vale para
arquivos de ate 10 MB e o WASM passa disso.

---

## 18. Definicao de pronto desta spec

### Dependencias externas (precisam existir antes de implementar)
- [ ] Sons do catalogo (sec 3.1) gravados/licenciados e entregues como arquivos AAC (`.m4a`) ou MP3 em `public/audio/`.
- [ ] Icones SVG dos cartoes culturais (`public/icons/cultural/`) criados pelo time de design.
- [ ] Arte do certificado (silhueta de maos, logotipo) entregue como asset vetorial.
- [ ] Campo `video_caption` preenchido no `signs.json` de U1 pela equipe de conteudo (SPEC 03 sec 2).
- [ ] Campo `cultural_card_id` preenchido nas licoes do `course.json` correspondentes (sec 8.1).

### Implementacao web (`apps/web-poc/`, desenvolvedor pode iniciar)
- [ ] `SfxPlayer` em Web Audio com buffers pre-carregados, destravado no primeiro toque, `audioSession` `ambient` quando existir, fila de prioridade (sec 3.2) e toggle de som sempre visivel (sec 3).
- [ ] `canvas-confetti` com parametros por evento e desligado com reduzir movimento (sec 5.2).
- [ ] Design visual do esqueleto com todos os estados de cor (sec 1.1) no canvas 2D sobre o video, com cores de `stage.landmark.*`.
- [ ] Animacao de "cristalizacao" no acerto com camera (scale com mola, sec 1.3).
- [ ] Esqueleto de comparacao (retry) com duas camadas de canvas sobrepostas (sec 10.2).
- [ ] Sequencia do Momento Zero implementada (sec 2.1-2.2), flag `firstCameraSuccess` local (hoje em `localStorage`, `src/lib/flags.ts`).
- [ ] Vibracao via `navigator.vibrate` para os eventos da sec 4, so como extra (no iPhone nada e chamado); erro nunca vibra.
- [ ] Curvas `cubic-bezier` e `linear()` aplicadas conforme tabela da sec 5.1, com `prefers-reduced-motion` respeitado.
- [ ] Animacao da chama de streak com todas as 7 faixas (sec 5.3); usar SVG/CSS ou dotLottie.
- [ ] Catalogo de marcos com celebracoes especificas (sec 6); flag `firstDynamicSuccess` local.
- [ ] `NameFingerspellScreen` implementado e integrado ao `UnitCompletionScreen` de U1 (sec 7).
- [ ] `CulturalCardWidget` renderizado no slot 4 da `LessonScreen` quando `cultural_card_id` != null (sec 8.1).
- [ ] `FavoriteSignCard` e badge "Pratica especial" no `ProfileScreen`/`DailyQueueScreen` (sec 9.1-9.2).
- [ ] Mensagem contextual de boas-vindas na `TopBar` (sec 9.4).
- [ ] Dicas do `nearestErrorHint` atualizadas com linguagem de coaching (sec 10.1).
- [ ] Empty states WoW implementados para DailyQueue, SquadHub e LeagueScreen (sec 11).
- [ ] Copy de todas as notificacoes atualizado conforme catalogo (sec 12.2) nos tres canais (Web Push, lembrete no app, e-mail); logica de pause (12.3) com flag local.
- [ ] Preview de camera no onboarding (sec 14) so com consentimento, com barra de progresso do download do ML e flag `onboardingCameraPreviewSeen` local.
- [ ] Sequencia coreografada do `CourseCompletionScreen` com WAAPI (`animation.finished`) ou atrasos encadeados (sec 15.1).
- [ ] Certificado: Canvas 2D + `canvas.toBlob()` + `navigator.share({ files })`, com download como alternativa (sec 15.2).
- [ ] `video_caption` exibida no `SignVideoPlayer` ao toque longo (sec 16.4).
- [ ] Modo escuro por `prefers-color-scheme` e teste com zoom de texto de 200% (sec 16).
- [ ] Metricas de performance (primeira visita e retorno) validadas em Moto G / Samsung A12 (Chrome Android) e em iPhone (Safari) antes de considerar pronto (sec 17).

### Item pendente de decisao (fora do escopo desta iteracao)
- Secao 9.3 (lembretes adaptativos): requer gravar timestamps de abertura no IndexedDB. Definir se entra no MVP ou pos-MVP antes de implementar.
