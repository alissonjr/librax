# SPEC 01 - Reconhecimento de sinais (executável)

> Aprofundamento do doc `01-arquitetura-e-reconhecimento.md` até nível de implementação.
> Ancorado em evidência da literatura e no estado real das libraries (ver Fontes no fim).
> Plataforma: **Flutter, Android-first** (decidido pós-spike, ver `decisao-framework.md`);
> iOS via ponte nativa na fase de produção. Inferência on-device.

## 0. Veredito de viabilidade (honesto)

| Capacidade | Acurácia esperada (literatura) | Veredito |
|---|---|---|
| Datilologia / handshapes estáticos | ~95-97% | **Viável já.** Baixo risco. |
| Sílabas / sinais isolados curtos | ~97% (datasets controlados) | Viável com modelo temporal + dataset próprio. |
| Sinais isolados "in the wild" (LIBRAS-BSL) | ~88% | **Viável, mas não perfeito.** UX precisa absorver os ~12% de erro. |
| Frases contínuas | pesquisa de ponta | **Fora de escopo.** |

Conclusão: o produto é viável construindo do estático para o dinâmico. O número de **88% em sinais isolados reais** é o dado que mais molda o design: a avaliação **não pode** ser binária e punitiva, senão 1 em cada 8 acertos do aluno vira "erro" do sistema. Isso vira requisito de UX (seção 6) e de negócio (vidas generosas).

## 1. Decisões de arquitetura (travadas)

1. **Extração de landmarks** via **Flutter** (ver `spike-01-findings.md` e `decisao-framework.md`). Pacote: **`hand_landmarker`** (pub.dev, v2.2.0) - 21 landmarks 3D, delegate GPU/CPU, empacota o modelo, integra com o plugin `camera`. **Android-only**; iOS via **plugin Flutter nativo próprio** (platform channel/FFI) sobre o MediaPipe Tasks iOS SDK, na fase de produção. Histórico: a `react-native-mediapipe` (cdiddy77) está abandonada e sem mãos; `expo-vision-camera-v4-mediapipe` exige vision-camera v4 (incompatível com a v5 do Expo SDK 56) - por isso a escolha por Flutter.
2. **Inferência do classificador: on-device.**
   - **Estáticos:** duas rotas possíveis (decidir no spike): (a) **MediaPipe Gesture Recognizer + Model Maker** treinado com nossos handshapes (sem escrever classificador), ou (b) MLP próprio em `.tflite` rodando via **`tflite_flutter`**. Preferir (a) se a acurácia bater a meta, pelo menor custo de engenharia.
   - **Dinâmicos:** modelo temporal próprio (`.tflite`) sobre sequência de landmarks.
3. **Pré-processamento obrigatório** (a literatura mostra que isto é o que faz funcionar no mundo real):
   - Normalização por translação (pulso na origem) + escala (pulso->base do médio).
   - **Seleção de subconjunto de landmarks** (não usar todos: mais rápido e mais preciso).
   - **Suavização temporal** (média móvel / Gaussian) para reduzir jitter entre frames.
   - **Imputação por spline** para frames com landmark faltante (mão sai do quadro por um instante).
4. **Imagem nunca sai do device.** Só landmarks; e na maioria dos casos nem isso (classificação local). LGPD por design.

## 2. Pipeline de runtime (detalhado)

```
Camera frame (15-20 fps)
   → hand_landmarker HandLandmarkerPlugin (GPU, ~12ms)    → 21 landmarks x (até 2 mãos)
   → [Dart] normalização + subset + suavização             → vetor de features
   → ESTÁTICO: classifica frame estável (mão parada ~400ms) → score por classe
   → DINÂMICO: buffer de janela T frames → modelo temporal  → score por sinal
   → política de decisão (seção 6)                          → feedback ao aluno
```

Parâmetros iniciais (calibrar no spike):
- FPS de processamento: 15 (poupa bateria; landmarker aguenta mais).
- Janela temporal T: 24-32 frames (~1.5-2s a 15fps); padding/reamostragem para sinais mais lentos.
- Features estático: 21 pts x (x,y,z) = 63, menos o subconjunto descartado.
- Features dinâmico: T x (mão(s) + subset de pose para ponto de articulação).

## 3. Modelos

