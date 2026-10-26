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
com o login por e-mail e senha; o login com Google, os lembretes por e-mail e as notificações (Web Push) ficam
desligados e podem ser ligados depois (seção [Depois do lançamento](#depois-do-lançamento)).

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
  ativar. Os dados aparecem em cerca de 24 horas. Sem ele, a tela Custo do painel fica vazia.
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
2. Usa o Node do CloudShell se for a versão 20 ou mais nova; se não for, baixa o Node 22 para `/tmp/librax-node`
   (conferido pelo SHA-256 publicado).
3. Instala as dependências (`npm ci`) de `infra`, `services/api`, `apps/web-poc`, `apps/admin-web` e
   `apps/landing`, só onde ainda não estão instaladas.
4. Grava os valores em `infra/cdk.context.json` (fora do git) e uma cópia em `~/.librax/` para a próxima sessão.
5. Trava da conta: confere que o login do CloudShell é da conta informada; se não for, para.
6. Confere a zona, o certificado (emitido, cobrindo `librax.online`, `www`, `app` e `auth`) e se o domínio já
   responde pelos servidores do Route 53.
7. Faz o build da landing (o deploy calcula dele a CSP), o bootstrap do CDK (só na primeira vez) e o deploy da
   stack `LibraxStack` (de 15 a 40 minutos na primeira vez).
8. Lê os outputs da stack e grava as variáveis de build do app e do painel (`.env.production.local`).
9. Faz o build do app (baixa os modelos de ML e o avatar VLibras na primeira vez) e do painel.
10. Envia o app para o bucket do app, os modelos de ML (`/ml/`) para o bucket de conteúdo, o painel para
    `admin/` e publica a landing.

**Não deixe o CloudShell parado.** Ele fecha a sessão depois de 20 a 30 minutos sem teclado ou mouse, mesmo com o
script trabalhando. O script avisa a cada 2 minutos; quando aparecer o aviso, clique no terminal ou aperte Shift.
Se a sessão cair mesmo assim: abra o CloudShell de novo, clone de novo se o `/tmp/librax` tiver sumido e rode o
mesmo comando. O que a AWS já estava fazendo continua sozinho, o script espera terminar e segue de onde parou, e
os valores voltam da cópia em `~/.librax/`.

## Passo 9. Conferir

- `https://librax.online` abre a landing; `https://www.librax.online` redireciona para ela.
- `https://app.librax.online` abre o app. Crie uma conta com e-mail e senha: o código chega por e-mail (o Cognito
  manda até 50 e-mails por dia sem SES, o que basta para o começo).
- `https://app.librax.online/privacidade` e `/termos` abrem sem login.
- `https://app.librax.online/admin/` pede login e, sem o grupo admin, recusa (passo 10).
- `https://app.librax.online/.well-known/assetlinks.json` responde `[]` até o app Android ter as impressões
  digitais ([`android-twa.md`](android-twa.md)).
- O e-mail dos alarmes recebe duas mensagens "AWS Notification - Subscription Confirmation" (alarmes e orçamento):
  clique em **Confirm subscription** nas duas.

## Passo 10. Virar admin do painel

Com a conta já criada no app (passo 9), no CloudShell:

```bash
cd /tmp/librax
bash infra/scripts/lancar-cloudshell.sh --admin seu@email.com
```

Saia do painel e entre de novo: o grupo só entra no login seguinte. Os comandos equivalentes, para tirar o acesso
ou dar a outra pessoa, estão em [`painel-admin.md`](painel-admin.md#como-dar-acesso-de-admin-a-alguém).

Fim do lançamento: `rm -rf /tmp/librax` e apague o token do GitHub (passo 6).

## Depois do lançamento

Cada item é opcional e independente. Depois de cada um, rode o script de novo com a opção indicada.

### Google

1. No Google Cloud Console, crie um cliente OAuth do tipo **Aplicativo da Web** com origem
   `https://auth.librax.online` e URI de redirecionamento `https://auth.librax.online/oauth2/idpresponse`. Na tela
   de consentimento, informe `https://app.librax.online/privacidade` e `https://app.librax.online/termos`.
2. No CloudShell, guarde o id e o segredo sem que eles fiquem no histórico do terminal:

   ```bash
   read -rp 'Client ID: ' ID; read -rsp 'Client secret: ' SEGREDO; echo
   aws ssm put-parameter --name /librax/google/client-id --type String --value "$ID"
   aws secretsmanager create-secret --name librax/google/client-secret --secret-string "$SEGREDO" --query Name
   unset ID SEGREDO
   ```

3. `bash infra/scripts/lancar-cloudshell.sh --com-google` (refaz o deploy e o app volta a mostrar "Continuar com
   Google"). O segredo custa US$ 0,40 por mês.

### Notificações (Web Push)

Gera o par de chaves VAPID uma vez e guarda no SSM sem mostrar a chave privada:

```bash
cd /tmp/librax/services/api
npx web-push generate-vapid-keys --json > /tmp/vapid.json
aws ssm put-parameter --name /librax/vapid/public-key --type String --value "$(node -p 'require("/tmp/vapid.json").publicKey')"
aws ssm put-parameter --name /librax/vapid/private-key --type SecureString --value "$(node -p 'require("/tmp/vapid.json").privateKey')"
rm /tmp/vapid.json
cd /tmp/librax && bash infra/scripts/lancar-cloudshell.sh --so-publicar
```

Trocar as chaves depois invalida as inscrições de quem já ativou as notificações.

### Lembretes por e-mail (SES)

1. Console > **Amazon SES** (us-east-1) > **Identidades** > **Criar identidade** > Domínio `librax.online`, com
   **Easy DKIM** e a opção de publicar os registros no Route 53.
2. Peça a saída do sandbox (**Conta** > **Solicitar acesso de produção**). Até lá, só chegam e-mails para endereços
   verificados.
3. `bash infra/scripts/lancar-cloudshell.sh --com-lembretes-email` (remetente `lembretes@librax.online`).

### Política e Termos

Enquanto `apps/web-poc/src/legal/responsavel.ts` tiver marcadores entre colchetes, as páginas mostram o selo
"Rascunho". Preencha nome, CNPJ ou CPF, e-mail de contato e foro no repositório (não no CloudShell, que perde o que
for editado), suba a versão e a data no topo de `privacidade.md` e `termos.md` e publique (próxima seção).

## Publicar atualizações

Depois que a mudança estiver no `main` do GitHub: CloudShell, token novo se o anterior venceu, e

```bash
cd /tmp && rm -rf librax && git clone --depth 1 https://github.com/alissonjr/librax.git && cd librax
bash infra/scripts/lancar-cloudshell.sh --so-publicar   # mudou só o app, o painel ou a landing
bash infra/scripts/lancar-cloudshell.sh                 # mudou infra/ ou services/api/ (o bootstrap é pulado)
```

O `--so-publicar` não mexe na stack: faz o build e o upload do app, do painel e da landing. Se a landing mudar o
script inline da página, ele para pedindo a rodada completa (a CSP da landing sai do deploy). Outras opções:
`bash infra/scripts/lancar-cloudshell.sh --ajuda`.

Fora do CloudShell, num computador com o login do Identity Center ([`conta-aws.md`](conta-aws.md)), o mesmo
script funciona com o perfil `librax`.

## Custos

Preços de us-east-1. No piloto, o esperado é de US$ 1 a US$ 3 por mês, quase tudo fixo:

| Item | Por mês |
|---|---|
| Zona do Route 53 | US$ 0,50, mais centavos por consulta |
| Cost Explorer (uma consulta por dia do painel) | US$ 0,31 |
| Segredo do Google (se ligar) | US$ 0,40 |
| CloudFront, Lambda, DynamoDB, S3, Cognito, CloudWatch | centavos no piloto (free tier permanente do CloudFront, da Lambda e do Cognito) |
| Certificado do ACM, AWS Budget, SNS por e-mail | grátis |

O domínio é pago à parte, na GoDaddy. O **AWS Budget** `librax-mensal` avisa por e-mail ao passar de 80% e de 100%
de US$ 10 por mês (mude com `--orcamento 20`). Ele só avisa, não bloqueia gasto. Detalhe dos custos do painel em
[`painel-admin.md`](painel-admin.md#7-custo-extra-estimado-por-mês).

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
  engano): apague à mão se quiser mesmo. Depois a stack `CDKToolkit` e o bucket dela, o certificado, os registros e
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
