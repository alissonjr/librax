# Ambiente local (AWS simulada na máquina)

Um ambiente que roda inteiro no computador para testar a API, o login e o banco de ponta a ponta, com o app e
o painel usando dados locais de verdade. **Nenhuma chamada vai para a AWS**: o DynamoDB e o Cognito são
simulados em containers, o resto é o código de produção ou um falso explícito.

A fonte única é a infra: o bootstrap sintetiza a `LibraxStack` (`infra/lib/librax-stack.ts`) no próprio
processo e tira do template a tabela, o User Pool, os clients, o grupo, as rotas, os autorizadores e os jobs.
Rota nova na infra aparece sozinha no servidor local; rota sem handler local faz o servidor recusar subir.

## 1. Subir

Precisa de Docker (com `docker compose`), Node 20 ou mais novo, `openssl` e as dependências instaladas
(`npm ci` em `services/api`, `infra`, `apps/web-poc` e `apps/admin-web`). As imagens usadas são
`amazon/dynamodb-local:3.3.1` e `motoserver/moto:5.2.4`.

```bash
cd services/api
npm run local:up        # containers, template da infra, bootstrap e semente (idempotente)
npm run local           # API, Cognito local e página de login (deixe este terminal aberto)

cd apps/web-poc   && npm run dev:local   # app em http://127.0.0.1:5320/
cd apps/admin-web && npm run dev:local   # painel em http://127.0.0.1:5321/admin/
```

Na primeira vez, abra <https://127.0.0.1:5333/> e aceite o aviso de certificado: a página de login local é
HTTPS com certificado autoassinado, porque o Amplify do app monta `https://<domínio>/oauth2/...` fixo. O painel
não usa essa página: entra pela própria tela, com SRP pelo proxy do `cognito-idp` (porta 5332).

| Comando (em `services/api`) | O que faz |
|---|---|
| `npm run local:up` | sobe os containers, sintetiza o template (só se a infra mudou), cria o que falta e roda a semente |
| `npm run local` | API (`/api/v1/...`), proxy do Cognito e página de login |
| `npm run local:down` | para os containers **sem apagar** os dados; o próximo `local:up` volta de onde parou |
| `npm run local:reset` | para e **apaga** os dados (volumes, verificadores SRP, ids e `.env` do Vite) |
| `npm run local:jobs` | roda agora os jobs do Scheduler: `-- close-league`, `-- ops-daily`, `-- reminders` (sem nome, todos) |
| `npm run local:status` | containers e memória |
| `npm run test:e2e` | teste de ponta a ponta (seção 6) |

Os jobs aceitam o mesmo evento da Lambda: `npm run local:jobs -- ops-daily --event '{"day":"2026-10-22"}'` ou
`npm run local:jobs -- close-league --event '{"periodStart":"2026-10-19"}'`.

O modo local do Vite (`--mode ambiente-local`) lê as `VITE_*` de `infra/local/.data/env/`, geradas pelo
bootstrap, e nunca o `.env.local` (que é o da AWS de verdade). O `/api` vai para a API local pelo proxy do Vite.

## 2. Contas de teste

Senhas só de desenvolvimento, criadas pela semente (`services/api/local/config.mjs`).

| Conta | Senha | Para quê |
|---|---|---|
| `aluno@librax.example` | `aluno-local-123` | conta comum: progresso de duas semanas, liga, squad e inscrição de Web Push |
| `admin@librax.example` | `admin-local-123` | grupo `admin`: abre o painel |
| `bia@`, `caio@`, `davi@`, `eva@`, `fabi@librax.example` | `figurante-local-123` | dão vida às ligas, às squads e aos números do painel |

- **Cadastro**: pelo app (Amplify) ou pela página de login. O código de confirmação aparece no terminal do
  `npm run local`, na caixa simulada <https://127.0.0.1:5333/caixa> e, no cadastro pela página, na própria tela.
