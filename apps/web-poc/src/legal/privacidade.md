---
versao: 1.0
vigencia: 2026-10-24
---

Esta política explica, em linguagem simples, quais dados o Librax usa, para quê, onde eles ficam, por quanto tempo e como você exerce seus direitos pela Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018). Ela vale junto com os [Termos de Uso](/termos).

## 1. Resumo

- **A imagem da câmera nunca sai do seu aparelho.** O reconhecimento dos sinais roda no próprio celular. Nem a imagem nem os pontos da sua mão são enviados para nós.
- **Sem conta, tudo fica só neste navegador.** Nós não recebemos nada.
- **Com conta, guardamos seu e-mail, o nome que você informou e o seu progresso no curso**, para você não perder o que aprendeu e poder continuar em outro aparelho.
- **Os servidores ficam nos Estados Unidos**, na Amazon Web Services (AWS).
- **Não vendemos dados, não mostramos anúncios e não usamos ferramentas de análise de uso nem de rastreamento.**
- Você pode pedir acesso, correção ou exclusão dos seus dados pelo e-mail {{email}}.

## 2. Quem é o responsável

O responsável pelos seus dados (o "controlador", nas palavras da LGPD) é {{nome}}, {{documento}}.

O canal para qualquer assunto de privacidade, inclusive os pedidos do item 13, é o e-mail {{email}}.

## 3. O que fica só no seu aparelho

Enquanto você usa o Librax sem conta, os dados abaixo ficam guardados no navegador do seu aparelho (no armazenamento local do site e no cache do app). Nós não temos acesso a eles:

- o nome ou apelido que você digita nas boas-vindas;
- o seu progresso: XP, sequência de dias, lições concluídas, conquistas, as revisões programadas de cada sinal e a liga da semana;
- a lição em andamento, para você continuar de onde parou se a página recarregar;
- suas preferências: idioma, tema, sons e avisos que você já viu;
- um código aleatório criado pelo app para separar os dados deste aparelho, que não identifica você;
- as lições concluídas que ainda vão ser enviadas, se você tiver ou criar uma conta;
- os arquivos do próprio app, do modelo de reconhecimento e das animações do avatar, guardados para o app funcionar sem internet.

A resposta sobre o motivo de você aprender Libras, nas boas-vindas, não é guardada nem enviada.

Esses dados ficam no aparelho até você apagá-los, pelo botão "Excluir conta e dados" das Configurações ou limpando os dados do site nas configurações do navegador.

## 4. A câmera

- A câmera só é usada nos exercícios que pedem e só depois que você dá permissão no navegador. Você pode retirar essa permissão quando quiser, nas configurações do navegador.
- A imagem é analisada no próprio aparelho por um modelo de reconhecimento de mãos (MediaPipe, do Google), que o Librax entrega dos próprios servidores. O modelo encontra 21 pontos da mão, e o app compara esses pontos com o sinal esperado.
- Nenhuma foto, vídeo ou ponto da mão é gravado ou enviado, nem para nós nem para terceiros. Se você tiver conta, o servidor recebe só o resultado da lição, por exemplo quais sinais você acertou.

Existe também uma página separada de coleta voluntária, usada para treinar o reconhecimento, com um termo próprio. Nela, os pontos da mão (números, nunca imagens) ficam guardados no aparelho e só chegam até nós se você mesmo exportar o arquivo e entregá-lo à equipe.

## 5. O que guardamos quando você cria uma conta

A conta é opcional. Ao criar uma, guardamos os dados abaixo.

### Dados da conta

- O e-mail e a confirmação de que ele é seu.
- O nome que você informou no cadastro ou, se entrar com o Google, o seu primeiro nome na conta Google.
- A senha, se você usar e-mail e senha. Ela não é enviada nem guardada como texto: o login usa um protocolo seguro (SRP), e o servidor guarda só um verificador.
- Se você entrar com o Google, o vínculo com a sua conta Google. Do Google guardamos só o e-mail, a confirmação de que ele é válido, o primeiro nome e o identificador da conta.

### Progresso

Ligados ao identificador da sua conta:

- XP, sequência de dias, lições concluídas, conquistas e a meta diária;
- quais sinais você revisou, como foi cada revisão e quando é a próxima;
- o XP de cada dia e o grupo da liga semanal com o seu XP da semana;
- o último dia, semana e mês em que você usou o app, para contar as pessoas ativas sem contar ninguém duas vezes;
- um registro de cada lição enviada, para a mesma lição não ser somada duas vezes. Ele é apagado sozinho em 60 dias.

O progresso vai para o servidor quando você conclui uma lição (ou assim que houver internet). Quando você entra na conta pela primeira vez, o progresso feito como convidado neste aparelho é levado para ela.

Com conta, o app também envia quantas respostas e quantos erros você teve em cada tipo de exercício da lição e, se você sair no meio, em que exercício parou. Esses números só entram nos totais do item 6.

## 6. Números da operação

Para saber se o app funciona e onde as pessoas têm mais dificuldade, o servidor soma totais por dia, por semana e por mês: pessoas ativas, contas novas, lições concluídas e abandonadas, e erros por lição, por tipo de exercício e por sinal. Esses totais não guardam quem fez o quê.

Registros técnicos de funcionamento do servidor (por exemplo, erros) ficam 30 dias e podem conter o identificador da sua conta.

Pessoas da equipe com acesso de administração podem consultar o resumo de uma conta (e-mail, perfil, progresso e última atividade) para operar o serviço e atender pedidos. Cada consulta fica registrada.

## 7. Sem anúncios e sem rastreamento

O Librax não usa ferramentas de análise de uso (como o Google Analytics), pixels de anúncio, cookies de rastreamento nem perfis de publicidade. As fontes, os ícones e os arquivos do app são entregues pelos próprios servidores do Librax.