### 3.1 Estático (alfabeto/números) - MVP
- Entrada: vetor de landmarks normalizados (1 frame estável).
- Modelo: MLP 2 camadas (ex. 128->64, ReLU, softmax) **ou** Gesture Recognizer/Model Maker.
- Dataset alvo: ver seção 4.
- **Meta de aceite: >= 95% top-1** em conjunto de teste com pessoas/condições não vistas.

### 3.2 Dinâmico (sinais isolados) - pós-MVP
- Entrada: sequência T x features (mãos + subset de pose).
- Modelo: GRU/1D-CNN leve ou Transformer pequeno; considerar DTW contra protótipo como sinal auxiliar.
- **Meta de aceite: >= 85% top-1** em sinais do currículo, com pessoas não vistas. (Coerente com os ~88% da literatura em dados reais; abaixo disso, o sinal fica como exercício receptivo até melhorar.)

## 4. Dados de treino (quantificado)

Referência da literatura: dataset de Libras com **~27 mil amostras para 26 classes (~1.000/classe)** atingiu ~97% em tarefa estática controlada. Tradução para nosso plano:

| Fase | Classes | Amostras/classe (mín.) | Pessoas distintas (mín.) | Como coletar |
|---|---|---|---|---|
| Alfabeto (estático) | ~26-32 | 300-500 (após augmentation: 1.000+) | 15-20 | ferramenta de captura própria |
| Números | ~11 | 300-500 | 15-20 | idem |
| Saudações (1os dinâmicos) | ~7 | 200-400 sequências | 15-20 | idem |

Regras de coleta (cada uma reduz o gap "funciona só comigo"):
- Variar **pessoas** (tom de pele, tamanho de mão, canhoto/destro), **iluminação**, **fundo**, **distância** e **ângulo**.
- Salvar **apenas landmarks + rótulo** (não vídeo).
- **Augmentation sobre landmarks**: ruído gaussiano, rotação/escala leve, espelhamento (canhoto), jitter temporal (dinâmico).
- Split por pessoa (treino/val/teste **sem** a mesma pessoa em mais de um split), senão a acurácia mente.

Fontes de dados, em ordem de praticidade:
1. Captura própria do currículo inicial (rápido para alfabeto).
2. Datasets públicos (ex.: MINDS-Libras, LIBRAS-UFOP, LIBRAS-BSL) - **verificar licença e disponibilidade caso a caso antes de usar.**
3. Co-criação com a comunidade surda (também garante correção linguística).

## 5. Plano de SPIKE (de-risking) - o próximo passo concreto

Objetivo: provar/derrubar a viabilidade antes de construir telas. Timebox sugerido: **5-8 dias úteis.**

| # | Tarefa | Critério de aceite |
|---|---|---|
| S1 | Dev build Expo (EAS) + vision-camera + `react-native-mediapipe` rodando | Esqueleto da mão desenhado sobre o vídeo, em iOS e Android reais, >= 15fps. |
| S2 | Ferramenta de captura de landmarks rotulados | Consegue gravar N amostras/classe de várias pessoas e exportar dataset. |
| S3 | Coletar 5-6 letras (ex. A, B, C, L, O, U) com 5+ pessoas | Dataset de teste com split por pessoa. |
| S4 | Treinar classificador estático + exportar `.tflite` (ou Gesture Recognizer) | Treino reproduzível em script. |
| S5 | Rodar inferência on-device em tempo real | Classifica as letras ao vivo, mostra confidence. |
| S6 | Medir acurácia com pessoas/luz **não vistas** | **GO se >= 90%** nas 5-6 letras com gente nova. NO-GO se << 90% mesmo após tuning. |

Entregável do spike: um relatório curto com a acurácia medida e a decisão GO/NO-GO sobre rota de classificador (Model Maker vs MLP próprio), além dos parâmetros calibrados (fps, T, subset de landmarks).

## 6. Política de avaliação e UX (deriva direto do 88%)

- **Nunca binário cru.** Limiar com tolerância + dica construtiva derivada da diferença de landmarks ("abra mais os dedos").
- **Distinguir falha de captura de erro do aluno**: sem mão no quadro / luz ruim / mão cortada => orientar enquadramento, **não** contar erro nem tirar vida.
- **Tentativas generosas** + botão "ver o modelo de novo" + esqueleto sobreposto comparando com a referência.
- **Calibração rápida** antes dos exercícios de câmera (mostra detecção e pede ajuste de luz/posição).
- **Modo sem câmera sempre disponível** (exercícios receptivos) - acessibilidade e quem não quer ligar a câmera.
- **Limiares (`min_confidence`) por sinal**, não global: sinais difíceis recebem limiar/regra mais permissivos. Calibrar com dados reais (não chutar).

