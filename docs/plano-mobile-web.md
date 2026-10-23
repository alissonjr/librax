# Plano: Librax mobile web

Versão do Librax que abre no navegador do celular (Safari no iPhone, Chrome no Android), sem instalar nada pela loja. Escrito em 2026-10-22 a partir da revisão de toda a pasta `docs/` e do código de `apps/web-poc/`, `apps/mobile_flutter/`, `services/api/`, `infra/` e `ml-training/`.

## Decisões travadas (2026-10-22)

Princípio que guia todas: **o produto roda no navegador do celular e a experiência é a mesma no iPhone e no Android.** Nada de fluxo especial por sistema; quando um recurso não existe em um dos lados, ele vira melhoria opcional e a experiência base funciona sem ele.

| # | Tema | Decisão | Por quê |
|---|---|---|---|
| 1 | Plataforma | **Mobile web é o canal único.** `apps/web-poc/` vira o produto (`apps/web/`). O Flutter fica congelado (não é apagado) e sai do roadmap. | O web-poc já é mais completo que o Flutter, roda o domínio testado e o MediaPipe JS funciona no Safari iOS sem ponte nativa, o que elimina o bloqueio de iOS do spike 01. |
| 2 | Aparelhos fracos | Se a fase W0 mostrar que um aparelho não aguenta a câmera (menos de 8 fps mesmo otimizado), ele recebe o **modo receptivo** (exercícios sem câmera) com mensagem honesta. Não volta o Flutter para cobrir esse caso. | Mantém um único código. O receptivo já é o fallback de acessibilidade da `spec-03`. |
| 3 | Navegadores suportados | Safari iOS 16.4+ (no iPhone todos os navegadores usam o motor do Safari, então Chrome iOS também entra) e Chrome/Samsung Internet Android nas duas últimas versões, em Android 9+. Navegadores embutidos (Instagram, WhatsApp, TikTok) mostram "Abrir no navegador". | 16.4 é a versão que trouxe Web Push e Wake Lock no iOS. |
| 4 | Conta | Fluxo igual para todos: entra como convidado, e a conta é oferecida no fim da primeira lição (como já diz a `spec-02` 12.1), com reforço antes de instalar na tela inicial e antes de ligar lembretes. `navigator.storage.persist()` é chamado sempre. | O Safari pode apagar dados de sites não usados por 7 dias; a conta protege o progresso em qualquer aparelho sem criar fluxo especial de iPhone. |
| 5 | Tela da câmera | **Vídeo da própria pessoa com o esqueleto 2D por cima**, como dizem a `spec-01` 9.3 e a `spec-05` 1. O avatar 3D sai do MVP (código fica, desligado). | Funciona bem em aparelho fraco, libera a GPU para o reconhecimento e a pessoa vê o próprio sinal, que é o que ensina. |
| 6 | Reconhecimento | Manter o MediaPipe Tasks Vision (`HandLandmarker`), atualizado para a 1.1.1, com WASM da mesma versão e modelo hospedados por nós e guardados no service worker; delegate GPU (WebGL2) com fallback para CPU, sem depender de WebGPU. Letras estáticas: MLP em TypeScript puro com pesos exportados pelo `train_static.py`, normalizando pulso na origem, escala, rotação (eixo pulso -> dedo médio) e espelhando a mão esquerda. Letras com movimento (J, Z e as que a consultoria surda confirmar) e depois palavras: modelo temporal (CNN 1D ou GRU, janelas de 24 a 32 quadros) no ONNX Runtime Web via WASM. Estabilidade contada por tempo (cerca de 400 ms), não por quadros. Dataset de 15 a 20 pessoas coletado no navegador. As regras feitas à mão saem. Da U3 em diante: duas mãos e PoseLandmarker lite, rosto só pelos lábios. | Avaliação de 2026-10-22: o MediaPipe é a melhor opção hoje para o navegador e roda igual no iPhone e no Android; o que falhava eram as regras feitas à mão e um defeito de estabilidade, não a biblioteca. TF.js está parado, ONNX e LiteRT só rodam modelos, Transformers.js é pesado demais. Não existe modelo pronto de Libras para o navegador. |
| 7 | Ícones | Material Symbols Rounded em SVG. Sai o FontAwesome. Ícone do app, favicon e palavra-marca são da marca Traço (o L desenhado como movimento, `tools/pwa/build-icons.mjs` e `src/components/Brand.tsx`, decidida em 2026-10-23). | Já é o que o `design-system.md` 8 define, licença Apache 2.0; os rounded combinam com a Figtree. |
| 8 | Fonte | Anybody (títulos, com eixo de largura) e Figtree (texto), auto-hospedadas em woff2 com licença OFL, no lugar da Nunito (marca Traço, 2026-10-23; `design-system.md` 5). | Funcionam offline (preload e precache do service worker) e não fazem requisição a terceiros (LGPD). |
| 9 | Idiomas | MVP só em pt-BR. A estrutura de i18n continua no código, en/es saem do escopo. | O público-alvo é brasileiro e Libras é brasileira. |
| 10 | Tipos de exercício | `intro` entra oficialmente na `spec-03` 3 como `sign_intro` (é o passo "apresenta (vídeo)" da regra de composição, que não tinha tipo). `mc4` é fundido em `watch_choose_word` (mesmo payload: sinal + 4 glosas). `sign_camera` é renomeado para `perform_sign`. Os exercícios passam a vir do bundle de conteúdo, não de `content.ts`. | Uma só fonte da verdade para o conteúdo. |
| 11 | Notificações | Web Push com VAPID para quem tem suporte (Android sempre, iPhone com o app na tela inicial). Para quem não tem: lembrete dentro do app e e-mail opcional (SES) com opt-in, iguais para todos. | Push no iPhone exige instalar na tela inicial; o e-mail garante lembrete para qualquer pessoa. |
| 12 | Háptica e som | Háptica é melhoria opcional (vibra no Android, não faz nada no iPhone). Som em AAC/MP3 via Web Audio. Todo feedback importante é visual. | Público inclui pessoas surdas; iPhone não vibra pelo navegador. |
| 13 | Instalação | Sugerir "adicionar à tela inicial" depois da primeira lição concluída e com conta criada. Sem conta, sugerir depois da terceira lição concluída. Uma vez só, nunca obrigatório (`shouldSuggestInstall` em `src/lib/install.ts`; regra na `spec-02` 12.1). | Instalado o app ganha push no iPhone e fica livre da limpeza de 7 dias do Safari; para quem nunca cria conta, instalar é o que protege os dados no iPhone. |
| 14 | Hospedagem | Um CloudFront com domínio próprio servindo tudo na mesma origem: `/` app, `/content/` conteúdo, `/ml/` modelos, `/api/` API. | Sem CORS, cache do service worker sem respostas opacas, Cognito com domínio próprio. |

