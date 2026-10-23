# Librax API - logica de dominio (backend)

Nucleo server-authoritative das SPEC 02 (engajamento) e SPEC 04 (squads), escrito
com TDD (testes antes do desenvolvimento). E a parte do backend que independe de
AWS: regras puras + orquestracao sobre uma porta de repositorio.

## Por que JS + `node:test` (e nao TS)

A SPEC 02 pede "Lambda (Node/TS)". Aqui o codigo e JS (ESM) com o runner embutido
`node:test`, por um motivo pratico: garante o ciclo vermelho-verde do TDD sem
instalar nada e sem depender de rede. A logica e pura e mapeia 1:1 para TypeScript
quando formos empacotar as Lambdas (adicionar tipos e um `tsconfig`, sem reescrever).

## Rodar os testes

```bash
cd services/api
node --test          # Node 20+
```

(76 testes no momento; ver `test/`.)

## Estrutura

```
services/api/
├── src/
│   ├── domain/        # funcoes puras (sem I/O) - o coracao das regras
│   │   ├── dates.js          aritmetica de datas-calendario
│   │   ├── streak.js         ofensiva (SPEC 02 secao 5.1)
│   │   ├── srs.js            SM-2 adaptado (SPEC 03 secao 6)
│   │   ├── xp.js             XP server-authoritative + meta diaria (SPEC 02 secao 5.2)
│   │   ├── achievements.js   regras declarativas (SPEC 02 secao 5.4)
│   │   ├── squads.js         guardas de squad (SPEC 04 secoes 0 e 2)
│   │   ├── invite.js         codigo de convite (SPEC 04 secao 2)
│   │   ├── leagues.js        ranking + promocao/rebaixamento (SPEC 02 secao 5.5)
│   │   ├── dailyQueue.js     fila SRS + conteudo novo (SPEC 03 secao 6)
│   │   └── profile.js        perfil default (SPEC 02 secao 3)
│   ├── usecases/      # orquestram dominio + repositorio
│   │   ├── completeLesson.js XP + streak + SRS + conquistas + fan-out (SPEC 02/04)
│   │   ├── getDailyQueue.js  monta a fila do dia
│   │   └── squads.js         create / join / leave / manageMember (SPEC 04 secao 2)
│   └── adapters/
│       └── inMemoryRepo.js   implementa a porta em memoria (testes e dev local)
└── test/              # um arquivo por modulo; testes escritos antes do codigo
```

## A porta de repositorio

Os usecases dependem de uma interface de repositorio (metodos como `getProfile`,
`saveSrsItem`, `incrementSquadXp`, `findSquadIdByInvite`, ...). O `InMemoryRepo`
a implementa para testes. O adaptador de producao (DynamoDB single-table, SPEC 02
secao 3 / SPEC 04 secao 1) deve implementar **os mesmos metodos**, traduzindo cada
um para os padroes de acesso `PK`/`SK`/GSI da tabela `librax`.

## O que ainda NAO esta aqui (e por que)

Estas camadas precisam de AWS ou de um device para ter sentido, entao ficam para
quando o ambiente tiver esses recursos; o nucleo testavel de que elas dependem ja
esta pronto:

- **Adaptador DynamoDB** (`dynamoRepo.js`) - implementa a porta sobre a tabela real.
- **Handlers HTTP (API Gateway + Lambda)** - validacao de request, authorizer Cognito,
  serializacao; chamam os usecases.
- **Auth (Cognito)** - convidado, e-mail, Google, Apple, migracao de convidado.
- **Pipeline de conteudo** - bundle JSON validado por schema -> S3/CloudFront.
- **App Flutter (SPEC 01/03 frontend) e classificador on-device** - sem Dart/Flutter
  SDK neste ambiente; o spike vive em `apps/mobile_flutter/`.

Cada usecase aqui e o ponto de entrada que esses handlers vao chamar.
