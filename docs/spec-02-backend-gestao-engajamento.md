# SPEC 02 - Backend, gestão e engajamento (executável)

> Substitui o doc `02-backend-gestao-engajamento.md` (que assumia Supabase).
> Decisões do produto: **MVP 100% gratuito** para o usuário; negócio **híbrido B2C + B2B**
> (B2B é evolução, não MVP); **infra AWS serverless** (free tier).
> Plataforma: app híbrido React Native + Expo (iOS/Android), offline-first.

## 0. Princípios que orientam o desenho

1. **MVP gratuito**: nada de vidas pagas, gems pagas ou anúncios agora. Engajamento (streak, XP, ligas, conquistas) **fica**; monetização **sai**.
2. **Custo ~zero no início**: usar só serviços com free tier generoso da AWS; conteúdo estático em CDN; dado de usuário em DynamoDB.
3. **Offline-first**: o app funciona no metrô; sincroniza quando há rede.
4. **B2B desde a modelagem, não na implementação**: o modelo de dados já prevê `org`/assentos, mas o MVP não constrói o painel institucional.
5. **LGPD por design**: imagem de câmera nunca chega ao servidor (decidido na Camada 1).

## 1. Arquitetura AWS serverless

```
App (Expo RN)
  │
  ├── Conteúdo (read): CloudFront ──► S3 (bundles JSON versionados + vídeos de referência)
  │      currículo, sinais, exercícios, vídeos      (app pré-baixa por curso)
  │
  ├── Auth: Amazon Cognito (User Pool + Identity Pool)
  │      e-mail/senha, Google, Apple, e convidado (anônimo)
  │
  └── API de usuário (write/read dinâmico):
         API Gateway (HTTP API) ──► Lambda (Node/TS) ──► DynamoDB (single-table)
                                          │
                                          ├── EventBridge Scheduler ──► Lambda (fechar liga semanal, jobs)
                                          └── (analytics) evento ──► Kinesis Firehose/SQS ──► destino
```

### Por que essa divisão
- **Currículo é read-mostly e versionado** => servir como JSON estático por CDN é mais barato, mais rápido e offline-friendly do que consultar banco. Nada de "tabela de lições".
- **Dado de usuário é chave-valor por acesso** (progresso, streak, SRS) => DynamoDB single-table escala no free tier e dispensa servidor.
- **Lambda só para escrita/lógica** (validar XP, atualizar streak, conceder conquista) => paga-por-uso, 1M req/mês sempre grátis.

### Honestidade sobre o AWS free tier (verificar valores atuais na implementação)
| Serviço | Free tier | Tipo |
|---|---|---|
| Lambda | ~1M req + 400k GB-s / mês | **Sempre grátis** |
| DynamoDB | ~25 GB + capacidade on-demand baixa | **Sempre grátis** |
| Cognito | MAU grátis até um teto (mudou ao longo do tempo) | **Sempre grátis** (com teto) |
| CloudFront | cota de transferência/req mensal | **Sempre grátis** (cota) |
| API Gateway (HTTP API) | ~1M req/mês | **12 meses** |
| S3 | 5 GB + req | **12 meses** |

Conclusão honesta: o **núcleo** (Lambda + DynamoDB + Cognito + CloudFront) tende a ficar grátis por bastante tempo; **S3 e API Gateway** têm partes de 12 meses, mas o custo após isso é baixo no volume de MVP. Mitigação de S3: vídeos de referência são poucos e cacheados no CloudFront e no device.

## 2. Autenticação (Amazon Cognito)

- **Convidado primeiro**: Identity Pool com acesso não autenticado deixa jogar a 1ª unidade sem cadastro. Progresso de convidado guardado localmente (SQLite) e **migrado** ao criar conta.
- Métodos: e-mail/senha (ou magic link), **Google**, **Apple** (obrigatório na App Store com login social).
- Tokens JWT do Cognito autorizam a HTTP API (authorizer nativo do API Gateway).
- B2B (futuro): Cognito groups por `org`; SSO/SAML quando vender para instituição.