**Pendente do usuário:** o nome do domínio próprio, e quais celulares físicos estão disponíveis para a matriz da fase W0.

## 1. Estado atual

### 1.1 O que serve

- **`apps/web-poc/`** (cerca de 10 mil linhas, v0.3.0): React 18, Vite 5, TypeScript, `vite-plugin-pwa`, `idb`, `@mediapipe/tasks-vision`. Já tem onboarding, mapa do curso, lição, telas de conclusão, prática, streak, conquistas, perfil, configurações, oito tipos de exercício, testes com vitest e layout mobile-first. O domínio vem de `services/api/src` por alias e `completeLesson` roda no navegador sobre IndexedDB (`src/lib/idbRepo.ts`), o "Caminho B" de `poc-web-storage.md`.
- **`services/api/`**: domínio JS puro com 76 testes. Já existem `handlers/` e `adapters/dynamoRepo.js` (o README está desatualizado e diz que faltam).
- **`infra/lib/librax-stack.ts`**: DynamoDB, Cognito, Lambdas, HTTP API com authorizer JWT, S3 e CloudFront de conteúdo, Scheduler da liga.
- **`ml-training/train_static.py`**: MLP 63->128->64->N com split por pessoa; exporta `.tflite` e `labels.txt`. A normalização de referência é `normalizeHand` em `apps/mobile_flutter/lib/hand_skeleton.dart`.

### 1.2 O que precisa ser corrigido no web-poc

