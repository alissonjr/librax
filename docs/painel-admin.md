# Painel de administração

> Status: **primeira etapa, só leitura** (out/2026). Nada foi publicado: a infra está no CDK e passa no
> `cdk synth`, mas o deploy é do dono da conta.

Um lugar para ver a operação do Librax e o que o app tem na nuvem, sem abrir o console da AWS. Fica em
`https://app.<domínio>/admin/`, no mesmo CloudFront do app, e só abre para contas no grupo `admin` do Cognito.

Código:

| Parte | Onde |
|---|---|
| Site | `apps/admin-web` (Vite, React, TypeScript) |
| Rotas `/v1/admin/*` | `services/api/src/handlers/admin.js`, `usecases/admin.js`, `domain/admin.js` |
| Contadores | `services/api/src/domain/opsMetrics.js` e `usecases/opsMetrics.js` |
| Uso anônimo e notas do app | `services/api/src/domain/telemetry.js`, `domain/feedback.js`, `usecases/telemetry.js`, `handlers/telemetry.js`; no app, `apps/web-poc/src/lib/telemetry.ts` |
| Job diário (CloudWatch e Cost Explorer) | `services/api/src/handlers/opsDaily.js` e `usecases/collectDailyOps.js` |
| Infra (bucket, rotas, grupo, alarmes, orçamento) | `infra/lib/librax-stack.ts` |

## 1. O que cada tela mostra

| Tela | O que tem | De onde vem |
|---|---|---|
| **Operação** | pessoas ativas por dia (30 dias), semana (12) e mês (12); contas novas; lições concluídas; lições onde mais desistem e mais erram; lições puladas pelo nivelamento (por lição, com as desfeitas); erros por tipo de exercício; sinais mais errados; erros do servidor por dia e por Lambda | contadores agregados (seção 3) e o job diário |
| **Uso** | dados de uso anônimos de todo mundo, com e sem conta: ativos por dia, semana e mês separados em sem conta e com conta; D1 e D7 por dia de chegada; funil (abriu, boas-vindas, 1a lição, 5 lições, conta); lições mais abertas, onde saem (e em que exercício); até onde chegam no curso; aparelhos; idioma e meta das boas-vindas; prática; notas do app (média, por estrela, por semana e os comentários paginados, com filtro por nota) | itens `TELAGG` e `FBLIST` (seção 3a), `GET /v1/admin/usage` e `GET /v1/admin/feedback` |
| **Câmera** | letras e sinais do mais difícil para o mais fácil nos mesmos 30 dias (taxa de pulo, depois média de tentativas até acertar), com nível, filtro de letras ou sinais e as leituras trocadas mais comuns (K lida como H) | item `CAMERA` do dia (seção 3), pela mesma rota da Operação |
| **Conteúdo** | as 14 unidades e os 255 sinais: validado (`validated`), origem (`source`), vídeo, avatar e o que falta em cada sinal, com filtros | `services/api/src/content/contentStatus.js`, gerado do bundle do app por `npm run catalog` |
| **Contas** | busca pelo começo do e-mail ou pelo id; resumo com perfil, progresso (lição concluída ou "pulada pelo nivelamento"), liga, squads e última atividade | Cognito (`ListUsers`) e a partição `USER#<id>` |
| **Squads** | nome, tipo, tamanho e criação, da mais nova para a mais velha | registro `SQUADINDEX` e o META de cada squad |
| **Custo** | gasto estimado do mês e o detalhe por serviço; meses anteriores | Cost Explorer, uma vez por dia |

Definições usadas nas telas:

- **Pessoa ativa**: concluiu lição, fez a prática do dia ou abriu uma lição e saiu, contada uma vez por dia,
  semana e mês. O dia é o da própria pessoa (o `today` que o app manda, o mesmo da ofensiva).
- **Conta nova**: gatilho PostConfirmation do Cognito (cadastro confirmado ou primeiro login com Google), no dia
  de Brasília. Troca de senha não conta.
- **Desistência**: a pessoa confirmou "Sair da lição?". Taxa = saídas / (saídas + conclusões). Fechar a aba sem
  confirmar não chega ao servidor.
- **Erro**: resposta errada num exercício (contada por tipo de exercício e por lição) e sinal com estado
  `failed` na revisão.
