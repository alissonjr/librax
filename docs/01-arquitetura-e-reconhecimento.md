# Camada 1: Arquitetura tecnológica e reconhecimento de sinais

> **OBSOLETO** - Este blueprint foi escrito antes do spike e assumia React Native + Expo como stack.
> Decisao final: **Flutter, Android-first** (ver `decisao-framework.md` e `spike-01-findings.md`).
> A fonte da verdade e a `spec-01-reconhecimento.md`.

> Prioridade de plataforma: **app de celular híbrido para iOS e Android**.
> Web/PWA entra como alvo secundário (mesmo código de UI), nunca como bloqueador.

## 1.1 Decisão de stack

| Camada | Escolha | Por quê |
|---|---|---|
| Runtime do app | **React Native + Expo (com EAS Build / dev client)** | Um código para iOS e Android, ecossistema gigante, acesso a módulos nativos para câmera e ML. |
| Câmera | **react-native-vision-camera** | Câmera de alta performance com *frame processors* (processa cada frame em thread nativa, sem passar imagem pela ponte JS). |
| Extração de landmarks | **MediaPipe Tasks Vision (Hand/Pose/Face Landmarker)** rodando nativo | Modelo de mão maduro do Google, roda em GPU no device, 30+ fps. |
| Classificação do sinal | **TFLite via react-native-fast-tflite** | Roda o modelo de classificação on-device, com delegates GPU/NNAPI/Core ML. |
| Estado/dados | TanStack Query + Zustand; SQLite local (expo-sqlite / WatermelonDB) | Cache, offline-first. |
| Web (secundário) | **react-native-web** + `@mediapipe/tasks-vision` (JS/WASM) | Reaproveita UI; no web o MediaPipe roda em WebGL/WebGPU. |

### Por que Expo e não "RN puro" ou Flutter
- Expo hoje suporta **módulos nativos e config plugins** via EAS Build, então a limitação antiga ("Expo não faz câmera/ML") não existe mais. Você ganha OTA updates, build na nuvem e DX excelente sem abrir mão de nativo.
- **Importante:** câmera + MediaPipe exigem **development build** (não funciona no Expo Go). O fluxo é: `expo prebuild` / config plugin + `eas build` + `expo-dev-client`.
- Flutter é excelente, mas a integração de ML de câmera em tempo real é mais artesanal e o suporte web do MediaPipe é nativo em JS, o que favorece o ecossistema React quando quisermos o PWA.

## 1.2 O pipeline de reconhecimento (coração do produto)

Arquitetura em duas etapas. Nunca trafegamos imagem; só vetores de coordenadas. Isso resolve privacidade (LGPD) e custo.

```
┌──────────┐   frame    ┌─────────────────────┐ 21 pts/mão ┌──────────────┐ vetor ┌────────────┐  score
│  Câmera  │ ─────────▶ │ MediaPipe Landmarker │ ─────────▶ │ Normalização │ ────▶ │ Classifier │ ──────▶ feedback
│ Vision-  │  (nativo,  │  (mão / pose / face) │  (x,y,z)   │  (invariância)│       │  (TFLite)  │
│ Camera   │   GPU)     └─────────────────────┘             └──────────────┘       └────────────┘
└──────────┘
       tudo on-device, em tempo real, offline
```

**Etapa A - Extração de landmarks (biblioteca pronta, não treinamos):**
- Mão: 21 landmarks 3D por mão, até 2 mãos.
- Quando avançarmos para sinais com corpo/rosto: Pose Landmarker (33 pontos) + Face Landmarker (expressões não manuais, que em Libras carregam significado gramatical).

**Etapa B - Classificação (esta parte é nossa):**
- **Sinais estáticos** (alfabeto/números): vetor de 21 landmarks normalizados, classificado por **MLP pequeno** (ou KNN no protótipo).
- **Sinais dinâmicos** (com movimento): janela de N frames de landmarks (sequência), classificada por **GRU/LSTM, 1D-CNN ou Transformer pequeno**.

### Normalização (passo que faz o modelo funcionar no mundo real)
O modelo precisa ser invariante a: distância da câmera, posição da mão na tela e tamanho da mão. Receita:

```ts
// pseudo-código do frame processor / worklet
function normalize(landmarks /* 21 x {x,y,z} */) {
  const wrist = landmarks[0];
  // 1. translada para a origem (pulso = 0,0,0)
  let pts = landmarks.map(p => ({ x: p.x - wrist.x, y: p.y - wrist.y, z: p.z - wrist.z }));
  // 2. escala pela distância pulso -> base do dedo médio (invariância de tamanho/distância)
  const scale = dist(pts[0], pts[9]) || 1e-6;
  pts = pts.map(p => ({ x: p.x / scale, y: p.y / scale, z: p.z / scale }));
  // 3. (opcional) alinha rotação usando o eixo pulso->médio
  return pts.flatMap(p => [p.x, p.y, p.z]); // vetor de 63 floats
}
```

