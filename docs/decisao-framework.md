# Decisão de framework: mobile web (antes: Flutter, Android-first no spike)

> Decidido em 2026-06-16, após o spike de reconhecimento (`spike-01-findings.md`).
> **Reavaliado em 2026-10-22: a decisão vigente é mobile web** (ver "Reavaliação 2026-10: mobile web", no fim).
> As seções até "iOS - plano" ficam como histórico da decisão de junho.

## Contexto
O spike revelou que **não existe biblioteca pronta, madura e cross-platform (iOS+Android)
para landmarks de mão** - nem em React Native nem em Flutter. Os wrappers prontos de mãos
são **Android-only** nos dois ecossistemas; iOS sempre exige uma **ponte nativa** sobre o
MediaPipe Tasks iOS. Trocar de framework não derruba esse muro.

## Comparação (para este projeto)

| Critério | React Native | Flutter | Mobile web (reavaliação 2026-10) |
|---|---|---|---|
| Lib de mãos pronta (Android) | fragmentada; conflito vision-camera v4/v5, plugins imaturos | **`hand_landmarker` (pub.dev, v2.2.0): pacote único, empacota o modelo, delegate GPU/CPU** | MediaPipe Tasks Vision (`HandLandmarker`) em JS, o mesmo pacote no Android e no iPhone |
| iOS (mãos) | ponte nativa (MediaPipe Tasks iOS) | ponte nativa (igual) | igual ao Android (Safari iOS 16.4+) |
| iOS sem código nativo | não | não | **sim** |
| UI animada estilo jogo | boa | **excelente** (renderização compilada) | boa (CSS/WAAPI, canvas) |
| Reuso no web/PWA (alvo secundário) | **melhor** (MediaPipe JS é first-class) | Flutter web mais pesado | é o próprio produto |
| Backend AWS (Camada 2) | indiferente | indiferente | indiferente |
| Currículo/avaliação (Camada 3) | indiferente | indiferente | indiferente |

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

## iOS - plano (histórico)
> Plano de junho/2026, substituído pela reavaliação abaixo: no navegador o iPhone usa o mesmo
> MediaPipe JS do Android, sem ponte nativa.

Plugin Flutter próprio (platform channel/FFI) sobre o MediaPipe Tasks iOS SDK (Swift),
expondo `detectHandLandmarks` com a mesma forma de saída do `hand_landmarker` Android.
Entraria depois do GO de viabilidade no Android.

## Reavaliação 2026-10: mobile web

> Decidido em 2026-10-22. Detalhes, fases e riscos em [`plano-mobile-web.md`](./plano-mobile-web.md).

### O que mudou
- O PWA virou prioridade, que era a condição de reavaliação registrada em junho.
- `apps/web-poc/` ficou mais completo que o Flutter: onboarding, mapa do curso, lição, prática, streak,
  conquistas, perfil e configurações, rodando o domínio testado de `services/api/` no navegador sobre IndexedDB.
- O MediaPipe JS funciona no Safari iOS sem ponte nativa, o que elimina o bloqueio de iOS do spike 01.
- `apps/mobile_flutter/` nunca foi compilado em aparelho (não tem a pasta `android/`), então o GO/NO-GO da
  SPEC 01 seção 5 nunca foi medido no Flutter.

### Decisões
Princípio: **o produto roda no navegador do celular e a experiência é a mesma no iPhone e no Android.** Quando um
recurso não existe em um dos lados, ele vira melhoria opcional e a experiência base funciona sem ele.

1. **Plataforma**: mobile web é o canal único. `apps/web-poc/` vira o produto (`apps/web/`). O Flutter fica
   congelado (não é apagado) e sai do roadmap.
2. **Aparelhos fracos**: se a fase W0 mostrar que um aparelho não aguenta a câmera (menos de 8 fps mesmo
   otimizado), ele recebe o modo receptivo (exercícios sem câmera) com mensagem honesta. O Flutter não volta
   para cobrir esse caso.
3. **Navegadores**: Safari iOS 16.4+ (e Chrome iOS, que usa o mesmo motor) e Chrome/Samsung Internet Android nas
   duas últimas versões, em Android 9+. Navegadores embutidos (Instagram, WhatsApp, TikTok) mostram "Abrir no
   navegador".
4. **Conta**: entra como convidado; a conta é oferecida no fim da primeira lição, com reforço antes de instalar
   na tela inicial e antes de ligar lembretes. `navigator.storage.persist()` sempre.
5. **Tela da câmera**: vídeo da própria pessoa com o esqueleto 2D por cima. O avatar 3D sai do MVP.
6. **Reconhecimento**: MediaPipe Tasks Vision (`HandLandmarker`) 1.1.1, com WASM e modelo hospedados por nós e
   guardados no service worker; delegate GPU (WebGL2) com fallback para CPU. Letras estáticas: MLP em TypeScript
   com pesos exportados pelo `train_static.py`. Letras com movimento e palavras: modelo temporal no ONNX Runtime
   Web. As regras feitas à mão saem.
7. **Ícones**: Material Symbols Rounded em SVG.
8. **Fonte**: Nunito auto-hospedada em woff2.
9. **Idiomas**: MVP só em pt-BR.
10. **Tipos de exercício**: `intro` vira `sign_intro`, `mc4` é fundido em `watch_choose_word`, `sign_camera` vira
    `perform_sign`; os exercícios passam a vir do bundle de conteúdo.
11. **Notificações**: Web Push com VAPID onde houver suporte (Android sempre, iPhone com o app na tela inicial);
    para todos, lembrete dentro do app e e-mail opcional.
12. **Háptica e som**: háptica é melhoria opcional (o iPhone não vibra pelo navegador); som em AAC/MP3 via Web
    Audio; todo feedback importante é visual.
13. **Instalação**: sugerir "adicionar à tela inicial" depois da primeira lição concluída e com conta criada.
    Nunca obrigatório.
14. **Hospedagem**: um CloudFront com domínio próprio servindo tudo na mesma origem (`/` app, `/content/`,
    `/ml/`, `/api/`).

### Impacto nas specs
- **SPEC 01 (reconhecimento)**: é a que mais muda (rota web, pipeline em TypeScript, coleta no navegador,
  trilha W0 a W2). Ver a seção 2 do plano.
- **SPEC 02, 03, 04 e 05**: ajustes de plataforma (IndexedDB no lugar de SQLite, Web Push, Web Share,
  convites por HTTPS, Web Audio, metas de performance web). Domínio, currículo e regras de jogo não mudam.
- **Design system**: a proposta foi aprovada e virou o [`design-system.md`](./design-system.md), já para web.
- `apps/mobile_flutter/` fica congelado como referência (por exemplo, a `normalizeHand` de
  `lib/hand_skeleton.dart` é a referência da normalização que vai para TypeScript).

### Se um dia for preciso estar nas lojas
Empacotar o mesmo web com Capacitor (iOS) e TWA (Android), sem reescrever o app.
