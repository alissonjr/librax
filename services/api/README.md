# Librax API (backend)

Backend server-authoritative das SPEC 02 (engajamento) e SPEC 04 (squads), ajustado ao
plano mobile web (`docs/plano-mobile-web.md`, decisões 4, 11 e 14, fase W3). Escrito com
TDD: as regras são funções puras com testes; usecases orquestram as regras sobre uma porta
de repositório; handlers Lambda e adaptadores AWS ficam na borda.

A infraestrutura que publica tudo isso está em `infra/` (AWS CDK, `infra/lib/librax-stack.ts`).

## Por que JS + `node:test` (e não TS)

A SPEC 02 pede "Lambda (Node/TS)". Aqui o código é JS (ESM) com o runner embutido
`node:test`: o ciclo vermelho-verde roda sem instalar nada. Na publicação, o CDK empacota
cada handler com esbuild (`NodejsFunction`), então o ESM vira um arquivo só por Lambda e
dependências como `web-push` vão junto. O AWS SDK v3 não é empacotado (já vem no runtime
Node 22).

## Rodar os testes

```bash
cd services/api
npm ci
npm test            # node --test (Node 20+)
```

363 testes no momento (`test/`). Os handlers são testados com o `InMemoryRepo` injetado e
o `DynamoRepo` com um client falso que só registra os comandos; nenhum teste chama a AWS.

## Ambiente local (AWS simulada)

DynamoDB Local e o Cognito do moto em containers, a API pelas fábricas dos handlers, uma página que imita o
Hosted UI e o app e o painel apontados para tudo isso, sem chamada à AWS. Tudo sai do template da infra.
Detalhes, contas de teste e diferenças para a AWS: [`docs/ambiente-local.md`](../../docs/ambiente-local.md).

```bash
npm run local:up      # containers, template, bootstrap e semente
npm run local         # API em http://127.0.0.1:5332/api, Cognito local e login em https://127.0.0.1:5333
npm run test:e2e      # ponta a ponta (fora do npm test, precisa do local:up)
npm run local:down    # para sem apagar; local:reset apaga os dados
```

## Estrutura

```
services/api/
├── scripts/build-catalog.mjs   gera src/content/catalog.js e contentStatus.js a partir do conteúdo do app
├── src/
│   ├── domain/        funções puras (sem I/O)
│   │   ├── streak.js            ofensiva (SPEC 02 seção 5.1)
│   │   ├── srs.js               SM-2 adaptado (SPEC 03 seção 6)
│   │   ├── xp.js                XP server-authoritative + meta diária (SPEC 02 seção 5.2)
│   │   ├── achievements.js      regras declarativas (SPEC 02 seção 5.4)
│   │   ├── squads.js            guardas de squad (SPEC 04 seções 0 e 2)
│   │   ├── invite.js            código de convite (SPEC 04 seção 2)
│   │   ├── leagues.js           ranking + promoção/rebaixamento (SPEC 02 seção 5.5)
│   │   ├── dailyQueue.js        fila SRS + conteúdo novo (SPEC 03 seção 6)
│   │   ├── profile.js           perfil default (SPEC 02 seção 3)
│   │   ├── lessonCompletion.js  validação e limites das conclusões vindas do cliente
│   │   ├── practiceReview.js    validação das respostas da prática diária
│   │   ├── push.js              inscrição Web Push e preferências de lembrete
│   │   ├── reminders.js         regras de horário dos lembretes (SPEC 05 12.2 e 12.3)
│   │   ├── admin.js             grupo admin no token (cognito:groups) e busca de conta
│   │   ├── opsMetrics.js        contadores agregados do painel e a tela de operação
│   │   └── costReport.js        janela do Cost Explorer e projeção do mês
│   ├── lib/dates.js   aritmética de datas-calendário
│   ├── content/
│   │   ├── catalogFromCourse.js catálogo mínimo (XP, sinais por lição, conquistas)
│   │   ├── catalog.js           GERADO, empacotado nas Lambdas (npm run catalog)
│   │   ├── contentReport.js     situação do conteúdo: validado, fonte, vídeo, avatar, o que falta
│   │   └── contentStatus.js     GERADO, só na Lambda do painel (npm run catalog)
│   ├── usecases/
│   │   ├── completeLesson.js     XP + streak + SRS + conquistas + fan-out (SPEC 02/04)
│   │   ├── completeLessonOnce.js o mesmo, idempotente por lessonAttemptId
│   │   ├── migrateGuest.js       reexecuta o log do convidado (POST /v1/guest/migrate)
│   │   ├── getDailyQueue.js      monta a fila do dia
│   │   ├── reviewSigns.js        prática diária: resposta vai para o SRS (sem XP); versão idempotente
│   │   ├── sendReminders.js      rodada de lembretes (Web Push e e-mail opcional)
│   │   ├── closeLeagueWeek.js    fechamento semanal de todas as ligas (SPEC 02 seção 5.5)
│   │   ├── leagueEnrollment.js   entrada na liga na 1a lição da semana, grupos de até 30
│   │   ├── leagueView.js         leitura da liga atual e resultado visto (GET/POST /v1/league)
│   │   ├── resetSquadWeek.js     reset semanal do XP das squads com histórico (SPEC 04 seção 8)
│   │   ├── squads.js             rotas de escrita de squad (SPEC 04 seção 2)
│   │   ├── deleteAccount.js      exclusão de conta (LGPD): squads, ligas, USER#<id> e o Cognito
│   │   ├── opsMetrics.js         contadores do painel (lição, prática, saída, conta nova)
│   │   ├── admin.js              leituras do painel (operação, conta, squads, custo)
│   │   └── collectDailyOps.js    job diário: CloudWatch e Cost Explorer na tabela
│   ├── adapters/
│   │   ├── inMemoryRepo.js  porta em memória (testes e dev local)
│   │   ├── dynamoRepo.js    porta sobre a tabela single-table `librax`
│   │   ├── cognitoDirectory.js  busca de conta (ListUsers) e exclusão (AdminDeleteUser) no Cognito
│   │   ├── cloudWatchMetrics.js soma diária do GetMetricData
│   │   └── costExplorer.js      gasto por serviço (GetCostAndUsage)
│   └── handlers/      Lambdas (API Gateway HTTP API, payload 2.0)
│       ├── _http.js         auth pelo JWT, parse com limite de tamanho, envelope de erro
│       ├── _repo.js         DynamoRepo reaproveitado entre invocações
│       ├── _catalog.js      catálogo empacotado
│       ├── lesson.js        POST /v1/lesson/complete, GET /v1/lesson/queue
│       ├── practice.js      POST /v1/practice/review
│       ├── guest.js         POST /v1/guest/migrate
│       ├── push.js          inscrição/remoção de Web Push e preferências de lembrete
│       ├── squads.js        rotas de squad (SPEC 04)
│       ├── league.js        GET /v1/league/current, POST /v1/league/result-seen
│       ├── account.js       DELETE /v1/users/me (exclusão de conta)
│       ├── reminders.js     Lambda do Scheduler: lembretes (web-push + VAPID do SSM)
│       ├── closeLeague.js   Lambda do Scheduler: fechar as ligas e zerar as squads da semana
│       ├── admin.js         rotas /v1/admin (uma Lambda, pelo routeKey), só grupo admin
│       ├── opsDaily.js      Lambda do Scheduler: erros do dia e custo do mês para o painel
│       └── postConfirmation.js  gatilho do Cognito: conta nova nos contadores
└── test/              um arquivo por módulo; testes escritos antes do código
```

