# Lançamento do Librax em librax.online

Passo a passo para colocar o Librax no ar a partir do zero, tudo pelo navegador: o domínio fica na GoDaddy, o DNS
no Route 53 e o lançamento roda no AWS CloudShell (o terminal que abre dentro do console da AWS). Nada precisa ser
instalado no seu computador.

No fim, ficam no ar:

| Endereço | O que é |
|---|---|
| `https://librax.online` | landing (português, inglês e espanhol) |
| `https://www.librax.online` | redireciona para `https://librax.online` |
| `https://app.librax.online` | o app |
| `https://app.librax.online/admin/` | painel de administração (só para o grupo `admin`) |
| `https://auth.librax.online` | página de login do Cognito (usada pelo app) |

Tempo: cerca de 1 hora de trabalho, mais a espera do DNS (de minutos a algumas horas). O primeiro lançamento sai
com o login por e-mail e senha; o login com Google, os lembretes por e-mail, as notificações (Web Push) e o envio
dos códigos do login pelo SES ficam desligados e podem ser ligados depois (seção
[Depois do lançamento](#depois-do-lançamento)).

## Passo 1. Conta AWS e região

1. Entre no console da AWS com um usuário que tenha `AdministratorAccess` (o primeiro lançamento cria papéis do
   IAM). Não use o usuário raiz no dia a dia; o login pelo IAM Identity Center está em
   [`conta-aws.md`](conta-aws.md).
2. No seletor de região (canto superior direito), escolha **Leste dos EUA (Norte da Virgínia) us-east-1**. O
   Librax inteiro fica nessa região, porque o certificado do CloudFront e o do login precisam estar lá.
3. Anote o número da conta (12 dígitos, no menu com o seu nome). O script pede esse número e se recusa a
   publicar em qualquer outra conta.

## Passo 2. Zona hospedada no Route 53

1. Console > **Route 53** > **Zonas hospedadas** > **Criar zona hospedada**.
2. Nome do domínio: `librax.online`. Tipo: **Zona hospedada pública**. Criar.
3. Na zona criada, anote o **ID da zona hospedada** (algo como `Z0123456789ABCDEFGHIJ`) e os quatro
   **servidores de nomes** do registro `NS` (algo como `ns-123.awsdns-45.com`).

A zona custa US$ 0,50 por mês.

## Passo 3. Servidores de nomes na GoDaddy

1. Na GoDaddy: **Meus produtos** > `librax.online` > **DNS**.
2. Se o **DNSSEC** estiver ligado, desligue antes (aba DNSSEC). Com DNSSEC ligado e servidores novos, o domínio
   para de resolver.
3. Em **Servidores de nomes** > **Alterar** > **Vou usar meus próprios servidores de nomes**, cole os quatro
   servidores do passo 2, sem o ponto final. Salve.
4. Registros que existiam na GoDaddy (por exemplo o MX de um e-mail do domínio) não vão junto: se você usa algum,
   crie o mesmo registro na zona do Route 53.

A troca costuma valer em minutos, mas pode levar até 48 horas. Para conferir, no CloudShell (passo 7):

```bash
curl -s "https://dns.google/resolve?name=librax.online&type=NS"   # deve listar os awsdns
dig +short NS librax.online                                       # se o dig existir no CloudShell
nslookup -type=NS librax.online 8.8.8.8                           # outra forma
```

Enquanto aparecerem os `domaincontrol.com` da GoDaddy, espere. O script confere isso sozinho e para com uma
mensagem clara se ainda não tiver propagado.

## Passo 4. Certificado no ACM (us-east-1)

1. Console, ainda em us-east-1 > **Certificate Manager** > **Solicitar** > **Solicitar um certificado público**.
2. Nomes de domínio: `librax.online` e, em "Adicionar outro nome", `*.librax.online`.
3. Validação: **Validação de DNS**. Algoritmo: RSA 2048. Solicitar.
4. Abra o certificado e clique em **Criar registros no Route 53** > **Criar registros**.
5. Espere o status virar **Emitido** (minutos depois que o DNS do passo 3 propagar). Copie o **ARN**
   (`arn:aws:acm:us-east-1:...:certificate/...`); o script também acha sozinho e sugere.

O certificado é gratuito e renova sozinho enquanto os registros de validação ficarem na zona.

## Passo 5. O que ligar na conta

- **Nada é obrigatório.** Lambda, DynamoDB, Cognito, S3 e CloudFront já vêm ligados.
- **Cost Explorer (recomendado):** Console > **Faturamento e Gerenciamento de Custos** > **Cost Explorer** >
  ativar. Os dados aparecem em cerca de 24 horas. Sem ele, a tela Custo do painel fica vazia e o alerta de
  anomalia de custo fica para a próxima rodada do script ([Travas de custo](#travas-de-custo)).
- **Cota de concorrência do Lambda (recomendado):** conta nova costuma vir com 10 execuções simultâneas, o que
  derruba o app num pico de acesso. Peça 1000 (grátis): **Service Quotas** > **Serviços da AWS** > **AWS Lambda** >
  **Concurrent executions** (código `L-B99A9384`) > **Solicitar aumento no nível da conta** > `1000`. A AWS costuma
  responder de horas a 2 dias. O script confere a cota (só leitura) e lembra disso enquanto estiver baixa.
- **Conta nova:** algumas contas novas precisam de verificação para criar CloudFront. Se o deploy parar com uma
  mensagem sobre "account must be verified", abra um caso no **Support Center** pedindo a liberação do CloudFront
  e rode o script de novo quando responderem.

## Passo 6. Token do GitHub (só leitura)

O repositório `alissonjr/librax` é privado. Para clonar no CloudShell, crie um token que só lê esse repositório e
vence sozinho:

1. GitHub > foto > **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens** >
   **Generate new token**.
2. Nome `librax-cloudshell`, **Expiration** 7 dias, **Repository access** > **Only select repositories** >
   `alissonjr/librax`.
3. **Permissions** > **Repository permissions** > **Contents**: **Read-only** (o Metadata só leitura entra
   sozinho). Nada mais.
4. **Generate token** e copie. Não cole o token em lugar nenhum além do pedido de senha do `git clone`.

Quando terminar o lançamento, apague o token na mesma tela (**Delete**).

## Passo 7. CloudShell e o código em /tmp

1. No console, em us-east-1, clique no ícone do **CloudShell** (`>_`, na barra de cima).
2. Clone em `/tmp`. A pasta pessoal do CloudShell tem só 1 GB e o lançamento precisa de uns 2,5 GB; o `/tmp` tem
   espaço e é apagado quando a sessão termina:

   ```bash
   cd /tmp
   git clone --depth 1 https://github.com/alissonjr/librax.git
   ```

   Username: `alissonjr`. Password: cole o token (não aparece nada enquanto cola) e Enter. Nunca coloque o token
   dentro da URL: o histórico do terminal fica guardado na pasta pessoal.

## Passo 8. Rodar o lançamento

```bash
cd /tmp/librax
bash infra/scripts/lancar-cloudshell.sh
```

O script mostra cada passo com a hora e para no primeiro erro, dizendo o que fazer. Ele pergunta:

| Pergunta | Resposta |
|---|---|
| Conta AWS do Librax | o número do passo 1 |
| Id da zona do Route 53 | o do passo 2 (ele sugere; Enter aceita) |
| ARN do certificado | o do passo 4 (ele sugere; Enter aceita) |
| E-mail dos alarmes | o e-mail que recebe os alarmes e o aviso do orçamento mensal |

Depois, sem perguntar mais nada:

1. Confere o ambiente: CloudShell, região us-east-1, espaço livre, cache do npm em `/tmp`.
2. Usa o Node do CloudShell se for a versão 22 ou mais nova (a mesma das Lambdas; o Node 20 saiu do suporte); se não for, baixa o Node 22 para `/tmp/librax-node`
   (conferido pelo SHA-256 publicado).
3. Instala as dependências (`npm ci`) de `infra`, `services/api`, `apps/web-poc`, `apps/admin-web` e
   `apps/landing`, só onde ainda não estão instaladas.
4. Grava os valores em `infra/cdk.context.json` (fora do git) e uma cópia em `~/.librax/` para a próxima sessão.
5. Trava da conta: confere que o login do CloudShell é da conta informada; se não for, para.
6. Confere a zona, o certificado (emitido, cobrindo `librax.online`, `www`, `app` e `auth`) e se o domínio já
   responde pelos servidores do Route 53.
7. Confere as travas de custo, só lendo a conta: a cota de concorrência do Lambda (recomenda pedir 1000 se estiver
   baixa) e se o Cost Explorer já responde, para ligar o alerta de anomalia de custo
   ([Travas de custo](#travas-de-custo)).
8. Faz o build da landing (o deploy calcula dele a CSP), o bootstrap do CDK (só na primeira vez) e o deploy da
   stack `LibraxStack` (de 15 a 40 minutos na primeira vez). Depois do deploy, grava uma cópia dos valores no SSM
   (`/librax/cdk-context`, cifrada e grátis), de onde o [CI/CD](ci-cd.md) lê.
9. Lê os outputs da stack e grava as variáveis de build do app e do painel (`.env.production.local`).
10. Faz o build do app (baixa os modelos de ML e o avatar VLibras na primeira vez) e do painel.
11. Envia o app para o bucket do app, os modelos de ML (`/ml/`) para o bucket de conteúdo, o painel para
    `admin/` e publica a landing. Cada pasta de `/ml/` sobe com o `Cache-Control` certo (ver
    [Modelos de ML nos apps instalados](#modelos-de-ml-nos-apps-instalados)).

**Não deixe o CloudShell parado.** Ele fecha a sessão depois de 20 a 30 minutos sem teclado ou mouse, mesmo com o
script trabalhando. O script avisa a cada 2 minutos; quando aparecer o aviso, clique no terminal ou aperte Shift.
Se a sessão cair mesmo assim: abra o CloudShell de novo, clone de novo se o `/tmp/librax` tiver sumido e rode o
mesmo comando. O que a AWS já estava fazendo continua sozinho, o script espera terminar e segue de onde parou, e
os valores voltam da cópia em `~/.librax/`.

## Passo 9. Conferir

- `https://librax.online` abre a landing; `https://www.librax.online` redireciona para ela.
- `https://app.librax.online` abre o app. Crie uma conta com e-mail e senha: o código chega por e-mail, de
  `no-reply@verificationemail.com`, com o assunto "Confirme seu e-mail no Librax" (no idioma do app; ver
  [Os e-mails do Librax](#os-e-mails-do-librax)). O Cognito manda até 50 e-mails por dia
  sem SES, o que basta para o começo; para passar disso, veja
  [E-mails do login pelo SES](#e-mails-do-login-pelo-ses).
- `https://app.librax.online/privacidade` e `/termos` abrem sem login.
- `https://app.librax.online/admin/` pede login e, sem o grupo admin, recusa (passo 10).
- `https://app.librax.online/.well-known/assetlinks.json` responde `[]` até o app Android ter as impressões
  digitais ([`android-twa.md`](android-twa.md)).
- O e-mail dos alarmes recebe duas mensagens "AWS Notification - Subscription Confirmation" (alarmes e orçamento):
  clique em **Confirm subscription** nas duas.

## Passo 10. Virar admin do painel

O painel exige o segundo fator: um aplicativo autenticador no celular (Google Authenticator, Microsoft
Authenticator, 1Password ou outro; grátis, nunca SMS). Por isso:

1. Crie no app uma conta de **e-mail e senha só para o painel** (por exemplo, `seu+admin@email.com`). Com o
   autenticador ligado, essa conta não entra no app do Librax (o app ainda não pede o código), e conta do Google
   não serve (o segundo fator dela fica no Google, fora do Cognito).
2. No CloudShell:

   ```bash
   cd /tmp/librax
   bash infra/scripts/lancar-cloudshell.sh --dono seu+admin@email.com
   ```

   `--dono` deixa a conta admin e dona do painel: só ela torna outras contas admin ou tira do admin, pela tela
   **Contas** do painel. Quem já rodou `--admin` roda `--dono` uma vez com o mesmo e-mail (depois do deploy que
   cria o grupo `owner`).

3. Abra `https://app.librax.online/admin/` e entre com o e-mail e a senha dessa conta. No primeiro acesso o painel mostra
   **Configure o aplicativo autenticador**: toque em **Começar**, leia o QR code com o aplicativo (ou digite a
   chave mostrada embaixo) e digite o código de 6 dígitos. Pronto: daí em diante, o login do painel pede o código
   do aplicativo depois da senha.

Se já estava no painel, saia e entre de novo: o grupo só entra no login seguinte. Perdeu o celular: veja
[`painel-admin.md`](painel-admin.md#perdeu-o-celular-do-autenticador). Os comandos equivalentes, para tirar o
acesso ou dar a outra pessoa, estão em [`painel-admin.md`](painel-admin.md#como-dar-acesso-de-admin-a-alguém).

Fim do lançamento: `rm -rf /tmp/librax` e apague o token do GitHub (passo 6).

## Depois do lançamento

Cada item é opcional e independente. Depois de cada um, rode o script de novo com a opção indicada.

### Google

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto (ex.: Librax) e abra
   **APIs e serviços** > **Tela de consentimento OAuth** (Google Auth Platform):
   - Tipo de usuário **Externo**; nome do app **Librax**; e-mail de suporte e de contato: o seu.
   - Domínio autorizado: `librax.online`. Página inicial `https://librax.online`, política
     `https://app.librax.online/privacidade` e termos `https://app.librax.online/termos`.
   - Escopos: só os básicos (`openid`, `email`, `profile`), que não pedem verificação do Google.
   - Em **Público-alvo**, clique em **Publicar app** (sai do modo de teste, que só deixa entrar quem estiver
     na lista de testadores).
2. **Credenciais** > **Criar credenciais** > **ID do cliente OAuth**, tipo **Aplicativo da Web**:
   - Origens JavaScript autorizadas: `https://auth.librax.online`.
   - URIs de redirecionamento autorizados: `https://auth.librax.online/oauth2/idpresponse`.
   - **Criar**. Deixe a janela com o **ID do cliente** e a **Chave secreta do cliente** aberta.
3. No CloudShell:

   ```bash
   cd /tmp/librax && bash infra/scripts/lancar-cloudshell.sh --com-google
   ```

   O script pede o ID do cliente (confere o formato) e a chave secreta (não aparece na tela nem fica no
   histórico), guarda o id no SSM (`/librax/google/client-id`) e a chave no Secrets Manager
   (`librax/google/client-secret`, US$ 0,40 por mês), faz o deploy e publica o app com o botão "Continuar com
   Google". Nas rodadas seguintes ele só confere que os dois existem.
4. **Conferir.** No app, **Entrar** > **Continuar com Google**: entra e volta para o mapa.

Uma pessoa, uma conta (gatilho `librax-pre-signup`, `services/api/src/handlers/preSignUp.js`): quem já tinha
conta de e-mail e senha confirmada e entra pela primeira vez pelo Google com o mesmo e-mail cai nessa conta, com o
progresso (o app repete o login sozinho uma vez, porque o Cognito recusa a primeira volta depois de ligar). E quem
tenta criar conta com senha usando um e-mail que já entra pelo Google recebe o aviso para usar "Continuar com
Google".

Para desligar: `--sem-google` (o cliente e a chave continuam guardados para ligar de novo).

### Notificações (Web Push)

Um comando só, no CloudShell:

```bash
cd /tmp/librax && bash infra/scripts/lancar-cloudshell.sh --so-publicar --com-notificacoes
```

O script gera o par de chaves VAPID ali mesmo, grava no SSM (a pública em `/librax/vapid/public-key` e a privada
cifrada em `/librax/vapid/private-key`), sem mostrar a privada, e publica o app com as notificações. Rodar de novo
não troca as chaves: trocar invalidaria a inscrição de quem já ativou. Custo zero (parâmetros padrão do SSM).

**Conferir.** No celular, abra o app, **Configurações** > **Lembretes** > ative e escolha um horário (no iPhone,
só com o app instalado na tela inicial). O lembrete chega no horário escolhido, se você ainda não tiver estudado
no dia. Sem as chaves, os lembretes por e-mail continuam saindo normalmente.

### Lembretes por e-mail (SES)

1. Console > **Amazon SES** (us-east-1) > **Identidades** > **Criar identidade** > Domínio `librax.online`, com
   **Easy DKIM** e a opção de publicar os registros no Route 53.
2. Peça a saída do sandbox (**Conta** > **Solicitar acesso de produção**). Até lá, só chegam e-mails para endereços
   verificados.
3. `bash infra/scripts/lancar-cloudshell.sh --com-lembretes-email` (remetente `lembretes@librax.online`). O
   mesmo deploy publica o app com a opção **Lembrete por e-mail** em **Configurações** > **Lembretes**; cada pessoa
   liga a sua (começa desligada e vai para o e-mail confirmado da conta).

### E-mails do login pelo SES

Sem isso, o código de cadastro e o de "esqueci a senha" saem pelo envio padrão do Cognito, limitado a 50 e-mails
por dia. Com o SES, saem de `Librax <nao-responda@librax.online>`, sem esse limite. Os passos 1 e 3 são feitos uma
vez só e servem também para os lembretes por e-mail.

1. **Identidade do domínio.** Console > **Amazon SES** (região us-east-1) > **Identidades** > **Criar identidade**:
   - Tipo: **Domínio**, `librax.online`.
   - Em "Verificar seu domínio", deixe **Easy DKIM** com **RSA_2048_BIT** e marque **Publicar registros DNS no
     Route 53** (Publish DNS records to Route 53). As assinaturas DKIM ficam ativadas.
   - **Criar identidade.** O SES grava os 3 registros CNAME do DKIM na zona e a identidade passa a **Verificado**
     em alguns minutos (no máximo 72 horas).
2. **DMARC (opcional, recomendado).** Route 53 > **Zonas hospedadas** > `librax.online` > **Criar registro**:
   nome `_dmarc`, tipo **TXT**, valor `"v=DMARC1; p=none;"`. Com `p=none` nada é bloqueado; o registro só melhora
   a entrega no Gmail e no Outlook.
3. **Acesso de produção.** Toda conta começa no sandbox do SES, que só entrega para endereços verificados: com o
   envio pelo SES ligado no sandbox, quem criar conta não recebe o código. Console > **Amazon SES** > **Painel da
   conta** (Account dashboard) > **Solicitar acesso de produção** (Request production access):
   - Tipo de e-mail: **Transacional**. URL do site: `https://librax.online`. Idioma de contato: inglês.
   - Descrição sugerida (em inglês, que é o idioma da análise):

     > Librax (https://librax.online) is a free app for learning Brazilian Sign Language (Libras). We use Amazon
     > SES for transactional e-mail sent by Amazon Cognito: the sign-up verification code and the password reset
     > code, from nao-responda@librax.online. From the same address we send a security notice when an account
     > signs in on a new device (at most 3 per day per account). Later we will also send study reminders that
     > users turn on in the app, each with a link to turn them off. We never buy or import address lists: every recipient created
     > their own account and confirmed the address. The domain uses Easy DKIM and has a DMARC record. Bounces and
     > complaints are handled by the SES account-level suppression list, and we watch the bounce and complaint
     > rates in the SES account dashboard. Expected volume at launch: under 1,000 e-mails per day.

   A AWS costuma responder em até 24 horas, por e-mail e no Support Center.
4. **Ligar.** No CloudShell:

   ```bash
   cd /tmp/librax && bash infra/scripts/lancar-cloudshell.sh --com-email-ses
   ```

   O script grava `librax:cognitoEmailSes` no `infra/cdk.context.json`, confere no SES que `librax.online` existe e
   está verificado (se não, para e diz o que falta) e avisa se a conta ainda estiver no sandbox. Depois faz o
   deploy. A troca só atualiza o User Pool: as contas, as senhas e o login continuam iguais.
5. **Conferir.** Crie uma conta de teste no app ou peça "Esqueci a senha": o e-mail chega de
   `Librax <nao-responda@librax.online>`. Entre na mesma conta em outro navegador: chega o aviso "Novo acesso à
   sua conta do Librax".

Para voltar ao envio padrão do Cognito: `bash infra/scripts/lancar-cloudshell.sh --sem-email-ses`. Outro remetente
(do mesmo domínio verificado) ou um endereço de resposta: `librax:cognitoEmailFrom`, `librax:cognitoEmailFromName` e
`librax:cognitoEmailReplyTo` no `infra/cdk.context.json` (`infra/lib/config.ts`).

### Os e-mails do Librax

São quatro, todos com a identidade visual do app (logo, cores, botão em pílula), em HTML com versão em texto, e no
idioma que a pessoa escolheu no app (português, inglês ou espanhol). O texto fica em
`services/api/src/email/` e as prévias saem com `npm run emails:previa -- <pasta>` (em `services/api`).

| E-mail | Quando sai | Por onde |
|---|---|---|
| Código do cadastro | criar conta e "Reenviar código" | Cognito (envio padrão ou SES), gatilho Custom Message |
| Código de nova senha, com "não foi você?" | "Esqueci a senha" | Cognito (envio padrão ou SES), gatilho Custom Message |
| Lembrete de estudo, com a sequência e o botão para o app | horário do lembrete, sem notificação entregue | SES, só com `--com-lembretes-email` |
| Aviso de acesso num aparelho novo | a conta entra num navegador ou aparelho que ela ainda não tinha | SES, só com `--com-email-ses` |

Não há nada novo para configurar: os dois primeiros funcionam com e sem SES, e os outros dois seguem as opções
que já existem. O idioma vem do app (no cadastro, no reenvio e no "esqueci a senha"; e, com conta, a cada login e
troca de idioma). Sem idioma conhecido, sai em português. O logo dos e-mails é `https://app.librax.online/email/logo.png`,
publicado junto com o app. Se o gatilho falhar, o Cognito manda o texto padrão em português: "Olá! Seu código do
Librax é 123456. Digite esse código no app para confirmar seu e-mail ou criar uma nova senha. Se não foi você que
pediu, é só ignorar esta mensagem. Bons estudos em Libras!"

O aviso de acesso novo é feito pelo Librax, sem o plano pago do Cognito: o app avisa a API depois de entrar, com
um código aleatório do navegador, e a API guarda só um resumo desse código, o tipo de aparelho, o sistema e o
navegador (sem IP). O primeiro aparelho da conta não gera aviso, sessões antigas também não, e cada conta recebe
no máximo 3 avisos por dia. Com o SES desligado, os aparelhos são registrados e nenhum e-mail sai.

A troca no User Pool é só o gatilho Custom Message (atualização no lugar, sem recriar o User Pool nem mexer nas
contas); o idioma vai no atributo padrão `locale`, sem atributo novo.

### Política e Termos

Os textos ficam em `apps/web-poc/src/legal/privacidade.md` e `termos.md`. Mudou o texto, suba a versão e a data no
topo do arquivo e publique (próxima seção). Edite no repositório, não no CloudShell, que perde o que for editado.

A política 1.4 trouxe os dados de uso anônimos e a nota do app. A versão que o app mostra no aviso de uma vez
fica em `apps/web-poc/src/lib/usageNotice.ts` (`PRIVACY_POLICY_VERSION`, conferida pelo teste da política): quem já
usava o app vê o aviso curto no mapa uma vez; quem chega aceita nas boas-vindas. Publique a infra (rota nova) e o
app juntos, na rodada completa.

## Publicar atualizações

**Com o CI/CD (recomendado):** configure uma vez com `bash infra/scripts/lancar-cloudshell.sh --configurar-ci` e,
daí em diante, publique do seu computador com uma tag de versão. A AWS roda todos os testes e só publica se todos
passarem; o resultado chega no e-mail dos alarmes. Passo a passo, custo, logs e como voltar uma versão em
[`ci-cd.md`](ci-cd.md):

```bash
git tag v1.0.0 && git push origin v1.0.0
```

**Pelo CloudShell (sem CI/CD, ou para mudar os valores do lançamento):** depois que a mudança estiver no `main` do
GitHub: CloudShell, token novo se o anterior venceu, e

```bash
cd /tmp && rm -rf librax && git clone --depth 1 https://github.com/alissonjr/librax.git && cd librax
bash infra/scripts/lancar-cloudshell.sh --so-publicar   # mudou só o app, o painel ou a landing
bash infra/scripts/lancar-cloudshell.sh                 # mudou infra/ ou services/api/ (o bootstrap é pulado)
```

O `--so-publicar` não mexe na stack: faz o build e o upload do app, do painel e da landing. É o caminho
para publicar modelo de ML novo: o PWA e o app Android pegam sozinhos, sem versão nova na loja (abaixo). Se a landing mudar o
script inline da página, ele para pedindo a rodada completa (a CSP da landing sai do deploy). Outras opções:
`bash infra/scripts/lancar-cloudshell.sh --ajuda`.

Fora do CloudShell, num computador com o login do Identity Center ([`conta-aws.md`](conta-aws.md)), o mesmo
script funciona com o perfil `librax`.

### Modelos de ML nos apps instalados

O app instalado (PWA ou Android) recebe site novo e modelo novo sem passar pela loja. O `/ml/` tem duas regras,
iguais no CloudFront (`infra/lib/librax-stack.ts`), no metadado do S3 (o upload do script) e no service worker
(`apps/web-poc/src/lib/mlCache.ts`):

| Caminho | Cache no navegador e na borda | Service worker |
|---|---|---|
| `/ml/<versão do MediaPipe>/` (WASM e modelos da mão e do corpo) | um ano, `immutable` | guarda para sempre (CacheFirst) |
| `/ml/classifier/`, `/ml/sinais/`, `/ml/letras-mov/`, `/ml/numeros/` e qualquer outra pasta | `no-cache`: sempre revalida com o ETag (resposta 304 quando não mudou) | entrega o guardado (funciona offline) e busca o novo por trás (StaleWhileRevalidate) |

Na prática: depois de publicar um modelo, quem abrir a câmera com internet já baixa o novo por trás e passa a
usar a partir da abertura seguinte do app; sem internet, continua com o anterior. O pacote "Baixar para usar
offline" usa os mesmos caches. A pasta com versão só muda quando o `@mediapipe/tasks-vision` muda de versão:
trocar um arquivo dentro de `/ml/<versão>/` sem trocar a versão não chegaria a quem já baixou.

## Custos

Preços de us-east-1. No piloto, o esperado é de US$ 1 a US$ 3 por mês, quase tudo fixo:

| Item | Por mês |
|---|---|
| Zona do Route 53 | US$ 0,50, mais centavos por consulta |
| Cost Explorer (uma consulta por dia do painel) | US$ 0,31 |
| Segredo do Google (se ligar) | US$ 0,40 |
| SES (se ligar os e-mails do login ou os lembretes) | US$ 0,10 por mil e-mails |
| CloudFront, Lambda, DynamoDB, S3, Cognito, CloudWatch | centavos no piloto (free tier permanente do CloudFront, da Lambda e do Cognito) |
| Certificado do ACM, AWS Budget, SNS por e-mail | grátis |
| CI/CD no CodeBuild (se configurar) | grátis até 100 minutos de build, cerca de 5 versões; US$ 0,40 com 10 versões e US$ 1,30 com 20 ([`ci-cd.md`](ci-cd.md#quanto-custa)) |

Os dados de uso anônimos crescem com o uso: cerca de US$ 0,60 por mês com mil pessoas por dia e US$ 6 com 10 mil
([`painel-admin.md`](painel-admin.md#7-custo-extra-estimado-por-mês)); nessa escala, suba o orçamento.

O domínio é pago à parte, na GoDaddy. O **AWS Budget** `librax-mensal-<resumo>` avisa por e-mail ao passar de 80%
e de 100% de US$ 10 por mês e quando a previsão do mês passa de 100% (mude o valor com `--orcamento 20`; a previsão
só aparece depois de algumas semanas de uso). Ele só avisa, não bloqueia gasto. Detalhe dos custos do painel em
[`painel-admin.md`](painel-admin.md#7-custo-extra-estimado-por-mês).

### Travas de custo

O risco do Librax é mais de conta alta e de app fora do ar do que de invasão. Estas travas são de graça e ficam na
stack (valores em `infra/lib/cost-guards.ts`); todas mudam no lugar, sem recriar recurso:

| Trava | O que faz |
|---|---|
| Limite por rota da API | `POST /v1/guest/migrate` 1 por segundo (rajada 5), `lesson/complete` e `practice/review` 20 (rajada 40), `squads/join` 5 (10), criar squad 2 (5), excluir conta 1 (5); as rotas públicas do uso anônimo: `POST /v1/telemetry` 10 (30), apagar o código e mandar a nota 1 (5). Acima disso a API responde 429 e o app tenta de novo depois. O limite geral continua 50 por segundo, com rajada de 200 (antes 100) para o pico da hora do lembrete |
| Teto da tabela | o DynamoDB sob demanda aceita até 500 leituras e 200 escritas por segundo; acima disso recusa em vez de cobrar, e o alarme `librax-dynamodb-throttles` avisa |
| Versões antigas no S3 | os quatro buckets apagam versões antigas depois de 30 dias e envios incompletos depois de 7 |
| Alarme de download | `librax-app-download` avisa quando o CloudFront do app entrega mais de 5 GB numa hora (uma instalação nova baixa de 30 a 45 MB); mude com `-c librax:appDownloadAlarmGbPerHour=10` |
| Previsão do orçamento | o AWS Budget também avisa quando a previsão do mês passa do valor |
| Anomalia de custo | resumo diário por e-mail (o dos alarmes) de gasto fora do padrão acima de 20% do orçamento (US$ 2 com o padrão). Só cabe um monitor de serviços por conta e a AWS costuma criar um ao ativar o Cost Explorer: o script usa o que existir ou cria (`librax:costAnomalyAlerts`). Com o Cost Explorer desligado, fica para a próxima rodada |
| User Pool protegido | o User Pool (as contas) não pode ser apagado nem pelo CloudFormation nem pelo console sem antes desligar a proteção |
| Concorrência reservada (opcional) | cada Lambda da API ganha um teto de cópias simultâneas (2 para o `guest/migrate`, de 5 a 20 para as outras, 180 no total) e um abuso numa rota não toma a conta inteira |

**Concorrência reservada.** Fica desligada por padrão: com a cota de 10 de uma conta nova, qualquer reserva faz o
deploy falhar (a AWS exige 100 execuções sem reserva). Depois que a AWS liberar a cota de 1000
([passo 5](#passo-5-o-que-ligar-na-conta)), ligue com:

```bash
bash infra/scripts/lancar-cloudshell.sh --com-concorrencia-reservada
```

O script lê a cota (`lambda get-account-settings`, só leitura) e para antes do deploy se ela não bastar.
`--sem-concorrencia-reservada` desliga de novo.

## Desfazer

- **Publicação ruim do app, do painel ou da landing:** volte para o commit anterior e publique só os sites:

  ```bash
  cd /tmp && rm -rf librax && git clone https://github.com/alissonjr/librax.git && cd librax
  git log --oneline -10            # escolha o commit bom
  git checkout <commit>
  bash infra/scripts/lancar-cloudshell.sh --so-publicar
  ```

- **Deploy da stack com erro:** o CloudFormation desfaz sozinho e a versão anterior continua no ar. Para voltar a
  stack a uma versão antiga, `git checkout <commit>` como acima e rode sem `--so-publicar`.
- **Primeiro deploy com erro** (o script fala em `ROLLBACK_COMPLETE`): veja o motivo em **CloudFormation** >
  `LibraxStack` > **Eventos**, apague a stack, apague a tabela `librax` do DynamoDB que ficou (está vazia; o nome é
  fixo e impediria a próxima criação) e rode o script de novo.
- **Tirar tudo do ar:**

  ```bash
  cd /tmp/librax/infra && npm run aws:conta && ./scripts/aws.sh npx cdk destroy LibraxStack
  ```

  A tabela `librax`, o User Pool `librax-users` e os quatro buckets ficam (proteção contra apagar dados por
  engano): apague à mão se quiser mesmo. O User Pool tem proteção contra exclusão: desligue em **Cognito** >
  `librax-users` > **Configurações** > **Proteção contra exclusão** antes de apagar. Depois a stack `CDKToolkit` e o bucket dela, o certificado, os registros e
  a zona do Route 53 e, na GoDaddy, volte para **Servidores de nomes padrão da GoDaddy**.

## Problemas comuns

| Mensagem ou sintoma | O que fazer |
|---|---|
| "O domínio ainda não aponta para o Route 53" | esperar a troca do passo 3; conferir os quatro servidores na GoDaddy |
| "O certificado está como PENDING_VALIDATION" | conferir os registros de validação na zona (passo 4) e esperar |
| "dentro da pasta pessoal do CloudShell" | clonar em `/tmp` (passo 7) |
| Erro no download do VLibras | rodar de novo (o que já baixou fica); com os servidores do governo fora do ar, `--vlibras-opcional` publica sem o avatar |
| Build parado com "Killed" ou "heap out of memory" | `export NODE_OPTIONS=--max-old-space-size=1536` e rodar de novo |
| Sessão do CloudShell fechou | abrir de novo e rodar o mesmo comando (passo 8) |
| "account must be verified" no CloudFront | caso no Support Center (passo 5) |
| "A cota de execuções simultâneas do Lambda nesta conta é 10" | pedir 1000 no Service Quotas (passo 5); o lançamento segue sem a concorrência reservada |
| "Concorrência reservada pedida, mas a cota da conta é ..." | esperar a AWS liberar a cota ou rodar com `--sem-concorrencia-reservada` |
| Painel mostra "Configure o aplicativo autenticador" | é o primeiro acesso de admin: siga o passo 10 |
| Painel diz "E-mail ou senha incorretos" com a senha certa | conta do Google não tem senha e não entra no painel; use uma conta de e-mail e senha (passo 10) |
| Esqueceu a senha da conta do painel | "Esqueci a senha" na tela do painel abre o app; troque lá e entre de novo no painel |

## Revisão de segurança e custo

Revisão feita antes do lançamento (outubro de 2026). Conclusão: o risco é mais de custo e de disponibilidade do que
de invasão. A API só aceita o token do Cognito, as Lambdas têm o mínimo de permissão, os buckets são privados e o
site sai com CSP, HSTS e sem moldura.

**Corrigido nesta rodada** (todas as mudanças são atualização no lugar, sem recriar User Pool, tabela, buckets ou
estágio da API):

- limite por rota na API, teto de vazão da tabela, versões antigas do S3 expirando, alarme de download do
  CloudFront, previsão no AWS Budget e alerta de anomalia de custo ([Travas de custo](#travas-de-custo));
- concorrência reservada das Lambdas como opção, ligada só depois de a cota da conta subir para 1000;
- User Pool com proteção contra exclusão;
- painel de administração com segundo fator obrigatório (aplicativo autenticador, TOTP; nunca SMS): o Cognito fica
  com MFA opcional, o app continua sem MFA para quem usa o Librax e a Lambda do painel recusa admin sem o
  autenticador ligado ([`painel-admin.md`](painel-admin.md#2-acesso-três-travas));
- CSP do app sem `cdn.jsdelivr.net` e `storage.googleapis.com` (o MediaPipe já vem de `/ml/`);
- validação do `squadId` no caminho das rotas de squad e do `today` da fila diária.

**Fica para depois** (nada disso bloqueia o lançamento):

- **Abuso de download:** sem WAF, o CloudFront entrega tudo o que pedirem e cobra a transferência acima do 1 TB
  grátis por mês. O alarme `librax-app-download` avisa; a proteção de verdade é paga: AWS WAF com limite por IP no
  CloudFront (cerca de US$ 6 a 10 por mês) ou um dos planos de preço fixo do CloudFront, que já incluem WAF e
  não cobram por excesso.
- **WAF no Cognito:** limitar tentativas de login e de cadastro por IP (pago, mesmo WAF acima).
- **Logs de acesso** do CloudFront e da API (CloudWatch Logs ou S3): ajudam a investigar abuso, com custo pequeno
  de armazenamento.
- **Anti-trapaça do jogo:** o servidor já valida pontuação, datas e idempotência, mas XP e ligas ainda confiam no
  app para o resultado de cada exercício; ranking com prêmio exigiria conferência no servidor.
- **Node 24 nas Lambdas** antes do fim do suporte do Node 22 (abril de 2027).
- **Dependências de desenvolvimento** com versões novas (Vite, Vitest, esbuild e afins): atualizar com calma, fora
  do caminho do lançamento.
- **App com o código do autenticador:** se um dia o app do Librax tiver MFA para quem quiser, a conta do painel
  poderá ser a mesma do app.