## 3. Modelo de dados - DynamoDB single-table

Tabela única `librax`. Chaves: `PK` (partition) e `SK` (sort). GSIs para os acessos que fogem da PK.

| Entidade | PK | SK | Atributos | 
|---|---|---|---|
| Perfil | `USER#<id>` | `PROFILE` | displayName, locale, timezone, xpTotal, streak, lastActiveDay, dailyGoalXp |
| Progresso de lição | `USER#<id>` | `PROG#<lessonId>` | status, bestScore, completedAt |
| Item SRS | `USER#<id>` | `SRS#<signId>` | strength, dueAt, lastReviewedAt; **GSI1**: `USER#<id>` / `DUE#<dueAt>` |
| Log de ofensiva | `USER#<id>` | `DAY#<yyyy-mm-dd>` | (presença = estudou no dia) |
| Conquista | `USER#<id>` | `ACH#<code>` | earnedAt |
| Membro de liga | `LEAGUE#<id>` | `USER#<id>` | xpPeriod; **GSI2**: `USER#<id>` / `LEAGUE#<period>` |
| (B2B) Org | `ORG#<id>` | `META` | name, seats, plan |
| (B2B) Membro org | `ORG#<id>` | `MEMBER#<userId>` | role, seatActive |

### Padrões de acesso suportados
1. Get perfil: `PK=USER#<id>, SK=PROFILE`.
2. Todo o progresso do usuário: `PK=USER#<id>, SK begins_with PROG#`.
3. Get/update progresso de uma lição: chave direta.
4. **SRS devidos agora**: GSI1 `PK=USER#<id>, GSI1SK <= DUE#<now>`.
5. Append/checar dia de ofensiva: `SK=DAY#<data>`.
6. Conquistas do usuário: `SK begins_with ACH#`.
7. Liga atual do usuário (GSI2) e ranking dos membros (`PK=LEAGUE#<id>`), ordenado por xpPeriod no app/Lambda.
8. (B2B) membros de uma org: `PK=ORG#<id>, SK begins_with MEMBER#`.

### Telemetria de tentativas (alto volume) NÃO vai para a tabela transacional
Eventos `exercise_answered`/`sign_recognized` vão para **analytics** (seção 8), não para o DynamoDB de produto. O que volta para o DynamoDB é o **agregado** (bestScore, atualização de SRS).

## 4. Conteúdo como bundle versionado (S3 + CloudFront)

- Estrutura: `s3://librax-content/<courseId>/v<N>/course.json` + `signs.json` + vídeos.
- O app baixa o bundle do curso (offline-first), checa versão e atualiza incremental.
- **CMS = pipeline de autoria** (repo + script de build) que valida o JSON (schema), sobe vídeos ao S3 e publica nova versão. Não precisa de painel no MVP; a equipe de conteúdo (com a comunidade surda) edita JSON/planilha que o build converte. Painel web vem depois.
- Schema dos objetos de conteúdo (lessons/exercises/signs) está na SPEC 03.

## 5. Engajamento

### 5.1 Streak / ofensiva (Lambda `onLessonCompleted`)
- "Dia" no **timezone do usuário** (campo no perfil), não do servidor.
- Consecutivo => `streak += 1`; mesmo dia => no-op; quebrou => `streak = 1`.
- **Streak freeze**: mantido como item, mas no MVP gratuito é **concedido gratuitamente** (ex.: 1 por semana) em vez de vendido.
- Grava `DAY#<data>` para histórico/heatmap.

### 5.2 XP e meta diária
- XP por exercício/lição, **validado no Lambda** (cliente não escreve XP direto; envia "completei a lição X com score Y" e o servidor calcula). Anti-burla básico.
- Meta diária configurável (10/20/50 XP). Evento `goal_met` ao atingir.

### 5.3 Vidas / corações - **removidas no MVP**
Justificativa: (a) MVP é gratuito, então não há motivo de monetização para vidas; (b) o reconhecimento erra ~12% em sinais reais (Camada 1), e punir isso com perda de vida gera churn. Em vez de vidas, usar **prática ilimitada com feedback construtivo**. Reavaliar se/quando entrar monetização.