Cada handler exporta uma fábrica (`makeLessonHandlers`, `makeGuestHandlers`,
`makePushHandlers`, `makeSquadHandlers`, `makeLeagueHandlers`, `makeAccountHandlers`, `makeCloseLeagueHandler`,
`makeAdminHandlers`, `makeOpsDailyHandler`, `makePostConfirmationHandler`) que recebe o repositório
(e o catálogo, quando usa), mais as instâncias de produção já ligadas ao DynamoDB. Os testes
usam as fábricas.

## Endpoints

Todos sob `/api` no domínio do app (CloudFront repassa `/api/*` para o estágio `api` da
HTTP API) e com o autorizador JWT do Cognito. O app manda o **id token** no
`Authorization: Bearer`. Não há Identity Pool: o convidado é 100% local e só chama a API
depois de criar conta (`POST /v1/guest/migrate`).

| Método | Rota | O que faz |
|---|---|---|
| POST | `/v1/lesson/complete` | conclui uma lição; com `lessonAttemptId` é idempotente (fila offline) |
| GET | `/v1/lesson/queue` | fila diária de SRS + sinais novos |
| POST | `/v1/lesson/abandon` | saída no meio da lição (`lessonId`, `today`, `exerciseIndex`, `exerciseCount`, `exerciseType`); só contadores do painel |
| POST | `/v1/practice/review` | grava no SRS as respostas da prática diária (sem XP nem ofensiva); idempotente por `reviewAttemptId` |
| POST | `/v1/guest/migrate` | recebe o log de conclusões do convidado e reexecuta no servidor |
| POST | `/v1/push/subscriptions` | guarda a inscrição Web Push (`PushSubscription.toJSON()`) |
| DELETE | `/v1/push/subscriptions/{subscriptionId}` | remove a inscrição |
| PUT | `/v1/notifications/preferences` | horário do lembrete, fuso e opt-in de e-mail |
| POST | `/v1/squads` | cria squad (`public` ou `private`; `org` só pelo painel B2B) |
| POST | `/v1/squads/join` | entra por `inviteCode` ou `squadId` |
| GET | `/v1/squads/{squadId}` | squad, membros por XP da semana e o papel de quem chama; quem não é membro de squad privada vê só os dados públicos |
| POST | `/v1/squads/{squadId}/leave` | sai (único membro dissolve; único admin precisa transferir) |
| POST | `/v1/squads/{squadId}/transfer` | admin passa a administração (`newAdminUserId`) e vira membro |
| PATCH | `/v1/squads/{squadId}` | admin edita `name`, `description`, `type`, `maxMembers` (o resto é ignorado) |
| DELETE | `/v1/squads/{squadId}` | admin dissolve: META, membros, vínculos e convite |
| POST | `/v1/squads/{squadId}/members/{userId}/manage` | admin: `promote`, `demote` ou `kick` |
| POST | `/v1/squads/{squadId}/invite-code/regenerate` | admin troca o código; o antigo deixa de funcionar |
| GET | `/v1/users/me/squads` | squads de quem chama |
| GET | `/v1/league/current` | liga da semana, ranking, tempo até o fechamento e o resultado anterior não visto |
| POST | `/v1/league/result-seen` | marca o LeagueResultSheet da semana `{ period }` como visto |
| DELETE | `/v1/users/me` | exclui a conta de quem chama: dados na tabela e o usuário no Cognito (LGPD); idempotente |

