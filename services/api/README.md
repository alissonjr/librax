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

145 testes no momento (`test/`). Os handlers são testados com o `InMemoryRepo` injetado e
o `DynamoRepo` com um client falso que só registra os comandos; nenhum teste chama a AWS.

## Estrutura

```
services/api/
├── scripts/build-catalog.mjs   gera src/content/catalog.js a partir do course.json do app
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
│   │   ├── push.js              inscrição Web Push e preferências de lembrete
│   │   └── reminders.js         regras de horário dos lembretes (SPEC 05 12.2 e 12.3)
│   ├── lib/dates.js   aritmética de datas-calendário
│   ├── content/
│   │   ├── catalogFromCourse.js catálogo mínimo (XP, sinais por lição, conquistas)
│   │   └── catalog.js           GERADO, empacotado nas Lambdas (npm run catalog)
│   ├── usecases/
│   │   ├── completeLesson.js     XP + streak + SRS + conquistas + fan-out (SPEC 02/04)
│   │   ├── completeLessonOnce.js o mesmo, idempotente por lessonAttemptId
│   │   ├── migrateGuest.js       reexecuta o log do convidado (POST /v1/guest/migrate)
│   │   ├── getDailyQueue.js      monta a fila do dia
│   │   ├── sendReminders.js      rodada de lembretes (Web Push e e-mail opcional)
│   │   └── squads.js             create / join / leave / manageMember (SPEC 04 seção 2)
│   ├── adapters/
│   │   ├── inMemoryRepo.js  porta em memória (testes e dev local)
│   │   └── dynamoRepo.js    porta sobre a tabela single-table `librax`
│   └── handlers/      Lambdas (API Gateway HTTP API, payload 2.0)
│       ├── _http.js         auth pelo JWT, parse com limite de tamanho, envelope de erro
│       ├── _repo.js         DynamoRepo reaproveitado entre invocações
│       ├── _catalog.js      catálogo empacotado
│       ├── lesson.js        POST /v1/lesson/complete, GET /v1/lesson/queue
│       ├── guest.js         POST /v1/guest/migrate
│       ├── push.js          inscrição/remoção de Web Push e preferências de lembrete
│       ├── squads.js        rotas de squad (SPEC 04)
│       ├── reminders.js     Lambda do Scheduler: lembretes (web-push + VAPID do SSM)
│       └── closeLeague.js   Lambda do Scheduler: fechar liga semanal
└── test/              um arquivo por módulo; testes escritos antes do código
```

Cada handler exporta uma fábrica (`makeLessonHandlers`, `makeGuestHandlers`,
`makePushHandlers`) que recebe o repositório e o catálogo, mais as instâncias de produção
já ligadas ao DynamoDB. Os testes usam as fábricas.

## Endpoints

Todos sob `/api` no domínio do app (CloudFront repassa `/api/*` para o estágio `api` da
HTTP API) e com o autorizador JWT do Cognito. O app manda o **id token** no
`Authorization: Bearer`.

| Método | Rota | O que faz |
|---|---|---|
| POST | `/v1/lesson/complete` | conclui uma lição; com `lessonAttemptId` é idempotente (fila offline) |
| GET | `/v1/lesson/queue` | fila diária de SRS + sinais novos |
| POST | `/v1/guest/migrate` | recebe o log de conclusões do convidado e reexecuta no servidor |
| POST | `/v1/push/subscriptions` | guarda a inscrição Web Push (`PushSubscription.toJSON()`) |
| DELETE | `/v1/push/subscriptions/{subscriptionId}` | remove a inscrição |
| PUT | `/v1/notifications/preferences` | horário do lembrete, fuso e opt-in de e-mail |
| | `/v1/squads/...`, `/v1/users/me/squads` | squads (SPEC 04) |

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
é apagada para o reenvio poder aplicar. O item expira pelo TTL da tabela (`expiresAt`, ~400
dias).

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

## Itens da tabela `librax`

Além dos da SPEC 02 seção 3 e SPEC 04 seção 1:

| Item | PK | SK | Observação |
|---|---|---|---|
| Tentativa de lição | `USER#<id>` | `ATTEMPT#<lessonAttemptId>` | `status` pending/done, `result`, TTL `expiresAt` |
| Inscrição Web Push | `USER#<id>` | `PUSH#<hash>` | `endpoint`, `keys`, `createdAt` |
| Lembretes | `USER#<id>` | `NOTIF` | preferências + estado; GSI6 `NOTIF#H<balde>` / `USER#<id>` |

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

1. **Domínio.** Escolher o domínio do app (ex.: `librax.com.br`) e passar
   `-c librax:domainName=<dominio>`. O Cognito usa `auth.<dominio>` (mude com
   `librax:authDomainName`).
2. **Certificado.** Pedir no ACM em `us-east-1` um certificado com `<dominio>` e
   `auth.<dominio>`, validar por DNS e passar `-c librax:certificateArn=<arn>`. Sem ele o app
   fica no `*.cloudfront.net` e o Cognito no prefixo `librax-example.auth.us-east-1.amazoncognito.com`
   (mude com `librax:cognitoDomainPrefix`).
3. **DNS.** Com zona no Route 53, passar `librax:hostedZoneId` e `librax:hostedZoneName`: a
   stack cria A/AAAA do app e A do `auth.` na ordem certa. Com DNS fora da AWS: o Cognito só
   aceita domínio próprio se o domínio pai já resolver, então crie antes um registro A
   provisório para `<dominio>`; depois do deploy aponte `<dominio>` para o output
   `DistributionDomain` e `auth.<dominio>` para `AuthDomainCloudFront`.
4. **Google.** No Google Cloud Console, criar um cliente OAuth do tipo "Aplicativo da Web"
   com origem `https://auth.<dominio>` e URI de redirecionamento
   `https://auth.<dominio>/oauth2/idpresponse`. Guardar:
   ```bash
   aws ssm put-parameter --name /librax/google/client-id --type String --value '<client id>'
   aws secretsmanager create-secret --name librax/google/client-secret --secret-string '<client secret>'
   ```
   O template só leva a referência; o valor é resolvido no deploy. Para publicar antes de ter
   o Google: `-c librax:googleEnabled=false`.
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
8. **Bootstrap do CDK** na conta e região (`cdk bootstrap`), feito pelo dono da conta.
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
    `/assets/*`, então não precisa invalidar a cada publicação.
11. **Conteúdo e modelos.** No bucket `ContentBucketName`, a chave repete a URL:
    `content/<courseId>/v<N>/...` e `ml/<versao>/...`. Suba `.wasm` com
    `--content-type application/wasm` (o CloudFront também força esse tipo em `*.wasm`).
12. **CSP.** No primeiro teste em aparelho, dá para mandar a CSP como Report-Only com
    `-c librax:cspReportOnly=true` e olhar o console antes de travar.

## Pendências conhecidas (fora desta entrega)

- `handlers/squads.js` importa `transferOwnership`, `updateSquad`, `disbandSquad` e
  `regenerateInviteCode`, que `usecases/squads.js` não exporta: essas rotas respondem 500
  (o esbuild avisa no synth).
- A agenda da liga semanal chama `closeLeague` sem `leagueId`; a Lambda só registra e sai.
- O Identity Pool do convidado anônimo continua na stack, sem uso pelo app web (convidado
  100% local); remover quando a decisão for fechada.
- `completedAt` e `today` vêm do aparelho; um relógio errado pode deslocar a ofensiva de um
  convidado migrado (limitado a 365 dias atrás e 1 dia à frente).
