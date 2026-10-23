# Librax - Visão geral

O "Duolingo de Libras": app para **adultos** aprenderem Língua Brasileira de Sinais,
com **reconhecimento dos gestos pela câmera** do celular para avaliar a execução.

**Plataforma prioritária: app de celular híbrido (iOS e Android) com React Native + Expo.**
Web/PWA é alvo secundário, reaproveitando o mesmo código de UI.

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
- Plataforma: **Flutter, Android-first** no spike (ver `decisao-framework.md`); iOS via ponte nativa na produção. (O scaffold React Native foi removido; o ativo é `apps/mobile_flutter/`.)
- Negócio: **híbrido B2C + B2B** (B2B é evolução, não MVP).
- MVP **100% gratuito** para o usuário (sem vidas pagas/anúncios). Engajamento (streak/XP/ligas/conquistas) fica.
- Infra: **AWS serverless** (Lambda, DynamoDB, Cognito, S3+CloudFront) no free tier.

## Spike e decisões técnicas
- [SPIKE 01 - Resultados](./spike-01-findings.md) - o que o spike de reconhecimento revelou (libs prontas são Android-only; vision-camera v5 quebrou a API v4).
- [Decisão de framework](./decisao-framework.md) - por que Flutter, Android-first.
- Scaffold do spike: `apps/mobile_flutter/` (Flutter) - ver README de bootstrap.

## Documentos

Design system e manual de UX/UI:
- [Design System](./design-system.md) - paleta de cores, tipografia, componentes, tom de dialogos, fluxos de tela, acessibilidade.

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

## Implementação (estado atual)

- `apps/mobile_flutter/` - spike de reconhecimento (S1 esqueleto + S2 captura de dataset). Ver `spike-01-findings.md`.
- `ml-training/train_static.py` - treino do classificador estático (split por pessoa), pronto para rodar quando houver dataset.
- `services/api/` - **núcleo de domínio do backend (SPEC 02 + SPEC 04) com TDD**: streak, SRS (SM-2), XP, conquistas, squads, ligas, fila diária, e os usecases `completeLesson`/`getDailyQueue`/squads sobre uma porta de repositório (adaptador em memória). 76 testes. Falta a borda AWS (adaptador DynamoDB, handlers Lambda, Cognito) - ver `services/api/README.md`.

## Roadmap de execução (ordem por risco)

1. **Spike de reconhecimento** (maior risco técnico): Flutter + `hand_landmarker` + landmarks da mão na tela. *(S1/S2 concluídos; S3-S6 pendentes - ver `spike-01-findings.md`.)*
2. Classificador do **alfabeto** on-device (TFLite via `tflite_flutter`), validado com câmeras/luz reais.
3. App shell (Flutter Navigator / go_router) + 3 tipos de exercício receptivo.
4. Integrar câmera nos exercícios expressivos do alfabeto.
5. Backend AWS serverless: Cognito (auth anônimo -> conta), DynamoDB (progresso, XP, streak), Lambda.
6. Unidade 1 (alfabeto) completa, ponta a ponta.
7. Engajamento: streak, meta diária, conquistas, PostHog.
8. Sinais dinâmicos (modelo temporal) + expansão do currículo.

## Dois requisitos não negociáveis
- **Co-criação com a comunidade surda** (conteúdo, vídeos, validação dos sinais).
- **Privacidade por design / LGPD**: imagem da câmera nunca sai do dispositivo; só landmarks, e na maioria dos casos nem isso.