### Painel de administração (`/v1/admin`, só leitura)

Detalhes, escolhas de custo e como dar acesso: [`docs/painel-admin.md`](../../docs/painel-admin.md).

As rotas usam um autorizador JWT próprio, que só aceita o id token do app client do painel (`librax-admin`), e a
Lambda confere o grupo no token (`cognito:groups`): quem não está no grupo `admin` recebe **403 `ADMIN_ONLY`**.
Uma Lambda só (`librax-admin`, `adminRouter`) atende todas, pelo `routeKey`, e só lê a tabela.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/v1/admin/me` | quem está logado e os grupos (o site decide se abre) |
| GET | `/v1/admin/overview` | 30 dias, 12 semanas e 12 meses de ativos, contas novas, lições, saídas e erros; rankings por lição, exercício e sinal |
| GET | `/v1/admin/content` | unidades e sinais com `validated`, `source`, vídeo, avatar e `missing` |
| GET | `/v1/admin/accounts?q=` | busca por começo do e-mail ou pelo sub (Cognito `ListUsers`), até 10 |
| GET | `/v1/admin/accounts/{userId}` | resumo da conta: perfil, progresso, SRS, conquistas, liga, squads, atividade |
| GET | `/v1/admin/squads?cursor=&limit=` | squads da mais nova para a mais velha (até 50 por página) |
| GET | `/v1/admin/cost` | último custo guardado pelo job diário e até 6 meses |

A conclusão de lição aceita também `exerciseStats` (`{ "<tipo>": { "attempted", "wrong" } }`, tipos do app):
é telemetria do painel, e formato errado é descartado sem recusar a conclusão.

Erros de squad saem com o código do domínio, o mesmo que a tela espera (SPEC 04 seção 4.4):
`SQUAD_NOT_FOUND` e `TARGET_NOT_MEMBER` (404), `NOT_ADMIN` e `GUEST_NOT_ALLOWED` (403),
`SQUAD_FULL`, `ALREADY_MEMBER`, `SQUADS_LIMIT_REACHED`, `MUST_TRANSFER_OWNERSHIP`,
`CANNOT_DEMOTE_ONLY_ADMIN` e `MAX_MEMBERS_BELOW_COUNT` (409), validação (400).

### Squads: o que cada um vê e escritas concorrentes

- `GET /v1/squads/{squadId}` (`domain/squads.js`, `squadView`): o membro recebe a squad
  completa (com `inviteCode`, para compartilhar) e todos os membros. Quem não é membro recebe
  só `squadId`, `name`, `description`, `type`, `memberCount`, `maxMembers` e `xpWeekly`, sem
  convite; em squad pública vem também o ranking (preview da SPEC 04 4.2, só `userId`,
  `displayName`, `role` e `xpWeeklyContrib`); em squad privada ou de org, `members: []` e
  `membersVisible: false`.
- Entrar por `squadId` direto só vale para squad pública; privada sem código responde
  `SQUAD_NOT_FOUND`.
- Depois de criada, a squad nunca é regravada inteira: edição e convite novo usam SET só dos
  campos (`updateSquadFields`), o `memberCount` usa ADD condicional ao limite
  (`memberCount < maxMembers` na hora da escrita) e troca de papel mexe só em `role`. XP somado
  por outra lição no meio e entradas concorrentes não se perdem.

### POST /v1/guest/migrate

Corpo: `{ "entries": [{ "lessonAttemptId", "lessonId", "today", "score", "completedAt"?, "reviewed"?, "signsLearnedDelta"? }] }`.

- Valida cada conclusão (`domain/lessonCompletion.js`): `lessonAttemptId` de 8 a 64
  caracteres `[A-Za-z0-9_-]`, lição do catálogo, data real entre 365 dias atrás e 1 dia à
  frente, `score` entre 0 e 1, `reviewed` só com sinais do curso e estados conhecidos (até
  100). `signsLearnedDelta` é limitado pelos sinais da lição e `alphabetComplete` vem do
  catálogo, nunca do cliente.
- Limites: corpo até 256 KB (413 `PAYLOAD_TOO_LARGE`, medido antes do parse) e até 200
  conclusões por envio (400 `TOO_MANY_ENTRIES`). O app manda lotes de 100.
- Ordena por dia, horário e posição e chama `completeLessonOnce` para cada uma.
- Resposta: `results` com `applied`, `duplicate` ou `rejected` (com `reason`) por
  `lessonAttemptId`, `summary` e `profile` (`xpTotal`, `streak`). Inválidas não impedem as
  válidas.

### Idempotência

`completeLessonOnce` grava `USER#<id> / ATTEMPT#<lessonAttemptId>` com escrita condicional
antes de aplicar. Se o item já existe, devolve o resultado guardado com `duplicate: true` e
não soma XP, ofensiva, SRS, liga nem squads de novo. Se o `completeLesson` falhar, a reserva
é apagada para o reenvio poder aplicar. O item expira pelo TTL da tabela (`expiresAt`, 60
dias a partir da gravação).