## 7. Performance, bateria, robustez
- GPU delegate; processar a 15fps; usar `runAsync`/skip de frames para não enfileirar.
- Monitorar throttling térmico em sessões longas.
- Lidar com mãos faltantes/oclusão via imputação por spline antes de classificar.

## 8. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| `hand_landmarker` Android-only; iOS exige ponte nativa | Média | Alto | Plano B (iOS/prod): plugin Flutter próprio (platform channel/FFI) sobre MediaPipe Tasks iOS SDK - ver `decisao-framework.md`. |
| Handshapes visualmente parecidos confundem o modelo | Média | Médio | Subset de landmarks + mais dados desses pares + usar orientação/profundidade. |
| Dinâmico não passa de ~88% | Alta | Médio | Sinal vira receptivo até melhorar; UX tolerante; coletar mais dados guiado por telemetria de confidence. |
| Variação de câmera/luz entre devices | Alta | Médio | Diversidade no dataset; calibração; normalização robusta. |
| Dataset público indisponível/licença | Média | Médio | Não depender dele; captura própria + comunidade surda. |

## 9. Frontend - componentes de câmera

Os componentes desta secao sao reutilizados pelos exercicios expressivos definidos
na SPEC 03 (perform_sign, fingerspell, mirror_practice). O HandCameraView do spike
(apps/mobile_flutter/) e o precursor direto.

### 9.1 Fluxo de permissao de camera

**Acesso:** primeira vez que o usuario abre um exercicio expressivo na sessao.

**Componentes:**
- `PermissionRationaleCard`: titulo "Para este exercicio o Librax precisa da sua camera"; texto de privacidade "Sua imagem nunca sai do celular. So os pontos da sua mao sao usados para avaliar o sinal. (LGPD)"; ilustracao de mao com pontos 3D.
- Botao primario "Permitir camera".
- Botao secundario "Fazer sem camera".
- `CameraBlockedCard` (estado negado): titulo "Camera bloqueada"; texto "Abra as configuracoes do celular e permita o Librax usar a camera"; botoes "Abrir configuracoes" e "Fazer sem camera".

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| inicial | permissao ainda nao solicitada | exibe `PermissionRationaleCard` com os dois botoes |
| negado | usuario negou no prompt do SO | troca para `CameraBlockedCard` |
| concedido | permissao concedida | fecha o fluxo e segue para `CalibrationOverlay` (9.2) |

**Acoes:**
| Acao | Resultado |
|---|---|
| "Permitir camera" | abre prompt nativo; sucesso -> concedido; recusa -> negado |
| "Abrir configuracoes" | abre as configuracoes do app no SO (`app_settings`) |
| "Fazer sem camera" | salva preferencia local; substitui exercicios expressivos pela versao receptiva equivalente; reversivel em Configuracoes |

### 9.2 CalibrationOverlay

**Acesso:** antes do primeiro exercicio com camera de cada sessao; nao reaparece ate o app ser reaberto.

**Componentes:**
- `CameraPreview` ao fundo + `HandSkeletonPainter` (sobrepoe os 21 pontos assim que ha mao).
- Mensagem-guia "Posicione a mao no quadro".
- `StabilityBar`: progresso dos 2s de estabilidade exigidos.
- `LightingIndicator`: "Boa" / "Insuficiente", atualizado em tempo real.
- Botao "Pular calibracao": so aparece apos 10s sem deteccao.

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| aguardando | sem mao detectada | guia + barra zerada; apos 10s exibe "Pular calibracao" |
| estabilizando | mao detectada, < 2s estavel | `StabilityBar` preenche; esqueleto visivel |
| luz ruim | iluminacao insuficiente | `LightingIndicator` = "Insuficiente" (alerta) |
| pronto | mao estavel por 2s consecutivos | fecha overlay e inicia o exercicio |

**Acoes:**
| Acao | Resultado |
|---|---|
| mao estavel por 2s | avanca automaticamente |
| "Pular calibracao" | fecha o overlay e inicia o exercicio sem calibrar |

### 9.3 CameraExerciseLayout (componente reutilizavel)

Widget Flutter base de `perform_sign`, `fingerspell` e `mirror_practice`. Define a moldura; o painel inferior e preenchido por cada tipo (SPEC 03 secoes 11.7-11.9).