- **Esqueci a senha**: pelo app ("Esqueci a senha" em Entrar) ou pela página de login. O código aparece no
  terminal e na caixa simulada (assunto "nova senha") e, pela página, na própria tela. A senha nova passa a valer
  no SRP do app na hora. E-mail sem conta, conta do Google simulado e conta não confirmada recebem a mesma
  resposta de "código enviado", sem código nenhum, como no Cognito com `PreventUserExistenceErrors`. Depois de 5
  pedidos de código ou 5 códigos errados na mesma hora, a conta recebe `LimitExceededException` até a janela
  passar, trocar a senha ou reiniciar o `npm run local`. Se trocar a senha de uma conta de teste, a tabela acima
  deixa de valer para ela até trocar de volta.
- **Google (simulado)**: botão na página de login (e o "Continuar com Google" do app). Na primeira vez cria a
  conta com o e-mail e o nome informados e dispara o PostConfirmation, como o primeiro login social.
- O `sub` das contas é o mesmo a cada `local:reset` (o moto usa uma semente fixa).

## 3. Portas

Tudo em `127.0.0.1`. As portas 5300 e 5310 são do dono (dev do app e do painel) e não são usadas.

| Porta | O quê |
|---|---|
| 5320 | app (`apps/web-poc`, `npm run dev:local`) |
| 5321 | painel (`apps/admin-web`, `npm run dev:local`), em `/admin/` |
| 5330 | DynamoDB Local (container) |
| 5331 | moto, só o `cognito-idp` (container) |
| 5332 | API local (`/api/v1/...`) e proxy do `cognito-idp` (`POST /` com `X-Amz-Target`) |
| 5333 | página que imita o Hosted UI do Cognito (HTTPS) |

## 4. O que é real e o que é simulado

| Parte | No ambiente local |
|---|---|
| Handlers, usecases e domínio da API | **reais**: as fábricas `make*Handlers` com o `DynamoRepo` e o catálogo empacotado |
| `DynamoRepo` e `CognitoDirectory` | **reais** (AWS SDK v3), apontados para o DynamoDB Local e o moto |
| Tabela `librax` | DynamoDB Local, com as 6 GSIs e o TTL do template |
| Login do app (SRP, cadastro, confirmação, esqueci a senha, OAuth com PKCE) | código **real** do Amplify, contra o proxy local e a página local |
| Login do painel (tela própria, SRP) | código **real** do `apps/admin-web/src/lib/auth.ts`, contra o proxy local; sem o segundo fator (aplicativo autenticador): o moto só confere o código com uma chave fixa para todas as contas, então a Lambda do painel roda com `mfa: false` (`local/functions.mjs`) |
| User Pool, clients, grupo `admin`, tokens e JWKS | moto, criados a partir do template |
| O que o moto não faz como o Cognito | proxy local: confere a senha no SRP, gera e confere o código de confirmação e o da nova senha (com a política de senha do template e o limite de tentativas), roda o PostConfirmation, responde o `RevokeToken`, aplica os `ExplicitAuthFlows` do client e o `PreventUserExistenceErrors`, e no `AdminDeleteUser` apaga também o verificador SRP (refresh de conta excluída vira `NotAuthorizedException`, como no Cognito) |
| Hosted UI e Google | página local no visual do Traço; o Google é simulado |
| API Gateway | imitação local: estágio `api`, rotas, autorizador JWT com as regras da HTTP API (inclusive `/v1/admin` só com o client do painel), CORS do template, evento 2.0 |
| CloudFront | o proxy de `/api` do Vite |
| EventBridge Scheduler | não roda sozinho: `npm run local:jobs` |
| CloudWatch e Cost Explorer (job diário) | **falsos** explícitos (`local/fakes.mjs`), números estáveis por dia |
| Web Push (lembretes) | **falso**: só registra no terminal o que seria enviado |
| SES, Budgets, alarmes e SNS | não existem aqui (o e-mail de lembrete está desligado na infra; o resto é só infra) |

