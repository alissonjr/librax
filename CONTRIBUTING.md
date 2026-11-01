# Como contribuir com o Librax

Obrigado pelo interesse em ajudar. O Librax é mantido por uma pessoa só, então este guia tenta deixar claro o
caminho mais curto entre a sua ideia e uma mudança aceita.

Toda participação segue o [código de conduta](CODE_OF_CONDUCT.md). Falhas de segurança não vão em issue
pública: veja a [política de segurança](SECURITY.md).

## Antes de começar

- **Procure nas [issues](https://github.com/alissonjr/librax/issues)** se o assunto já existe.
- **Para mudanças grandes** (tela nova, rota nova na API, mudança na infra, modelo de reconhecimento novo), abra
  uma issue de sugestão antes de escrever o código, para combinar o caminho.
- **Correções pequenas** (texto, teste, bug com causa clara) podem ir direto para um pull request.
- A documentação, as issues e as mensagens de commit são em português do Brasil.

## Preparar o ambiente

Requisitos:

- **Node.js 22** e npm (o mesmo Node das Lambdas e do CodeBuild).
- **Docker** com `docker compose` e `openssl`, só se for usar o ambiente local que simula a AWS.
- **Python 3**, só se for mexer no treino do reconhecimento (`ml-training/`).

Você **não precisa de conta na AWS** para contribuir. Nenhum teste e nenhum comando de desenvolvimento usa a AWS.

```bash
# 1. Faça um fork no GitHub e clone o seu fork
git clone https://github.com/<seu-usuario>/librax.git
cd librax

# 2. Instale as dependências dos cinco pacotes (npm ci em cada um)
bash infra/ci/ci.sh instalar

# 3. Rode o app
cd apps/web-poc
npm run dev            # http://localhost:5173
```

Os outros jeitos de rodar (landing, painel com dados de exemplo, app no celular e o ambiente completo com
DynamoDB e Cognito simulados) estão no [README](README.md#como-rodar-localmente) e em
[`docs/ambiente-local.md`](docs/ambiente-local.md).

## Onde fica cada coisa

| Quero mexer em | Pasta | Leia antes |
|---|---|---|
| Telas, exercícios, câmera | `apps/web-poc` | [`apps/web-poc/README.md`](apps/web-poc/README.md), [`docs/design-system.md`](docs/design-system.md) |
| Lições e sinais do curso | `apps/web-poc/src/assets/content` | [`docs/spec-03-curriculo-fases-avaliacao.md`](docs/spec-03-curriculo-fases-avaliacao.md) |
| Regras de XP, sequência, ligas, API | `services/api` | [`services/api/README.md`](services/api/README.md) |
| Infraestrutura | `infra` | [`docs/spec-02-backend-gestao-engajamento.md`](docs/spec-02-backend-gestao-engajamento.md) |
| Site | `apps/landing` | [`docs/design-system.md`](docs/design-system.md) |
| Painel | `apps/admin-web` | [`docs/painel-admin.md`](docs/painel-admin.md) |
| Reconhecimento (treino) | `ml-training` | [`docs/spec-01-reconhecimento.md`](docs/spec-01-reconhecimento.md) |

## Combinados do projeto

- **Testes junto com a mudança.** O domínio do backend é escrito com TDD (`services/api/test/`) e o app tem
  testes com vitest em `apps/web-poc/src/__tests__/`. Comportamento novo ou bug corrigido vem com teste.
- **Textos de interface nos três idiomas.** Todo texto novo do app entra em `pt-BR.json`, `en.json` e `es.json`
  (`apps/web-poc/src/i18n/locales/`); um teste falha se faltar alguma chave.
- **Design system.** Cores, espaços e tipografia vêm dos tokens (`docs/design-tokens.json`, que gera
  `apps/web-poc/src/styles/tokens.css`). Siga o checklist da seção 12.1 de
  [`docs/design-system.md`](docs/design-system.md). Uma regra que costuma pegar: **nunca usar faixa colorida
  lateral em cards** (borda esquerda grossa ou barra vertical de acento); para identidade ou estado, use selo,
  ícone, fundo ou contorno completo.
- **Acessibilidade e cultura surda.** Nada pode depender de som: instrução, acerto e dica aparecem na tela.
- **Privacidade.** A imagem da câmera nunca sai do aparelho. Não envie imagem, vídeo nem landmarks para fora sem
  que isso tenha sido combinado numa issue.
- **Sem segredos no git.** Arquivos `.env` e `.env.local` ficam fora do repositório (só o `.env.example` é
  versionado). Não versione chaves, senhas, ids de conta ou dados de pessoas.
- **Escopo pequeno.** Um pull request por assunto. Refatoração sem relação com a mudança vai em outro PR.

## Branch

O mantenedor trabalha direto no `main`, então o repositório não tem um padrão de nome de branch. Para contribuir,
crie uma branch no seu fork a partir do `main` atualizado, com um nome curto e descritivo:

```bash
git checkout main
git pull
git checkout -b ligas-aviso-pouca-gente
```

## Mensagens de commit

O histórico segue um padrão simples, que vale manter:

- Em português, com acentos.
- Uma frase curta no título, dizendo o que muda do ponto de vista de quem usa ou mantém, sem ponto final.
- Quando ajuda, a área no começo seguida de dois-pontos: `App:`, `Painel:`, `Site:`, `Landing:`, `Ligas:`,
  `Sinais:`, `CI:`, `Docs:`.
- Sem prefixos como `feat:` ou `fix:`.
- Corpo opcional, em lista com `- `, explicando o que mudou em cada parte e por quê.

Exemplos do histórico:

```text
Ligas: com menos de 10 pessoas, ninguém sobe nem desce na semana
Painel: botão para baixar os dados de calibração num arquivo só
Trocar o nome em Configurações, com o nome da conta valendo num aparelho novo
```

## Rodar os testes antes do PR

O repositório não roda testes automaticamente em pull requests. Antes de abrir o seu, rode a suíte completa na
raiz do repositório:

```bash
bash infra/ci/ci.sh testar
```

Ela roda, na ordem, os testes da API (`node --test`), da landing, do painel, da infra (vitest e `tsc`) e do app
(`content:check`, `tsc -b` e vitest), e para na primeira falha. Para iterar mais rápido, rode `npm test` só no
pacote que você mudou e deixe a suíte completa para o fim. Cole no PR o resumo do resultado.

Se mudou lições ou sinais, `npm run content:check` em `apps/web-poc` confere o conteúdo. Se mudou tokens de
design, `npm run tokens:check` confere os arquivos gerados e o contraste.

## Abrir uma issue

Use os modelos em [Issues > New issue](https://github.com/alissonjr/librax/issues/new/choose):

- **Bug**: o que aconteceu, os passos para repetir, o que era esperado e o aparelho e navegador.
- **Sugestão**: o problema que a ideia resolve e como você imagina a solução. Vale também para sinal errado ou
  texto confuso no curso.

Não coloque e-mail, senha, código de login nem fotos de pessoas na issue.

## Abrir um pull request

1. Atualize a sua branch com o `main` do repositório.
2. Rode `bash infra/ci/ci.sh testar` e confira que tudo passou.
3. Abra o PR para o `main` de `alissonjr/librax` e preencha o modelo: o que muda, por quê, a issue relacionada
   (`Closes #123`) e como você testou. Para mudança visual, inclua prints de antes e depois, no claro e no escuro.
4. Responda os comentários da revisão com novos commits na mesma branch.

Publicar uma versão (tags `vX.Y.Z`) é feito só pelo mantenedor; não crie tags no PR.

## Licença das contribuições

O Librax é licenciado sob a [AGPL-3.0-only](LICENSE). Ao enviar uma contribuição, você concorda que ela seja
distribuída sob essa mesma licença.