0. **Defeito que impede qualquer acerto pela câmera**: `useStableGesture` (`src/hooks/useCameraRecognizer.ts:37-53`) só roda quando a leitura muda, então o contador nunca passa de 1 e o "Correto!" nunca aparece. Os testes não pegavam porque usam o hook falso. **Corrigido em 2026-10-22**: a estabilidade passou a contar por tempo (400 ms), com teste em `src/__tests__/useStableGesture.test.tsx`.
1. Reconhecedor heurístico (`src/lib/recognizer.ts`): compara dedos só pelo eixo y, reconhece 10 letras e a "confiança" não é probabilidade. Mão inclinada vira "A", qualquer punho fechado vira "A" (aceita S e E como A), D é lido como L. As outras 16 letras contam como erro na lição (`ExerciseCameraSign.tsx:98-116`), quando deveriam ser puladas.
2. WASM baixado na versão 0.10.19 com pacote JS 0.10.35; precisam ser iguais (e atualizar para 1.1.1).
3. WASM (11 MB) e modelo (7,8 MB) vêm de CDNs de terceiros e não ficam em cache; a câmera não funciona offline.
4. O `HandLandmarker` é recriado a cada exercício.
5. Quatro `setState` por frame e nenhum limite de 15 fps.
6. `<video>` iniciado com `display:none` (arriscado no iOS) e avatar 3D cobrindo o vídeo.
7. Sem roteador: o voltar do Android sai do app e não há URLs. **Corrigido em 2026-10-23**: react-router 6 com as rotas do `design-system.md` 11.13, "Sair da lição?" no voltar, rolagem no topo a cada tela e fallback de SPA no Vite e no service worker.
8. PWA incompleto: faltam `public/` e ícones; `theme_color` diverge entre manifest, `index.html` e design system. **Corrigido em 2026-10-23**: ícones 192, 512, maskable 512, `favicon.svg` e `apple-touch-icon` gerados por `tools/pwa/build-icons.mjs` com os tokens; manifest completo; metas do iOS; `theme_color` único (`bg.canvas`); Chrome sem erro de instalabilidade além do modo anônimo do teste; sugestão de instalar depois da primeira lição (decisão 13).
9. Nunito do Google Fonts e sem `viewport-fit=cover` nem safe areas. **Corrigido** (conferido em 2026-10-23): fonte local em `public/fonts` (hoje Anybody e Figtree, decisão 8), `viewport-fit=cover` e `--lx-safe-*` na barra de abas, barras do topo, rodapé da lição e sheets.
10. Exercícios gerados em código, fora do schema da `spec-03`; todos os `video_url` são `null`. **Corrigido em 2026-10-23** (a parte dos exercícios): bundle por lição no schema da `spec-03` 3, gerado por `tools/content/build-lessons.mjs`. Os `video_url` continuam `null` até a gravação (fase W5).
11. `navigator.vibrate` sem efeito no iOS; não há sistema de som.

### 1.3 Flutter

`apps/mobile_flutter/` nunca foi compilado em aparelho (não tem a pasta `android/`), então o GO/NO-GO da `spec-01` 5 nunca foi medido. Fica congelado.

## 2. O que muda em cada documento

**`00-visao-geral.md`**: reescrever "Plataforma prioritária" (ainda cita React Native) para mobile web; "Implementação" deve citar `apps/web-poc/` e `infra/` e reconhecer handlers e adaptador DynamoDB; roadmap com a fase W0 em primeiro e "classificador multiplataforma" no lugar de TFLite.

**`decisao-framework.md`**: nova seção "Reavaliação 2026-10: mobile web" registrando as decisões acima; linha "iOS sem código nativo" na tabela; "iOS - plano" vira histórico.

**`spike-01-findings.md`**: sem mudança, só link para um futuro `spike-02-mobile-web.md`.

**Blueprints 01, 02, 03**: sem mudança.

**`spec-01-reconhecimento.md`** (o que mais muda):
- 1: rota web (`getUserMedia` -> `HandLandmarker`, arquivos hospedados por nós); recomendar a rota (b) de classificador, porque Model Maker treina com imagens e conflita com "só landmarks" (LGPD).
- 2: pipeline web com `requestVideoFrameCallback` a 15 fps, normalização em TS idêntica à do Dart e MLP em TS.
- 3.1: exportar também pesos em JSON/binário, labels, `normalization_version` e vetores dourados.
- 4: JSONL ganha `platform`, `device_model`, `browser`, `normalization_version`; coleta no navegador.
- 5: linha S1 obsoleta (Expo); adicionar trilha W0 a W2 e matriz de aparelhos.
- 7: WebGL2/CPU, Web Worker, resolução, níveis de aparelho, Wake Lock.
- 8: riscos web (fps em Android fraco, navegadores embutidos, tamanho do download, armazenamento no iOS).
- 9.1: sem "abrir configurações"; instruções por navegador; estados "sem suporte" e "navegador embutido".
- 9.2: medição de luz em canvas 32x32 a cada 500 ms e benchmark de nível do aparelho.
- 9.3: componente web, Wake Lock durante a câmera, tratamento de paisagem.
- 9.5 e 10: caminho `apps/web/src/recognition/`.