### Lembretes (Web Push e e-mail)

- Inscrição em `USER#<id> / PUSH#<hash>` (hash SHA-256 do endpoint). Só endpoints de
  serviços de push conhecidos (FCM, Mozilla, Apple, Windows) são aceitos, para a Lambda
  nunca ser usada para chamar endereço interno.
- Preferências e estado em `USER#<id> / NOTIF`, indexado no GSI6 por balde de fuso
  (`NOTIF#H<deslocamento UTC>`). Ao inscrever pela primeira vez: lembrete às 19h no fuso
  enviado (padrão `America/Sao_Paulo`).
- A Lambda `librax-reminders` roda de hora em hora (EventBridge Scheduler) e aplica a SPEC 05
  12.3: nada entre 22h e 7h no fuso do usuário; sem lembrete diário se abriu o app nas
  últimas 3h; no máximo 2 por dia, exceto "sequência em risco" às 20h (streak de 3 ou mais);
  7 dias sem tocar em notificação pausa tudo por 3 dias e depois volta só o diário.
- O app deve chamar `POST /v1/push/subscriptions` a cada abertura (renova a inscrição e
  registra a abertura) e mandar `openedFromNotification: true` quando abrir pela URL
  `/?origem=lembrete` (registra interação).
- E-mail (SES) só quando não há push entregue, a pessoa fez opt-in com e-mail verificado e a
  infra ligou `librax:emailRemindersEnabled`. Por enquanto é só a estrutura.

### Ligas: entrada, leitura e resultado visto

Entrada (`usecases/leagueEnrollment.js`): a primeira lição da semana que conta na liga chama
`ensureLeague` dentro do `completeLesson`.

- Quem já tem vaga na semana (`USER#<id> / LEAGUEWEEK#<semana>`, inclusive levado pelo
  fechamento) fica onde está.
- Quem tem resultado de semana anterior entra na liga de destino (`tier` de
  `USER#<id> / LEAGUE`).
- Se a última liga já acabou e o fechamento ainda não rodou (ele roda segunda 00:05 UTC, que no
  Brasil é domingo 21:05), o resultado dela é calculado com o mesmo domínio e gravado com a
  escrita condicional por semana; o job depois só confirma.
- Quem é novo entra na Bronze.
- Grupos de até 30: a vaga, o membro e o `ADD memberCount` do META (condição
  `memberCount < 30`) vão numa transação só, e a vaga é condicional (uma liga por pessoa e
  semana). Grupo cheio avança um cursor condicional (`LEAGUEGROUPS#<tier>#<semana>`). O 1o
  grupo fica sem sufixo e os outros recebem `-g<n>`. O fechamento leva quem fez XP pelo mesmo
  caminho, de preferência no mesmo grupo.
- A semana sai do relógio do servidor. Lição com `today` fora da semana atual (aceita o
  domingo anterior por causa do fuso) soma no perfil, mas não na liga nem no XP semanal das
  squads: é o caso da migração do convidado e da fila offline antiga.

`GET /v1/league/current` (só leitura, não coloca ninguém em liga) devolve o formato do
`LeagueView` do app (`apps/web-poc/src/lib/leagueLocal.ts`), com `mode: 'server'`:

```json
{
  "mode": "server",
  "enrolled": true,
  "tier": "prata",
  "leagueId": "prata-2026-w44",
  "week": 44,
  "period": "2026-w44",
  "periodStart": 1792972800000,
  "periodEnd": 1793577600000,
  "msUntilClose": 302400000,
  "promote": 3,
  "relegate": 10,
  "rows": [{ "userId": "...", "name": "Bia", "xpPeriod": 30, "rank": 1, "zone": "promotion", "isYou": false, "simulated": false }],
  "you": { "userId": "...", "name": null, "xpPeriod": 10, "rank": 2, "zone": "promotion", "isYou": true, "simulated": false },
  "pendingResult": { "period": "2026-w43", "periodStart": 1792368000000, "leagueId": "bronze-2026-w43",
                     "fromTier": "bronze", "toTier": "prata", "outcome": "promoted", "rank": 1, "total": 30, "xp": 50 }
}
```

- `periodStart`, `periodEnd` e `pendingResult.periodStart` em epoch ms (como no app).
- `name` é o `displayName` do perfil guardado ao entrar na liga; pode vir `null`.
- Sem lição na semana: `enrolled: false`, `leagueId: null`, `rows: []`, `you: null` e `tier` é
  a liga em que a pessoa vai entrar. O `pendingResult` vem mesmo assim.
- `pendingResult` é o último resultado com semana maior que a marcada como vista. Se o
  fechamento ainda não rodou, já vem calculado (sem gravar nada).

`POST /v1/league/result-seen` com `{ "period": "2026-w43" }`: só semana já encerrada
(`400 INVALID_PERIOD` para formato errado, semana atual ou futura). Guarda em
`USER#<id> / LEAGUE_SEEN` só para frente; marcar uma semana mais antiga não faz o resultado
voltar.

### Fechamento semanal das ligas e reset das squads

A Lambda `librax-close-league` roda toda segunda 00:05 UTC (EventBridge Scheduler, evento
vazio) e fecha a semana que terminou em **todas** as ligas dela (`usecases/closeLeagueWeek.js`):

