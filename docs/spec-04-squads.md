# SPEC 04 - Squads e equipes (executável)

> Cobre dados, backend e frontend completo da feature de squads/equipes.
> Liga-se a: SPEC 02 (DynamoDB single-table, Lambdas, XP, job semanal) e
> SPEC 03 (XP gerado por licao). B2B referencia o groundwork do ORG# da SPEC 02.

---

## 0. Conceito e regras de negócio

### 0.1 Squad B2C (criada por qualquer usuário autenticado)

- Qualquer usuário com conta ativa (não anonimo) pode criar uma squad.
- Visibilidade: pública (aparece no diretório) ou privada (apenas por código/link).
- Limite: cada usuário pode participar de ate 5 squads simultaneamente.
- Limite de membros por squad: 30 (padrão). Admin pode reduzir, nunca abaixo do total atual.
- Criador vira admin automaticamente. Admin pode promover membros a co-admin.
- Um squad precisa ter pelo menos 1 admin. Ao sair, o único admin deve transferir a propriedade ou a squad é dissolvida.
- Admin pode dissolver a squad; exige confirmação explícita.

### 0.2 Equipe B2B (dentro de uma org)

- Dentro de uma org, apenas admins da org podem criar equipes.
- Membros de equipes B2B são exclusivamente usuários vinculados àquela org.
- Um membro pode pertencer a várias equipes da mesma org (sem limite de squads B2B no contador de 5).
- Equipes B2B não aparecem no diretório público.
- Admins adicionam e removem membros diretamente; não há convite por código para o membro.
- A equipe B2B não pode ser criada pelo membro comum do app; o fluxo de gestão fica no painel institucional (fora do escopo mobile do MVP - ver secao 8).

### 0.3 XP e ranking

- XP semanal da squad: soma do XP gerado por todos os membros na semana corrente.
- Ranking interno: membros ordenados por `xpWeeklyContrib` (descendente).
- XP do usuário em múltiplas squads é o mesmo XP individual; não se duplica nem se divide.
- Reset toda segunda-feira 00:00 UTC - mesmo job que fecha as ligas (SPEC 02 secao 5.5).
- Ranking entre squads públicas: por `xpWeekly` total (implementar junto com o diretório).

---

## 1. Modelo de dados - DynamoDB (single-table `librax`)

### 1.1 Novas entidades

| Entidade | PK | SK | Atributos principais |
|---|---|---|---|
| Squad | `SQUAD#<id>` | `META` | name, description, type (public/private/org), orgId?, createdBy, inviteCode, maxMembers, memberCount, xpWeekly, xpAllTime, createdAt |
| Membro de squad | `SQUAD#<id>` | `MEMBER#<userId>` | role (admin/member), joinedAt, xpWeeklyContrib, xpAllTimeContrib |
| Equipe de org | `ORG#<id>` | `SQUAD#<squadId>` | name, memberCount (denormalizado) |

### 1.2 GSIs adicionais

