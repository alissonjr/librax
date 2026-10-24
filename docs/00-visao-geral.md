# Librax - Visão geral

O "Duolingo de Libras": app para **adultos** aprenderem Língua Brasileira de Sinais,
com **reconhecimento dos gestos pela câmera** do celular para avaliar a execução.

**Plataforma: mobile web.** O Librax abre no navegador do celular (Safari no iPhone, Chrome no Android),
sem instalar nada pela loja, com a mesma experiência nos dois. Pode ser adicionado à tela inicial (PWA) e
funciona offline. Decidido em 2026-10-22 (ver [`plano-mobile-web.md`](./plano-mobile-web.md)).

## Reality check que guia todas as decisões

Libras é um idioma completo (5 parâmetros: configuração de mão, ponto de articulação,
movimento, orientação, expressões não manuais). Três níveis de dificuldade de reconhecimento:

| Nível | Reconhece | Dificuldade | No MVP? |
|---|---|---|---|
| 1. Datilologia (alfabeto/números) | handshapes estáticos | Baixa | Sim |
| 2. Sinais isolados | palavras com movimento | Média/Alta | Sim (com modelo temporal) |
| 3. Frases contínuas | conversação | Pesquisa de ponta | Não |

Estratégia: dominar níveis 1 e 2. O produto não precisa entender conversação para ser excelente.

## Decisões de produto travadas
- Plataforma: **mobile web como canal único** (ver `decisao-framework.md`, seção "Reavaliação 2026-10"). `apps/web-poc/` vira o produto; o Flutter (`apps/mobile_flutter/`) fica congelado e sai do roadmap. Navegadores: Safari iOS 16.4+ e Chrome/Samsung Internet no Android 9+.
- Negócio: **híbrido B2C + B2B** (B2B é evolução, não MVP).
- MVP **100% gratuito** para o usuário (sem vidas pagas/anúncios). Engajamento (streak/XP/ligas/conquistas) fica.
- MVP só em **pt-BR**.
- Infra: **AWS serverless** (Lambda, DynamoDB, Cognito, S3+CloudFront) no free tier, com um CloudFront na mesma origem para app, conteúdo, modelos e API.

## Spike e decisões técnicas
- [Plano mobile web](./plano-mobile-web.md) - decisões travadas em 2026-10-22, o que muda em cada documento e as fases W0 a W5.
- [Decisão de framework](./decisao-framework.md) - de Flutter Android-first (jun/2026) para mobile web (out/2026).
- [SPIKE 01 - Resultados](./spike-01-findings.md) - o que o spike de reconhecimento revelou (libs nativas prontas são Android-only; vision-camera v5 quebrou a API v4). Histórico: o bloqueio de iOS some no navegador.

## Documentos

Design system e manual de UX/UI:
- [Design System](./design-system.md) - versão aprovada para mobile web: princípios, voz, tokens (cor, tipografia, espaço, motion, háptica, som), componentes, rotas, acessibilidade e cultura surda. Valores em [`design-tokens.json`](./design-tokens.json).

Conteúdo:
- [Conteúdo e validação](./conteudo-e-validacao.md) - status do conteúdo (rascunho), fontes, licenças e o que falta validar com a comunidade surda.

Blueprints iniciais (visão geral):
- [01 - Arquitetura e reconhecimento](./01-arquitetura-e-reconhecimento.md)
- [02 - Backend, gestão e engajamento](./02-backend-gestao-engajamento.md) (nota: substituído pela SPEC 02; assumia Supabase)
- [03 - Currículo, fases e avaliação](./03-curriculo-fases-avaliacao.md)