**`spec-02-backend-gestao-engajamento.md`**:
- Cabeçalho: tirar React Native.
- 1: CloudFront único na mesma origem.
- 2: Cognito com domínio próprio, OAuth code + PKCE, callbacks web; Apple opcional. Lacuna real: o convidado do Identity Pool não tem JWT do User Pool e o authorizer atual o rejeita; resolver com `POST /v1/guest/migrate`.
- 4: prefixo versionado `ml/<versao>/`, Range requests para vídeo.
- 7: SQLite vira IndexedDB com store `outbox`; envio em `online`, `visibilitychange` e abertura do app (Background Sync só como extra).
- 8: propriedades `platform`, `browser`, `display_mode`, `device_tier`, `ml_delegate`; PostHog via proxy no domínio.
- 9: Web Push VAPID mais e-mail opcional.
- 12.1: momento "instalar o app" depois da primeira lição com conta.
- 12.2 e 12.3: OAuth por redirect; Apple opcional.
- 12.8: exportar dados por download ou `navigator.share`; notificações só se houver suporte; item "Instalar o Librax".
- 12.10: "abrir o app" = carregar a página ou voltar à aba depois de N horas oculta.
- 13: sync offline em IndexedDB.

**`spec-03-curriculo-fases-avaliacao.md`**:
- 3: tipos conforme decisão 10.
- 8: vídeos H.264 MP4 com faststart, 360p a 480p, 2 a 3 s, até 400 KB por sinal.
- 11.4: pôster estático e vídeo ao toque, em vez de 4 vídeos em loop.
- 11.6: arrastar com Pointer Events mais botões subir/descer.
- 11.14: flag em localStorage.
- 11.15: Web Share API com arquivo, download como alternativa.

**`spec-04-squads.md`**:
- 3.1: roteador web; convite vira `https://<dominio>/convite/<code>`.
- 3.2: IndexedDB; `visibilitychange`.
- 4.2, 4.6, 4.8: Web Share e Clipboard API.
- 6: Web Push mais e-mail.
- 8: rota HTTPS no lugar de deep link; telas web.

**`spec-05-experiencia-wow.md`**:
- 1: canvas 2D sobre o vídeo (decisão 5).
- 3: Web Audio com buffers pré-carregados, destravados no primeiro toque; AAC/MP3 (OGG falha no Safari); `navigator.audioSession.type = 'ambient'` quando existir; toggle de som sempre visível.
- 4: `navigator.vibrate` como extra, com os padrões dos tokens (`docs/design-tokens.json`).
- 5: CSS/WAAPI com `cubic-bezier` e `linear()`; `prefers-reduced-motion`; `canvas-confetti`; dotLottie ou SVG/CSS no lugar de Lottie.
- 12: push só com app instalado no iPhone; lembrete in-app e e-mail como base.
- 13.2: convite HTTPS.
- 14: preview de câmera no onboarding só com consentimento e barra de progresso (baixa de 8 a 12 MB comprimidos).
- 15.2: Canvas `toBlob` e `navigator.share({files})`.
- 16: `prefers-color-scheme`; tamanhos em rem e teste com zoom de texto de 200%.
- 17: metas separadas para primeira visita e retorno; meta de download de ML; WASM pré-comprimido em brotli (CloudFront só comprime até 10 MB).
- 18: pacotes web equivalentes; Moto G e Samsung A12 seguem como aparelhos de aceite.

**`design-system.md`**: tokens em CSS custom properties com paleta clara e escura fixa; `theme_color` único; fontes locais (Anybody e Figtree); rem; `viewport-fit=cover` e `env(safe-area-inset-*)`; Material Symbols; `overscroll-behavior: contain` e `touch-action` na lição; rotas com URL e "Sair da lição?" respeitando o voltar do navegador; ARIA no lugar de `semanticsLabel`; alvos de 48px. (Revisão completa do design system em andamento em paralelo.)

