# SPIKE 01 - Resultados (reconhecimento de mãos no app)

> Execução da tarefa S1 da SPEC 01 ("landmarks da mão na tela"). Rodado em 2026-06-16.
> Ambiente de dev: Linux headless (sem device/emulador) - validou-se instalação, resolução
> de dependências e type-check; o build nativo e a medição em câmera ficam para um device.

## O que foi construído
- App Expo (TypeScript) em `apps/mobile/` (SDK 56, RN 0.85, React 19).
- Tela `App.tsx`: câmera frontal (vision-camera) + frame processor chamando `detectHandLandmarks` + overlay SVG do esqueleto da mão (21 pontos, conexões).
- `src/recognition/handConnections.ts` (esqueleto) e `src/recognition/normalize.ts` (normalização da SPEC 01, pronta para o classificador).
- `app.json` com config plugins (vision-camera + mediapipe) e permissões de câmera (pt-BR).
- Modelo `assets/hand_landmarker.task` (7.8 MB) baixado do MediaPipe.

## Descobertas (correções à SPEC 01)

### 1. `react-native-mediapipe` (cdiddy77) NÃO serve
- Última publicação: 2024-12-12 (v0.6.0). Estagnada.
- A versão publicada exporta apenas object/pose/face. **Não tem hand landmarker**, apesar do site de docs anunciar. Descartada.

### 2. Melhor opção atual: `expo-vision-camera-v4-mediapipe`
- v1.2.2, publicada 2026-06-13. 21 landmarks 3D por mão, até 4 mãos, handedness, pose/face opcionais (holistic), feita explicitamente para "sign-language (Libras)". Frame processor nativo em Kotlin.
- API: worklet global `detectHandLandmarks(frame)` retornando `{ hands: HandLandmark[][], handedness, pose?, face? }`.
- **Limitação dura: Android only.** iOS não suportado nesta versão.

### 3. BLOQUEADOR de versão (o achado principal)
- Expo SDK 56 instala **vision-camera v5.0.11**, que **redesenhou a API** (modelo de "outputs": `useFrameOutput`, `useAsyncRunner`, `useObjectOutput`...). **`useFrameProcessor` e a prop `frameProcessor` não existem mais.**
- `expo-vision-camera-v4-mediapipe` depende da **API de frame processor do vision-camera v4**.
- Fixar vision-camera em v4 sob o SDK 56 dá **ERESOLVE** (conflito transitivo reanimated 4 / react-native-worklets 0.9.x / skia).
- Confirmado por type-check: `App.tsx` não compila contra a v5 (`useFrameProcessor` inexistente).

## Conclusão
O reconhecimento de mãos é viável e a tecnologia existe, mas **o stack bleeding-edge de hoje (SDK 56 + vision-camera v5) não encaixa com o plugin de mãos (que assume v4)**. É preciso escolher a base antes de prosseguir. Esse era o objetivo do spike: achar isso agora, não depois.

## Opções de caminho (decisão necessária)

| Opção | O que é | Prós | Contras |
|---|---|---|---|
| **A. Base estável (SDK 53/54 + vision-camera v4 + plugin)** | Recriar o app numa SDK Expo um pouco anterior, onde a API v4 e o plugin se encaixam | Caminho provado, plugin funciona como projetado, rápido para validar viabilidade | Não fica na SDK mais nova; Android-only continua |
| **B. Ficar no SDK 56/v5 e escrever frame processor próprio** | Plugin nativo (Kotlin + iOS Swift) sobre MediaPipe Tasks, na API v5 | Sem pin de versão; **resolve iOS também**; controle total | Mais trabalho de engenharia nativa agora |
| **C. Forçar v4 no SDK 56 (`--legacy-peer-deps`)** | Instalar v4 ignorando conflito e testar no device | Rápido de tentar | Frágil; pode quebrar no build nativo; dívida técnica |

## Recomendação
Para um spike (objetivo = validar viabilidade rápido, não estar na ponta), **Opção A**: recriar a base numa SDK estável onde o plugin funciona, provar o GO/NO-GO de acurácia (S4-S6) e só depois decidir investir no plugin nativo (Opção B) para destravar iOS e a SDK mais nova.

## Próximos passos após escolher a base
- S2: ferramenta de captura de landmarks rotulados.
- S3: coletar 5-6 letras com 5+ pessoas.
- S4: treinar classificador estático + exportar `.tflite` (ou usar Gesture Recognizer/Model Maker).
- S5/S6: inferência on-device ao vivo + medir acurácia com gente nova (GO se >= 90%).
