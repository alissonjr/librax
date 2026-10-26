# Login da conta AWS do Librax

O projeto tem um login próprio da AWS, separado do que a máquina usa no dia a dia. Ele usa o
IAM Identity Center: você entra pelo navegador, nenhuma senha ou chave fica salva e o acesso vence
sozinho. Fora dos comandos do projeto, o `aws` continua usando o `~/.aws` de sempre.

O lançamento pode ser feito sem nada disso, pelo AWS CloudShell: [`lancamento.md`](lancamento.md).

## Como funciona

- `infra/scripts/aws.sh <comando>` roda qualquer comando com o perfil `librax` da pasta `.aws/` na
  raiz do projeto (fora do git). Ele ignora o `~/.aws/config` e o `~/.aws/credentials` e descarta as
  credenciais, a região e os endpoints que estiverem no terminal (por exemplo os do ambiente local).
- No AWS CloudShell (`AWS_EXECUTION_ENV` começando com `CloudShell`) não há perfil local: o `aws.sh`
  mantém só as credenciais do contêiner (o login do console, `AWS_CONTAINER_CREDENTIALS_FULL_URI` e o
  token dele) e a região da sessão, e continua descartando chaves avulsas, perfis e endpoints. A trava
  da conta roda igual.
- A conta do Librax fica fixada em `librax:accountId`, no `infra/cdk.context.json` (local, fora do
  repositório; o `lancar-cloudshell.sh` grava ele). `npm run bootstrap`, `npm run diff` e `npm run deploy`
  conferem a conta do login antes de começar e recusam qualquer outra. Sem a conta fixada, recusam sempre.
  O CDK também usa esse número na stack, então ele mesmo recusa credenciais de outra conta.
- Ordem do contexto (a do CDK): `-c chave=valor` vale mais que o `infra/cdk.json`, que vale mais que o
  `infra/cdk.context.json`. Uma chave presente no `cdk.json`, mesmo vazia, esconde a do arquivo local. Por
  isso o `cdk.json` só traz o que é do projeto (`librax:domainName` e `librax:androidPackageName`); conta,
  zona, certificado, e-mails, Google, lembretes e impressões digitais do Android vão no
  `cdk.context.json`, por exemplo:

  ```json
  {
    "librax:accountId": "123456789012",
    "librax:hostedZoneId": "Z0123456789ABCDEFGHIJ",
    "librax:hostedZoneName": "librax.online",
    "librax:certificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/...",
    "librax:alarmEmail": "alertas@exemplo.com",
    "librax:googleEnabled": false
  }
  ```
- O token temporário do Identity Center fica em `~/.aws/sso/cache`, num arquivo próprio da sessão
  `librax`. Ele não altera o login que já existe na máquina.

## Uma vez, na conta AWS (pelo console)

1. Ative o IAM Identity Center (de preferência em `us-east-1`, a região da stack).
2. Crie o seu usuário e confirme o convite que chega por e-mail.
3. Crie um conjunto de permissões. Para o primeiro deploy use `AdministratorAccess` (o bootstrap
   e a stack criam papéis do IAM); depois dá para trocar por um mais restrito. A duração da sessão é
   configurada ali (o padrão é 1 hora).
4. Em "Contas da AWS", atribua o usuário e o conjunto de permissões à conta do Librax.
5. Anote a URL do portal de acesso (algo como `https://d-xxxxxxxxxx.awsapps.com/start`) e o número da
   conta (12 dígitos).

## Uma vez, nesta máquina

```bash
cd infra
npm run aws:configurar
```

Respostas:

| Pergunta | Resposta |
|---|---|
| SSO session name | `librax` |
| SSO start URL | a URL do portal de acesso |
| SSO region | a região onde o Identity Center foi ativado (`us-east-1`) |
| SSO registration scopes | Enter (padrão) |
| (navegador) | autorize e escolha a conta do Librax e o conjunto de permissões |
| Default client Region | `us-east-1` |
| CLI default output format | `json` |

Depois, crie `infra/cdk.context.json` com `{ "librax:accountId": "<número da conta>" }` e confira:

```bash
npm run aws:conta   # "Conta 123456789012 conferida (perfil librax)."
```

## No dia a dia

```bash
cd infra
npm run aws:entrar   # abre o navegador e renova o acesso
npm run diff         # confere a conta e mostra o que muda
npm run deploy       # confere a conta e publica
infra/scripts/aws.sh aws s3 ls   # qualquer outro comando com o login do Librax
```

Não use `aws sso logout`: ele apaga os tokens de todas as sessões do Identity Center da máquina,
inclusive as de outros projetos. Para sair, basta deixar o acesso vencer.

## Domínio: landing e app

Um domínio só (`librax:domainName`, `librax.online` no `infra/cdk.json`) e quatro nomes. A landing (`apps/landing`) fica na raiz, com bucket e
CloudFront próprios; o app continua como é hoje, só que em `app.`: mesmo CloudFront, mesmos caminhos, mesmo
escopo do PWA. Os nomes partem do domínio e podem ser trocados por contexto (`infra/lib/config.ts`).