- Lista as ligas da semana pelo GSI2 (`LEAGUES#<semana>`), 25 por página, e pula as já
  fechadas.
- Calcula o resultado com o mesmo domínio que o app usa no modo local
  (`domain/leagues.js`: `rankLeague` e `closeLeague`, com as zonas por liga: Bronze não
  rebaixa, Diamante não promove; top 3 sobem, bottom 10 descem).
- Grava o resultado em `USER#<id> / LEAGUE` com escrita condicional por semana: rodar de novo
  não promove de novo e devolve o resultado já gravado.
- Quem fez XP entra na liga da semana seguinte (`toTier`, de preferência no mesmo grupo e
  sempre com até 30 por grupo), sem zerar XP que já tenha entrado nela. Quem já entrou sozinho
  na semana nova (lição antes do job) fica onde está. Quem ficou sem XP fica só com o estado
  (como no app: semana sem estudo não gera rebaixamento extra) e entra na liga na próxima
  lição.
- Marca a liga como `closed`. Se cair no meio, a nova tentativa continua de onde parou.

Na mesma execução (SPEC 04 seção 0.3: "mesmo job que fecha as ligas"),
`usecases/resetSquadWeek.js` zera o XP semanal das squads:

- A squad (META) e cada membro guardam a semana do XP (`xpWeekPeriod`). A lição soma com ADD
  condicional a essa semana; se o item ainda é de uma semana velha, vira a semana com escrita
  condicional (o valor anterior vai para `lastWeekXp`/`lastWeekPeriod`) e, no META, marca a
  squad como ativa (`SQUAD#<id> / WEEK#<semana>`, GSI2 `SQUADS#<semana>`, uma escrita por
  squad e semana).
- O job percorre o GSI2 `SQUADS#<semana>` 25 por página, vira quem ainda está na semana velha
  (`xpWeekly` e `xpWeeklyContrib` a zero) e fecha a semana em `WEEK#<semana>` com o total, o
  total de membros e o ranking interno (`xpWeeklyContrib` desc), uma vez só. XP que já entrou
  na semana nova não é apagado e rodar de novo não muda nada.
- `xpAllTime` e `xpAllTimeContrib` são somados na própria lição.
- As leituras de squad mostram zero para quem ainda está numa semana velha (job atrasado).
- O relatório da Lambda leva o das squads em `squads`.

Para refazer uma semana a mão: invocar a Lambda com `{ "periodStart": "2026-10-19" }` (a
segunda-feira da semana).

### Exclusão de conta (DELETE /v1/users/me)

A própria pessoa exclui a conta pelo app (Configurações, spec-02 12.8). Mesmo autorizador JWT das outras rotas:
só o `sub` do token decide de quem é a conta. Lambda própria (`librax-delete-account`, 30 s), a única com
`cognito-idp:AdminDeleteUser`, e só no User Pool do app. Resposta `200 { "ok": true }` só depois de tudo apagado;
erro no meio vira 500 e a pessoa tenta de novo pelo app. O log leva só contagens (`usecases/deleteAccount.js`).

O que sai, nesta ordem:

| Onde | O quê | Decisão |
|---|---|---|
| Squads em que a pessoa está (`USER#<id> / SQUAD#<id>`) | `SQUAD#<id> / MEMBER#<id>`, o vínculo e `memberCount - 1` numa transação condicional (`removeMemberWithCount`) | membro comum só sai |
| Squad em que ela é a única admin | o membro mais antigo (`joinedAt`, desempate pelo `userId`) vira admin antes de ela sair | é o que o `transferOwnership` faria (SPEC 04: a squad precisa de um admin); quem exclui a conta não pode mais transferir e a squad dos outros não some |
| Squad em que ela é o único membro | dissolve: META, membros, semanas, convite (`INVITE#`) e `SQUADINDEX` (`deleteSquad`, META por último) | é o `leaveSquad` do único membro |
| `createdBy` do META e `ranking` das semanas fechadas (`SQUAD#<id> / WEEK#<semana>`) | o `createdBy` sai e a linha dela sai do ranking (`forgetSquadMember`) | os totais da semana não identificam ninguém e ficam; a posição dos outros fica como foi |
| Ligas (GSI2 `USER#<id> / LEAGUE#<semana>` e vagas `LEAGUEWEEK#`) | `LEAGUE#<id> / USER#<id>` (com o `displayName`) | liga aberta: `memberCount - 1` na mesma transação (libera a vaga no grupo de 30) e o ranking dos outros passa a ser calculado sem ela, inclusive no fechamento; liga fechada: os totais do fechamento e o resultado já gravado dos outros ficam |
| Partição `USER#<id>` inteira | perfil, `PROG#`, `SRS#` (e o GSI1), `DAY#`, `ACH#`, vínculos `SQUAD#`, `LEAGUE`, `LEAGUEWEEK#`, `LEAGUE_SEEN`, `ATTEMPT#`, `PUSH#`, `NOTIF` (e o GSI6), `ACTIVITY` | BatchWrite de 25, com reenvio do não processado (`deleteUserItems`) |
| Cognito | `AdminDeleteUser` com o `cognito:username` do id token (o `sub` nas contas de e-mail, `google_<id>` nas do Google) | por último: se algo antes falhar, a pessoa ainda entra para tentar de novo; usuário que já não existe conta como feito |