**`poc-web-storage.md`**:
- 2.2: atualizar quotas do Safari 17+.
- 10: corrigir "Safari 16+ não tem esse problema": a limpeza de 7 dias continua valendo para sites não instalados, e o app instalado tem armazenamento separado da aba.
- 5: tirar `main.dart.js`; adicionar `RangeRequestsPlugin`, alerta de respostas opacas e limite de 2 MB do precache.
- 9: Web Push VAPID.
- 11: marcar como implementado no web-poc.

**Fora de `docs/`**: atualizar `services/api/README.md`.

## 3. Decisões técnicas detalhadas

### 3.1 Landmarks no navegador
- `HandLandmarker` em modo VIDEO, `numHands` 1 para o alfabeto; delegate GPU (WebGL2) com fallback para CPU escolhido pelo benchmark da calibração. Não depender de WebGPU.
- WASM e `.task` em `/ml/<versao>/`, versão npm fixada sem `^`, cache imutável, `Content-Type: application/wasm`, brotli pré-comprimido.
- Um landmarker por sessão do app, aquecido ao entrar numa lição com câmera; um stream de câmera por lição.
- `requestVideoFrameCallback` a 15 fps, descartando frames enquanto o anterior processa; UI atualizada a cerca de 10 Hz por ref ou store externa.
- Avaliar no spike um Web Worker com `ImageBitmap` (GPU no worker exige OffscreenCanvas com WebGL, Safari 17+).

### 3.2 Classificador
- Estático: forward pass em TS puro (cerca de 40 linhas). `train_static.py` passa a exportar `weights.bin`, `model.json` e vetores dourados.
- Dinâmico (U3 em diante): decidir depois entre ONNX Runtime Web e TF.js.
- Contrato de coordenadas: o frame do `getUserMedia` não vem espelhado (o espelho é só CSS) e o handedness do MediaPipe vem invertido; espelhar a mão esquerda para direita antes de classificar e replicar `normalizeHand` bit a bit, inclusive `scale==0`.
- Coleta do dataset por link no navegador, em iPhone e Android.

### 3.3 Câmera
- HTTPS obrigatório (mkcert ou túnel na rede local); `playsinline` e `muted`; nunca iniciar com `display:none`; `facingMode: 'user'`, 640x480 ou 480x360.
- O Safari pode pedir permissão a cada sessão: explicar na UI e orientar "Permitir sempre".
- Navegadores embutidos: detectar e mostrar "Abrir no navegador".
- Paisagem: layout próprio ou aviso "gire o celular".
- Wake Lock durante a câmera.

### 3.4 Níveis de aparelho
- **Alto**: GPU, 15 fps.
- **Médio**: GPU ou CPU, 12 a 15 fps.
- **Baixo**: menos de 10 fps mesmo otimizado; modo receptivo com mensagem honesta.
- Enxugar o CSS (127 KB com `animate.css` inteiro); pausar a detecção fora dos exercícios de câmera.

### 3.5 PWA, offline e armazenamento
- Workbox: shell em precache; conteúdo CacheFirst versionado; vídeos CacheFirst com `RangeRequestsPlugin`; `/ml/` em runtime CacheFirst.
- Prefetch do ML quando a pessoa aceita usar a câmera no onboarding, com progresso e respeitando `Save-Data`.
- `navigator.storage.persist()`.
- Android: `beforeinstallprompt` como sugestão. iPhone: instruções de "Adicionar à Tela de Início".

### 3.6 Autenticação
- `aws-amplify/auth` v6: SRP para e-mail/senha e OAuth com PKCE para Google.
- Infra: domínio Cognito próprio, callbacks e logouts do web, `allowOrigins` restrito (hoje é `'*'`).
- Convidado 100% local; `POST /v1/guest/migrate` reexecuta o log de lições no servidor com o mesmo `completeLesson`.

### 3.7 Push
- Lambda com `web-push`, inscrições em `USER#<id> / PUSH#<hash>`, disparo pelo EventBridge Scheduler conforme `spec-05` 12.3. Sem Firebase.

### 3.8 Estrutura do código
- `apps/web-poc/` vira `apps/web/`, com roteador (rotas de `design-system.md` 11.13), `src/recognition/` (landmarker, normalização, MLP, `evaluatePerformSign`) e `src/platform/` (camera, haptics, audio, wakeLock, share, push), cada um com detecção de suporte.
- Domínio continua por alias; opcionalmente extrair para `packages/core`.

## 4. Fases (ordem por risco)