Specs executáveis (fonte da verdade):
- [SPEC 01 - Reconhecimento](./spec-01-reconhecimento.md) - viabilidade ancorada em literatura, libraries reais, plano de spike com GO/NO-GO, dados quantificados.
- [SPEC 02 - Backend AWS serverless](./spec-02-backend-gestao-engajamento.md) - Cognito, DynamoDB single-table, conteúdo em S3/CloudFront, engajamento, offline, free tier. Cobre fluxos de onboarding, conta, streak, ligas, conquistas e jornada de retorno (AppOpenFlow).
- [SPEC 03 - Currículo e avaliação](./spec-03-curriculo-fases-avaliacao.md) - inventário A1 com 5 parâmetros, schemas de exercício, rubrica calibrável, SRS (SM-2), produção com comunidade surda. Cobre todas as telas de currículo incluindo UnitCompletion, CourseCompletion e DynamicSignIntro.
- [SPEC 04 - Squads e equipes](./spec-04-squads.md) - squads B2C (criadas por usuários), equipes B2B (criadas por admins de org), ranking semanal, diretório, convites, frontend completo.
- [SPEC 05 - Experiência WoW](./spec-05-experiencia-wow.md) - design emocional: câmera como palco, motion design, som, háptica, marcos de progressão, cartões de cultura surda, notificações com voz humana, empty states, CourseCompletion coreografado, performance como feature.

Operação:
- [Painel de administração](./painel-admin.md) - painel só de leitura em `/admin` (grupo `admin` do Cognito): operação, conteúdo, contas, squads e custo, com contadores agregados, job diário, alarmes por e-mail e AWS Budget. Inclui como dar acesso e o custo extra estimado.

Notas técnicas:
- [PoC web storage](./poc-web-storage.md) - progresso local em IndexedDB rodando o domínio no navegador (o "Caminho B", implementado no web-poc).

## Implementação (estado atual)

Conferido no código em 2026-10-23.

- `apps/web-poc/` - **o app** (React 18, Vite 5, TypeScript, PWA com `vite-plugin-pwa`, v0.3.0). Já tem onboarding, mapa do curso, lição, telas de conclusão (lição, unidade e curso), prática, streak, conquistas, perfil e configurações, com layout mobile-first. Ainda não tem roteador (sem URLs) nem ligação com a API: o progresso fica só no aparelho.
  - **Curso A1 com 14 unidades e 254 sinais, todos em rascunho** (`status: "rascunho"`, `validated: false` em `src/assets/content/signs.json` e `course.json`), sem nenhum vídeo gravado (`video_url: null` em todos). Detalhes em [`conteudo-e-validacao.md`](./conteudo-e-validacao.md).
  - **Avatar VLibras como demonstração provisória do sinal**: enquanto não há vídeos com pessoas surdas, o `SignDemo` mostra o avatar do VLibras (player oficial do Governo Federal, LGPL-3.0, carregado sem alteração por `public/vlibras/player.html`), com crédito na tela e nas Configurações. Ordem de prioridade: vídeo, avatar, texto (`video_caption`).
  - **Exercício de montar frase** (`build_phrase`, `ExerciseBuildPhrase.tsx`): a pessoa vê a tradução em português e toca nos blocos de glosa na ordem da Libras. Usa as frases de exemplo (rascunho) das unidades, a partir da U3, com preferência por frases cujas glosas a pessoa já viu.
  - Outros tipos de exercício: apresentação do sinal, câmera, múltipla escolha, ver e escolher a palavra, pares, ordenar sequência, prática no espelho e datilologia. Os exercícios ainda são gerados em `src/lib/content.ts` (a decisão 10 do plano leva para o bundle de conteúdo).
  - **Reconhecimento pela câmera ainda é heurístico** (`src/lib/recognizer.ts`, 10 letras) e o MediaPipe vem de CDN de terceiros, sem cache offline. É o que as fases W0 e W1 trocam. O defeito de estabilidade (`useStableGesture`) já foi corrigido (400 ms).
  - **Design system aplicado com tokens**: `docs/design-tokens.json` gera `src/styles/tokens.css` e `tokens.ts` (`tools/tokens/build.mjs`), com verificação de contraste WCAG no build (`tools/tokens/check-contrast.mjs`). Modo claro e escuro, Material Symbols em SVG, safe areas, esqueleto da mão com as cores do palco e háptica que nunca vibra no erro.
  - **Marca Traço** (escolhida em 2026-10-23, estudo em `estudo/marca/traco.html`): tangerina sobre grafite, petróleo para tudo que é mão, erro em framboesa; Anybody larga nos títulos e Figtree no texto, auto-hospedadas; logo em L desenhado como movimento (ícone do app e favicon); a seta de trajetória dos dicionários de Libras gira em volta da lição atual no mapa, aparece no botão "Ver o movimento" e explode na celebração da lição concluída. Detalhes em `docs/design-system.md`.
  - Progresso em IndexedDB (`src/lib/idbRepo.ts`) rodando o mesmo domínio de `services/api/src` por alias (`completeLesson` no navegador). Testes com vitest (15 arquivos).