| GSI | PK de acesso | SK de acesso | Para que serve |
|---|---|---|---|
| GSI3 | `USER#<userId>` | `SQUAD#<squadId>` | listar squads de um usuário (reverso do MEMBER#) |
| GSI4 | `TYPE#public` | `XP#<xpWeekly_10digits_padded>` | diretório de squads públicas ordenado por XP |
| GSI5 | `INVITE#<code>` | `SQUAD#<squadId>` | lookup de squad por código de convite |

Nota sobre GSI4: o SK precisa ser uma string com XP com zero-padding (ex: `XP#0000001240`) para ordenação lexicográfica correta. Scan reverso retorna do maior para o menor.

### 1.3 Padrões de acesso suportados

1. Get squad por ID: `PK=SQUAD#<id>, SK=META`.
2. Membros de uma squad: `PK=SQUAD#<id>, SK begins_with MEMBER#`.
3. Squads de um usuário: GSI3 `PK=USER#<userId>, SK begins_with SQUAD#`.
4. Squad por código de convite: GSI5 `PK=INVITE#<code>`.
5. Diretório público paginado: GSI4 `PK=TYPE#public` (scan reverso, limit + cursor).
6. Equipes de uma org: `PK=ORG#<id>, SK begins_with SQUAD#`.

### 1.4 Atualização de XP (fan-out server-side)

Quando `completeLesson` executa (SPEC 02 secao 5.2), alem de atualizar o perfil do usuário,
o Lambda incrementa `xpWeeklyContrib` em todos os `MEMBER#<userId>` das squads do usuário
e `xpWeekly` no `META` de cada squad. O app nao precisa de logica especial; o fan-out
acontece server-side.

Limite prático: usuário em 5 squads = 5 writes extras por licao concluída. Aceito no volume de MVP.

---

## 2. API - Lambdas

Todas as rotas passam pelo API Gateway (HTTP API) com authorizer Cognito - mesmo padrao da SPEC 02.

### createSquad
```
POST /squads
Body: { name, description?, type: "public"|"private" }
```
Regras: usuário nao anonimo; < 5 squads; nome 3-40 chars.
Ação: gera `id` (UUID) e `inviteCode` único (6 chars alfanumérico, case-insensitive armazenado em maiúsculas);
cria `SQUAD#<id>/META` + `SQUAD#<id>/MEMBER#<userId>` (role=admin) + entrada GSI3 + GSI4 (se público) + GSI5.
Retorno: squad completa.

### joinSquad
```
POST /squads/join
Body: { inviteCode } | { squadId }   -- squadId direto só para squads públicas
```
Regras: usuário nao anonimo; squad existe; `memberCount < maxMembers`; usuário nao é membro; < 5 squads.
Ação: cria `MEMBER#<userId>`, incrementa `memberCount`, cria entrada GSI3.
Retorno: squad completa.

### leaveSquad
```
POST /squads/{squadId}/leave
```
Regras: se único admin e ha outros membros, rejeita com erro `MUST_TRANSFER_OWNERSHIP`.
Se único membro: dissolve a squad (remove todos os items, GSIs).
Ação: remove `MEMBER#<userId>`, decrementa `memberCount`, remove GSI3.

### transferOwnership (admin only)
```
POST /squads/{squadId}/transfer
Body: { newAdminUserId }
```
Regras: caller é admin; `newAdminUserId` é membro da squad.
Ação: promove `newAdminUserId` a admin, demote o caller para membro (ou remove se for sair em seguida).

### updateSquad (admin only)
```
PATCH /squads/{squadId}
Body: { name?, description?, type?, maxMembers? }
```
Regras: `maxMembers >= memberCount` atual; ao mudar `type` de private para public, cria entrada GSI4; ao inverso, remove.

### disbandSquad (admin only)
```
DELETE /squads/{squadId}
```
Ação: remove todos os `MEMBER#` items, o `META`, e todas as entradas de GSI. Transacional (DynamoDB transaction).

### manageMember (admin only)
```
POST /squads/{squadId}/members/{userId}/manage
Body: { action: "promote"|"demote"|"kick" }
```
Regras: `demote` falha se o membro é o único admin; caller nao pode agir sobre si mesmo via este endpoint.

### regenerateInviteCode (admin only)
```
POST /squads/{squadId}/invite-code/regenerate
```
Ação: remove entrada GSI5 do código antigo, gera novo código, cria entrada GSI5 nova.
Retorno: `{ inviteCode }`.

### getSquad
```
GET /squads/{squadId}
```
Retorno: `{ squad: META, members: [ {userId, displayName, role, xpWeeklyContrib, xpAllTimeContrib} ], userMembership: {role}|null }`.
Membros ordenados por `xpWeeklyContrib` desc (ranking interno).

### listPublicSquads
```
GET /squads/public?limit=20&cursor=<opaque>
```
Retorno: squads públicas ordenadas por `xpWeekly` desc, com cursor para próxima página.
Inclui por squad: name, description, memberCount, xpWeekly.

### searchPublicSquads (pos-MVP)
```
GET /squads/public/search?q=<termo>
```

### getUserSquads
```
GET /users/me/squads
```
Retorno: squads do usuário com dados suficientes para card: name, type, memberCount, xpWeekly, `userRank` (posição do usuário no ranking desta semana), `userXpWeekly`.

### (B2B) createOrgTeam (admin de org only)
```
POST /orgs/{orgId}/teams
Body: { name, description?, memberUserIds: [] }
```
Regras: caller é admin de `ORG#<orgId>`; todos os `memberUserIds` são membros da org.
Cria squad com `type=org` e `orgId`.

### (B2B) addOrgTeamMember / removeOrgTeamMember
```
POST /orgs/{orgId}/teams/{squadId}/members
DELETE /orgs/{orgId}/teams/{squadId}/members/{userId}
```

---

## 3. Frontend - arquitetura e navegação

### 3.1 Posição na navegação

Nova aba "Social" na barra de navegação principal (tab bar do app web).

```
Tab bar
├── Aprender       (lições e currículo)
├── Praticar       (fila SRS diária)
├── Social         <- nova aba
└── Perfil
```

Estrutura de rotas dentro de Social (roteador web com URL de verdade: cada tela tem endereço próprio e o voltar do navegador e do Android volta uma tela, sem sair do app):

```
/social
  /social/squads/new              <- CreateSquad
  /social/squads/directory        <- SquadDirectory
  /social/squads/join             <- JoinByCode
  /social/squads/:squadId         <- SquadDetail
  /social/squads/:squadId/settings <- SquadSettings
  /social/squads/:squadId/members  <- MemberManagement
```

Link de convite: `https://<dominio>/convite/<code>` (HTTPS no domínio próprio, sem esquema `librax://`). A rota resolve para `/social/squads/join?code=<code>`. Aberto dentro de navegador embutido (Instagram, WhatsApp), mostra "Abrir no navegador" com o mesmo link.

### 3.2 Estado e cache

IndexedDB local (o mesmo banco da SPEC 02 seção 7):
- Store `cached_squads`: id, name, type, memberCount, xpWeekly, userRank, userXpWeekly, updatedAt.
- Store `cached_squad_members`: squadId, userId, displayName, role, xpWeeklyContrib (para SquadDetail offline).

Política de cache:
- `getUserSquads` é chamado na abertura da aba Social e ao voltar ao app (`visibilitychange` com a página visível de novo).
- `getSquad` é chamado ao abrir SquadDetail, com resultado salvo em cache por squadId.
- Telas mostram dados do cache imediatamente e atualizam em background (stale-while-revalidate).
- Se o cache tem mais de 30 minutos, mostra banner discreto "Dados de HH:MM - Atualizando...".

Estado efêmero (nao persistido): loading flags, form state em CreateSquad/SquadSettings.

---

## 4. Frontend - telas

### 4.1 SquadHub (tela raiz da aba Social)

**Acesso:** aba "Social" (tela raiz). Ponto de entrada de todas as features de squad.

**Componentes:**
- `OrgTeamsSection` (so membros de org): equipes B2B acima de "Suas squads" (secao 5.1).
- `SquadList`: lista de `SquadCard` das squads do usuario.
- `SquadCard`: nome; badge de tipo (Publica/Privada/org); "<N> membros - <XP> XP esta semana"; "Voce: #<rank> de <N>" + barra de XP (proporcional ao XP do lider).
- `EmptyState` (sem squads): ilustracao + texto "Aprenda junto com amigos. Crie uma squad, convide pessoas e compitam o progresso semanal." + botoes "Criar minha squad", "Entrar com codigo", "Descobrir squads".
- Rodape (com squads): botoes "+ Criar squad" e "Descobrir".

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| vazio | usuario sem squads | exibe `EmptyState` com os 3 botoes |
| com squads | 1+ squads | "Suas squads" + `SquadList` + rodape |
| limite atingido | usuario em 5 squads | "Criar squad" e "Descobrir" esmaecidos; toque -> tooltip "Voce ja esta em 5 squads. Saia de uma para entrar em outra." |
| carregando | fetch inicial sem cache | skeleton cards (shimmer) |
| erro sem cache | rede falhou e sem cache | "Nao foi possivel carregar suas squads." + "Tentar novamente" |

**Acoes:**
| Acao | Resultado |
|---|---|
| toque em `SquadCard` | abre SquadDetail (4.2) |
| "Criar squad" | abre CreateSquad (4.3) |
| "Entrar com codigo" | abre JoinByCode (4.4) |
| "Descobrir" | abre SquadDirectory (4.5) |

**Regra:** atualiza via `getUserSquads` ao abrir a aba e no `visibilitychange` (página visível de novo); stale-while-revalidate sobre o cache (secao 3.2).

---

### 4.2 SquadDetail

**Acesso:** `SquadCard` no SquadHub; card do SquadDirectory (preview); apos criar/entrar numa squad.

**Componentes:**
- `AppBar`: nome da squad + menu "..." contextual.
- `SquadHeader`: badge de tipo + "<N> / <max> membros"; descricao.
- `XpWeeklyCard`: "<XP> XP" desta semana + "reseta em Xd Yh" + barra.
- `TabBar`: [Ranking | Membros].
- `RankingTab`: lista ordenada por `xpWeeklyContrib` desc; cada linha = posicao, `displayName`, badge "(adm)" se admin, XP, barra relativa ao lider; a linha do usuario tem fundo destacado e rotulo "Voce".
- `MembersTab`: lista com role e "Membro desde <mes/ano>"; para admin, menu "..." por membro (4.7).
- `JoinBar` (preview): botao fixo "Entrar nesta squad".

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| membro | usuario pertence | linha propria destacada; menu "..." = "Compartilhar squad" / "Sair da squad" |
| admin | usuario e admin | menu "..." = "Editar squad", "Codigo de convite", "Dissolver squad"; acao "Convidar membros" visivel |
| preview | nao membro vendo squad publica | sem linha destacada; `JoinBar` no rodape |
| limite atingido | preview e usuario em 5 squads | `JoinBar` desabilitado com explicacao |

**Acoes:**
| Acao | Resultado |
|---|---|
| "..." -> "Editar squad" (admin) | abre SquadSettings (4.6) |
| "..." -> "Codigo de convite" (admin) | abre InviteSheet (4.8) |
| "..." -> "Dissolver squad" (admin) | dialogo de confirmacao (abaixo) |
| "..." -> "Compartilhar squad" (membro) | `navigator.share` com o link de convite; sem Web Share, copia o link (Clipboard API) e mostra snackbar "Link copiado!" |
| "..." -> "Sair da squad" (membro) | dialogo de confirmacao (abaixo) |
| "Convidar membros" (admin) | abre InviteSheet (4.8) |
| "Entrar nesta squad" (preview) | chama `joinSquad`; vira membro |

**Dialogos:**
| Dialogo | Texto | Botoes |
|---|---|---|
| sair (membro) | "Sair de "<Nome>"? Voce perdera sua posicao no ranking e precisara de um codigo para voltar (se a squad for privada)." | "Cancelar" / "Sair" |
| dissolver (admin) | "Dissolver "<Nome>"? Todos os <N> membros serao removidos e o historico sera perdido. Esta acao nao pode ser desfeita." | "Cancelar" / "Dissolver" |
| unico admin (bloqueio ao sair) | "Voce e o unico administrador. Transfira a administracao para outro membro antes de sair." | "Entendido" |

---

### 4.3 CreateSquad

**Acesso:** "Criar squad" no SquadHub.

**Componentes:**
- Campo `nome` (obrigatorio) com contador "(N/40)".
- Campo `descricao` (opcional, max 200).
- `VisibilityRadio`: "Publica" ("Aparece no diretorio. Qualquer um pode entrar") / "Privada" ("Apenas por codigo de convite").
- Botao primario "Criar squad".

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| invalido | nome fora de 3-40 chars | "Criar squad" desabilitado |
| valido | nome ok | "Criar squad" habilitado |
| enviando | request em andamento | botao com spinner, desabilitado (`aria-busy`) |

**Acoes:**
| Acao | Resultado |
|---|---|
| "Criar squad" | chama `createSquad`; em sucesso: navega para SquadDetail, abre InviteSheet automaticamente, snackbar "Squad criada!" |

---

### 4.4 JoinByCode

**Acesso:** "Entrar com codigo" no SquadHub; link de convite `https://<dominio>/convite/<code>`.

**Componentes:**
- `CodeInput`: 6 caixas estilo OTP (letras e numeros, maiusculas automaticas).
- Texto de ajuda "Ou acesse o link compartilhado por um membro da squad.".
- Botao "Entrar".

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| incompleto | < 6 chars | "Entrar" desabilitado |
| completo | 6 chars | aciona "Entrar" automaticamente |
| erro | Lambda recusou | mensagem inline (tabela abaixo) |

**Erros (inline, abaixo do campo):**
| Erro do Lambda | Mensagem |
|---|---|
| `SQUAD_NOT_FOUND` | "Codigo nao encontrado. Verifique com quem te convidou." |
| `SQUAD_FULL` | "Esta squad esta cheia (30/30 membros)." |
| `ALREADY_MEMBER` | "Voce ja e membro desta squad." |
| `SQUADS_LIMIT_REACHED` | "Voce ja esta em 5 squads. Saia de uma para entrar em outra." |

**Regras:**
- O link de convite pre-preenche o campo e dispara a busca automaticamente.
- Sucesso: navega para SquadDetail com snackbar "Voce entrou em <Nome>!".

---

### 4.5 SquadDirectory (diretorio de squads publicas)

**Acesso:** "Descobrir" no SquadHub.

**Componentes:**
- `AppBar`: titulo "Descobrir squads" + botao "Buscar".
- `DirectoryCard`: nome, "<N> membros - <XP> XP", botao de acao.
- `SearchField`: inline no AppBar quando acionado.
- Indicador de carregamento no fim da lista (infinite scroll).

**Estados (botao do DirectoryCard):**
| Estado | Condicao | Botao |
|---|---|---|
| disponivel | ha vaga e usuario nao e membro | "Entrar" |
| cheia | `memberCount == maxMembers` | "Cheia" (desabilitado) |
| ja membro | usuario pertence | "Ver" |

**Acoes:**
| Acao | Resultado |
|---|---|
| toque no card (fora do botao) | abre SquadDetail em modo preview (4.2) |
| "Entrar" | chama `joinSquad` direto (sem abrir o detalhe) |
| "Ver" | abre SquadDetail |
| "Buscar" | abre `SearchField`; filtra o batch carregado por nome; sem resultado -> "Buscar em todas as squads" chama `searchPublicSquads` (pos-MVP) |
| rolar ate o fim | carrega mais 20 (paginacao por cursor, `listPublicSquads`) |

**Regra:** ordenado por `xpWeekly` desc (GSI4, secao 1.2).

---

### 4.6 SquadSettings (admin only)

**Acesso:** menu "..." do SquadDetail -> "Editar squad".

**Componentes:**
- Campo `nome` (obrigatorio).
- Campo `descricao`.
- `VisibilityRadio`: Publica / Privada.
- `InviteCodeRow`: codigo + botoes "Copiar" e "Regenerar".
- Botao "Compartilhar link de convite".
- `MaxMembersField`: limite (min = membros atuais).
- `DangerZone`: botao "Dissolver squad".
- Botao salvar "[v]" no AppBar.

**Estados:**
| Estado | Condicao | O que muda |
|---|---|---|
| sem alteracao | nada editado | "[v]" inativo |
| alteracao pendente | algum campo mudou | "[v]" ativo |
| salvando | request em andamento | "[v]" vira spinner |

**Acoes:**
| Acao | Resultado |
|---|---|
| "[v]" salvar | chama `updateSquad` (valida `maxMembers >= memberCount`; troca de visibilidade ajusta GSI4) |
| "Copiar" | copia o codigo com `navigator.clipboard.writeText`; snackbar "Codigo copiado!" |
| "Regenerar" | dialogo "Regenerar codigo de convite? O codigo <X> deixara de funcionar." -> "Cancelar" / "Regenerar"; chama `regenerateInviteCode` |
| "Compartilhar link" | `navigator.share` com "Entre na minha squad no Librax: https://<dominio>/convite/<X>"; sem Web Share, copia o texto (Clipboard API) e mostra snackbar "Link copiado!" |
| "Dissolver squad" | dialogo de confirmacao da secao 4.2 (admin) |

**Regra:** `DangerZone` separada visualmente; "Dissolver squad" em vermelho.

---

### 4.7 MemberManagement (admin only)

**Acesso:** menu "..." por membro na aba Membros do SquadDetail; lista de membros no SquadSettings.

**Componentes:** lista de `MemberTile` (nome, role, "desde <mes/ano>") com menu "..." por membro (oculto na propria linha).

**Acoes (menu por membro):**
| Membro alvo | Opcoes | Resultado |
|---|---|---|
| membro comum | "Tornar administrador" / "Remover da squad" | `manageMember` action=promote / kick |
| co-admin | "Remover de administrador" / "Remover da squad" | `manageMember` action=demote / kick |

**Dialogo de remocao:** "Remover <Nome>? Ele sera removido da squad e precisara de um novo convite." -> "Cancelar" / "Remover".

**Regras:** `demote` falha se o alvo e o unico admin; o admin nao age sobre a propria linha por este menu (sai/transfere via SquadDetail).

---

### 4.8 InviteSheet (bottom sheet)

**Acesso:** automatico apos criar squad; "Convidar membros" no SquadDetail; "Compartilhar link" no SquadSettings.

**Componentes:** titulo "Convidar para <Nome>"; `InviteCodeBox` (codigo + "Copiar"); botao "Compartilhar link"; nota "O codigo nao expira. Somente admins podem regenera-lo.".

**Acoes:**
| Acao | Resultado |
|---|---|
| "Copiar" | copia o codigo com `navigator.clipboard.writeText`; snackbar "Codigo copiado!" |
| "Compartilhar link" | `navigator.share` com o link `https://<dominio>/convite/<code>` (abre a folha de compartilhar do sistema no iPhone e no Android); sem Web Share, copia o link (Clipboard API) e mostra snackbar "Link copiado!" |

**Regra:** para membro comum (nao admin), o sheet mostra apenas o link de convite (codigo visivel so para admins).

---

## 5. B2B - equipes dentro de orgs

### 5.1 Diferenca de UX no app mobile

Membros de uma org veem, no SquadHub (4.1), uma `OrgTeamsSection` acima de "Suas squads".

**Componentes:**
- `OrgTeamsSection`: titulo "Equipes - <Nome da Org>".
- `OrgTeamCard`: igual ao `SquadCard` (nome, "<N> membros - <XP> XP esta semana", "Voce: #<rank> de <N>", barra), com badge "[org]" diferenciando de squads B2C.

**Regra:** equipes B2B nao contam no limite de 5 squads (secao 0.2).

### 5.2 TeamDetail B2B

Mesmo layout de SquadDetail, com diferencas:
- Sem badge "Publica/Privada"; exibe "[Nome da Org]" no lugar.
- Membro comum: sem botao "Convidar" e sem opcao de saida voluntaria (so org admin pode remover).
- Admin da org: menu "..." exibe "Gerenciar equipe" (-> painel institucional, fora do app MVP).

### 5.3 Criacao e gestao de equipe B2B

Fluxo de criacao e edicao de equipes B2B ocorre no painel institucional (web, fora do escopo mobile do MVP).
O groundwork no modelo de dados ja esta preparado (PK=`ORG#<id>`, SK=`SQUAD#<squadId>`).
Lambda `createOrgTeam` sera chamado pelo painel, nao pelo app mobile.

---

## 6. Notificacoes relacionadas

| Evento | Destinatario | Mensagem |
|---|---|---|
| Novo membro entrou na squad | Admins da squad | "[Nome] entrou em [Squad]" |
| Fim de semana, usuario no top 3 | Membro | "Voce esta em #[N] em [Squad] esta semana. Continue!" |
| Squad dissolvida por admin | Todos os ex-membros | "[Squad] foi encerrada pelo administrador." |
| (pos-MVP) Desafio de squad criado | Membros | "[Admin] criou um desafio em [Squad]: [descricao]" |

Regras:
- Opt-in por squad (preferencia configuravel no perfil).
- Nao disparar se o usuario esta com o app aberto (usar in-app notification em vez de push).
- Implementar com Web Push (VAPID) para quem tem suporte (Android sempre, iPhone com o app na tela inicial) e e-mail opcional (SES, com opt-in) como alternativa igual para todos - mesmo sistema da SPEC 02 secao 9.

---

## 7. Offline e sincronizacao

- SquadHub: carrega do cache IndexedDB imediatamente; refetch em background ao abrir a aba.
- SquadDetail: carrega do cache por squadId; refetch ao abrir a tela.
- Acoes de escrita (criar, entrar, sair, gerenciar) exigem conexao - mostrar erro claro se offline.
- XP contribuido e calculado server-side em `completeLesson`; o app nao precisa sincronizar XP de squad explicitamente.

---

## 8. Definicao de pronto

### Backend

- [ ] Todos os Lambdas da secao 2 implementados, com testes de integracao.
- [ ] GSIs 3, 4, 5 criados na tabela `librax`.
- [ ] `completeLesson` (SPEC 02) atualiza `xpWeeklyContrib` em todas as squads do usuario (fan-out).
- [ ] Job semanal de reset de XP (EventBridge) reseta `xpWeekly` e `xpWeeklyContrib` em squads alem de ligas.
- [ ] Rota HTTPS `https://<dominio>/convite/<code>` servida pelo CloudFront (mesma origem do app, SPEC 02 secao 1), caindo no app web.

### Frontend

- [ ] Aba "Social" com SquadHub na navegacao principal.
- [ ] Telas 4.1 a 4.8 implementadas no app web (React, `apps/web-poc/`) com rotas de URL e todos os estados descritos (loading, erro, vazio, limite).
- [ ] Cache IndexedDB para SquadHub e SquadDetail funcionando offline.
- [ ] Link de convite HTTPS resolvendo para JoinByCode pre-preenchido, inclusive vindo de navegador embutido ("Abrir no navegador").
- [ ] Compartilhar e copiar via Web Share e Clipboard API, com alternativa quando nao houver suporte.
- [ ] Todos os dialogos de confirmacao de acoes destrutivas implementados.
- [ ] Banner de cache desatualizado (> 30 min) em SquadHub e SquadDetail.

### B2B (groundwork - nao bloqueia MVP)

- [ ] Modelo de dados suporta `type=org` e `ORG#/SQUAD#` (ja desenhado na secao 1).
- [ ] Lambda `createOrgTeam` implementado (chamado pelo painel institucional).
- [ ] App mobile exibe equipes B2B na secao "Equipes - [Org]" do SquadHub para membros de org.