Fica: os contadores agregados do painel (`OPS / DAY#...`, `WEEK#`, `MONTH#`, `COST#`) somam por dia, lição, tipo de
exercício e sinal (nomes planos como `done:u1-l1`), sem o id de ninguém. O convite (`INVITE#`) é da squad, não da
pessoa.

Idempotente: cada passo só age sobre o que ainda existe, e as saídas com contador são condicionais ao membro existir,
então a nova tentativa depois de uma queda no meio termina o serviço sem descontar duas vezes.

Limites conhecidos: o id token continua válido até expirar (até 1 h, o autorizador JWT confere só a assinatura); o
app sai da conta logo depois. Uma conclusão enviada nesse intervalo por outra aba recriaria itens soltos com o
`sub`, que não leva a ninguém. Squads de que a pessoa saiu antes da exclusão guardam o `sub` no `createdBy` e nos
rankings semanais antigos (sem índice da pessoa para essas squads, só um Scan acharia); sem a conta no Cognito, o
`sub` não identifica ninguém.

### Contadores do painel e job diário

`completeLessonOnce` (também na migração do convidado), `reviewSignsOnce`, o endpoint legado da lição, a saída
da lição e o gatilho PostConfirmation do Cognito somam com `ADD` em `OPS / DAY#<dia>` (e `#LESSON`, `#EXERCISE`,
`#SIGN`), `WEEK#<semana>` e `MONTH#<mês>`. A pessoa conta como ativa uma vez por dia, semana e mês pelo registro
`USER#<id> / ACTIVITY` (escrita condicional só na primeira atividade do dia). Reenvio idempotente não soma de
novo, e erro no contador só vai para o log: a lição nunca falha por causa dele.

A Lambda `librax-ops-daily` roda às 03:30 UTC (00:30 em Brasília): soma no dia de Brasília que acabou os 5xx e 4xx
da API, os erros por Lambda e o throttling (CloudWatch `GetMetricData`) e grava o gasto do mês por serviço (uma
chamada ao Cost Explorer, US$ 0,01). Refazer um dia: `{ "day": "2026-10-22" }`; sem Cost Explorer:
`{ "skipCost": true }`.

## Itens da tabela `librax`

Além dos da SPEC 02 seção 3 e SPEC 04 seção 1:

| Item | PK | SK | Observação |
|---|---|---|---|
| Tentativa de lição | `USER#<id>` | `ATTEMPT#<lessonAttemptId>` | `status` pending/done, `result`, TTL `expiresAt` |
| Inscrição Web Push | `USER#<id>` | `PUSH#<hash>` | `endpoint`, `keys`, `createdAt` |
| Lembretes | `USER#<id>` | `NOTIF` | preferências + estado; GSI6 `NOTIF#H<balde>` / `USER#<id>` |
| Liga (META) | `LEAGUE#<leagueId>` | `META` | `tier`, `period`, `periodStart`, `group`?, `memberCount` (até 30), `status` open/closed; GSI2 `LEAGUES#<semana>` / `LEAGUE#<leagueId>` |
| Membro de liga | `LEAGUE#<leagueId>` | `USER#<id>` | `xpPeriod`, `displayName`?; GSI2 `USER#<id>` / `LEAGUE#<semana>` |
| Estado de liga | `USER#<id>` | `LEAGUE` | `tier` atual, `lastResult` (para o LeagueResultSheet), `lastClosedPeriod` |
| Vaga na semana | `USER#<id>` | `LEAGUEWEEK#<semana>` | `leagueId`, `tier`, `period`; condicional: uma liga por pessoa e semana |
| Cursor de grupo | `LEAGUEGROUPS#<tier>#<semana>` | `META` | `group` aberto; avança com escrita condicional |
| Resultado visto | `USER#<id>` | `LEAGUE_SEEN` | `period` do último LeagueResultSheet mostrado |
| Semana da squad | `SQUAD#<id>` | `WEEK#<semana>` | `status` open/closed, `xpWeekly`, `memberCount`, `ranking`; GSI2 `SQUADS#<semana>` / `SQUAD#<id>` |
| Contadores do painel | `OPS` | `DAY#<dia>`, `DAY#<dia>#LESSON`, `#EXERCISE`, `#SIGN` | `ADD`; nomes planos (`done:u1-l1`); `cloud` gravado pelo job; TTL `expiresAt` de 400 dias |
| Semana e mês do painel | `OPS` | `WEEK#<semana>`, `MONTH#<mês>` | ativos, contas novas, lições; TTL de 800 dias na semana |
| Custo do mês | `OPS` | `COST#<AAAA-MM>` | total, projeção e gasto por serviço (job diário) |
| Atividade | `USER#<id>` | `ACTIVITY` | `lastDay`, `lastWeek`, `lastMonth` contados no painel |
| Registro de squads | `SQUADINDEX` | `SQUAD#<createdAt>#<squadId>` | lista do painel sem Scan; apagado ao dissolver |

`leagueId` segue o formato do app: `<tier>-<ano>-w<semana ISO>` (ex.: `bronze-2026-w43`), com
`-g<n>` a partir do 2o grupo de 30 da mesma liga e semana.