### Onde roda a inferência
- **Estáticos e a maioria dos isolados: 100% on-device.** Latência zero, funciona offline, custo de servidor zero.
- **Modelos grandes (futuro/avançado):** servidor opcional (FastAPI + ONNX Runtime), recebendo **apenas a sequência de landmarks**, nunca vídeo.

## 1.3 Estrutura de pastas proposta

```
librax-game/
├── apps/
│   └── mobile/                 # app Expo (React Native)
│       ├── app/                # rotas (expo-router)
│       ├── src/
│       │   ├── recognition/    # frame processors, normalização, wrappers TFLite
│       │   ├── exercises/      # componentes de cada tipo de exercício
│       │   ├── features/       # streak, xp, conquistas, ligas
│       │   ├── data/           # supabase client, sqlite, sync
│       │   └── ui/             # design system
│       └── plugins/            # config plugins (vision-camera, mediapipe)
├── packages/
│   ├── core/                   # regras de negócio compartilhadas (TS puro)
│   └── ml/                     # scripts de treino (Python) + modelos exportados
├── ml-training/                # notebooks/scripts de coleta e treino
│   ├── data/                   # landmarks rotulados (NÃO versionar vídeos)
│   ├── collect/                # ferramenta de captura de dataset
│   └── train/                  # treino do classificador estático e temporal
└── docs/
```

## 1.4 Bibliotecas-chave (verificar versões/maturidade na implementação)

| Função | Biblioteca | Observação |
|---|---|---|
| Câmera performática | `react-native-vision-camera` | Frame processors + worklets (`react-native-worklets-core`). |
| Landmarks de mão | `react-native-mediapipe` (community) **ou** plugin custom sobre MediaPipe Tasks | Conferir maturidade; alternativa é escrever um frame processor plugin nativo. |
| Inferência on-device | `react-native-fast-tflite` | Carrega `.tflite`, suporta delegates GPU/Core ML. |
| Resize de frame | `vision-camera-resize-plugin` | Pré-processa frame para o modelo. |
| Web (PWA) | `@mediapipe/tasks-vision` + `@tensorflow/tfjs` | Caminho secundário. |
| Treino (Python) | `mediapipe`, `tensorflow`/`keras`, `scikit-learn`, `numpy` | Geração do dataset e modelos. |

> Nota honesta: a peça de maior risco de integração é o **frame processor plugin que entrega os landmarks ao JS**. Validar isso num spike isolado antes de construir telas. Se `react-native-mediapipe` não estiver maduro o suficiente, o plano B é um plugin nativo fino (Kotlin/Swift) sobre MediaPipe Tasks que devolve o array de landmarks.

## 1.5 Coleta de dados e treino

O classificador precisa de **landmarks rotulados por sinal**. Pipeline:

1. **Ferramenta de captura** (`ml-training/collect/`): app/webcam grava várias repetições de cada sinal, de várias pessoas, e salva **apenas os landmarks** (não o vídeo) com o rótulo. Variar iluminação, fundo, mão esquerda/direita, distância.
2. **Augmentation sobre landmarks**: ruído gaussiano, rotação/escala leve, jitter temporal (para dinâmicos). Multiplica o dataset barato.
3. **Treino estático**: MLP simples (entrada 63, 1-2 camadas densas, softmax por classe). Exporta `.tflite`.
4. **Treino temporal**: sequências de T frames x 63 (ou 126 para duas mãos), modelo GRU/1D-CNN. Padroniza tamanho de janela e taxa de amostragem.
5. **Datasets públicos de Libras** (ex.: MINDS-Libras, LIBRAS-UFOP e similares acadêmicos) podem acelerar, **mas é obrigatório verificar licença e disponibilidade atual antes de usar** (não assumir, conferir caso a caso).

## 1.6 Performance, bateria e robustez (mobile)
- Rodar landmarker em **GPU delegate**; limitar a ~15-20 fps para os exercícios (não precisa de 60) para poupar bateria e evitar throttling térmico.
- Processar frames com `runAsync`/skip de frames para não enfileirar.
- Detectar condições ruins (sem mão no frame, baixa luz, mão cortada) e dar feedback de enquadramento **antes** de avaliar o sinal.
- **Calibração rápida** no início dos exercícios de câmera (mostra o esqueleto detectado e pede para a pessoa ajustar).

## 1.7 Privacidade desde o design (LGPD)
- **Vídeo/imagem nunca sai do dispositivo.** Só landmarks (e, na maioria dos casos, nem isso sai: classificação é local).
- Permissão de câmera com explicação clara; **modo sem câmera sempre disponível** (exercícios receptivos).
- Se um dia coletarmos landmarks para melhorar o modelo, exige **consentimento explícito e opt-in**, anonimizado.

## 1.8 Sequência de validação técnica (de-risking)
1. Spike: dev build Expo + VisionCamera + landmarks da mão aparecendo na tela. (maior risco)
2. Classificador do alfabeto on-device, medindo acurácia com luz/câmeras reais.
3. Só então integrar nas telas de exercício.
4. Depois: modelo temporal para o primeiro punhado de sinais dinâmicos.