Trava: `services/api/local/awsGuard.mjs` põe credenciais falsas fixas, ignora `~/.aws` e `AWS_PROFILE`, aponta
todo serviço para o moto e o DynamoDB para o DynamoDB Local, e faz `http`, `https`, `fetch` e `dns` recusarem
`*.amazonaws.com` e `*.amazoncognito.com`. O synth roda no próprio processo, sem a CLI do CDK.

### Semente

Gerada pelas mesmas fábricas e usecases da API, com o relógio do servidor no dia de cada evento: 7 contas, cerca
de 60 lições nas duas últimas semanas (com `exerciseStats`, desempenho da câmera nas letras e sinais revisados), práticas, saídas no meio da
lição, duas squads, o fechamento das ligas da semana passada (o job `librax-close-league`) e o job diário do
painel nos últimos 14 dias. Só roda a atividade se nenhuma conta da semente tem perfil na tabela; para recomeçar
do zero, `npm run local:reset` e `npm run local:up`.

## 5. Diferenças para a AWS

- **Persistência do Cognito.** O moto guarda tudo em memória. O `local:up` repete a gravação de pedidos que
  fica no volume (`MOTO_ENABLE_RECORDING`); o primeiro pedido gravado é a semente do gerador, então os ids e o
  `sub` voltam iguais. A gravação cresce com o uso (cada login entra nela). Refresh tokens e a sessão da página
  de login não sobrevivem a um `local:down`: é preciso entrar de novo. A data de criação das contas vira a do
  replay.
- **Senha no SRP.** O verificador fica em `infra/local/.data/srp.json`, gravado quando a senha passa pelo
  ambiente local (semente, cadastro, troca e recuperação de senha) e apagado na exclusão da conta. Conta criada
  direto no moto, sem passar por ele, não entra por e-mail e senha no app.
- **Exclusão de conta.** A Lambda de `DELETE /v1/users/me` chama o `AdminDeleteUser` pelo proxy do
  `cognito-idp` (o mesmo endereço do app), não direto no moto, para o verificador SRP sair junto. O id token de
  quem excluiu continua valendo até expirar, como no API Gateway; o app sai da conta logo depois. Rota nova na
  infra só aparece aqui depois de um `npm run local:up` (que sintetiza o template de novo).
- **Tokens.** Mesmo formato do Cognito, assinados com a chave fixa do moto (`kid` "dummy"). O `iss` é o
  endereço real (`https://cognito-idp.us-east-1.amazonaws.com/<pool>`); o autorizador só compara o texto e
  busca as chaves no moto. O `email_verified` vem como texto `"true"` (no Cognito, booleano); a API aceita os
  dois. Os atributos no id token dependem do `ReadAttributes` do client, que o bootstrap preenche (o Cognito
  libera todos quando ele falta; o moto, nenhum).
- **Google.** Não há Google: o botão cria ou reusa uma conta com `identities` do Google. No Cognito, entrar com
  Google usando um e-mail que já tem senha cria outra conta (`google_...`); aqui a página recusa e pede outro
  e-mail.
- **Página de login.** Imita o comportamento do Hosted UI (callbacks e logouts do client, PKCE S256, `state`,
  sessão lembrada), não o visual. A sessão lembrada é por client; no Cognito ela vale para o domínio todo.
- **E-mails.** Nada é enviado: códigos no terminal e na caixa simulada. Na AWS, sem SES configurado no User Pool,
  os códigos de cadastro e de nova senha saem pelo envio padrão do Cognito, com cota diária baixa (50 por dia na
  cota padrão); aqui não há esse limite.
- **Limites do esqueci a senha.** O Cognito não publica os números exatos; os do proxy (5 pedidos e 5 códigos
  errados por conta, por hora) só servem para a mensagem de "muitas tentativas" aparecer.
- **API Gateway.** Sem throttling (50/100 do estágio), sem limite de tempo e memória das Lambdas, sem cold
  start. Erro não tratado vira 500 como na AWS. O CORS do proxy do Cognito é `*`.
