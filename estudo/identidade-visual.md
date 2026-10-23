# Librax: identidade visual

Estudo de marca e assinatura visual, 23/10/2026. Os protótipos estão em `estudo/marca/` e abrem direto do disco
(file://): `index.html` lista os quatro caminhos e cada caminho tem um HTML com a folha da marca e seis telas do
celular, nos temas claro e escuro, com um seletor que mostra o antes (o visual de hoje). Nada aqui é decisão.

## Diagnóstico

O design system de hoje é bom tecnicamente: tokens com fonte única, contraste AA verificado, componentes e estados
definidos. A assinatura é que é fraca. Nunito com Azul Sinal e turquesa lembra qualquer app de educação, não existe
palavra-marca e nenhum elemento gráfico é só do Librax. O ícone (um L em pontos sobre degradê azul) já apontava
para o caminho certo, mas parava no ícone.

## Os quatro caminhos

| Caminho | Personalidade | Ideia | Fontes | Cores |
|---|---|---|---|---|
| Constelação (recomendado) | Preciso, noturno, vivo | O esqueleto de 21 pontos da câmera vira a assinatura: logo em L feito com os pontos da mão, mapa de articulações, barra que acende uma articulação por exercício, lição concluída como constelação | Sora e Atkinson Hyperlegible Next | Noite `#0B1022`, turquesa `#0A7A70`, âmbar `#FFB547` |
| Glosa | Estudioso, claro, respeitoso | A notação dos linguistas: glosas em caixa-alta monoespaçada e os 5 parâmetros da Libras (CM, PA, M, Or, ENM) como sistema de cores e glifos no mapa, na ficha de sinal e na câmera | Lexend e IBM Plex Mono | Tinta `#2F3BA8`, papel `#F2F3F0`, 5 cores de parâmetro |
| Traço | Cinético, quente, de jogo | As setas de trajetória dos dicionários de Libras: logo como um movimento, órbita na lição atual, Ver o movimento, celebração em explosão de setas | Anybody (largura variável) e Figtree | Grafite `#1B1510`, tangerina `#F05A0C`, petróleo `#0E7C7B` |
| Ajuste fino | Familiar, calmo, econômico | O de hoje, sem degradê no ícone, com a palavra-marca librax e o ponto de articulação (anel turquesa) em cinco lugares | Nunito | As de hoje |

Regras comuns a todos: nada depende de som; erro nunca em vermelho puro e sempre com ícone e texto; palco da câmera
sempre escuro; alvos de toque de 48 px; sem faixa colorida lateral em cards; texto alinhado à esquerda nas telas
novas. O esqueleto da mão é desenhado por código a partir dos 21 pontos e das ligações do MediaPipe (o mesmo modelo
da câmera), com poses para L, D, U, A e mão aberta; os símbolos da Constelação são gerados a partir desses pontos.

## Custo de cada caminho

| Caminho | O que muda no app | Custo |
|---|---|---|
| Ajuste fino | Ícone e favicon, palavra-marca no topo do mapa e na boas-vindas, um componente "ponto" | Baixo: 1 a 2 dias. Nenhum token muda |
| Constelação | Duas fontes novas (auto-hospedadas, como a Nunito hoje), ação passa de azul para turquesa, âmbar vira cor de marca e de XP (o ouro sai), o "dedo a ajustar" da câmera passa de âmbar para coral, novos componentes de mapa, progresso e celebração | Médio. O desenho do esqueleto já existe no app; não precisa de dado novo por sinal |
| Glosa | Duas fontes novas, 5 cores de parâmetro nos tokens, fichas de sinal | Médio no visual e alto no conteúdo: cada sinal precisa dos parâmetros cadastrados (CM, PA, M, Or, ENM) e revisados |
| Traço | Paleta inteira nova, erro passa a framboesa, botões em pílula, duas fontes | Médio a alto: as setas de demonstração pedem dado de trajetória por sinal para não virarem enfeite |

## Recomendação: Constelação

1. **É o produto.** O esqueleto de pontos é o que a câmera desenha sobre a mão da pessoa. A marca passa a ser o
   próprio momento de aprender, e o design system já diz que "a mão é a protagonista". Nenhum outro app de Libras ou
   de idioma tem esse elemento.
2. **Funciona sem som e para os dois públicos.** É um desenho que a pessoa surda e a ouvinte leem igual, e a fonte
   de texto (Atkinson Hyperlegible) foi feita para leitura fácil.
3. **Mantém o aceno ao Setembro Azul.** A turquesa sobe de "cor da mão" para cor da marca e da ação; ação e mão
   passam a ser a mesma coisa, o que combina com o princípio de que a mão é a protagonista.
4. **Custo de conteúdo zero.** Diferente de Glosa e Traço, não precisa de nenhum dado novo por sinal.
5. **Absorve o melhor dos outros.** As glosas em caixa-alta continuam (já são regra hoje) e o sistema dos 5
   parâmetros da Glosa pode entrar depois nas dicas de erro ("confira a configuração de mão"), sem virar identidade.

Pontos de atenção: o âmbar deixa de ser cor de aviso na câmera (o dedo a ajustar vai para coral, com texto); a
palavra-marca usa "Librax" com L maiúsculo porque o "l" da Sora parece um 1, e o desenho final pede um designer de
tipos; cores e símbolo precisam passar por consultores surdos antes de qualquer decisão. Se a prioridade for gastar o
mínimo agora, o Ajuste fino resolve a falta de palavra-marca em um ou dois dias e não fecha a porta para a
Constelação depois.

## Contraste

Script próprio com a fórmula de luminância relativa do WCAG 2.x, rodado sobre as mesmas paletas que geram o CSS dos
protótipos, nos temas claro e escuro, mais os pares de cor fixa do palco da câmera. Mínimos: 4,5:1 para texto e 3:1
para componentes e gráficos (WCAG 1.4.11). Resultado: **0 reprovações em 253 pares**.

| Caminho | Pares | Reprovados | Menor razão em texto | Menor razão em gráfico |
|---|---|---|---|---|
| Hoje (referência) | 50 | 0 | 5,00 | 3,40 |
| Constelação | 51 | 0 | 5,08 | 3,17 |
| Glosa | 54 | 0 | 4,87 | 3,40 |
| Traço | 49 | 0 | 5,32 | 3,04 |
| Ajuste fino | 49 | 0 | 5,00 | 3,40 |

No Traço, a tangerina da primeira versão (`#FF6B1A`) ficava em 2,6:1 como forma sobre o fundo claro e foi escurecida
para `#F05A0C`. O texto sobre ela é escuro (5,3:1), nunca branco.

<details>
<summary>Tabelas completas por caminho</summary>


**Hoje**: 50 pares, 0 reprovados. Menor razão em texto: 5.00 (mínimo 4,5); em gráfico: 3.40 (mínimo 3).

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| Texto principal / fundo | 16.38 | 17.75 | 4.5 |
| Texto principal / cartão | 17.55 | 16.38 | 4.5 |
| Texto de apoio / fundo | 7.89 | 7.87 | 4.5 |
| Texto de apoio / cartão | 8.46 | 7.26 | 4.5 |
| Metadado / cartão | 5.93 | 5.00 | 4.5 |
| Metadado / fundo | 5.53 | 5.42 | 4.5 |
| Metadado / área recuada | 5.15 | 5.71 | 4.5 |
| Link / cartão | 8.20 | 8.40 | 4.5 |
| Link / fundo | 7.65 | 9.10 | 4.5 |
| Texto do botão principal | 6.04 | 6.47 | 4.5 |
| Selecionado (aba, chip) | 8.69 | 11.00 | 4.5 |
| Texto de mão e Libras / cartão | 6.03 | 10.73 | 4.5 |
| Selo de unidade | 5.23 | 5.29 | 4.5 |
| Acerto em texto | 6.42 | 10.58 | 4.5 |
| Faixa de acerto | 8.01 | 8.01 | 4.5 |
| Erro em texto | 7.32 | 8.65 | 4.5 |
| Faixa de erro | 8.98 | 8.98 | 4.5 |
| XP em texto | 5.80 | 12.94 | 4.5 |
| Selo de XP | 5.33 | 6.87 | 4.5 |
| Sequência em texto | 7.62 | 8.65 | 4.5 |
| Selo de sequência | 6.38 | 5.54 | 4.5 |
| Cor de apoio em texto | 6.03 | 10.73 | 4.5 |
| Selo da cor de apoio | 5.23 | 7.51 | 4.5 |
| Texto sobre lição bloqueada | 13.65 | 13.40 | 4.5 |
| Botão principal / fundo (gráfico) | 5.64 | 6.47 | 3 |
| Botão principal / cartão (gráfico) | 6.04 | 5.97 | 3 |
| Borda de controle (gráfico) | 3.51 | 5.00 | 3 |
| Anel de foco (gráfico) | 6.04 | 8.40 | 3 |
| Anel de foco / fundo (gráfico) | 5.64 | 9.10 | 3 |
| Acerto forte (gráfico) | 4.80 | 8.11 | 3 |
| Erro forte (gráfico) | 5.08 | 6.85 | 3 |
| Ícone sobre nó concluído (gráfico) | 4.13 | 9.17 | 3 |
| Ícone sobre acerto (gráfico) | 4.80 | 8.78 | 3 |
| Texto sobre erro forte | 5.08 | 7.42 | 4.5 |
| Cor de apoio (gráfico) | 4.13 | 8.47 | 3 |
| Barra de progresso / trilho (gráfico) | 4.17 | 5.25 | 3 |
| XP (gráfico) | 3.48 | 11.39 | 3 |
| Sequência (gráfico) | 3.40 | 6.77 | 3 |
| Cadeado / lição bloqueada (gráfico) | 4.61 | 5.94 | 3 |
| Palavra-marca / fundo | 16.38 | 17.75 | 4.5 |
| Detalhe da marca / fundo (gráfico) | 3.86 | 9.17 | 3 |
| Texto / palco | 20.02 | (palco, igual) | 4.5 |
| Texto de apoio / pílula do palco | 14.79 | (palco, igual) | 4.5 |
| Ossos do esqueleto / palco (gráfico) | 20.02 | (palco, igual) | 3 |
| Articulações / palco (gráfico) | 12.07 | (palco, igual) | 3 |
| Articulações ativas / palco (gráfico) | 12.07 | (palco, igual) | 3 |
| Texto do acerto no palco | 8.01 | (palco, igual) | 4.5 |
| +XP no acerto | 6.75 | (palco, igual) | 4.5 |
| Botão Continuar do acerto | 8.78 | (palco, igual) | 4.5 |
| Botão Ver de novo | 11.37 | (palco, igual) | 4.5 |

**Constelação**: 51 pares, 0 reprovados. Menor razão em texto: 5.08 (mínimo 4,5); em gráfico: 3.17 (mínimo 3).

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| Texto principal / fundo | 17.30 | 17.37 | 4.5 |
| Texto principal / cartão | 18.89 | 15.97 | 4.5 |
| Texto de apoio / fundo | 8.58 | 8.73 | 4.5 |
| Texto de apoio / cartão | 9.37 | 8.02 | 4.5 |
| Metadado / cartão | 6.32 | 5.73 | 4.5 |
| Metadado / fundo | 5.79 | 6.23 | 4.5 |
| Metadado / área recuada | 5.33 | 6.40 | 4.5 |
| Link / cartão | 6.75 | 11.16 | 4.5 |
| Link / fundo | 6.18 | 12.14 | 4.5 |
| Texto do botão principal | 5.21 | 10.26 | 4.5 |
| Selecionado (aba, chip) | 8.62 | 10.74 | 4.5 |
| Texto de mão e Libras / cartão | 6.75 | 11.95 | 4.5 |
| Selo de unidade | 5.74 | 8.24 | 4.5 |
| Acerto em texto | 6.42 | 10.82 | 4.5 |
| Faixa de acerto | 8.01 | 10.47 | 4.5 |
| Erro em texto | 7.32 | 8.85 | 4.5 |
| Faixa de erro | 8.98 | 10.76 | 4.5 |
| XP em texto | 6.33 | 11.51 | 4.5 |
| Selo de XP | 5.63 | 8.78 | 4.5 |
| Sequência em texto | 7.62 | 8.85 | 4.5 |
| Selo de sequência | 6.38 | 7.04 | 4.5 |
| Cor de apoio em texto | 6.33 | 11.51 | 4.5 |
| Selo da cor de apoio | 9.34 | 11.02 | 4.5 |
| Texto sobre lição bloqueada | 15.35 | 13.76 | 4.5 |
| Botão principal / fundo (gráfico) | 4.77 | 10.42 | 3 |
| Botão principal / cartão (gráfico) | 5.21 | 9.58 | 3 |
| Borda de controle (gráfico) | 3.87 | 4.60 | 3 |
| Anel de foco (gráfico) | 5.21 | 11.16 | 3 |
| Anel de foco / fundo (gráfico) | 4.77 | 12.14 | 3 |
| Acerto forte (gráfico) | 4.80 | 8.29 | 3 |
| Erro forte (gráfico) | 5.08 | 7.01 | 3 |
| Ícone sobre nó concluído (gráfico) | 4.13 | 10.26 | 3 |
| Ícone sobre acerto (gráfico) | 4.80 | 8.78 | 3 |
| Texto sobre erro forte | 5.08 | 7.42 | 4.5 |
| Cor de apoio (gráfico) | 3.46 | 10.21 | 3 |
| Barra de progresso / trilho (gráfico) | 4.23 | 7.81 | 3 |
| XP (gráfico) | 3.46 | 10.21 | 3 |
| Sequência (gráfico) | 3.81 | 6.92 | 3 |
| Cadeado / lição bloqueada (gráfico) | 5.14 | 6.91 | 3 |
| Palavra-marca / fundo | 17.30 | 17.37 | 4.5 |
| Detalhe da marca / fundo (gráfico) | 3.17 | 11.11 | 3 |
| Texto / palco | 19.76 | (palco, igual) | 4.5 |
| Texto de apoio / pílula do palco | 14.28 | (palco, igual) | 4.5 |
| Ossos do esqueleto / palco (gráfico) | 10.55 | (palco, igual) | 3 |
| Articulações / palco (gráfico) | 19.76 | (palco, igual) | 3 |
| Articulações ativas / palco (gráfico) | 11.25 | (palco, igual) | 3 |
| Texto do acerto no palco | 16.34 | (palco, igual) | 4.5 |
| +XP no acerto | 11.77 | (palco, igual) | 4.5 |
| Botão Continuar do acerto | 10.26 | (palco, igual) | 4.5 |
| Legenda sobre o palco | 13.00 | (palco, igual) | 4.5 |
| +15 XP da celebração | 12.67 | (palco, igual) | 4.5 |

**Glosa**: 54 pares, 0 reprovados. Menor razão em texto: 4.87 (mínimo 4,5); em gráfico: 3.40 (mínimo 3).

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| Texto principal / fundo | 16.22 | 16.79 | 4.5 |
| Texto principal / cartão | 18.07 | 15.48 | 4.5 |
| Texto de apoio / fundo | 8.49 | 8.49 | 4.5 |
| Texto de apoio / cartão | 9.46 | 7.83 | 4.5 |
| Metadado / cartão | 6.51 | 5.58 | 4.5 |
| Metadado / fundo | 5.84 | 6.06 | 4.5 |
| Metadado / área recuada | 5.32 | 6.28 | 4.5 |
| Link / cartão | 9.08 | 9.20 | 4.5 |
| Link / fundo | 8.16 | 9.98 | 4.5 |
| Texto do botão principal | 9.08 | 8.34 | 4.5 |
| Selecionado (aba, chip) | 11.03 | 11.59 | 4.5 |
| Texto de mão e Libras / cartão | 6.03 | 10.64 | 4.5 |
| Selo de unidade | 5.23 | 5.29 | 4.5 |
| Acerto em texto | 6.42 | 10.50 | 4.5 |
| Faixa de acerto | 8.01 | 8.01 | 4.5 |
| Erro em texto | 7.32 | 8.59 | 4.5 |
| Faixa de erro | 8.98 | 8.98 | 4.5 |
| XP em texto | 5.80 | 12.84 | 4.5 |
| Selo de XP | 5.33 | 6.87 | 4.5 |
| Sequência em texto | 7.62 | 8.59 | 4.5 |
| Selo de sequência | 6.38 | 5.54 | 4.5 |
| Cor de apoio em texto | 6.60 | 9.95 | 4.5 |
| Selo da cor de apoio | 8.90 | 10.90 | 4.5 |
| Texto sobre lição bloqueada | 14.78 | 13.11 | 4.5 |
| Botão principal / fundo (gráfico) | 8.16 | 8.34 | 3 |
| Botão principal / cartão (gráfico) | 9.08 | 7.69 | 3 |
| Borda de controle (gráfico) | 4.30 | 4.64 | 3 |
| Anel de foco (gráfico) | 9.08 | 9.20 | 3 |
| Anel de foco / fundo (gráfico) | 8.16 | 9.98 | 3 |
| Acerto forte (gráfico) | 4.80 | 8.04 | 3 |
| Erro forte (gráfico) | 5.08 | 6.80 | 3 |
| Ícone sobre nó concluído (gráfico) | 4.13 | 9.17 | 3 |
| Ícone sobre acerto (gráfico) | 4.80 | 8.78 | 3 |
| Texto sobre erro forte | 5.08 | 7.42 | 4.5 |
| Cor de apoio (gráfico) | 5.10 | 8.59 | 3 |
| Barra de progresso / trilho (gráfico) | 7.43 | 6.00 | 3 |
| XP (gráfico) | 3.48 | 11.30 | 3 |
| Sequência (gráfico) | 3.40 | 6.72 | 3 |
| Cadeado / lição bloqueada (gráfico) | 5.32 | 6.63 | 3 |
| Palavra-marca / fundo | 16.22 | 16.79 | 4.5 |
| Detalhe da marca / fundo (gráfico) | 8.16 | 9.98 | 3 |
| Parâmetro CM / cartão | 6.50 | 7.16 | 4.5 |
| Parâmetro PA / cartão | 4.87 | 9.76 | 4.5 |
| Parâmetro M / cartão | 5.10 | 8.59 | 4.5 |
| Parâmetro Or / cartão | 4.92 | 10.56 | 4.5 |
| Parâmetro ENM / cartão | 5.80 | 7.15 | 4.5 |
| Texto / palco | 19.57 | (palco, igual) | 4.5 |
| Texto de apoio / pílula do palco | 13.95 | (palco, igual) | 4.5 |
| Ossos do esqueleto / palco (gráfico) | 19.57 | (palco, igual) | 3 |
| Articulações / palco (gráfico) | 11.87 | (palco, igual) | 3 |
| Articulações ativas / palco (gráfico) | 8.05 | (palco, igual) | 3 |
| Texto do acerto no palco | 8.01 | (palco, igual) | 4.5 |
| Glosa L no palco | 13.09 | (palco, igual) | 4.5 |
| Parâmetros conferidos na câmera | 17.93 | (palco, igual) | 4.5 |

**Traço**: 49 pares, 0 reprovados. Menor razão em texto: 5.32 (mínimo 4,5); em gráfico: 3.04 (mínimo 3).

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| Texto principal / fundo | 16.62 | 16.90 | 4.5 |
| Texto principal / cartão | 18.08 | 15.66 | 4.5 |
| Texto de apoio / fundo | 9.28 | 9.03 | 4.5 |
| Texto de apoio / cartão | 10.10 | 8.37 | 4.5 |
| Metadado / cartão | 7.03 | 5.93 | 4.5 |
| Metadado / fundo | 6.46 | 6.40 | 4.5 |
| Metadado / área recuada | 5.87 | 6.73 | 4.5 |
| Link / cartão | 6.38 | 8.32 | 4.5 |
| Link / fundo | 5.86 | 8.98 | 4.5 |
| Texto do botão principal | 5.32 | 7.18 | 4.5 |
| Selecionado (aba, chip) | 9.35 | 11.56 | 4.5 |
| Texto de mão e Libras / cartão | 6.96 | 10.68 | 4.5 |
| Selo de unidade | 5.82 | 7.35 | 4.5 |
| Acerto em texto | 6.42 | 10.51 | 4.5 |
| Faixa de acerto | 8.01 | 8.01 | 4.5 |
| Erro em texto | 8.54 | 8.97 | 4.5 |
| Faixa de erro | 10.88 | 11.02 | 4.5 |
| XP em texto | 5.80 | 12.86 | 4.5 |
| Selo de XP | 5.33 | 6.87 | 4.5 |
| Sequência em texto | 6.60 | 9.15 | 4.5 |
| Selo de sequência | 5.59 | 7.16 | 4.5 |
| Cor de apoio em texto | 6.60 | 9.15 | 4.5 |
| Selo da cor de apoio | 9.35 | 11.56 | 4.5 |
| Texto sobre lição bloqueada | 15.09 | 13.59 | 4.5 |
| Botão principal / fundo (gráfico) | 3.13 | 7.47 | 3 |
| Botão principal / cartão (gráfico) | 3.40 | 6.92 | 3 |
| Borda de controle (gráfico) | 4.39 | 4.45 | 3 |
| Anel de foco (gráfico) | 6.38 | 8.32 | 3 |
| Anel de foco / fundo (gráfico) | 5.86 | 8.98 | 3 |
| Acerto forte (gráfico) | 4.80 | 8.05 | 3 |
| Erro forte (gráfico) | 6.12 | 7.17 | 3 |
| Ícone sobre nó concluído (gráfico) | 5.01 | 9.26 | 3 |
| Ícone sobre acerto (gráfico) | 4.80 | 8.78 | 3 |
| Texto sobre erro forte | 6.12 | 7.74 | 4.5 |
| Cor de apoio (gráfico) | 3.64 | 7.45 | 3 |
| Barra de progresso / trilho (gráfico) | 3.04 | 5.14 | 3 |
| XP (gráfico) | 3.48 | 11.31 | 3 |
| Sequência (gráfico) | 3.64 | 7.45 | 3 |
| Cadeado / lição bloqueada (gráfico) | 5.87 | 7.26 | 3 |
| Palavra-marca / fundo | 16.62 | 16.90 | 4.5 |
| Detalhe da marca / fundo (gráfico) | 3.35 | 8.04 | 3 |
| Texto / palco | 19.62 | (palco, igual) | 4.5 |
| Texto de apoio / pílula do palco | 14.09 | (palco, igual) | 4.5 |
| Ossos do esqueleto / palco (gráfico) | 19.62 | (palco, igual) | 3 |
| Articulações / palco (gráfico) | 11.83 | (palco, igual) | 3 |
| Articulações ativas / palco (gráfico) | 8.38 | (palco, igual) | 3 |
| Texto do acerto no palco | 16.27 | (palco, igual) | 4.5 |
| Botão Continuar do acerto | 7.18 | (palco, igual) | 4.5 |
| Glosa L no palco | 8.38 | (palco, igual) | 4.5 |

**Ajuste fino**: 49 pares, 0 reprovados. Menor razão em texto: 5.00 (mínimo 4,5); em gráfico: 3.40 (mínimo 3).

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| Texto principal / fundo | 16.38 | 17.75 | 4.5 |
| Texto principal / cartão | 17.55 | 16.38 | 4.5 |
| Texto de apoio / fundo | 7.89 | 7.87 | 4.5 |
| Texto de apoio / cartão | 8.46 | 7.26 | 4.5 |
| Metadado / cartão | 5.93 | 5.00 | 4.5 |
| Metadado / fundo | 5.53 | 5.42 | 4.5 |
| Metadado / área recuada | 5.15 | 5.71 | 4.5 |
| Link / cartão | 8.20 | 8.40 | 4.5 |
| Link / fundo | 7.65 | 9.10 | 4.5 |
| Texto do botão principal | 6.04 | 6.47 | 4.5 |
| Selecionado (aba, chip) | 8.69 | 11.00 | 4.5 |
| Texto de mão e Libras / cartão | 6.03 | 10.73 | 4.5 |
| Selo de unidade | 5.23 | 5.29 | 4.5 |
| Acerto em texto | 6.42 | 10.58 | 4.5 |
| Faixa de acerto | 8.01 | 8.01 | 4.5 |
| Erro em texto | 7.32 | 8.65 | 4.5 |
| Faixa de erro | 8.98 | 8.98 | 4.5 |
| XP em texto | 5.80 | 12.94 | 4.5 |
| Selo de XP | 5.33 | 6.87 | 4.5 |
| Sequência em texto | 7.62 | 8.65 | 4.5 |
| Selo de sequência | 6.38 | 5.54 | 4.5 |
| Cor de apoio em texto | 6.03 | 10.73 | 4.5 |
| Selo da cor de apoio | 5.23 | 7.51 | 4.5 |
| Texto sobre lição bloqueada | 13.65 | 13.40 | 4.5 |
| Botão principal / fundo (gráfico) | 5.64 | 6.47 | 3 |
| Botão principal / cartão (gráfico) | 6.04 | 5.97 | 3 |
| Borda de controle (gráfico) | 3.51 | 5.00 | 3 |
| Anel de foco (gráfico) | 6.04 | 8.40 | 3 |
| Anel de foco / fundo (gráfico) | 5.64 | 9.10 | 3 |
| Acerto forte (gráfico) | 4.80 | 8.11 | 3 |
| Erro forte (gráfico) | 5.08 | 6.85 | 3 |
| Ícone sobre nó concluído (gráfico) | 4.13 | 9.17 | 3 |
| Ícone sobre acerto (gráfico) | 4.80 | 8.78 | 3 |
| Texto sobre erro forte | 5.08 | 7.42 | 4.5 |
| Cor de apoio (gráfico) | 4.13 | 8.47 | 3 |
| Barra de progresso / trilho (gráfico) | 4.17 | 5.25 | 3 |
| XP (gráfico) | 3.48 | 11.39 | 3 |
| Sequência (gráfico) | 3.40 | 6.77 | 3 |
| Cadeado / lição bloqueada (gráfico) | 4.61 | 5.94 | 3 |
| Palavra-marca / fundo | 16.38 | 17.75 | 4.5 |
| Detalhe da marca / fundo (gráfico) | 3.86 | 9.17 | 3 |
| Texto / palco | 20.02 | (palco, igual) | 4.5 |
| Texto de apoio / pílula do palco | 14.79 | (palco, igual) | 4.5 |
| Ossos do esqueleto / palco (gráfico) | 20.02 | (palco, igual) | 3 |
| Articulações / palco (gráfico) | 12.24 | (palco, igual) | 3 |
| Articulações ativas / palco (gráfico) | 12.07 | (palco, igual) | 3 |
| Texto do acerto no palco | 8.01 | (palco, igual) | 4.5 |
| +XP no acerto | 6.75 | (palco, igual) | 4.5 |
| Botão Continuar do acerto | 8.78 | (palco, igual) | 4.5 |

</details>

## Verificação

Cada página foi aberta no Chromium (Playwright) via file:// em 390 px e 1280 px, nos temas claro e escuro e com o
antes: sem rolagem horizontal, sem erro de script, todos os esqueletos desenhados e nenhum texto das telas abaixo de
12 px. A câmera é simulada (sem webcam). As fontes vêm do Google Fonts por link, com fallback do sistema; no app,
seriam auto-hospedadas como a Nunito.