- `services/api/` - **núcleo de domínio do backend (SPEC 02 + SPEC 04) com TDD**: streak, SRS (SM-2), XP, conquistas, squads, ligas, fila diária, e os usecases `completeLesson`/`getDailyQueue`/squads sobre uma porta de repositório. 76 testes. A borda AWS já começou: handlers Lambda (`src/handlers/`: lição, squads, fechamento da liga) e adaptador DynamoDB (`src/adapters/dynamoRepo.js`), além do adaptador em memória. O `services/api/README.md` ainda diz que eles faltam.
- `infra/` - **AWS CDK** (`infra/lib/librax-stack.ts`): DynamoDB single-table com GSI1 a GSI5, Cognito User Pool (e-mail e Google; o convidado é 100% local, sem Identity Pool), Lambdas Node 22 por endpoint, HTTP API com authorizer JWT do Cognito, S3 e CloudFront para o conteúdo e EventBridge Scheduler para fechar a liga semanal. Ainda não tem o CloudFront único com domínio próprio nem a migração do convidado (fase W3).
- `apps/admin-web/` - **painel de administração** (Vite, React, TypeScript), só leitura, publicado em `/admin` no mesmo CloudFront. Ver [`painel-admin.md`](./painel-admin.md).
- `ml-training/train_static.py` - treino do classificador estático (MLP, split por pessoa), pronto para rodar quando houver dataset. Hoje exporta `.tflite`; a fase W1 passa a exportar pesos para inferência em TypeScript.
- `apps/mobile_flutter/` - **congelado**. Spike de reconhecimento (S1 esqueleto + S2 captura de dataset), nunca compilado em aparelho. Fica como referência da normalização (`lib/hand_skeleton.dart`). Ver `spike-01-findings.md`.

## Roadmap de execução (ordem por risco)

As fases vêm do [`plano-mobile-web.md`](./plano-mobile-web.md) (seção 4), cada uma com critério de GO.

1. **W0 - Spike de aparelho** (3 a 5 dias): landmarker hospedado por nós, 15 fps, esqueleto 2D e telemetria na tela, testado numa matriz de iPhones e Androids reais (inclusive link aberto pelo Instagram e WhatsApp). Responde o maior risco: fps em Android de entrada.
2. **W1 - Classificador multiplataforma no navegador** (1 a 2 semanas): captura de dataset pelo navegador, MLP em TypeScript com pesos do `train_static.py`, 90% ou mais de acerto com pessoas não vistas em iPhone e Android.
3. **W2 - App de produção** (2 semanas): roteador e voltar, safe areas, ícones e manifest, exercícios vindos do bundle, permissão e calibração da câmera, níveis de aparelho, som e háptica.
4. **W3 - AWS para web** (1 a 2 semanas): CloudFront único, Cognito com domínio próprio e PKCE, migração do convidado, fila offline de sync.
5. **W4 - Engajamento** (1 a 2 semanas): Web Push, e-mail opcional, convites por HTTPS, Web Share, certificado em Canvas, PostHog via proxy.
6. **W5 - Conteúdo e piloto**: vídeos da U1 gravados com a comunidade surda (H.264 faststart) e piloto com 20 a 50 adultos.

Depois do piloto: sinais dinâmicos (modelo temporal, duas mãos e pose) e expansão do currículo.

## Dois requisitos não negociáveis
- **Co-criação com a comunidade surda** (conteúdo, vídeos, validação dos sinais).
- **Privacidade por design / LGPD**: imagem da câmera nunca sai do dispositivo; só landmarks, e na maioria dos casos nem isso.
