# Decisão de framework: Flutter (Android-first no spike)

> Decidido em 2026-06-16, após o spike de reconhecimento (`spike-01-findings.md`).

## Contexto
O spike revelou que **não existe biblioteca pronta, madura e cross-platform (iOS+Android)
para landmarks de mão** - nem em React Native nem em Flutter. Os wrappers prontos de mãos
são **Android-only** nos dois ecossistemas; iOS sempre exige uma **ponte nativa** sobre o
MediaPipe Tasks iOS. Trocar de framework não derruba esse muro.

## Comparação (para este projeto)

| Critério | React Native | Flutter |
|---|---|---|
| Lib de mãos pronta (Android) | fragmentada; conflito vision-camera v4/v5, plugins imaturos | **`hand_landmarker` (pub.dev, v2.2.0): pacote único, empacota o modelo, delegate GPU/CPU** |
| iOS (mãos) | ponte nativa (MediaPipe Tasks iOS) | ponte nativa (igual) |
| UI animada estilo jogo | boa | **excelente** (renderização compilada) |
| Reuso no web/PWA (alvo secundário) | **melhor** (MediaPipe JS é first-class) | Flutter web mais pesado |
| Backend AWS (Camada 2) | indiferente | indiferente |
| Currículo/avaliação (Camada 3) | indiferente | indiferente |

## Decisão
**Flutter**, Android-first para o spike. Motivos:
1. A lib de mãos do Flutter é a mais sólida disponível hoje (vs. o inferno de versões do RN).
2. UI de jogo polida é ponto forte do Flutter.
3. O custo do iOS (ponte nativa) é o mesmo nos dois - não é fator de desempate.

Trade-off aceito: o reuso no **web/PWA** (alvo secundário) fica menos natural. Quando/se o
PWA virar prioridade, reavaliar (MediaPipe roda em JS no navegador independente do app mobile).

## Impacto nas specs
- **SPEC 01 (reconhecimento)**: stack do app passa a Flutter; pipeline e metas seguem iguais
  (MediaPipe Hand Landmarker + classificador `.tflite` via `tflite_flutter`).
- **SPEC 02 (backend AWS)** e **SPEC 03 (currículo/avaliação)**: **inalteradas** - são
  agnósticas de framework.
- O scaffold React Native foi **removido** (`apps/mobile/`); os aprendizados do spike estão
  em `spike-01-findings.md`. O caminho ativo é `apps/mobile_flutter/`.

## iOS - plano (produção, não MVP do spike)
Plugin Flutter próprio (platform channel/FFI) sobre o MediaPipe Tasks iOS SDK (Swift),
expondo `detectHandLandmarks` com a mesma forma de saída do `hand_landmarker` Android.
Entra depois do GO de viabilidade no Android.