- **CloudFront.** Sem os cabeçalhos de segurança, a CSP e o cache da distribuição: o Vite serve o app.
- **Plano Lite.** O moto não tem planos do User Pool; o `UserPoolTier` do template é ignorado.
- **Avisos.** O AWS SDK avisa que versões futuras vão pedir Node 22; com Node 20 é só aviso.

## 6. Teste de ponta a ponta

```bash
cd services/api
npm run local:up
npm run test:e2e
```

Fica fora do `npm test` (as suítes normais rodam sem containers). Usa o servidor local se ele estiver no ar, ou
sobe um no próprio processo. O teste (`services/api/e2e/local.e2e.mjs`):

1. faz login pela página local com PKCE S256 (authorize, formulário, code, token), confere o `state`, que o code
   não troca com o verifier errado nem duas vezes, a senha errada e o callback fora da lista;
2. conclui uma lição pela API e confere no DynamoDB Local a tentativa (`ATTEMPT#`) e o XP do perfil; reenvio não
   soma de novo; sem token ou com token adulterado, 401;
3. entra no client do painel por SRP pelo proxy (como a tela do painel), renova pelo refresh token e chama
   `/v1/admin` com a conta admin (200), com a comum (403 `ADMIN_ONLY`) e com o token do app (401); o client do
   painel não abre a página de login local (sem callback);
4. entra por SRP pelo proxy do `cognito-idp`: senha certa entra, errada não; `USER_PASSWORD_AUTH` é recusado
   pelo client do app;
5. troca a senha do aluno pelo esqueci a senha (código lido da caixa simulada), confere que o SRP aceita a nova e
   recusa a antiga e volta para a senha documentada; e-mail sem conta recebe a mesma resposta de "código enviado".
6. cria uma conta nova de e-mail e senha (cadastro pela página local) e uma do Google simulado, conclui uma lição
   e cria uma squad com cada uma, e exclui com `DELETE /v1/users/me`: a partição `USER#<id>`, os membros de liga e
   a squad somem do DynamoDB Local, o usuário some do moto, a senha e o refresh token não entram mais e repetir a
   exclusão responde 200. As contas da semente não são tocadas.

## 7. Memória

Medido com tudo ligado e depois dos logins (containers, servidor local e os dois Vite): DynamoDB Local cerca de
275 MB (limite de 384 MB, heap de 192 MB), moto cerca de 90 MB (limite de 256 MB), servidor local cerca de 80 MB e
cada Vite cerca de 100 MB. No total, uns 650 MB. O synth do template, só quando a infra muda, usa memória por
alguns segundos.

## 8. Arquivos

| Onde | O quê |
|---|---|
| `infra/local/docker-compose.yml` | projeto `librax-local`: DynamoDB Local e moto, portas em 127.0.0.1, memória limitada |
| `infra/local/synth.ts` | template da stack com os endereços locais no contexto (`librax:extra*`) |
| `infra/local/.data/` | gerado e fora do git: template, ids, verificadores SRP, `.env` do Vite, certificado |
| `services/api/local/cli.mjs` | `local:up`, `local:down`, `local:reset`, `local:jobs`, `local:status` |
| `services/api/local/template.mjs` | plano tirado do template |
| `services/api/local/bootstrap.mjs` e `seed.mjs` | criação idempotente e semente |
| `services/api/local/server.mjs` | `npm run local` |
| `services/api/local/apiGateway.mjs` e `jwt.mjs` | HTTP API e autorizador JWT |
| `services/api/local/cognitoProxy.mjs`, `cognitoLocal.mjs` e `srp.mjs` | o que o moto não faz como o Cognito |
| `services/api/local/hostedUi.mjs` | página de login local |
| `services/api/local/functions.mjs` e `fakes.mjs` | Lambdas pelas fábricas e os falsos |
| `services/api/local/awsGuard.mjs` | trava contra chamada à AWS |
