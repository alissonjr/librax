# Login da conta AWS do Librax

O projeto tem um login próprio da AWS, separado do que a máquina usa no dia a dia. Ele usa o
IAM Identity Center: você entra pelo navegador, nenhuma senha ou chave fica salva e o acesso vence
sozinho. Fora dos comandos do projeto, o `aws` continua usando o `~/.aws` de sempre.

## Como funciona

- `infra/scripts/aws.sh <comando>` roda qualquer comando com o perfil `librax` da pasta `.aws/` na
  raiz do projeto (fora do git). Ele ignora o `~/.aws/config` e o `~/.aws/credentials` e descarta as
  credenciais, a região e os endpoints que estiverem no terminal (por exemplo os do ambiente local).
- A conta do Librax fica fixada em `librax:accountId` (`infra/cdk.json`, ou `infra/cdk.context.json`,
  que é local e fica fora do git). `npm run bootstrap`, `npm run diff` e `npm run deploy` conferem a
  conta do login antes de começar e recusam qualquer outra. Sem a conta fixada, recusam sempre. O CDK
  também usa esse número na stack, então ele mesmo recusa credenciais de outra conta.
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

Depois, preencha `"librax:accountId"` em `infra/cdk.json` com o número da conta e confira:

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