- **Erros do servidor**: 5xx da API mais erros das Lambdas, do CloudWatch, até o dia anterior.
- **Pulada pelo nivelamento**: a pessoa fez o teste de nivelamento e pulou a lição (sem XP, ofensiva, SRS,
  conquista nem liga; não conta como lição concluída nem como pessoa ativa). Desfeita: a pessoa desfez o teste
  em Configurações antes de refazer a lição. Lição refeita depois vira conclusão normal.
- **Câmera**: uma vez é do momento em que a câmera abre até acertar ou pular; tentativa é cada leitura
  diferente da câmera até acertar. Nível difícil com metade ou mais de pulos ou 3 tentativas ou mais em média,
  atenção a partir de 20% de pulos ou 2 tentativas (a mesma regra da tela "Desempenho da câmera" do app). A
  lista esconde, por padrão, quem tem menos de 5 vezes no período.

Limites conhecidos: na Operação, o convidado só entra nos números quando cria conta (a migração soma as lições
dele nos dias em que foram feitas). A tela **Uso** cobre todo mundo pelos dados de uso anônimos (seção 3a).

Definições da tela Uso:

- **Ativo**: o app mandou algum evento naquele dia (o dia do aparelho), semana ou mês. A conta é por código
  anônimo, que é um por navegador: a mesma pessoa em dois aparelhos conta duas vezes. "Com conta" é o que valia
  no lote.
- **Coorte, D1 e D7**: códigos que chegaram com o app zerado (sem lição, XP nem conta) no dia; D1 = abriu o app no
  dia seguinte, D7 = sete dias depois. Quem já usava o app quando os dados de uso começaram não entra na coorte nem
  no funil (entra nos ativos).
- **Funil**: dos códigos que chegaram zerados nos 30 dias, quantos já terminaram as boas-vindas, concluíram 1 e 5
  lições e têm conta (criada ou entrada). Nada sai do app antes das boas-vindas (o aceite da política), então quem
  desiste antes delas não aparece.
- **Até onde chegam**: códigos que já concluíram cada lição, desde que os dados de uso começaram.
- **Nota**: uma por código; quem manda de novo troca a anterior (totais descontados). Comentário é texto simples.

## 2. Acesso: três travas

