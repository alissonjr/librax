# Librax

App gratuito para adultos aprenderem Libras (Língua Brasileira de Sinais) do zero, com lições curtas, um avatar
que sinaliza e uma câmera que confere a forma da sua mão. Roda no navegador do celular, sem instalar nada pela
loja, e funciona offline.

- Site: <https://librax.online>
- App: <https://app.librax.online>

O projeto está em beta. Os sinais do curso ainda estão marcados como rascunho e a câmera ainda não confere todos
eles (veja [O que a câmera confere](#o-que-a-câmera-confere)).

## Recursos

- **Curso do zero**: do alfabeto manual às primeiras frases, com 14 unidades, 57 lições e 255 sinais
  (`apps/web-poc/src/assets/content/`). Temas como números, cumprimentos, família, sentimentos, tempo, cores,
  comida, lugares, verbos, dinheiro e cultura surda.
- **Avatar que sinaliza**: o avatar do [VLibras](https://www.gov.br/governodigital/pt-br/vlibras) mostra cada
  sinal, com repetição e velocidade reduzida.
- **Câmera que confere**: a pessoa faz a letra, o número ou o sinal e vê na hora se acertou, com dica do que
  mudar na mão. O reconhecimento roda no aparelho: a imagem da câmera nunca sai dele, só os pontos da mão e do
  corpo são usados, e nada disso é enviado.
- **Mão em 3D**: gira para ver cada letra de outro ângulo e comparar as parecidas.
- **Vários tipos de exercício**: apresentação do sinal, assistir e escolher, pares, ordenar, montar frase com
  as glosas, datilologia, prática no espelho e câmera.
- **Teste de nivelamento** opcional, que confere na câmera as letras que a pessoa já sabe.
- **Engajamento**: meta diária, sequência de dias, XP, conquistas, revisão espaçada (SM-2), liga da semana, liga
  geral e ligas privadas com convite.
- **Sem cadastro**: dá para usar como convidado, com o progresso no aparelho (IndexedDB). A conta (e-mail e
  senha) é opcional e sincroniza o progresso entre aparelhos.
- **Offline e instalável** (PWA): "Baixar para usar offline" nas Configurações deixa lições, avatar e câmera
  funcionando sem internet; o progresso sincroniza quando a conexão volta.
- **Lembretes** por notificação do navegador (Web Push), quando ligados na publicação.
- **Interface em português, inglês e espanhol** (a língua ensinada é a Libras).
- **Painel de administração** para quem está no grupo `admin`: operação, uso, conteúdo, contas e custo, com as
  telas só de leitura e poucas ações de conta (desativar, reativar ou excluir).

### O que a câmera confere

Hoje a câmera confere as letras paradas do alfabeto manual, as letras com movimento H, J, K, X e Ç, alguns números
e um grupo de sinais com movimento. O Z ainda é praticado sem conferência. Os números atualizados, com a forma
como foram medidos (pessoas que nunca entraram no treino), ficam em `apps/landing/src/numeros.json` e na seção
"Quanto o app acerta" do site.

## Stack

| Parte | Tecnologias |
|---|---|
| App (`apps/web-poc`) | React 18, TypeScript, Vite 5, `vite-plugin-pwa`, React Router, IndexedDB (`idb`), Three.js, MediaPipe Tasks Vision, AWS Amplify (login) |
| Landing (`apps/landing`) | TypeScript e Vite, páginas geradas no build (pt, en, es) |
| Painel (`apps/admin-web`) | React 18, TypeScript, Vite 5 |
| API (`services/api`) | Node.js 22 (JavaScript ESM), testes com `node:test`, AWS Lambda, DynamoDB (tabela única), Cognito, SES, Web Push |
| Infra (`infra`) | AWS CDK em TypeScript: HTTP API, DynamoDB, Cognito, S3, CloudFront, EventBridge Scheduler, alarmes e orçamento |
| Treino do reconhecimento (`ml-training`) | Python: MediaPipe, NumPy, scikit-learn, TensorFlow, OpenCV |
| Android (`apps/android-twa`) | Trusted Web Activity (Gradle), casca da Play Store em volta do site |

## Estrutura

```text
apps/
  web-poc/         o app (PWA) que roda no navegador do celular
  landing/         site em librax.online
  admin-web/       painel de administração (/admin)
  android-twa/     app Android (TWA) e material da Play Store
  mobile_flutter/  spike em Flutter, congelado (só referência)
services/api/      domínio do backend, handlers Lambda e ambiente local que simula a AWS
infra/             stacks do AWS CDK, scripts de lançamento e CI (infra/ci/ci.sh)
ml-training/       scripts de treino dos modelos de reconhecimento e dados versionados
tools/             geradores usados no build: tokens de design, ícones, sons, ícones do PWA e lições
docs/              visão geral, specs, design system, operação e lançamento
estudo/            estudos de identidade visual e marca
```

## Como rodar localmente

Requisitos: **Node.js 22** (o mesmo das Lambdas e do CodeBuild; o ambiente local aceita Node 20 ou mais novo) e
npm. Para o ambiente completo com a AWS simulada, também Docker (com `docker compose`) e `openssl`. Nenhum
comando abaixo usa uma conta da AWS.

### Só o app (como convidado, sem backend)

```bash
cd apps/web-poc
npm ci
npm run dev            # http://localhost:5173
```

Na primeira vez o `npm run dev` baixa os modelos do MediaPipe e o avatar VLibras para `.cache/` e confere o
SHA-256 de cada arquivo; depois funciona sem internet. Para abrir no celular pela rede local (a câmera exige
HTTPS), use `npm run dev:celular`. Detalhes em [`apps/web-poc/README.md`](apps/web-poc/README.md).

Sem as variáveis `VITE_COGNITO_*` (veja `apps/web-poc/.env.example`) o app roda só como convidado.

### Landing e painel

```bash
cd apps/landing && npm ci && npm run dev        # http://127.0.0.1:5198
cd apps/admin-web && npm ci && npm run dev:mock # painel com dados de exemplo, porta 5310
```

### Ambiente completo (AWS simulada na máquina)

DynamoDB e Cognito simulados em containers, com a API, o login e contas de teste:

```bash
cd services/api
npm ci
npm run local:up       # containers, template da infra e dados de exemplo
npm run local          # API e login local (deixe aberto)

cd apps/web-poc   && npm run dev:local   # app em http://127.0.0.1:5320/
cd apps/admin-web && npm run dev:local   # painel em http://127.0.0.1:5321/admin/
```

Portas, contas de teste e o passo a passo estão em [`docs/ambiente-local.md`](docs/ambiente-local.md).

## Testes

A suíte completa, a mesma exigida antes de qualquer envio para o `main`:

```bash
bash infra/ci/ci.sh instalar   # npm ci nos cinco pacotes
bash infra/ci/ci.sh testar     # api, landing, painel, infra (vitest e tsc) e app (content:check, tsc -b e vitest)
```

Também dá para rodar um pacote só, com `npm test` dentro de `services/api`, `apps/landing`, `apps/admin-web`,
`infra` ou `apps/web-poc`. O teste de ponta a ponta do ambiente local é `npm run test:e2e` em `services/api`.

Nenhum teste chama a AWS.

## Publicação

O site e a infraestrutura são publicados pelo mantenedor: uma tag de versão (`vX.Y.Z`) dispara o CodeBuild na
conta AWS do projeto. Push no `main` e pull requests não publicam nada. Detalhes em
[`docs/ci-cd.md`](docs/ci-cd.md) e [`docs/lancamento.md`](docs/lancamento.md).

## Documentação

- [Visão geral](docs/00-visao-geral.md): decisões de produto, documentos e roadmap
- [Design system](docs/design-system.md): princípios, voz, tokens, componentes e acessibilidade
- [SPEC 01: reconhecimento](docs/spec-01-reconhecimento.md)
- [SPEC 02: backend AWS serverless](docs/spec-02-backend-gestao-engajamento.md)
- [SPEC 03: currículo e avaliação](docs/spec-03-curriculo-fases-avaliacao.md)
- [Backend e endpoints](services/api/README.md)
- [Painel de administração](docs/painel-admin.md)

## Como contribuir

Contribuições são bem-vindas: correções, testes, acessibilidade, textos e sinais. Leia o
[guia de contribuição](CONTRIBUTING.md) antes de abrir um pull request e siga o
[código de conduta](CODE_OF_CONDUCT.md). Para reportar uma falha de segurança, veja a
[política de segurança](SECURITY.md) (não abra issue pública).

## Licença

O código do Librax está sob a [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only): você pode usar,
estudar, modificar e redistribuir, desde que mantenha a mesma licença e, se colocar uma versão modificada no ar
para outras pessoas usarem, ofereça a elas o código-fonte dessa versão.

Componentes de terceiros mantêm as próprias licenças, entre eles as fontes Anybody e Figtree (SIL Open Font
License, em `apps/web-poc/public/fonts/`), o player do VLibras (LGPL-3.0, baixado sem alteração no build e fora
do git) e o MediaPipe (Apache-2.0).

Copyright (C) 2026 Alisson Júnior.

## Contato

Alisson Júnior, autor e mantenedor

- E-mail: <alisson.coj@hotmail.com>
- Site: <https://alissonjr.github.io/>
- LinkedIn: <https://www.linkedin.com/in/alissonjunior>

Para bugs e sugestões, use as [issues](https://github.com/alissonjr/librax/issues).