| Nome | O que serve | Chave | Padrão |
|---|---|---|---|
| `<dominio>` | landing (`/`, `/en/`, `/es/`) | `librax:landingDomainName` | `<domainName>` |
| `www.<dominio>` | redireciona (301) para `<dominio>`, com caminho e query | `librax:wwwDomainName` (`none` desliga) | `www.<landingDomainName>` |
| `app.<dominio>` | app, `/api` e `/admin` | `librax:appDomainName` | `app.<domainName>` |
| `auth.<dominio>` | login do Cognito | `librax:authDomainName` | `auth.<domainName>` |

O certificado (`librax:certificateArn`, ACM em `us-east-1`) precisa cobrir os quatro nomes (ou `<dominio>` e
`*.<dominio>`). Na landing, `/app` e `/app/...` redirecionam para `app.<dominio>`, então link antigo para
`/app/` continua funcionando.

Idioma da landing para o app: as duas origens não dividem o armazenamento do navegador, então todo link da
landing para o app leva `?lang=pt-BR|en|es`. O app aplica esse idioma como se fosse escolhido nele (guarda em
`librax_lang`) e tira o parâmetro da URL (`apps/web-poc/src/i18n/index.tsx`, `adoptLangFromUrl`). O
redirecionamento de `/app` mantém a query.

Registros DNS. Com zona no Route 53 (`librax:hostedZoneId` e `librax:hostedZoneName`) a stack cria todos. Com
DNS fora da AWS, depois do deploy:

| Registro | Tipo | Valor (output do CDK) |
|---|---|---|
| `<dominio>` | ALIAS/ANAME (ou CNAME na raiz, se o provedor achata) | `LandingDistributionDomain` |
| `www.<dominio>` | CNAME | `LandingDistributionDomain` |
| `app.<dominio>` | CNAME | `DistributionDomain` |
| `auth.<dominio>` | CNAME | `AuthDomainCloudFront` |

Além deles, os CNAME de validação que o ACM pede. O Cognito só aceita `auth.<dominio>` se `<dominio>` já
resolver: com DNS fora da AWS, crie um registro A provisório para `<dominio>` antes do primeiro deploy.

## Publicar a landing

```bash
cd infra
npm run landing:build     # build local, sem AWS (o synth tira dele o hash da CSP)
npm run deploy            # stack: bucket, CloudFront e CSP da landing
npm run landing:publicar  # confere a conta, build com os outputs, sync e invalidação
```

- `landing:build` roda o build do `apps/landing` com `VITE_APP_URL=https://app.<dominio>/` e
  `SITE_ORIGIN=https://<dominio>`, tirados do contexto (`cdk.context.json` e `cdk.json`).
- `landing:publicar` lê os outputs da stack (`AppUrl`, `LandingUrl`, `LandingBucketName`,
  `LandingDistributionId`, `LandingScriptHashes`), faz o build de novo com essas URLs, confere se a CSP
  publicada libera o script inline do build e então roda
  `aws s3 sync apps/landing/dist s3://<LandingBucketName> --delete` e invalida `/index.html`, `/en/index.html` e
  `/es/index.html`. Se o hash não bate, ele para antes do upload: rode `npm run deploy` e publique de novo.
- Cache: `/assets/*` (nome com hash) é imutável por um ano; as páginas e o resto (ícones, fontes, imagens),
  5 minutos. Caminho que não existe devolve 404 com a página inicial.
- CSP: tudo da própria origem e os scripts inline liberados pelo hash, sem `'unsafe-inline'`: o da raiz (leva
  ao idioma do navegador) e o de uma linha das três páginas (marca o `<html>` com JS antes de desenhar, para a
  abertura já abrir na moldura da mão em 3D, sem mostrar antes as mãos desenhadas). Sem o build, o synth usa o hash gravado em `infra/lib/landing.ts` e avisa; quando o
  script muda, o synth avisa para atualizar esse hash (`npm run landing:hash` mostra o valor novo).
- A mão em 3D da abertura (carregada depois da página: cerca de 300 kB comprimidos, entre o motor 3D e o
  modelo) pede três liberações, todas da própria origem: `'wasm-unsafe-eval'` em `script-src` (o
  descompressor do modelo é WebAssembly embutido no JS) e `blob:` em `img-src` e `connect-src` (a textura
  que vem dentro do GLB). A mesma mão aparece no app, na apresentação das letras e dos números
  (`apps/web-poc/src/mao3d`): a CSP do app (`infra/lib/web-headers.ts`) já tinha `'wasm-unsafe-eval'` (MediaPipe)
  e `blob:` em `img-src`, e ganhou `blob:` em `connect-src`.

## App Android (assetlinks.json)

O app Android da Play Store (`apps/android-twa`) abre o site do app numa Trusted Web Activity. Para o Chrome
abrir em tela cheia, `https://app.<dominio>/.well-known/assetlinks.json` precisa declarar o pacote e o
certificado do app. A stack serve esse arquivo direto do CloudFront do app (CloudFront Function,
`infra/lib/assetlinks.ts`), gerado das chaves `librax:androidPackageName` (padrão `br.com.librax.app`) e
`librax:androidCertFingerprints` (SHA-256 separados por vírgula: a chave de upload e a da assinatura de apps
do Google Play). Sem impressão digital ele sai como `[]` e o synth avisa. Depois de preencher, `npm run deploy`.
Passo a passo da publicação: [`docs/android-twa.md`](android-twa.md).