1. **Autorizador próprio.** O painel tem um app client só dele no Cognito (`librax-admin`, login pela tela do
   próprio painel, seção [Tela de entrar](#tela-de-entrar)). As rotas `/v1/admin/*` usam um autorizador JWT que só
   aceita o id token desse client: o token do app não abre o painel.
2. **Grupo no token.** Cada rota confere `cognito:groups` no token e responde **403 `ADMIN_ONLY`** para quem não
   está no grupo `admin` (`requireAdmin` em `handlers/_http.js`). O site esconde as telas, mas quem decide é a API.
3. **Segundo fator obrigatório.** A conta precisa ter o aplicativo autenticador (TOTP) ligado; sem ele, toda rota
   responde **403 `ADMIN_MFA_REQUIRED`** e o site guia a configuração. Conta do Google ou da Apple nem entra (o
   client do painel só aceita e-mail e senha, e ela não tem senha); se um token dela chegasse, a API responderia
   **403 `ADMIN_MFA_FEDERATED`**, porque o fator do Cognito não vale para ela.

A Lambda do painel só **lê** a tabela (`grantReadData`) e só pode chamar `cognito-idp:ListUsers` e
`cognito-idp:AdminGetUser` no User Pool do Librax. Cada acesso vai para o log com o sub de quem consultou e a rota
(trilha para a LGPD), sem o termo buscado; acesso recusado pelo segundo fator também (`denied`).

### Segundo fator (aplicativo autenticador)

O User Pool tem MFA **opcional, só por aplicativo autenticador** (TOTP; SMS nunca). Quem usa o app do Librax não
vê nada disso. O Cognito não exige MFA por grupo, e o token do User Pool não diz como a pessoa entrou (não tem
`amr`), então a trava fica na Lambda do painel:

- Ela lê a conta com `AdminGetUser` e confere se `UserMFASettingList` tem `SOFTWARE_TOKEN_MFA`
  (`directory.totpEnabled` em `adapters/cognitoDirectory.js`). Com o autenticador ligado, **todo login da conta
  pede o código**: o Cognito responde o desafio `SOFTWARE_TOKEN_MFA` depois da senha e a tela do painel pede os 6
  dígitos. Conferir a conta, e não o token, é o que dá para fazer de forma confiável.
- O "sim" fica guardado na Lambda por 5 minutos (`makeMfaGate` em `domain/admin.js`); o "não" nunca, para o
  painel abrir logo depois da configuração. Desligar o autenticador de uma conta leva até 5 minutos para valer.
- Se o Cognito não responder, a rota dá 500: o painel nunca abre sem conferir.
- Limite conhecido: um token emitido antes da configuração continua valendo até expirar (1 hora, o id token do
  painel). E quem tiver a senha de um admin que ainda não configurou poderia configurar
  o próprio celular: configure logo depois do `--admin`.

**Primeiro acesso** (site, `screens/MfaSetupScreen.tsx` e `lib/mfa.ts`): conta sem o autenticador entra só com a
senha, a API responde `ADMIN_MFA_REQUIRED` e o painel guia a configuração. O access token do login pela API do User
Pool sempre tem o escopo `aws.cognito.signin.user.admin`, e é com ele que o painel fala direto com o Cognito:
`AssociateSoftwareToken` (chave secreta), QR code gerado no navegador (nada sai dele), `VerifySoftwareToken`
(primeiro código de 6 dígitos) e `SetUserMFAPreference` (autenticador ligado e preferido). Depois disso o painel
confere o acesso de novo e abre; no próximo login, pede o código.

**Conta do painel separada.** Com o autenticador ligado, a conta não entra no app do Librax (o app ainda não pede o
código e mostra erro). Use uma conta de e-mail e senha só para o painel.

**Ambiente local:** o painel local entra pela mesma tela, com SRP pelo proxy do `cognito-idp` local. O moto só
confere o código do autenticador com uma chave fixa, igual para todas as contas (`MOTO_COGNITO_IDP_USER_POOL_ENABLE_TOTP`),
e sem ela aceita qualquer código; por isso o painel local não exige o segundo fator (`mfa: false` em
`services/api/local/functions.mjs`) e a conta admin da semente entra só com e-mail e senha.

### Tela de entrar

O painel tem tela de login própria, com a marca do Librax e em português (`screens/LoginScreen.tsx` e
`lib/auth.ts`), no lugar da página hospedada do Cognito (`auth.<domínio>`, que continua no ar para o Google do
app). Ela fala direto com a API do User Pool (`cognito-idp.<região>.amazonaws.com`), como o login de e-mail e senha
do app, sem biblioteca:

1. **E-mail e senha** por `USER_SRP_AUTH` (`lib/srp.ts`, a mesma conta do Amplify): a senha não sai do navegador.
   Sem link de cadastro (a conta é criada no app). Erros: "E-mail ou senha incorretos." (o mesmo para conta que não
   existe, com `PreventUserExistenceErrors`), "Muitas tentativas seguidas" (inclusive a trava de senha do Cognito)
   e "Sem conexão com o login".
2. **Código do autenticador** (desafio `SOFTWARE_TOKEN_MFA`): campo numérico com `autocomplete="one-time-code"`.
   Código errado limpa o campo e deixa tentar de novo com a mesma sessão. Se a sessão do desafio vencer (3 minutos
   no Cognito) ou já tiver sido usada, a tela volta para a senha com o aviso "O tempo para concluir o login acabou".
3. **Senha nova** (desafio `NEW_PASSWORD_REQUIRED`), só para conta criada por um admin da AWS com senha temporária:
   a tela pede a senha nova (mínimo de 8 caracteres) e segue o login.
4. **"Esqueci a senha"** abre o `/entrar` do app em outra aba (mesma origem, mesmo User Pool): lá, "Esqueci a
   senha" manda o código por e-mail e troca a senha. Depois é só voltar ao painel. Com o autenticador ligado, o app
   avisa que não conseguiu entrar depois da troca; a senha nova vale mesmo assim.

Tokens e saída:

- Id token e access token no `sessionStorage` (somem ao fechar a aba). O refresh token (12 horas) fica só na
  memória da aba: renova o id token enquanto o painel está aberto e some ao recarregar. Depois de recarregar, vale
  o id token guardado até vencer (1 hora); aí o painel pede login de novo. Nada disso vai na URL.
- **Sair** apaga tudo do navegador na hora e revoga no Cognito: `RevokeToken` com o refresh token ou, depois de
  recarregar a aba, `GlobalSignOut` com o access token (encerra as sessões da conta). Sem rede, só apaga; o id
  token já emitido vale até vencer (até 1 hora) para quem o tiver copiado.
- A CSP do painel só libera a própria origem e o `cognito-idp` da região (sem o domínio do login hospedado).

O app client do painel tem só `ALLOW_USER_SRP_AUTH` e `ALLOW_REFRESH_TOKEN_AUTH`, sem OAuth, callbacks nem Google, e
com a revogação de token ligada. A troca do login hospedado por este foi uma atualização no lugar do mesmo client
(mesmo `AdminClientId`; teste em `infra/test/cost-guards.test.ts`).

### Perdeu o celular do autenticador

Quem tem acesso à conta AWS desliga o autenticador da conta; no próximo acesso o painel pede a configuração de
novo:

```bash
aws cognito-idp admin-set-user-mfa-preference --user-pool-id "$POOL" --username <Username> \
  --software-token-mfa-settings Enabled=false,PreferredMfa=false
```

### Como dar acesso de admin a alguém

A pessoa precisa ter uma conta de **e-mail e senha** no Librax (conta do Google não passa no segundo fator) e,
de preferência, só para o painel. Depois, quem tem acesso à conta AWS:

```bash
POOL=<UserPoolId>            # output UserPoolId do CDK

# achar o nome de usuário pelo e-mail (com Google ele é algo como google_1234...)
aws cognito-idp list-users --user-pool-id "$POOL" --filter 'email = "pessoa@exemplo.com"' \
  --query 'Users[].Username' --output text

# colocar no grupo
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username <Username> --group-name admin

# conferir
aws cognito-idp admin-list-groups-for-user --user-pool-id "$POOL" --username <Username>
```

O grupo entra no id token na hora do login: a pessoa precisa **sair do painel e entrar de novo**. No primeiro
acesso o painel guia a configuração do aplicativo autenticador. Para tirar o acesso, `admin-remove-user-from-group`
com os mesmos parâmetros; o token que ela já tem vale até expirar (1 hora).

## 3. Como os números são guardados (sem Scan)

Abrir o painel nunca varre a tabela. Cada evento que já passa pelo servidor soma com `ADD` em poucos itens do
dia, e as telas leem só esses itens por chave ou por uma Query na partição `OPS`.

| Item | PK / SK | O que tem | TTL |
|---|---|---|---|
| Totais do dia | `OPS` / `DAY#<dia>` | `activeUsers`, `newAccounts`, `lessonsCompleted`, `practiceSessions`, `lessonAbandons` e, do job, `cloud` | 400 dias |
| Por lição | `OPS` / `DAY#<dia>#LESSON` | `done:`, `abandon:`, `attempted:`, `wrong:`, `failedSigns:`, `reviewedSigns:`, `placement:`, `placementUndo:` + id da lição | 400 dias |
| Por exercício | `OPS` / `DAY#<dia>#EXERCISE` | `attempted:`, `wrong:`, `abandon:` + tipo | 400 dias |
| Por sinal | `OPS` / `DAY#<dia>#SIGN` | `failed:` + id do sinal | 400 dias |
| Câmera | `OPS` / `DAY#<dia>#CAMERA` | `success:`, `skip:`, `attempts:` + id do sinal e `wrong:<id>:<rótulo>` | 400 dias |
| Semana | `OPS` / `WEEK#<AAAA-wSS>` | ativos, contas novas e lições | 800 dias |
| Mês | `OPS` / `MONTH#<AAAA-MM>` | ativos, contas novas e lições | sem TTL (12 itens por ano) |
| Custo | `OPS` / `COST#<AAAA-MM>` | total, projeção, gasto por serviço | sem TTL |
| Atividade | `USER#<id>` / `ACTIVITY` | último dia, semana e mês contados | sem TTL (sai com a conta) |
| Registro de squads | `SQUADINDEX` / `SQUAD#<criação>#<id>` | `squadId`, `createdAt` | sem TTL (sai ao dissolver) |

Escolhas e porquês:

- **Gravados nos usecases que já existem.** `completeLessonOnce` (que também serve a migração do convidado),
  `reviewSignsOnce` e o endpoint legado da lição somam depois de aplicar. O reenvio idempotente não soma de novo.
  O contador nunca derruba a lição (`quietly`: erro vai para o log). O modo local do app usa `completeLesson` e
  `reviewSigns`, que não chamam os contadores.
- **Ativo sem contar duas vezes.** O registro `ACTIVITY` guarda o último dia, semana e mês. A primeira atividade
  do dia grava com condição `lastDay < :dia` e `ReturnValues: UPDATED_OLD`, que diz se a semana e o mês também
  são novos. As outras lições do dia só leem o registro (0,5 RRU) e não escrevem nele.
- **Nomes planos** (`done:u1-l1`): o `ADD` do DynamoDB não cria mapa aninhado que ainda não existe.
- **Itens separados por assunto**: o `UpdateItem` cobra pelo tamanho do item; o de totais fica pequeno e o de
  lições (cerca de 5 KB com as 53 lições) só cresce até esse teto. O da câmera fica separado do `SIGN` pelo
  mesmo motivo: com as letras e os sinais com modelo e as trocas entre eles, deve ficar entre 3 e 8 KB por dia
  (de 3 a 8 WRU a mais por lição com câmera, só nas lições que têm câmera). Lição com muitos sinais divide o
  `ADD` em partes de 100 contadores (teto de 4 KB da expressão do DynamoDB).
- **Uma partição só.** Aguenta até 1.000 WRU por segundo, muito acima do piloto (cerca de 7 WRU por lição). Se
  um dia passar disso, o caminho é dividir em `OPS#<n>` e somar na leitura.
- **Squads**: o registro fica fora do META para o XP somado a cada lição não escrever nele de novo (o META já é
  projetado em dois GSIs).
- **Conteúdo** não toca o banco: é um arquivo gerado do mesmo `course.json` e `signs.json` do app, empacotado só
  na Lambda do painel. O teste `test/catalog.test.js` falha se ficar defasado.

### 3a. Dados de uso anônimos e notas (`TELAGG`, `TEL#`, `FBLIST`)

Via de mão única: o app manda (`POST /v1/telemetry`, rota pública, em lotes no fim da lição e quando sai da
tela), o servidor soma e nada volta. O progresso local continua guiando o curso; conta e migração do convidado
não mudam. Código anônimo próprio do navegador, separado da conta, do código do aparelho e do id local; sem nome,
e-mail, IP nem User-Agent. A pessoa desliga em Configurações (apaga a cópia pelo `DELETE /v1/telemetry/{id}`).

| Item | PK / SK | O que tem | TTL |
|---|---|---|---|
| Código | `TEL#<id>` / `META` | primeiro e último dia, contagem por evento, lições abertas e concluídas, marcos do funil, retrato e `hasAccount`; `rev` para a trava otimista | 12 meses depois do último lote |
| Nota | `TEL#<id>` / `FEEDBACK` | nota, comentário, lições, lição atual, conta sim ou não, versão, idioma e aparelho | 12 meses depois de enviada |
| Lista de notas | `FBLIST` e `FBLIST#R<n>` / `<ISO>#<aleatório>` | a mesma nota, sem o código, para listar da mais nova à mais velha e por estrela | 12 meses |
| Dia | `TELAGG` / `DAY#<dia>` | `active_guest`, `active_account`, `newIds`, `ev:<evento>`, `plat:<aparelho>:<como>`, `lang:`, `goal:`, prática, nivelamento, `fb_*`; na coorte: `f_open`, `ret1`, `ret7`, `f_onboarding`, `f_lesson1`, `f_lesson5`, `f_account` | 400 dias |
| Lição do dia | `TELAGG` / `DAY#<dia>#L#<lição>` | `open`, `done`, `abandon`, `sec`, `timed`, `score`, `at:<exercício>` | 400 dias |
| Semana e mês | `TELAGG` / `WEEK#`, `MONTH#` | ativos por tipo e `fb_*` | 800 dias e sem TTL |
| Alcance | `TELAGG` / `REACH` | `done:<lição>`: códigos que já concluíram a lição | sem TTL (1 item) |
| Notas no total | `TELAGG` / `FEEDBACK` | `fb_n`, `fb_sum`, `fb_r1`..`fb_r5` | sem TTL (1 item) |

O TTL é o atributo `expiresAt` que a tabela já usa (nenhuma mudança na tabela). Cada lote faz 1 leitura e 1
`PutItem` condicional no código (trava otimista: dois lotes ao mesmo tempo do mesmo aparelho não contam duas
vezes) e de 1 a 4 `ADD` pequenos (1 WRU cada); a tela lê uma Query na faixa de 38 dias, duas nas semanas e meses e
duas leituras por chave. A Lambda pública `librax-telemetry` só pode ler e gravar as chaves `TEL#*`, `TELAGG` e
`FBLIST*` (`dynamodb:LeadingKeys`).

### Telemetria nova no app

Para "onde erram ou desistem" o app passou a mandar duas coisas, só com conta:

- `exerciseStats` na conclusão (`POST /v1/lesson/complete` e na migração): respostas e erros por tipo de
  exercício. Formato errado é descartado sem recusar a conclusão.
- `POST /v1/lesson/abandon` ao confirmar "Sair da lição?": lição, exercício onde parou, quantos a lição tem e o
  dia. Sem fila offline: sem rede, não manda.
- `cameraStats` na conclusão (e na migração): o desempenho da câmera só daquela lição, por sinal (acertos,
  pulos, tentativas e leituras de outro sinal). O app junta na lição as vezes que os exercícios de câmera
  fecham (`onCameraRun` em `apps/web-poc/src/lib/cameraStats.ts`), guarda com a lição em andamento e manda
  pela fila offline com a conclusão: sem rede, vai quando a rede volta; sem conta, fica na fila e vai na
  migração, ao entrar. O acumulado do aparelho nunca é enviado. O servidor só aceita sinais e glosas do curso
  (formato no `services/api/README.md`) e grava só a soma do dia, sem id de pessoa.
- Marcas do teste de nivelamento (`placement: 'skip'` ou `'undo'`, sem nota) pela mesma fila das conclusões
  (`POST /v1/lesson/complete` e na migração): cada lição pulada e cada lição reaberta pelo "Desfazer". O
  servidor grava o progresso como `status: 'placement'` (só se a lição ainda não tem registro; nunca cobre
  conclusão de verdade), apaga no `undo` só se ainda for marca, e soma `placement:` / `placementUndo:` no item
  da lição do dia (`services/api/src/usecases/placement.js`).

## 4. Job diário e custo

A Lambda `librax-ops-daily` roda todo dia às 03:30 UTC (00:30 em Brasília) pelo EventBridge Scheduler, sem nova
tentativa (cada uma pagaria o Cost Explorer de novo; o alarme de erros avisa se falhar):

1. **CloudWatch** (`GetMetricData`, período de 1 hora somado no dia de Brasília): 5xx, 4xx e contagem da API,
   erros de cada Lambda, throttling das Lambdas e do DynamoDB. Grava em `DAY#<ontem>` como `cloud`.
2. **Cost Explorer** (`GetCostAndUsage`, `UnblendedCost` por serviço, do dia 1 até hoje): uma chamada, US$ 0,01.
   A estimativa do mês é a projeção linear do gasto até ontem, não a previsão paga (`GetCostForecast`, mais
   US$ 0,01 por dia). No dia 1, consulta o mês que acabou inteiro e o marca como fechado.

As duas partes são independentes e regravam o mesmo item (rodar de novo não soma nada). Para refazer um dia:
invocar com `{ "day": "2026-10-22" }`; para não pagar o Cost Explorer: `{ "skipCost": true }`.

O Cost Explorer precisa ser ativado uma vez na conta (console de Billing, "Cost Explorer"); os dados aparecem
cerca de 24 horas depois.

## 5. Alertas da nuvem

Tópico SNS `librax-alarms` com assinatura por e-mail (`-c librax:alarmEmail=<e-mail>`; o e-mail nunca fica no
código). A AWS manda um e-mail de confirmação: sem clicar nele, nada chega. Cada alarme avisa ao disparar e ao
voltar ao normal.

| Alarme | Métrica | Dispara com |
|---|---|---|
| `librax-lambda-errors` | `AWS/Lambda Errors` de todas as funções | 1 ou mais em 5 min |
| `librax-lambda-throttles` | `AWS/Lambda Throttles` | 1 ou mais em 5 min |
| `librax-api-lambda-duration` | p95 da `IntegrationLatency` do estágio `api` (duração das Lambdas da API) | acima de 5 s em 2 de 3 períodos de 5 min |
| `librax-api-5xx` | `5xx` do estágio `api` | 3 ou mais em 5 min |
| `librax-close-league-duration`, `librax-reminders-duration`, `librax-ops-daily-duration` | duração máxima do job | acima de 80% do timeout |
| `librax-dynamodb-throttles` | `ReadThrottleEvents + WriteThrottleEvents` da tabela (inclui o teto de 500 leituras e 200 escritas por segundo) | 1 ou mais em 5 min |
| `librax-app-download` | `AWS/CloudFront BytesDownloaded` do CloudFront do app (`Region=Global`) | mais de 5 GB em 1 hora (`librax:appDownloadAlarmGbPerHour`) |

São 9 alarmes e 10 métricas, no limite dos 10 alarmes grátis do CloudWatch: um alarme novo passa a custar cerca de
US$ 0,10 por mês. Por isso erros e duração das Lambdas
são agregados (um alarme por função seriam uns 30, cerca de US$ 3 por mês); o detalhe por função fica no painel.
Os handlers da API devolvem 500 em erro não tratado sem falhar a Lambda, então esse caso aparece no alarme de
5xx, e o de erros das Lambdas pega quedas, timeouts e jobs.

**AWS Budget** `librax-mensal-<resumo>`: custo real do mês, aviso por e-mail ao passar de 80% e de 100% do valor
de `librax:monthlyBudgetUsd` (padrão 10 dólares) e quando a previsão do mês passa de 100%. O e-mail é
`librax:budgetEmail` ou, sem ele, o dos alarmes; sem nenhum e-mail o orçamento não é criado (e o synth avisa). O
nome leva um resumo dos avisos e do e-mail: o CloudFormation só troca os avisos recriando o orçamento, e com nome
fixo o deploy travaria; com o resumo, ele cria o novo e apaga o velho.

**Anomalia de custo** (`librax:costAnomalyAlerts`, desligada por padrão): resumo diário por e-mail das anomalias
acima de 20% do orçamento. `create` cria o monitor de serviços; um ARN usa o monitor que a conta já tem (só cabe
um por conta). O script de lançamento escolhe sozinho, só lendo a conta ([`lancamento.md`](lancamento.md#travas-de-custo)).

```bash
npx cdk synth -c librax:alarmEmail=alertas@<domínio> -c librax:monthlyBudgetUsd=15
```

## 6. Publicar o painel

Outputs do CDK usados: `UserPoolId`, `AdminClientId`, `AdminBucketName`, `AdminUrl`.

```bash
cd apps/admin-web
cp .env.example .env.local      # VITE_COGNITO_USER_POOL_ID e VITE_COGNITO_CLIENT_ID
npm ci && npm run build
aws s3 sync dist s3://<AdminBucketName>/admin --delete
```

O painel tem bucket próprio: o `s3 sync --delete` do app não apaga o painel, e o do painel não apaga o app.
O CloudFront serve `/admin/assets/*` com cache imutável e `/admin` e `/admin/*` sem cache, com o `index.html` do
painel para as rotas sem extensão, CSP sem terceiros, `frame-ancestors 'none'` e `X-Robots-Tag: noindex`. Fontes e
favicon vêm do próprio app, na mesma origem.

Desenvolvimento:

- `npm run dev:mock`: o painel inteiro com dados de exemplo, sem AWS (porta 5310). Abre já dentro; "Sair" ou
  `/admin/?entrar` mostram a tela de entrar com um login de mentira (as senhas e os códigos que simulam cada erro
  estão em `src/dev/mock.ts`).
- `npm run dev:local`: contra o ambiente local que simula a AWS, com login de verdade (SRP pelo proxy local) e os
  dados da semente (porta 5321). Ver [`docs/ambiente-local.md`](ambiente-local.md).
- `LIBRAX_API_ORIGIN=https://app.<domínio> npm run dev`: contra a API de verdade, com `VITE_COGNITO_USER_POOL_ID` e
  `VITE_COGNITO_CLIENT_ID` no `.env.local`. O login fala direto com o `cognito-idp` (sem callback nem domínio);
  `-c librax:extraCorsOrigins=http://localhost:5310` continua valendo para a API.

## 7. Custo extra estimado por mês

Preços de us-east-1, sem contar o free tier da conta nova, a não ser onde ele é permanente.

| Item | Conta | Por mês |
|---|---|---|
| Cost Explorer | 1 chamada por dia, US$ 0,01 cada | US$ 0,31 |
| CloudWatch `GetMetricData` | cerca de 35 métricas por dia (US$ 0,01 por mil) | US$ 0,01 |
| Alarmes do CloudWatch | 9 métricas, dentro dos 10 grátis permanentes | US$ 0 (até US$ 0,90 se a conta já usa os grátis) |
| SNS por e-mail | 1.000 e-mails por mês grátis | US$ 0 |
| AWS Budget | orçamento sem ações não é cobrado | US$ 0 |
| DynamoDB | cerca de 7 WRU e 0,5 RRU a mais por lição (US$ 0,625 por milhão de WRU) | US$ 0,05 com 10 mil lições; US$ 0,45 com 100 mil |
| Lambda | job diário, painel, saída da lição e gatilho de conta nova: poucos milhares de execuções | US$ 0 (dentro do free tier permanente de 1 milhão) |
| S3, CloudFront e logs do painel | menos de 1 MB de site e poucos acessos | menos de US$ 0,05 |
| Cognito | quem é admin já é usuário do app; o client novo não cobra | US$ 0 |

**Total: cerca de US$ 0,40 por mês no piloto**, chegando perto de US$ 1,70 com 100 mil lições por mês numa conta
que já gaste os 10 alarmes grátis. O maior item fixo é o Cost Explorer.

**Dados de uso anônimos e notas, com 10 mil pessoas por dia e 3 lições cada** (cerca de 5 lotes por pessoa por
dia, 1,5 milhão de chamadas por mês):

| Item | Conta | Por mês |
|---|---|---|
| API Gateway (HTTP API) | 1,5 milhão de chamadas, US$ 1 por milhão | US$ 1,50 |
| Lambda `librax-telemetry` | 1,5 milhão de execuções de cerca de 40 ms em 256 MB ARM | US$ 0,50 (menos com o free tier) |
| DynamoDB escrita | cerca de 20 WRU por pessoa por dia (lote do fim da lição: 2 do código, 1 do dia, 1 da lição; lote ao sair: 3), 6 milhões de WRU | US$ 3,70 |
| DynamoDB leitura e armazenamento | 0,5 RRU por lote; cerca de 1,5 KB por código ativo nos últimos 12 meses | US$ 0,15 |
| Logs da Lambda | cerca de 0,5 GB por mês | US$ 0,25 |

**Cerca de US$ 6 por mês nessa escala**, proporcional ao uso (US$ 0,60 com mil pessoas por dia). As notas são
poucas e não mudam a conta.

## 8. Segunda etapa (ações que mudam dados, não implementadas)

Ficam para depois, cada uma com confirmação na tela (diálogo de ação destrutiva do design system), registro de
quem fez e teste do 403:

1. **Validar sinal**: marcar `validated` e quem validou (consultor surdo), trocar `status` de `rascunho` para
   `validado`. Pede mover a fonte da verdade do conteúdo do bundle do app para o bucket de conteúdo
   (`content/<curso>/v<N>/`), com versão nova a cada publicação, já que hoje os sinais estão no código.
2. **Excluir conta (LGPD) pelo painel**: a própria pessoa já exclui a conta pelo app (`DELETE /v1/users/me`,
   `usecases/deleteAccount.js`: partição `USER#<id>`, squads e ligas com o `memberCount` certo e o usuário no
   Cognito; ver `services/api/README.md`). Pelo painel falta o caminho de admin (outra conta, com registro do
   pedido), fila ou Step Functions para contas grandes e um prazo de arrependimento.
3. **Moderar squad**: renomear, tirar membro, dissolver (os usecases de squad já existem, falta o caminho de
   admin sem ser membro) e ver denúncias.
4. Também para depois: dar e tirar o grupo admin pela própria tela, exportar os números em CSV e um aviso no
   painel quando o job diário não rodou.