### 5.4 Conquistas
- Regra declarativa por código: `{"type":"streak","gte":7}`, `{"type":"signs_learned","gte":50}`, `{"type":"alphabet_complete"}`.
- Avaliadas no Lambda após cada evento relevante; grava `ACH#<code>` (idempotente).

### 5.5 Ligas semanais
- ~30 usuários por liga/tier; ranking por `xpPeriod` da semana.
- **EventBridge Scheduler** dispara Lambda no fim da semana para fechar liga (promove/rebaixa, reseta período, monta novas ligas).
- Sem necessidade de "amigos": competição social leve.

## 6. Repetição espaçada (SRS)
- Item por `(usuário, sinal)` na tabela (`SRS#<signId>`).
- Algoritmo MVP: **SM-2/Leitner** (simples, previsível). Evoluir para half-life regression quando houver dados.
- Acerto => `strength` sobe, `dueAt` mais distante; erro => `dueAt` próximo.
- Lição puxa sinais **devidos** (GSI1) priorizando os mais fracos. Lógica detalhada na SPEC 03.

## 7. Offline-first e sincronização
- **SQLite local** (expo-sqlite ou WatermelonDB): progresso, tentativas, SRS, fila de eventos.
- Conteúdo (bundles) pré-baixado por unidade.
- Sync: fila com retry; **last-write-wins por usuário** (o dado é só dele, sem conflito multiusuário).
- Reconhecimento é local => exercício de câmera funciona 100% offline; só o sync de XP/streak espera rede.

## 8. Analytics e medição
- **PostHog** (free tier) ou auto-hospedado; alternativa AWS-nativa: eventos via Kinesis Firehose -> S3 + Athena.
- Eventos: `app_open`, `lesson_started`, `exercise_answered{type,correct,confidence}`, `sign_recognized{sign_id,confidence,attempts}`, `lesson_completed{score,xp}`, `streak_extended{length}`, `goal_met`, `achievement_earned{code}`, `camera_permission{granted}`, `camera_session_quality{lighting,framing}`.
- Métricas norte: D1/D7/D30, DAU/MAU, comprimento de ofensiva, lições/dia.
- **Métrica específica**: `confidence` média por sinal => realimenta a fila de "sinais que precisam de mais dados" (fecha o ciclo com a Camada 1) e a calibração de limiares (Camada 3).

## 9. Notificações push
- **Expo Notifications** (funciona em dev build iOS/Android), ou Amazon SNS/Pinpoint.
- Casos: lembrete de ofensiva no horário habitual, "ofensiva em risco", retorno após inatividade, nova unidade.
- Disciplina: poucas e relevantes; respeitar opt-out.

## 10. B2B (groundwork, fora do MVP)
- Modelagem já prevê `ORG#`/`MEMBER#` e seats; Cognito groups por org.
- Futuro: painel de turma (professor vê progresso dos alunos), licença por assento, relatórios. **Não implementar agora**; só não fechar portas no schema.

## 11. LGPD / privacidade
- Imagem nunca trafega (Camada 1). Dados pessoais mínimos no Cognito/DynamoDB.
- Direitos do titular: exportar e apagar conta (Lambda que varre `PK=USER#<id>`).
- Consentimento explícito e opt-in se um dia coletarmos landmarks anonimizados para treino.

## 12. Frontend - telas de conta e engajamento

### 12.1 Fluxo de onboarding (primeiro acesso)

Convidado (anonimo - Identity Pool, secao 2). Onboarding progressivo em 4 telas (`PageView`); conta pedida so depois da primeira licao.

