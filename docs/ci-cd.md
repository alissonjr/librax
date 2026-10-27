# CI/CD do Librax (publicar com uma tag)

Depois do primeiro lançamento ([`lancamento.md`](lancamento.md)), publicar uma versão nova não precisa mais do
CloudShell. Você cria uma tag de versão no Git (por exemplo `v1.2.0`) e envia para o GitHub. A AWS percebe,
roda **todos os testes** do projeto e, só se todos passarem, publica a stack, o app, o painel e a landing,
exatamente como o script do CloudShell faz. No fim chega um e-mail dizendo se deu certo.

Tudo roda dentro da AWS, no **CodeBuild** (o serviço de builds da AWS), sem GitHub Actions e sem servidor
próprio. Um push comum no `main` não publica nada, e pull requests não rodam nada: só tags `vX.Y.Z`.

| Peça | Onde fica |
|---|---|
| Projeto do CodeBuild `librax-lancamento` | stack `LibraxCiStack` ([`infra/lib/ci-stack.ts`](../infra/lib/ci-stack.ts)) |
| Passos do build | [`infra/ci/buildspec.yml`](../infra/ci/buildspec.yml) e [`infra/ci/ci.sh`](../infra/ci/ci.sh) |
| Publicação | o mesmo [`infra/scripts/lancar-cloudshell.sh`](../infra/scripts/lancar-cloudshell.sh), com `--ci` |
| Valores do lançamento (domínio, certificado, e-mail, opções) | parâmetro `/librax/cdk-context` no SSM, gravado pelo CloudShell |
| Aviso do resultado | o mesmo tópico de alarmes (`librax-alarms`) e o mesmo e-mail dos alarmes |

## Quanto custa

O CodeBuild dá **100 minutos de build por mês de graça**, sem prazo para acabar (máquina
`general1.small`, 2 processadores e 4 GB). Passou disso, cada minuto custa US$ 0,005. O resto é grátis: a conexão
com o GitHub, a regra que manda o e-mail, o parâmetro do SSM (nível padrão) e os logs (guardados por 2 semanas,
poucos MB por build).

Cada versão leva por volta de **18 minutos**: 1 de preparo da máquina, 3 a 5 de `npm ci` nos cinco pacotes,
3 a 4 de testes, 2 a 3 de build do app (com os modelos de ML e o avatar VLibras), 3 a 6 do deploy da stack e 1 a
2 de upload. Quando a mudança mexe no CloudFront, o deploy pode levar mais 10 minutos. Build que falha nos testes
para antes do deploy e gasta uns 8 minutos.

| Versões por mês | Minutos (18 por versão) | Custo | Se cada versão levar 30 minutos |
|---|---|---|---|
| 5 | 90 | US$ 0,00 (dentro dos 100 grátis) | 150 min: US$ 0,25 |
| 10 | 180 | US$ 0,40 | 300 min: US$ 1,00 |
| 20 | 360 | US$ 1,30 | 600 min: US$ 2,50 |

O AWS Budget mensal do Librax já inclui esse gasto. Contas criadas depois de julho de 2025 entram no plano novo do
nível gratuito da AWS: confira em **Faturamento e Gerenciamento de Custos > Nível gratuito** (Billing and Cost
Management > Free Tier) se os 100 minutos do CodeBuild aparecem.

## Configurar (uma vez)

Pré-requisitos: o primeiro lançamento feito pelo CloudShell (a stack `LibraxStack` no ar) e a assinatura do e-mail
dos alarmes confirmada (o e-mail "AWS Notification - Subscription Confirmation" do passo 9 do lançamento).