Squad (META) e membro ganham `xpWeekPeriod`, `lastWeekXp` e `lastWeekPeriod` (semana do XP
semanal) e `xpAllTime` / `xpAllTimeContrib` (SPEC 04 seção 1.1). As respostas da API não levam
os campos de semana.

## Infra sem conta AWS

```bash
cd services/api && npm ci          # o esbuild do CDK empacota web-push daqui
cd ../../infra && npm ci
npm test                           # assertions do template (vitest), sem empacotar
npx cdk synth                      # funciona sem credenciais, com o domínio placeholder
```

Os parâmetros de contexto estão documentados em `infra/lib/config.ts` e podem ir no
`infra/cdk.json` ou na linha de comando (`-c librax:domainName=...`). O padrão
`librax.example` é placeholder e gera aviso no synth.

## Antes do primeiro deploy

Nada disso foi criado: é a lista do que o dono da conta precisa decidir ou criar. Regiões:
a stack usa `us-east-1` por padrão porque o certificado do CloudFront e o do domínio próprio
do Cognito precisam estar lá.

1. **Domínio.** Escolher o domínio (ex.: `librax.com.br`) e passar
   `-c librax:domainName=<dominio>`. A landing fica em `<dominio>` (com `www.<dominio>`
   redirecionando), o app em `app.<dominio>` e o Cognito em `auth.<dominio>` (mude com
   `librax:landingDomainName`, `librax:wwwDomainName`, `librax:appDomainName` e
   `librax:authDomainName`). Nomes, registros DNS e publicação da landing:
   [`docs/conta-aws.md`](../../docs/conta-aws.md#domínio-landing-e-app).
2. **Certificado.** Pedir no ACM em `us-east-1` um certificado com `<dominio>`, `www.<dominio>`,
   `app.<dominio>` e `auth.<dominio>` (ou `<dominio>` e `*.<dominio>`), validar por DNS e passar
   `-c librax:certificateArn=<arn>`. Sem ele o app e a landing ficam no `*.cloudfront.net` e o
   Cognito no prefixo `librax-example.auth.us-east-1.amazoncognito.com`
   (mude com `librax:cognitoDomainPrefix`).
3. **DNS.** Com zona no Route 53, passar `librax:hostedZoneId` e `librax:hostedZoneName`: a
   stack cria A/AAAA da landing (`<dominio>` e `www.`), do app (`app.`) e A do `auth.` na ordem
   certa. Com DNS fora da AWS: o Cognito só aceita domínio próprio se o domínio pai já resolver,
   então crie antes um registro A provisório para `<dominio>`; depois do deploy aponte os nomes
   para os outputs (tabela em [`docs/conta-aws.md`](../../docs/conta-aws.md#domínio-landing-e-app)).
4. **Google.** No Google Cloud Console, criar um cliente OAuth do tipo "Aplicativo da Web"
   com origem `https://auth.<dominio>` e URI de redirecionamento
   `https://auth.<dominio>/oauth2/idpresponse`. Guardar:
   ```bash
   aws ssm put-parameter --name /librax/google/client-id --type String --value '<client id>'
   aws secretsmanager create-secret --name librax/google/client-secret --secret-string '<client secret>'
   ```
   O template só leva a referência; o valor é resolvido no deploy. Para publicar antes de ter
   o Google: `-c librax:googleEnabled=false`.
   Na tela de consentimento do OAuth, informar a Política de Privacidade
   (`https://app.<dominio>/privacidade`) e os Termos de Uso (`https://app.<dominio>/termos`), que abrem
   sem login (a CloudFront Function do app entrega o `index.html` para essas rotas).
5. **Apple (opcional, desligada).** Para ligar: `librax:appleEnabled=true` e os parâmetros
   `/librax/apple/services-id`, `/librax/apple/team-id`, `/librax/apple/key-id` (SSM) e o
   segredo `librax/apple/private-key` (Secrets Manager).
6. **VAPID (Web Push).** Gerar o par de chaves uma vez e guardar no SSM:
   ```bash
   cd services/api && npx web-push generate-vapid-keys --json
   aws ssm put-parameter --name /librax/vapid/public-key --type String --value '<publicKey>'
   aws ssm put-parameter --name /librax/vapid/private-key --type SecureString --value '<privateKey>'
   ```
   A pública também vai no build do app (`VITE_VAPID_PUBLIC_KEY`). Contato exigido pelos
   serviços de push: `librax:vapidSubject` (padrão `mailto:contato@<dominio>`). Trocar as
   chaves invalida todas as inscrições.
7. **SES (opcional).** Verificar a identidade do domínio no SES (DKIM no DNS), pedir saída do
   sandbox e então `-c librax:emailRemindersEnabled=true -c librax:emailFrom=lembretes@<dominio>`.
   Sem isso o lembrete por e-mail fica desligado.
8. **Login e bootstrap.** Configurar o login da conta pelo IAM Identity Center e fixar
   `librax:accountId` ([`docs/conta-aws.md`](../../docs/conta-aws.md)). Depois, em `infra`,
   `npm run bootstrap` (o bootstrap do CDK na conta e região). `bootstrap`, `diff` e `deploy`
   recusam qualquer conta que não seja a fixada.
9. **Callbacks de dev.** Para testar o login no `localhost`, acrescentar
   `-c librax:extraCallbackUrls=http://localhost:5173/auth/callback`,
   `librax:extraLogoutUrls=http://localhost:5173/` e
   `librax:extraCorsOrigins=http://localhost:5173`. Não use em produção.
10. **Build e upload do app.** Preencher `apps/web-poc/.env.local` com os outputs
    (`UserPoolId`, `UserPoolClientId`, `AuthDomain`) e:
    ```bash
    cd apps/web-poc && npm ci && npm run build
    aws s3 sync dist s3://<WebBucketName> --delete
    ```
    O CloudFront aplica `no-cache` no app shell (`index.html`, `sw.js`) e `immutable` em
    `/assets/*`, então não precisa invalidar a cada publicação. O painel de administração tem bucket próprio
    (`AdminBucketName`) e vai em `admin/`: ver [`docs/painel-admin.md`](../../docs/painel-admin.md).
    A landing tem bucket e CloudFront próprios: `npm run landing:publicar` (em `infra`), ver
    [`docs/conta-aws.md`](../../docs/conta-aws.md#publicar-a-landing).
11. **Conteúdo e modelos.** No bucket `ContentBucketName`, a chave repete a URL:
    `content/<courseId>/v<N>/...` e `ml/<versao>/...`. Suba `.wasm` com
    `--content-type application/wasm` (o CloudFront também força esse tipo em `*.wasm`).
12. **Alertas e orçamento.** Passar `-c librax:alarmEmail=<e-mail>` (e, se quiser outro,
    `librax:budgetEmail`) e confirmar a assinatura no e-mail que a AWS manda. O AWS Budget avisa em 80% e 100% de
    `librax:monthlyBudgetUsd` (padrão 10). Ativar o Cost Explorer no console de Billing para a tela de custo.
13. **Admin.** Colocar as contas de administração no grupo `admin` do Cognito (docs/painel-admin.md).
14. **CSP.** No primeiro teste em aparelho, dá para mandar a CSP como Report-Only com
    `-c librax:cspReportOnly=true` e olhar o console antes de travar.
15. **Política e Termos.** Preencher quem responde pelo app em
    `apps/web-poc/src/legal/responsavel.ts` (nome, CNPJ ou CPF, e-mail de contato e foro) e subir a
    versão e a data de vigência no topo de `privacidade.md` e `termos.md`. Enquanto houver marcador
    entre colchetes, as páginas mostram o selo "Rascunho".

## Ligas no app: o que precisa mudar

O servidor já faz tudo que o modo local do app (`apps/web-poc/src/lib/leagueLocal.ts`) simula.
Para trocar:

1. `loadLeagueView` passa a chamar `GET /api/v1/league/current` (com o id token) e usar a
   resposta como `LeagueView`. O tipo precisa aceitar `mode: 'server'`, `you: null`,
   `enrolled: false` (o estado vazio que hoje é o `null` de `loadLeagueView`) e `name: null`
   nas linhas (mostrar um nome genérico). Há campos novos: `period`, `msUntilClose` e
   `enrolled`.
2. "Encerra em Xd Yh": calcular com `msUntilClose` (ou `periodEnd`), que vem do relógio do
   servidor, e não com o relógio do aparelho. O fechamento roda segunda 00:05 UTC.
3. `pendingResult` já vem filtrado pelo servidor. Ao exibir o LeagueResultSheet, chamar
   `POST /api/v1/league/result-seen` com `{ period: pendingResult.period }` (spec-02 12.7:
   marca ao exibir) no lugar do `localStorage` (`librax_leagueResultSeen`). Falha de rede só
   faz o sheet reaparecer.
4. Apagar `syncLeague`, `closePeriod`, `simulatedMembers` e a escrita de XP de liga no
   IndexedDB: a entrada na liga, o XP da semana e o fechamento são do servidor. A lição só
   precisa ir para `POST /v1/lesson/complete` (ou para a fila offline); a resposta traz
   `leagueId` e `period`.
5. O convidado continua no modo local: só chama a API depois de criar conta. Na migração
   (`POST /v1/guest/migrate`) só as lições da semana atual entram na liga; o ranking local do
   convidado não é levado para o servidor.
6. `rankLeague`/`zoneOpts` no app ficam opcionais: o servidor já manda `rank` e `zone`.

## Pendências conhecidas (fora desta entrega)

- Nenhuma rota preenche o `displayName` do perfil ainda; enquanto isso o ranking da liga e o
  da squad saem com `name`/`displayName` nulos.
- O GSI4 (diretório de squads públicas) não acompanha o XP: os ADD não reescrevem o
  `GSI4SK`. A ordem por XP fica para quando `listPublicSquads` for implementado.
- O limite de 5 squads por pessoa é checado antes de entrar, sem contador condicional: duas
  entradas ao mesmo tempo em squads diferentes podem passar de 5.
- `PATCH /v1/squads/{squadId}` (`updateSquadHandler`) existe na API, mas não tem Lambda nem
  rota na infra.
- Uma lição que começa antes da virada (domingo 23:59:59 UTC) e grava depois dela pode somar
  na liga e na squad da semana que já fechou.
- `completedAt` e `today` vêm do aparelho; um relógio errado pode deslocar a ofensiva de um
  convidado migrado (limitado a 365 dias atrás e 1 dia à frente). A semana da liga e das
  squads já usa o relógio do servidor.