**Componentes:**
- `AppBar`: botao voltar, titulo do exercicio, botao "?" (acoes).
- `LessonProgressBar` logo abaixo da `AppBar`.
- `CameraPane` (~55% da altura): `CameraPreview` + `CustomPaint(HandSkeletonPainter)` + HUD central de estado (texto).
- `ExercisePanel` (~45%): slot preenchido pelo tipo de exercicio.

**Acoes:**
| Acao | Resultado |
|---|---|
| "?" (AppBar) | abre bottom sheet com toggle camera ligada/desligada (troca expressivo por receptivo sem sair da licao) |
| voltar | delega ao container (`LessonScreen`), que confirma o descarte de progresso |

### 9.4 FeedbackOverlay

Camada sobre o `CameraExerciseLayout` apos cada avaliacao. Os quatro estados vem direto da politica da secao 6.

**Componentes:** mensagem de resultado, dica contextual por parametro (CM/OR/PA/MOV) e botoes de acao conforme o estado.

**Estados:**
| Estado | Gatilho | Conteudo | Cor | Saida |
|---|---|---|---|---|
| `correct` | confianca >= limiar | icone de confirmacao + "Correto!" + badge "+XP" subindo | verde | auto-avanca em 1.2s |
| `retry` | mao detectada, confianca < limiar | "Quase la!" + dica (ex.: "Abra mais os dedos. (CM)") | vermelho suave | aguarda acao: "Ver o sinal de novo" ou "Tentar novamente" |
| `no_capture` | sem mao / luz ruim / mao cortada | "Posicione a mao no quadro" ou "Procure um lugar mais iluminado" | amarelo (sem punicao) | auto-dispensa em 2s; nao conta tentativa |
| `accept_soft` | apos N tentativas, limiar relaxado | "Bom trabalho!" + atencao ao parametro mais distante (ex.: OR) | verde suave | aguarda "Continuar" |

**Regras:**
- A dica e gerada por `nearestErrorHint`, comparando os landmarks do aluno com o protótipo do sinal (mapeia para CM/OR/PA/MOV).
- `no_capture` nunca conta como tentativa nem erro (distingue falha de captura de erro do aluno - secao 6).

### 9.5 Adicao a definicao de pronto desta camada

- HandCameraView encapsulado como widget Flutter reutilizavel com API `onHands`.
- CalibrationOverlay funcional com deteccao de luz e estabilidade de mao.
- FeedbackOverlay implementado para todos os quatro estados.
- CameraExerciseLayout como widget base para os exercicios expressivos da SPEC 03.
- Fluxo de permissao de camera com fallback "sem camera" funcionando.

## 10. Definição de pronto (Camada 1)
- Spike com GO documentado e parâmetros calibrados.
- Rota de classificador estático decidida (Model Maker vs MLP).
- Ferramenta de captura + scripts de treino versionados em `ml-training/`.
- Pipeline de runtime encapsulado em `apps/mobile/src/recognition/` com API estável para a camada de exercícios (`evaluatePerformSign`, `evaluateFingerspell`).

## Fontes
- [Real-Time Syllable Recognition in LIBRAS (Springer)](https://link.springer.com/chapter/10.1007/978-3-032-04552-2_12) - 27.456 amostras, 26 classes, CNN ~97.4%, ~50ms desktop / 195ms RPi.
- [Proper Body Landmark Subset for Isolated LIBRAS (arXiv 2510.24887)](https://arxiv.org/pdf/2510.24887) - seleção de subconjunto de landmarks: ~5x mais rápido e mais preciso.
- [Enhancing Sign Language Detection via MediaPipe + CNN (arXiv 2406.03729)](https://arxiv.org/html/2406.03729v1) - 98.8% (DSL-46), 99.84% (LSA64), 88.40% (LIBRAS-BSL).
- [MediaPipe Landmarks + RNN for Dynamic Sign Recognition (MDPI)](https://www.mdpi.com/2079-9292/11/19/3228).
- [react-native-mediapipe - Hand Landmark Detection docs](https://cdiddy77.github.io/react-native-mediapipe/docs/api_pages/face-landmark-detection/) - suporta Hand Landmarker + Gesture Recognizer com vision-camera.
- [High-performance hand landmark detection in RN + Vision Camera (Medium, L. Kurant)](https://medium.com/@lukasz.kurant/high-performance-hand-landmark-detection-in-react-native-using-vision-camera-and-skia-frame-9ddec89362bc) - ~12ms GPU / 17ms CPU no Pixel 6.