**Sequencia de telas:**
| # | Tela | Componentes | Avanca para |
|---|---|---|---|
| 1 | Boas-vindas | logo; titulo "Aprenda Libras do zero"; botao primario "Comecar agora" (entra como convidado); link "Entrar" | "Comecar agora" -> tela 2; "Entrar" -> LoginScreen (12.3) |
| 2 | Motivo | titulo "Por que voce quer aprender Libras?"; radio: familiar/amigo surdo, interesse pessoal/cultura, trabalho/voluntariado, sou surdo(a)/perda auditiva, outro; "Continuar" | salva motivo no perfil; -> tela 3 |
| 3 | Meta diaria | titulo "Quanto tempo por dia?"; radio 5 / 10 / 15 / 20+ min (10 = "Regular (recomendado)", default); "Continuar" | salva `dailyGoalXp`; -> tela 4 |
| 4 | Camera (explicacao) | texto "O Librax avalia seus sinais pela camera - apenas os pontos da mao, nunca a imagem. (LGPD)"; botoes "Usar camera" / "Agora nao" | grava preferencia de camera; -> CourseMapScreen (SPEC 03) |

**Regras:**
- Nenhuma tela exige conta; nada bloqueia o avanco.
- A tela 4 explica, mas nao dispara o prompt de permissao do SO (isso ocorre no primeiro exercicio expressivo - SPEC 01 secao 9.1).
- Conta solicitada apenas ao concluir a primeira licao (12.2).

### 12.2 ConvertAccountSheet (convidado -> conta)

**Acesso:** bottom sheet ao concluir a primeira licao como convidado (apos "Continuar" da LessonCompletionScreen, SPEC 03 secao 11.10).

**Componentes:** titulo "Salvar seu progresso"; texto "Voce completou sua primeira licao! Crie uma conta para nao perder seu progresso."; botoes "Criar conta com e-mail", "Continuar com Google", "Continuar com Apple"; link "Continuar sem conta".

**Acoes:**
| Acao | Resultado |
|---|---|
| "Criar conta com e-mail" | abre RegisterScreen (12.3) |
| "Continuar com Google/Apple" | fluxo OAuth do Cognito; em sucesso, migra o convidado |
| "Continuar sem conta" | fecha o sheet; reaparece ao final da proxima licao |

**Regra:** migracao silenciosa - o Lambda vincula o `identityId` do convidado ao novo `userId`, preservando progresso, streak e SRS locais.

### 12.3 LoginScreen / RegisterScreen

**Acesso:** link "Entrar" no onboarding; "Criar conta" no ConvertAccountSheet; "Entrar na conta" nas Configuracoes.

**Componentes (LoginScreen):**
- Botoes sociais "Continuar com Google" e "Continuar com Apple".
- Divisor "ou".
- Campos `email` e `senha`.
- Botao primario "Entrar"; link "Esqueci a senha"; link "Criar conta".

**Componentes (RegisterScreen):** campos `nome`, `email`, `senha`; botao "Criar conta"; botoes sociais iguais.

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| edicao | formulario sendo preenchido | "Entrar"/"Criar conta" habilitado quando campos validos |
| enviando | request em andamento | botao com `CircularProgressIndicator`; campos travados |
| erro | credencial/validacao invalida | mensagem inline: "E-mail ja em uso", "Senha muito curta" ou "Credenciais invalidas" |

**Regra:** "Apple" obrigatorio em producao iOS (App Store Review).

### 12.4 ProfileScreen

**Acesso:** aba "Perfil" na navegacao principal.

**Componentes:**
- `ProfileHeader`: avatar, `displayName`, "Membro desde <mes/ano>".
- `StatsRow`: XP total (com barra de nivel) e sequencia (com icone de chama).
- `CourseProgressCard`: "A1: Libras do Zero", percentual concluido, barra, "N de 6 unidades com progresso".
- `AchievementsPreview`: "Conquistas N / 24" + 3 badges + link "Ver todas".
- `DailyGoalCard`: "Meta diaria: X min"; progresso "Hoje: Y / X min".
- Menu "..." (AppBar): "Configuracoes", "Sair da conta".
- `GuestBanner` (so convidado): "Crie uma conta para salvar seu progresso".