**W0 - Spike de aparelho (3 a 5 dias)**
- Página isolada: landmarker hospedado por nós, 15 fps, esqueleto 2D, telemetria na tela (fps, ms por detecção, delegate, memória), Wake Lock, service worker cacheando `/ml/`.
- Matriz: iPhone antigo (SE 2 ou 11) e recente, em aba e instalado; Moto G de entrada; Samsung A12/A14; um Android intermediário; link aberto pelo Instagram e WhatsApp.
- GO: câmera abre em 100% dos navegadores-alvo (embutidos caem em "Abrir no navegador"); init com cache até 1,5 s; init sem cache em 4G até 10 s; p50 de 15 fps nos iPhones e no Android intermediário; 10 fps no Android de entrada; 10 minutos seguidos com queda de fps até 30%; funciona em modo avião depois do primeiro uso.
- NO-GO parcial: Android de entrada abaixo de 8 fps depois de testar worker, CPU/GPU e resolução menor. Esse nível fica no modo receptivo (decisão 2).

**W1 - Classificador no navegador (1 a 2 semanas)**
- Ferramenta de captura web (JSONL no IndexedDB, exportação e envio opcional com consentimento); letras A, B, C, L, O, U com 5 ou mais pessoas; treino, exportação e inferência em TS.
- GO: diferença máxima abaixo de 1e-4 entre TS e Keras nos vetores dourados; 90% ou mais de acerto com pessoas não vistas em pelo menos 2 iPhones e 2 Androids; avaliação em até 500 ms depois da estabilidade.
- NO-GO: abaixo de 90%; revisar normalização e landmarks; a câmera fica como `mirror_practice` sem nota.

**W2 - App de produção (2 semanas)**
- Roteador, voltar, safe areas, fonte local, ícones, manifest; correções da seção 1.2; exercícios vindos do bundle; permissão e calibração; FeedbackOverlay com 4 estados; níveis de aparelho; som e háptica.
- GO: em aparelho classe Moto G com 4G simulado, LCP abaixo de 2,5 s e JS inicial abaixo de 200 KB gzip; axe sem violações AA; critérios de instalação do PWA no Chrome; Playwright mobile cobrindo uma lição completa com câmera simulada e sem câmera.

**W3 - AWS para web (1 a 2 semanas)**
- CloudFront único, Cognito com domínio próprio e PKCE, migração do convidado, outbox de sync.
- GO: login por e-mail e Google no iPhone e no Android; migração preservando XP, streak e SRS (E2E); fila offline enviada sem duplicar (idempotência por `lessonAttemptId`).

**W4 - Engajamento (1 a 2 semanas)**
- Web Push, e-mail opcional, convites por HTTPS, Web Share, certificado em Canvas, PostHog via proxy.
- GO: push entregue no Chrome Android e no iPhone instalado; convite abre o JoinByCode preenchido; eventos com `platform`, `browser`, `display_mode`.

**W5 - Conteúdo e piloto**
- Vídeos de U1 gravados com a comunidade surda (H.264 faststart); piloto com 20 a 50 adultos.
- GO: U1 até 10 MB sem o ML; 60% ou mais de permissão de câmera concedida; `no_capture` abaixo de 20% das tentativas; D1 medido.

## 5. Riscos

1. Fps em Android de entrada (só a W0 responde).
2. Download inicial de ML (cerca de 19 MB brutos) em 4G pré-pago.
3. Limpeza de dados do Safari depois de 7 dias sem uso e armazenamento separado no app instalado.
4. Navegadores embutidos quebrando o fluxo de convite.
5. Sem push no iPhone para quem não instala (mitigado por lembrete in-app e e-mail).
6. Sinais dinâmicos (U3+) precisam de 2 mãos e pose; Hand + Pose no navegador pode cortar o fps pela metade em aparelho fraco.
7. Sem presença nas lojas. Se for preciso depois, empacotar o mesmo web com Capacitor (iOS) e TWA (Android).

## Arquivos críticos

- `apps/web-poc/src/hooks/useCameraRecognizer.ts`
- `apps/web-poc/src/lib/recognizer.ts`
- `apps/web-poc/src/lib/content.ts`
- `apps/web-poc/src/App.tsx`
- `apps/web-poc/vite.config.ts`
- `apps/mobile_flutter/lib/hand_skeleton.dart` (referência da `normalizeHand`)
- `ml-training/train_static.py`
- `infra/lib/librax-stack.ts`
