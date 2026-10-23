# Camada 3: Currículo, fases, conteúdo e avaliação

> Meta: "O Duolingo de Libras". Aprendizado real, não joguinho.
> Conteúdo co-criado com a comunidade surda (requisito, não opcional).

## 3.1 Princípios pedagógicos

Libras tem **5 parâmetros** que estruturam todo sinal e, portanto, todo o conteúdo e a avaliação:
1. **Configuração de mão** (handshape)
2. **Ponto de articulação** (onde o sinal acontece no corpo/espaço)
3. **Movimento**
4. **Orientação da palma**
5. **Expressões não manuais** (rosto/corpo: carregam gramática, ex. negação, pergunta)

Implicação: nas fases iniciais avaliamos só configuração de mão (estático, confiável). Movimento e expressão entram progressivamente, acompanhando a maturidade do modelo de visão (doc 1).

Níveis (inspirados em CEFR, adaptados):
- **A1 Iniciante**: alfabeto, números, saudações, identidade.
- **A2 Básico**: família, cotidiano, verbos comuns, perguntas.
- **B1 Intermediário**: tempo, lugares, descrições, narrativas curtas.
- (B2+ depois, já tocando estrutura frasal e expressões não manuais.)

## 3.2 Árvore de habilidades (primeiro curso: "Libras do Zero", A1)

```
Curso A1: Libras do Zero
├── Unidade 1 - Alfabeto manual (datilologia)        [reconhecimento ESTÁTICO]
│   ├── Lição 1: Vogais (A E I O U)
│   ├── Lição 2: Consoantes A-M
│   ├── Lição 3: Consoantes N-Z
│   └── Lição 4: Soletrar palavras curtas
├── Unidade 2 - Números                              [ESTÁTICO]
│   ├── Lição 1: 0-10   ├── Lição 2: 11-100
├── Unidade 3 - Saudações e cortesia                 [primeiros DINÂMICOS]
│   ├── OI, BOM-DIA, TUDO-BEM, OBRIGADO, POR-FAVOR, DESCULPA, TCHAU
├── Unidade 4 - Identidade
│   ├── EU, VOCÊ, MEU-NOME, soletrar o próprio nome, SURDO, OUVINTE
├── Unidade 5 - Família
│   ├── MÃE, PAI, IRMÃO, IRMÃ, FILHO, FAMÍLIA
└── Unidade 6 - Cotidiano básico
    ├── CASA, COMER, ÁGUA, TRABALHAR, ESTUDAR, SIM, NÃO
```

Sequência intencional: começa 100% estático (modelo confiável, aluno ganha confiança e nós validamos pipeline), e só então introduz movimento.

## 3.3 Catálogo de tipos de exercício

### Receptivos (entender Libras) - sem câmera, fáceis de produzir
| Tipo | Descrição |
|---|---|
| `watch_choose_word` | Assiste ao vídeo do sinal, escolhe a palavra (múltipla escolha). |
| `word_choose_video` | Lê a palavra, escolhe entre 4 vídeos qual é o sinal. |
| `match_pairs` | Parear sinais (vídeos) com significados. |
| `order_sequence` | Ordenar passos/movimentos de um sinal. |

### Expressivos (produzir Libras) - usam câmera, é o diferencial
| Tipo | Descrição |
|---|---|
| `perform_sign` | Mostra o alvo, aluno executa, modelo avalia (estático ou dinâmico). |
| `fingerspell` | Soletrar uma palavra em datilologia (sequência de letras). |
| `mirror_practice` | Prática livre com feedback de esqueleto em tempo real, sem nota. |

Regra de ouro: **toda lição mistura receptivo e expressivo.** O receptivo ensina/prepara; o expressivo avalia; e o receptivo é o **fallback** quando não há câmera ou a pessoa não quer ligá-la.

### Exemplo de payload (jsonb em `exercises.payload`)
```jsonc
// perform_sign (estático - letra A)
{
  "type": "perform_sign",
  "sign_id": "letra-A",
  "recognition": "static",
  "min_confidence": 0.75,
  "max_attempts": 5,
  "hint_video_url": "https://cdn/.../A.mp4"
}
// watch_choose_word
{
  "type": "watch_choose_word",
  "sign_id": "OBRIGADO",
  "options": ["OBRIGADO", "DESCULPA", "POR-FAVOR", "TCHAU"],
  "correct": "OBRIGADO"
}
// fingerspell
{
  "type": "fingerspell",
  "word": "ANA",
  "letters": ["A","N","A"],
  "per_letter_confidence": 0.7
}
```