**Acoes:**
| Acao | Resultado |
|---|---|
| toque na sequencia / chama | abre StreakScreen (12.5) |
| "Ver todas" (conquistas) | abre AchievementsScreen (12.6) |
| "..." -> "Configuracoes" | abre SettingsScreen (12.8) |
| "..." -> "Sair da conta" | logout do Cognito; volta ao onboarding |
| `GuestBanner` | abre ConvertAccountSheet (12.2) |

### 12.5 StreakScreen

**Acesso:** toque na sequencia no ProfileScreen, ou no icone de chama no topo do CourseMapScreen; botao "Ver meu historico" no StreakBrokenSheet (secao 12.10).

**Componentes:**
- `StreakHero`: icone grande de chama + "<N> dias".
- `WeekHeatmap`: duas semanas (atual + anterior), 7 quadrinhos cada (Seg-Dom).
- `PersonalRecord`: "Recorde pessoal: <N> dias".
- `FreezeCard`: "Streak freeze disponivel: <N>" + botao "Usar freeze" (condicional).
- `RecoveryCard` (somente no estado `zerada`): titulo "Sua sequencia encerrou." + texto "Comece uma nova sequencia hoje. Uma sequencia nova e melhor que uma interrompida." + botao "Ir estudar agora" (volta ao CourseMapScreen).

**Estados da tela:**
| Estado | Condicao | O que muda |
|---|---|---|
| ativa | streak >= 1 e estudou hoje | `StreakHero` com chama vibrante; `FreezeCard` padrao |
| em risco | streak >= 1, dia sem estudo, >= 20h no fuso do usuario | `StreakHero` com borda pulsante amarela; texto adicional "Estude antes da meia-noite para manter sua sequencia"; `FreezeCard` destacado se ha freeze |
| zerada | streak = 0 | `StreakHero` com chama cinza "0 dias"; `RecoveryCard` substitui `FreezeCard`; `PersonalRecord` permanece visivel |

**Estados (quadrinho do heatmap):**
| Estado | Aparencia |
|---|---|
| estudou | preenchido (verde) |
| nao estudou | cinza |
| hoje | contorno destacado |
| gap de encerramento | contorno vermelho suave no ultimo dia estudado antes do gap |

**Acoes:**
| Acao | Condicao de exibicao | Resultado |
|---|---|---|
| "Usar freeze" | estado `em risco` e ha freeze disponivel | consome 1 freeze; preserva o streak; troca estado para `ativa`; atualiza heatmap |
| "Ir estudar agora" | estado `zerada` | fecha o StreakScreen e exibe o CourseMapScreen |

**Regra:** freeze concedido gratuitamente (1 por semana, MVP gratuito - secao 5.1).

### 12.6 AchievementsScreen

**Acesso:** "Ver todas" no ProfileScreen.

**Componentes:**
- `AppBar`: titulo "Conquistas" + contador "N de 24".
- Secao "Desbloqueadas": lista de `AchievementTile`.
- Secao "Bloqueadas": lista de `AchievementTile`.

**Estados (AchievementTile):**
| Estado | Aparencia |
|---|---|
| desbloqueada | badge colorido + titulo + descricao + data ("15 de junho de 2026") |
| bloqueada | cinza, com cadeado, titulo + descricao, sem data |

**Regra:** conquista desbloqueada durante uma licao dispara um bottom sheet celebratorio (badge animado) ANTES da LessonCompletionScreen (SPEC 03 secao 11.10).

### 12.7 LeagueScreen

**Acesso:** aba Social (secao Ligas) ou toque na insignia de liga no ProfileScreen. Se ha resultado pendente, o `LeagueResultSheet` (abaixo) e exibido automaticamente antes da tela ficar interativa.

**Componentes:**
- `AppBar`: nome do tier (ex.: "Liga de Safira") + "Semana N".
- `LeagueTimer`: "Encerra em Xd Yh".
- `PromotionLegend`: "Top 3: promovidos para <tier acima>" / "Bottom 10: rebaixados para <tier abaixo>".
- `RankingList`: linhas com posicao, `displayName`, `xpPeriod` e indicador de zona.

