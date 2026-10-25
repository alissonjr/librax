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
| Job diário (CloudWatch e Cost Explorer) | `services/api/src/handlers/opsDaily.js` e `usecases/collectDailyOps.js` |
| Infra (bucket, rotas, grupo, alarmes, orçamento) | `infra/lib/librax-stack.ts` |

## 1. O que cada tela mostra

| Tela | O que tem | De onde vem |
|---|---|---|
| **Operação** | pessoas ativas por dia (30 dias), semana (12) e mês (12); contas novas; lições concluídas; lições onde mais desistem e mais erram; erros por tipo de exercício; sinais mais errados; erros do servidor por dia e por Lambda | contadores agregados (seção 3) e o job diário |
| **Conteúdo** | as 14 unidades e os 254 sinais: validado (`validated`), origem (`source`), vídeo, avatar e o que falta em cada sinal, com filtros | `services/api/src/content/contentStatus.js`, gerado do bundle do app por `npm run catalog` |
| **Contas** | busca pelo começo do e-mail ou pelo id; resumo com perfil, progresso, liga, squads e última atividade | Cognito (`ListUsers`) e a partição `USER#<id>` |
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

Limites conhecidos: o convidado joga 100% no aparelho e só entra nos números quando cria conta (a migração
soma as lições dele nos dias em que foram feitas). Para análise de produto mais fina continua valendo o PostHog
via proxy previsto na fase W4.

## 2. Acesso: duas travas

1. **Autorizador próprio.** O painel tem um app client só dele no Cognito (`librax-admin`, código com PKCE,
   callbacks em `/admin/auth/callback`). As rotas `/v1/admin/*` usam um autorizador JWT que só aceita o id token
   desse client: o token do app não abre o painel.
2. **Grupo no token.** Cada rota confere `cognito:groups` no token e responde **403 `ADMIN_ONLY`** para quem não
   está no grupo `admin` (`requireAdmin` em `handlers/_http.js`). O site esconde as telas, mas quem decide é a API.

A Lambda do painel só **lê** a tabela (`grantReadData`) e só pode chamar `cognito-idp:ListUsers` no User Pool
do Librax. Cada acesso vai para o log com o sub de quem consultou e a rota (trilha para a LGPD), sem o termo
buscado.

### Como dar acesso de admin a alguém

A pessoa precisa ter conta no Librax (e-mail ou Google). Depois, quem tem acesso à conta AWS:

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

O grupo entra no id token na hora do login: a pessoa precisa **sair do painel e entrar de novo**. Para tirar o
acesso, `admin-remove-user-from-group` com os mesmos parâmetros; o token que ela já tem vale até expirar (1 hora).

## 3. Como os números são guardados (sem Scan)

Abrir o painel nunca varre a tabela. Cada evento que já passa pelo servidor soma com `ADD` em poucos itens do
dia, e as telas leem só esses itens por chave ou por uma Query na partição `OPS`.

| Item | PK / SK | O que tem | TTL |
|---|---|---|---|
| Totais do dia | `OPS` / `DAY#<dia>` | `activeUsers`, `newAccounts`, `lessonsCompleted`, `practiceSessions`, `lessonAbandons` e, do job, `cloud` | 400 dias |
| Por lição | `OPS` / `DAY#<dia>#LESSON` | `done:`, `abandon:`, `attempted:`, `wrong:`, `failedSigns:`, `reviewedSigns:` + id da lição | 400 dias |
| Por exercício | `OPS` / `DAY#<dia>#EXERCISE` | `attempted:`, `wrong:`, `abandon:` + tipo | 400 dias |
| Por sinal | `OPS` / `DAY#<dia>#SIGN` | `failed:` + id do sinal | 400 dias |
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
  lições (cerca de 5 KB com as 53 lições) só cresce até esse teto.
- **Uma partição só.** Aguenta até 1.000 WRU por segundo, muito acima do piloto (cerca de 7 WRU por lição). Se
  um dia passar disso, o caminho é dividir em `OPS#<n>` e somar na leitura.
- **Squads**: o registro fica fora do META para o XP somado a cada lição não escrever nele de novo (o META já é
  projetado em dois GSIs).
- **Conteúdo** não toca o banco: é um arquivo gerado do mesmo `course.json` e `signs.json` do app, empacotado só
  na Lambda do painel. O teste `test/catalog.test.js` falha se ficar defasado.

### Telemetria nova no app

Para "onde erram ou desistem" o app passou a mandar duas coisas, só com conta:

- `exerciseStats` na conclusão (`POST /v1/lesson/complete` e na migração): respostas e erros por tipo de
  exercício. Formato errado é descartado sem recusar a conclusão.
- `POST /v1/lesson/abandon` ao confirmar "Sair da lição?": lição, exercício onde parou, quantos a lição tem e o
  dia. Sem fila offline: sem rede, não manda.

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
| `librax-dynamodb-throttles` | `ReadThrottleEvents + WriteThrottleEvents` da tabela | 1 ou mais em 5 min |

São 8 alarmes e 9 métricas, dentro dos 10 alarmes grátis do CloudWatch. Por isso erros e duração das Lambdas
são agregados (um alarme por função seriam uns 30, cerca de US$ 3 por mês); o detalhe por função fica no painel.
Os handlers da API devolvem 500 em erro não tratado sem falhar a Lambda, então esse caso aparece no alarme de
5xx, e o de erros das Lambdas pega quedas, timeouts e jobs.

**AWS Budget** `librax-mensal`: custo real do mês, aviso por e-mail ao passar de 80% e de 100% do valor de
`librax:monthlyBudgetUsd` (padrão 10 dólares). O e-mail é `librax:budgetEmail` ou, sem ele, o dos alarmes; sem
nenhum e-mail o orçamento não é criado (e o synth avisa).

```bash
npx cdk synth -c librax:alarmEmail=alertas@<domínio> -c librax:monthlyBudgetUsd=15
```

## 6. Publicar o painel

Outputs do CDK usados: `AuthDomain`, `AdminClientId`, `AdminBucketName`, `AdminUrl`.

```bash
cd apps/admin-web
cp .env.example .env.local      # VITE_COGNITO_DOMAIN e VITE_COGNITO_CLIENT_ID
npm ci && npm run build
aws s3 sync dist s3://<AdminBucketName>/admin --delete
```

O painel tem bucket próprio: o `s3 sync --delete` do app não apaga o painel, e o do painel não apaga o app.
O CloudFront serve `/admin/assets/*` com cache imutável e `/admin` e `/admin/*` sem cache, com o `index.html` do
painel para as rotas sem extensão, CSP sem terceiros, `frame-ancestors 'none'` e `X-Robots-Tag: noindex`. Fontes e
favicon vêm do próprio app, na mesma origem.

Desenvolvimento:

- `npm run dev:mock`: o painel inteiro com dados de exemplo, sem AWS e sem login (porta 5310).
- `npm run dev:local`: contra o ambiente local que simula a AWS, com login de verdade (PKCE na página local) e os
  dados da semente (porta 5321). Ver [`docs/ambiente-local.md`](ambiente-local.md).
- `LIBRAX_API_ORIGIN=https://app.<domínio> npm run dev`: contra a API de verdade. Precisa do callback de dev no
  client do painel: `-c librax:extraAdminCallbackUrls=http://localhost:5310/admin/auth/callback`,
  `-c librax:extraAdminLogoutUrls=http://localhost:5310/admin/` e `-c librax:extraCorsOrigins=http://localhost:5310`.

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