1. Abra o CloudShell e clone o repositório em `/tmp`, como nos passos 6 e 7 do
   [`lancamento.md`](lancamento.md#passo-6-token-do-github-só-leitura).
2. Rode:

   ```bash
   cd /tmp/librax
   bash infra/scripts/lancar-cloudshell.sh --configurar-ci
   ```

   O script confere a conta e a `LibraxStack`, avisa se o e-mail dos alarmes ainda não foi confirmado, grava os
   valores do lançamento no SSM e cria a conexão com o GitHub. A conexão nasce **Pendente**: a AWS exige que o
   dono do GitHub aprove uma vez pelo console. O script mostra os passos abaixo e espera.
3. Aprove a conexão (o console pode estar em português ou em inglês; os dois nomes estão aqui):
   1. Em outra aba, abra
      `https://console.aws.amazon.com/codesuite/settings/connections?region=us-east-1`
      (**Ferramentas do desenvolvedor > Configurações > Conexões**; em inglês, **Developer Tools > Settings >
      Connections**). Confira que a região, no canto superior direito, é **Leste dos EUA (Norte da Virgínia)**.
   2. Clique em **librax-github** (status **Pendente** / **Pending**) e depois em **Atualizar conexão pendente**
      (**Update pending connection**). Abre uma janela do GitHub; se o navegador bloquear, libere os pop-ups.
   3. No GitHub, clique em **Authorize AWS Connector for GitHub**.
   4. De volta à janela da AWS, em **Aplicativos do GitHub** (**GitHub Apps**), clique em **Instalar um novo
      aplicativo** (**Install a new app**). No GitHub, escolha a conta **alissonjr**, marque **Only select
      repositories**, escolha **alissonjr/librax** e clique em **Install**. Se o GitHub pedir, aceite as
      permissões novas (**Accept new permissions**). Se o app já estava instalado, basta escolher a instalação que
      aparece na lista.
   5. Clique em **Conectar** (**Connect**). O status vira **Disponível** (**Available**).
4. Volte ao CloudShell e aperte **Enter**. O script confere a conexão e cria o projeto do CodeBuild, o webhook das
   tags e o aviso por e-mail. Termina com "CI/CD pronto". Se a sessão do CloudShell caiu no meio, rode o mesmo
   comando de novo: ele continua de onde parou.
5. Confira em **CodeBuild > Projetos de build** (**Build projects**): aparece `librax-lancamento`.

O e-mail que recebe o resultado dos builds é o mesmo dos alarmes. Não há assinatura nova para confirmar.

## Publicar uma versão

Com a mudança já no `main` do GitHub, no seu computador:

```bash
git checkout main && git pull
git tag v1.0.0
git push origin v1.0.0
```

A tag precisa ter o formato `v` + três números (`v1.0.0`, `v1.4.2`, `v2.0.0`). `v1.0`, `1.0.0` ou
`v1.0.0-beta` não disparam nada. Suba sempre o número: o último quando é correção (`v1.0.1`), o do meio quando é
novidade (`v1.1.0`). Uma tag por vez: espere o e-mail do build anterior antes de enviar a próxima (com um build
rodando, o CodeBuild recusa o segundo e ele não roda; veja [Rodar de novo](#rodar-de-novo)).

O que acontece, em ordem (cada etapa só começa se a anterior deu certo):

1. Confere que o build veio de uma tag de versão.
2. Instala as dependências (`npm ci`) de `services/api`, `apps/landing`, `apps/admin-web`, `infra` e `apps/web-poc`.
3. Roda os testes: `services/api` (`node --test`), `apps/landing` e `apps/admin-web` (vitest), `infra` (vitest e
   `tsc`), `apps/web-poc` (conteúdo das lições, `tsc -b` e vitest). **Qualquer teste vermelho para tudo aqui,
   antes de publicar.**
4. Publica com `lancar-cloudshell.sh --ci`: lê os valores do SSM, confere a conta, a zona, o certificado e o DNS,
   faz o deploy da `LibraxStack`, o build e o upload do app e do painel e publica a landing.

No fim chega no e-mail dos alarmes uma mensagem "Librax CI/CD: SUCCEEDED na versão v1.0.0" (publicado), ou
`FAILED`/`STOPPED` com o link do log.

## Ver os logs

- **CodeBuild > Projetos de build > librax-lancamento > Histórico de build** (**Build projects > librax-lancamento
  > Build history**). Clique no build: a aba **Logs de build** (**Build logs**) mostra a saída inteira, e
  **Detalhes da fase** (**Phase details**) mostra em que etapa parou (`INSTALL` é dependências, `PRE_BUILD` são os
  testes, `BUILD` é a publicação).
- O link do log também vem no e-mail do resultado.
- Os mesmos logs ficam em **CloudWatch > Grupos de logs > /aws/codebuild/librax-lancamento** (**Log groups**) por 2
  semanas.

Os logs não mostram segredos: os valores do lançamento são lidos do SSM direto para um arquivo, e o e-mail dos
alarmes aparece mascarado.

## Rodar de novo

Para repetir a mesma versão (por exemplo, depois de uma falha passageira no download do VLibras):

1. **CodeBuild > Projetos de build > librax-lancamento > Iniciar build com substituições** (**Start build with
   overrides**).
2. Em **Origem** (**Source**), no campo **Versão da origem** (**Source version**), digite a tag, por exemplo
   `v1.0.0`.
3. **Iniciar build** (**Start build**).

Prefira esse caminho ao **Repetir build** (**Retry build**): o build repetido pode não levar o nome da tag e então
para no primeiro passo, sem publicar nada. Um build iniciado com outra coisa na versão da origem (o `main`, um
commit) também para no primeiro passo: só tags de versão publicam.

## Voltar para uma versão anterior

Tags não mudam de lugar, e o CI só reage a tag nova. Para voltar ao que estava no ar na `v1.2.0`, crie uma versão
nova apontando para o mesmo commit:

```bash
git fetch --tags
git tag v1.2.2 'v1.2.0^{commit}'   # a v1.2.2 nova aponta para o mesmo commit da v1.2.0
git push origin v1.2.2
```

O CI testa e publica aquele código de novo, com a stack, o app, o painel e a landing daquela época. Depois corrija
no `main` e siga com a próxima versão (`v1.2.3`). Não apague nem mova tags já enviadas.

## Quando falha

O e-mail diz `FAILED`. Abra o log (acima) e veja a última mensagem começando com `ERRO:`.

| Onde parou ou o que diz | O que fazer |
|---|---|
| `PRE_BUILD` (testes) | nada foi publicado. Corrija no `main` e envie uma versão nova (`v1.0.1`) |
| "Este build não veio de uma tag de versão" | o build foi iniciado sem a tag; use [Rodar de novo](#rodar-de-novo) com a tag |
| "Não consegui ler /librax/cdk-context no SSM" ou "Falta no /librax/cdk-context do SSM" | rode o lançamento completo uma vez no CloudShell (`bash infra/scripts/lancar-cloudshell.sh`): ele regrava o parâmetro |
| Erro no download do VLibras ou dos modelos de ML | falha passageira dos servidores; [rode de novo](#rodar-de-novo) |
| Erro no deploy da stack | o CloudFormation desfaz sozinho e a versão anterior continua no ar. O motivo fica em **CloudFormation > LibraxStack > Eventos** (**Events**) |
| Falhou depois do deploy (no upload do app, do painel ou da landing) | a stack nova já está no ar e os sites ainda são os anteriores; [rode de novo](#rodar-de-novo) a mesma versão |
| "O login ativo é da conta ..." | o projeto foi criado em outra conta; apague a `LibraxCiStack` dessa conta e configure de novo na conta do Librax |
| "A conta não tem o bootstrap do CDK" | faça o lançamento completo pelo CloudShell (ele faz o bootstrap) |
| `STOPPED` | alguém parou o build no console, ou ele passou de 60 minutos; [rode de novo](#rodar-de-novo) |
| Enviei a tag e nada aconteceu | outra tag estava rodando (o CodeBuild recusa o segundo build): [rode de novo](#rodar-de-novo) com a tag. Confira também se a tag tem o formato `vX.Y.Z` e se a conexão `librax-github` continua **Disponível** |
| "Authentication required for primary source" ou falha ao baixar o código | o app do GitHub perdeu o acesso ao repositório: GitHub > **Settings > Applications > AWS Connector for GitHub > Configure** e confira `alissonjr/librax` |

## Mudar valores do lançamento

O CI publica sempre com os valores gravados no SSM pela última rodada completa no CloudShell. Para ligar o login
com Google, trocar o e-mail dos alarmes, o orçamento, o SES ou a concorrência reservada, rode o lançamento completo
no CloudShell com a opção (por exemplo `--com-google`), como em [`lancamento.md`](lancamento.md#depois-do-lançamento).
No fim do deploy o script atualiza o `/librax/cdk-context` e as próximas versões do CI já saem com o valor novo.

O parâmetro é `SecureString` (cifrado com a chave padrão do SSM, sem custo). Ele não guarda segredo (a chave do
Google fica no Secrets Manager e a chave privada do VAPID no SSM, fora dele), mas tem o e-mail dos alarmes.

O alerta de anomalia de custo é o único valor que o CI nunca decide sozinho: a consulta ao Cost Explorer custa
US$ 0,01 por chamada, então o CI repete a escolha da última rodada do CloudShell.

## O que o CI pode fazer na conta

O papel do CodeBuild tem só o que o script usa numa rodada completa:

- assumir os papéis do bootstrap do CDK (`cdk-hnb659fds-deploy-role`, `-file-publishing-role` e `-lookup-role`),
  que fazem o deploy da `LibraxStack` pelo CloudFormation, como no CloudShell;
- ler o estado e os outputs da `LibraxStack` e do `CDKToolkit`;
- ler os parâmetros `/librax/cdk-context`, `/librax/vapid/public-key` e `/librax/google/client-id`;
- conferir, só lendo, a zona do Route 53, o certificado do ACM, a identidade e a conta do SES, a cota do Lambda e
  se o segredo do Google existe (sem ler o valor);
- enviar e apagar arquivos só nos buckets da `LibraxStack` (nomes começando com `libraxstack-`);
- invalidar o cache do CloudFront (as páginas da landing);
- usar a conexão `librax-github` para baixar o código.

Ele não cria o bootstrap, não muda o IAM direto, não grava no SSM e não consulta o Cost Explorer. Como no
CloudShell, o papel de deploy do CDK pode mudar qualquer recurso da `LibraxStack`: é o mesmo poder de um
`cdk deploy`. O CI nunca publica a própria `LibraxCiStack` (ela fica num app do CDK separado,
`infra/bin/librax-ci.ts`), então mudar o CI exige rodar `--configurar-ci` de novo no CloudShell.

O aviso por e-mail usa uma política no tópico `librax-alarms` que repete a padrão da AWS e libera só a regra
`librax-ci-resultado` do EventBridge. A `LibraxStack` não tem política própria nesse tópico (um teste confere).

## Desligar

No CloudShell, com o repositório em `/tmp/librax`:

```bash
cd /tmp/librax/infra && npm run aws:conta && ./scripts/aws.sh npx cdk destroy LibraxCiStack \
  --app "npx ts-node --prefer-ts-exts bin/librax-ci.ts"
```

Some o projeto, o webhook, a conexão, a regra e os logs; o tópico de alarmes volta à política padrão. O parâmetro
`/librax/cdk-context` fica (grátis); apague em **Systems Manager > Parameter Store** se quiser. No GitHub, o app
**AWS Connector for GitHub** pode ser desinstalado em **Settings > Applications**.

## Por que assim

- **CodeBuild sozinho, sem CodePipeline**: um projeto com webhook na tag faz tudo e fica nos 100 minutos grátis.
  O CodePipeline só acrescentaria etapas e uma cobrança por minuto de ação.
- **Conexão pelo GitHub App (CodeConnections)**: nenhum token do GitHub fica guardado na AWS, e o app enxerga só
  o repositório `alissonjr/librax`. A AWS documenta o webhook do CodeBuild com esse tipo de conexão.
- **Máquina x86 `general1.small`**: igual ao CloudShell e dentro do nível gratuito. A ARM pequena também é
  gratuita e um pouco mais barata depois dos 100 minutos, mas a x86 evita diferença de ambiente entre o
  CloudShell e o CI.
- **Cache local do CodeBuild** (grátis) para o npm e os downloads do app: só ajuda quando a AWS reaproveita a
  mesma máquina pouco depois, então entre versões espaçadas costuma começar vazio. O cache no S3 custaria
  armazenamento e foi deixado de fora.