**Estados (linha do ranking):**
| Estado | Aparencia |
|---|---|
| zona de promocao | marcador "(^)" |
| zona de rebaixamento | marcador "(v)" |
| usuario atual | linha com fundo destacado |

**Regra:** `xpPeriod` e o XP da semana (nao o XP total do perfil). Ordenacao e zonas calculadas no app a partir dos membros da liga (secao 5.5).

### LeagueResultSheet (bottom sheet - resultado do periodo encerrado)

**Acesso:** automatico ao abrir o LeagueScreen (ou ao abrir o app - secao 12.10) quando o periodo anterior encerrou e o resultado ainda nao foi visto pelo usuario. Controlado pela flag local `leagueResultSeen: <period>`.

**Componentes:**
- Titulo dinamico por estado: "Voce subiu de liga!" / "Voce ficou na liga!" / "Voce desceu de liga."
- `LeagueChangeRow`: nome da liga anterior, seta direcional, nome da liga nova (ex.: "Liga de Bronze -> Liga de Prata").
- `PeriodStats`: "Posicao final: #<N> de 30 membros" + "<XP> XP ganhos na semana".
- Mensagem motivacional dinamica (por estado):
  - Promovido: "Excelente semana! Continue assim na <nova liga>."
  - Mantido: "Boa semana! Mais XP no topo e voce avanca na proxima."
  - Rebaixado: "Acontece. Uma semana de estudo consistente te traz de volta."
- Botao: "Ver minha nova liga" -> fecha o sheet; LeagueScreen exibe a nova liga atual.

**Estados do sheet:**
| Estado | Condicao (posicao final na liga anterior) |
|---|---|
| promovido | usuario estava no top 3 (zona de promocao) |
| mantido | usuario estava na zona neutra |
| rebaixado | usuario estava no bottom 10 (zona de rebaixamento) |

**Regras:**
- O sheet e marcado como visto (`leagueResultSeen`) ao ser exibido, nao ao ser fechado.
- Se o usuario nunca participou de uma liga (primeiro periodo), nao ha sheet.
- Animacao de confete apenas no estado `promovido`.

### 12.8 SettingsScreen

**Acesso:** menu "..." do ProfileScreen.

**Componentes (grupos de itens):**
- Conta: "Nome de exibicao", "E-mail" (somente leitura), "Alterar senha", "Excluir conta".
- Aprendizado: "Meta diaria", "Camera" (ativada/desativada).
- Notificacoes: "Lembrete diario" (com horario), "Sequencia em risco" (toggle).
- Privacidade: "Exportar meus dados", "Politica de privacidade".
- Sobre: "Versao".

**Acoes:**
| Acao | Resultado |
|---|---|
| "Meta diaria" | abre seletor (reusa a tela 3 do onboarding) |
| "Camera" | alterna preferencia (mesmo toggle do bottom sheet "?" da SPEC 01 secao 9.3) |
| "Exportar meus dados" | Lambda gera JSON (progresso, SRS, conquistas) e compartilha por e-mail / share sheet (LGPD) |
| "Excluir conta" | inicia o fluxo de exclusao em duas etapas (abaixo) |

**Fluxo de exclusao de conta (duas etapas):**
1. Dialogo: "Tem certeza? Todo o seu progresso sera apagado." -> "Cancelar" / "Continuar".
2. Campo de texto exigindo digitar "EXCLUIR" para habilitar o botao "Excluir conta".
3. Lambda apaga todos os itens `PK=USER#<id>` e revoga o token Cognito.

### 12.9 Adicao a definicao de pronto desta camada

- Onboarding de 4 telas implementado (motivo, meta, camera).
- ConvertAccountSheet acionado ao final da primeira licao de convidado.
- Login com e-mail, Google e Apple funcionando via Cognito.
- Migracao silenciosa de convidado para conta.
- ProfileScreen com XP, streak, conquistas e progresso do curso.
- StreakScreen com estados `ativa`, `em risco` e `zerada` (incluindo `RecoveryCard`).
- AchievementsScreen com estados desbloqueado/bloqueado.
- LeagueScreen com ranking, zonas de promocao/rebaixamento e `LeagueResultSheet` pos-periodo.
- SettingsScreen com exclusao de conta em duas etapas e exportacao de dados.
- AppOpenFlow (12.10) com `StreakBrokenSheet` e `LeagueResultSheet` na sequencia correta.