## 3.4 Lógica de avaliação do sinal (UX crítica)

Princípios:
- **Limiar com tolerância + feedback construtivo**, nunca binário cru. Em vez de "errado": "Quase! Sua mão estava um pouco fechada, abra mais os dedos."
- **Feedback visual do esqueleto** sobreposto, comparando com a referência. Ensina muito mais que certo/errado.
- **Tentativas generosas**: câmera ruim, luz ruim e iniciante errando são coisas diferentes. Dar várias tentativas + botão "ver o modelo de novo".
- **Detecção de problema de captura ≠ erro do aluno**: se não há mão no frame ou luz é ruim, orientar enquadramento, não contar como erro/perda de vida.

```ts
function evaluatePerformSign(scoreStream, payload) {
  // estático: pega o pico de confidence numa janela estável (mão parada ~0.5s)
  const best = peakStableConfidence(scoreStream, payload.sign_id);
  if (best.signMissing)   return { result: 'no_capture', coach: 'Posicione a mão no quadro' };
  if (best.lowLight)      return { result: 'no_capture', coach: 'Procure mais luz' };
  if (best.confidence >= payload.min_confidence) return { result: 'correct', confidence: best.confidence };
  return {
    result: 'retry',
    confidence: best.confidence,
    coach: nearestErrorHint(best, payload.sign_id) // dica derivada da diferença de landmarks
  };
}
```

Para **dinâmicos**: avaliar a sequência completa (janela temporal), com tolerância a velocidade (o aluno faz mais devagar). Pode usar DTW (dynamic time warping) entre a trajetória do aluno e o protótipo, além do classificador.

## 3.5 Estrutura de uma sessão/lição
- 7 a 12 exercícios, mistura de tipos, dificuldade crescente.
- Barra de progresso, vidas (se aplicável), XP no fim.
- **Revisão espaçada** intercalada: a lição puxa sinais antigos "devidos" (ver 3.6).
- Tela de conclusão com XP, streak e o que foi aprendido.

## 3.6 Repetição espaçada (o que separa "ferramenta que ensina" de "joguinho")

Modelar cada `(usuário, sinal)` como item de memória (tabela `srs_items`, doc 2). Algoritmo: **half-life regression** (estilo Duolingo) ou SM-2/Leitner como ponto de partida mais simples.

```
acerto  -> strength sobe -> due_at mais distante (intervalo cresce)
erro    -> strength cai  -> due_at logo (revisa em breve)
```

Sinais "devidos" (`due_at <= agora`) reaparecem dentro das próximas lições, priorizando os mais fracos. Isso garante que nada aprendido seja esquecido em silêncio.

## 3.7 Produção de conteúdo (não negociável)
- **Vídeos de referência e validação dos sinais por pessoas surdas e profissionais/intérpretes de Libras.** Sem isso, risco alto de ensinar errado e de o produto soar apropriativo. Tratar como requisito de produto.
- Cada sinal documenta os **5 parâmetros** (campo `signs.params`), o que serve tanto para ensino quanto para gerar dicas de avaliação.
- **Variação regional**: Libras varia por região. Definir cedo o padrão ensinado e sinalizar variantes (`signs.region`).

## 3.8 Acessibilidade e inclusão
- O app ensina Libras a **adultos** (muitos com vínculo pessoal com a surdez): tom respeitoso, sem infantilizar.
- **Modo sem câmera** sempre completo: dá para progredir só com exercícios receptivos.
- Legendas, alto contraste, suporte a fontes grandes, navegação por teclado/leitor de tela onde fizer sentido.
- Considerar que parte do público-alvo pode ser surda (aprendendo a forma padrão, ensinando familiares ouvintes etc.): não depender de áudio para nenhuma instrução crítica.

## 3.9 Como o conteúdo conversa com a tecnologia
- A ordem do currículo (estático -> dinâmico) é ditada pela confiabilidade do reconhecimento (doc 1).
- A telemetria de `confidence` por sinal (doc 2) realimenta tanto a dificuldade dos exercícios quanto a fila de "sinais que precisam de mais dados de treino".
- Um sinal só "entra" como exercício expressivo quando o modelo atinge um patamar mínimo de acurácia validado; até lá, fica como receptivo.