O app guarda dados no navegador só para funcionar (item 3). A página de login da conta pode usar cookies próprios para manter a sessão de login.

## 8. Serviços de terceiros

- **Amazon Web Services (AWS)**: hospeda o app, a conta (Amazon Cognito), o banco de dados (Amazon DynamoDB) e as funções do servidor, e envia o código de confirmação por e-mail. A AWS trata os dados em nosso nome, seguindo nossas instruções (na LGPD, ela é a "operadora").
- **Google**: só se você escolher "Continuar com Google". O login acontece na página do Google, e o que o Google faz com os seus dados segue a política de privacidade do Google.
- **VLibras (Governo Federal)**: quando um exercício mostra o avatar que faz o sinal, o navegador baixa o player e as animações direto dos servidores do VLibras (vlibras.gov.br, que usa a rede de distribuição jsDelivr). Como em qualquer acesso a um site, esses serviços recebem o endereço IP, dados técnicos do navegador e qual sinal foi pedido. Não enviamos a eles nenhum dado da sua conta. As animações já vistas ficam guardadas no aparelho.

## 9. Transferência internacional

Os servidores do Librax ficam na região us-east-1 da AWS, na Virgínia do Norte, Estados Unidos. Por isso, os dados da conta e do progresso são transferidos para fora do Brasil.

Essa transferência é necessária para prestar o serviço que você pede ao criar a conta (art. 33, inciso IX, combinado com o art. 7º, inciso V, da LGPD). A AWS se compromete por contrato a proteger os dados e a tratá-los só conforme as nossas instruções. Os serviços do Google e do VLibras também podem tratar dados fora do Brasil, conforme as políticas deles.

## 10. Para que usamos os dados e com qual base legal

- **Criar e manter a sua conta, guardar e sincronizar o progresso, calcular XP, sequência e liga, e enviar o código de confirmação**: execução do contrato que são os Termos de Uso (art. 7º, V, da LGPD).
- **Totais da operação, segurança, prevenção de abuso e registros técnicos**: legítimo interesse (art. 7º, IX), sempre com o mínimo de dados e sem identificar você nos totais.
- **Lembretes por e-mail, quando existirem**: o seu consentimento (art. 7º, I), que você pode retirar a qualquer momento.
- **Cumprir obrigações legais e atender pedidos de autoridades**: obrigação legal (art. 7º, II).

## 11. Lembretes e notificações

Hoje o app não pede permissão para notificações e não envia lembretes. O servidor já está preparado para isso.

Quando o recurso estiver disponível, ele só vai funcionar se você permitir as notificações no navegador ou marcar a opção de lembrete por e-mail, que começa desligada. Nesse caso guardaremos o endereço técnico que o navegador cria para as notificações, o horário preferido e o fuso horário. Esta política será atualizada antes de o recurso ser ligado.

## 12. Por quanto tempo guardamos

- **No seu aparelho**: até você apagar.
- **Conta e progresso no servidor**: enquanto a conta existir. Hoje não apagamos contas paradas automaticamente.
- **Registro de cada lição enviada**: 60 dias.
- **Registros técnicos**: 30 dias.
- **Cópias de segurança do banco de dados**: até 35 dias. Depois de uma exclusão, o dado ainda pode existir nessas cópias por até 35 dias, sem uso, até ser descartado.
- **Totais da operação, sem identificação**: 400 dias para os totais por dia, 800 dias para os totais por semana e sem prazo definido para os totais por mês.

## 13. Seus direitos

Pela LGPD (art. 18), você pode pedir:

- a confirmação de que tratamos dados seus e o acesso a eles;
- a correção de dados incompletos, errados ou desatualizados;
- a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados em desacordo com a lei;
- a portabilidade dos dados;
- a eliminação dos dados, inclusive dos tratados com o seu consentimento;
- a informação sobre com quem compartilhamos dados;
- a informação sobre a possibilidade de não dar consentimento e o que acontece se você não der;
- a revogação do consentimento.

Para fazer um pedido, escreva para {{email}}, de preferência a partir do e-mail da sua conta. Respondemos em até 15 dias. Podemos pedir uma confirmação de que a conta é sua antes de atender.

No próprio app:

- **Exportar meus dados** (Configurações) baixa um arquivo com o perfil e as revisões guardados neste aparelho.
- **Excluir conta e dados** (Configurações) apaga os dados deste aparelho e desconecta a conta dele. Para apagar também a conta e o progresso guardados no servidor, envie o pedido para {{email}}. Apagamos em até 15 dias e confirmamos por e-mail.

Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em [gov.br/anpd](https://www.gov.br/anpd).

## 14. Segurança

- A conexão com o Librax é sempre criptografada (HTTPS), e os dados ficam criptografados nos servidores da AWS.
- A senha é verificada sem trafegar pela rede (protocolo SRP).
- O acesso de administração é restrito às pessoas autorizadas da equipe, e cada consulta fica registrada.
- Nenhum sistema é totalmente seguro. Se acontecer um incidente que possa trazer risco ou dano relevante, avisaremos você e a ANPD, como manda a LGPD.

## 15. Idade mínima

O Librax é para pessoas com 18 anos ou mais. Não coletamos de propósito dados de menores de idade. Se você souber de alguém com menos de 18 anos usando uma conta, avise pelo e-mail {{email}} e apagaremos a conta.

## 16. Mudanças nesta política

Quando esta política mudar, a versão e a data no topo da página mudam junto. Se a mudança for importante, avisaremos no app ou por e-mail antes de ela valer.

## 17. Contato

{{nome}}, {{documento}}. E-mail: {{email}}.