### 12.10 AppOpenFlow (retorno D2+)

Esta secao define o que o usuario ve ao abrir o app no D2+ (qualquer abertura que nao seja a instalacao inicial). O fluxo garante que nenhum evento importante passe despercebido.

**Tela de entrada:** o app sempre abre no `CourseMapScreen` (aba Aprender), independente da aba em que estava na sessao anterior.

**Sequencia de avaliacao (antes da tela ficar interativa):**

| Passo | Condicao | O que aparece | Acao do usuario para continuar |
|---|---|---|---|
| 1 | `leagueResultSeen != periodo_atual` E o periodo anterior encerrou | `LeagueResultSheet` (secao 12.7) | "Ver minha nova liga" ou X para fechar |
| 2 | `last_active_day < hoje - 1 dia` (streak quebrou) E `streakBrokenShownDate != hoje` | `StreakBrokenSheet` (abaixo) | "Estudar agora" ou "Ver meu historico" |
| 3 | nenhuma das condicoes acima | CourseMapScreen interativo diretamente | - |

Passos 1 e 2 podem ocorrer juntos (ex.: usuario ficou afastado varios dias). O passo 1 e sempre exibido antes do passo 2.

**StreakBrokenSheet (bottom sheet):**

**Componentes:**
- Icone de chama apagada.
- Titulo: "Sua sequencia encerrou em <N> dias."
- Texto: "Nao conseguiu estudar? Sem problemas. Comece uma nova sequencia agora."
- Botao primario "Estudar agora" -> fecha o sheet; CourseMapScreen fica interativo.
- Botao secundario textual "Ver meu historico" -> abre StreakScreen (12.5) mostrando o estado `zerada`.

**Regras:**
- `streakBrokenShownDate` e gravado localmente ao exibir o sheet. Nao reaparece se o usuario abrir o app de novo no mesmo dia.
- Nao exibido se a streak nao chegou a 3 dias (mostrar "sequencia de 1 dia encerrou" e pouco significativo). Limiar configuravel; inicial: apenas exibir se streak encerrada era >= 3 dias.
- Nao exibido se o usuario ja estudou hoje (a streak tecnicamente continua ou recomeou).

**CourseMapScreen no retorno:**

| Componente | Estado no retorno (sem estudo hoje) |
|---|---|
| `DailyGoalBar` | progresso zerado "0 / <meta> XP hoje" |
| `StreakAtRiskBanner` | visivel somente se >= 20h no fuso do usuario |
| `ResumeBanner` | "Retomar: <proxima licao>" |

**Analytics:** `app_opened{cold_start: bool, streak_broken: bool, league_result_pending: bool}` disparado em toda abertura. Alimenta metricas de D1/D7/D30 e funil de retorno.

## 13. Definição de pronto (Camada 2)
- Tabela DynamoDB com os padrões de acesso da seção 3 implementados e testados.
- Cognito com convidado + e-mail + Google + Apple, e migração de convidado para conta.
- Lambdas: `completeLesson` (XP + streak + SRS + conquistas + `unit_completed` + `course_completed`), `getDailyQueue` (lições + SRS devidos), `closeLeague` (agendado).
- Pipeline de conteúdo: build de bundle JSON validado por schema + publish para S3/CloudFront.
- Camada de sync offline no app (SQLite + fila).
- Eventos de analytics fluindo para o destino escolhido.
- Flag `leagueResultSeen` e `streakBrokenShownDate` armazenadas localmente e respeitadas no AppOpenFlow.
- `LeagueResultSheet` exibido na sequencia correta (antes do StreakBrokenSheet) ao abrir o app.
