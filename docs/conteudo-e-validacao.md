# Conteúdo e validação

Status do conteúdo do curso A1, de onde ele veio e o que falta para publicar. Conferido em 2026-10-23 em
`apps/web-poc/src/assets/content/signs.json` e `course.json`.

## Status: rascunho, sem validação

- **254 sinais em 14 unidades**, todos com `status: "rascunho"` e `validated: false`.
- As 60 frases de exemplo (exercício de montar frase) e as 9 notas de cultura de `course.json` também são
  rascunho, como diz a nota de 2026-10-22 da SPEC 03 (árvore A1).
- Nenhum vídeo próprio: `video_url` é `null` nos 254 sinais. A demonstração do sinal hoje é o avatar VLibras
  (provisório) ou a descrição em texto (`video_caption`).
- Nada disso deve ir para usuários reais como conteúdo validado antes da revisão pela comunidade surda.

Campos de cada sinal em `signs.json` que registram a origem e as dúvidas:

| Campo | O que guarda |
|---|---|
| `status` / `validated` | `"rascunho"` / `false` em todos |
| `source` | nome e link da fonte principal (ausente nas 26 letras do alfabeto) |
| `notes` | conferência com outras fontes, variantes encontradas e por que uma forma foi escolhida (223 sinais) |
| `avatar` | glosa do VLibras usada na demonstração e, quando há divergência, uma nota |

## Fontes usadas

| Fonte | Uso | Quantos sinais |
|---|---|---|
| Dicionário de Libras do INES | fonte principal (`source`), com link para o vídeo do verbete; também a fonte das 60 frases de exemplo | 212 (3 deles compostos de dois verbetes, como BOA-TARDE) |
| Spread the Sign (português BR) | fonte principal quando o INES não tinha o sinal ou divergia; conferência nas `notes` | 11 como fonte principal, citado nas notas de 87 |
| Signbank de Libras (UFSC) | fonte principal em poucos casos; conferência nas `notes` | 5 como fonte principal, citado nas notas de 55 |
| VLibras (Governo Federal) | avatar que demonstra o sinal (`avatar.provider: "vlibras"`) | 253 com glosa de avatar |

As notas de cultura citam leis, artigos e o Tesouro Linguístico da UFPel, cada uma com a referência no campo
`source`.

O app **não copia vídeos de nenhuma fonte**: os links em `source` servem de referência para quem escreveu e
para quem vai validar. O player do VLibras é carregado sem alteração do endereço oficial.

## Licenças

O que já foi pesquisado:

| Fonte | Licença | O que significa para o Librax |
|---|---|---|
| Signbank de Libras (UFSC) | CC BY-NC-SA | Pode usar com crédito, sem uso comercial e compartilhando derivados pela mesma licença. O "NC" pesa no B2B. |
| Wikisigns | CC BY | Pode usar com crédito, inclusive comercialmente. Ainda não usada no conteúdo. |
| VLibras | LGPL no código (player) | Uso do player sem alteração, com crédito e link da licença (já na tela do avatar e nas Configurações). |
| Dicionário do INES | só com autorização | Não usar vídeos nem imagens sem autorização formal. |
| Spread the Sign | só com autorização | Mesmo caso do INES. |

## O que precisa de validação pela comunidade surda

- **Cada sinal**: os 5 parâmetros (`params`), a descrição (`video_caption`) e a forma escolhida quando há
  variante. As `notes` registram as escolhas (cerca de 40 citam variação ou variante, 12 citam variação regional).
- **As 26 letras do alfabeto**, que não têm `source`.
- **O avatar**: se o movimento do VLibras confere com a descrição. Há 9 sinais com nota de divergência no
  `avatar`, por exemplo os números 1 a 4 (o VLibras mostra a forma de quantidade) e sequências montadas com duas
  glosas (BOA-TARDE como BOM + TARDE, ONZE como 1 + 1).
- **As 60 frases**: ordem das glosas em Libras e tradução.
- **As 9 notas de cultura**: conteúdo e tom.
- **Design**: paleta (o turquesa como aceno à identidade surda), ícones e ilustrações de mão
  (`design-system.md`, seção 15, item 2).

## Lacunas conhecidas

- **Sem fonte confiável, ficaram fora do curso**: SEDE (U7), CENTAVO (U13) e SINALIZAR (U14).
- **Sem avatar**: ATÉ-LOGO. O VLibras não tem a glosa, e montar ATÉ + LOGO seria tradução palavra por palavra,
  diferente do aceno único do INES. O sinal aparece só com a descrição em texto.

## Próximos passos

1. Pedir autorização ao INES e ao Spread the Sign para usar os vídeos como referência e, se possível, no app.
2. Confirmar com o Signbank (UFSC) se o uso cabe na CC BY-NC-SA, principalmente no B2B.
3. Definir os consultores surdos e o processo de validação (quem revisa, em que ordem, como registrar).
4. Validar a U1 primeiro (é o MVP mínimo da SPEC 03) e depois as demais unidades; resolver SEDE, CENTAVO,
   SINALIZAR e ATÉ-LOGO nessa rodada.
5. Só depois da validação trocar `status` e `validated` de cada sinal.
6. ~~Gravar os vídeos próprios com pessoas surdas sinalizantes (fase W5 do `plano-mobile-web.md`), que substituem
   o avatar como demonstração.~~ **Engavetado em 2026-10-25**: gravar com pessoas reais é inviável agora.
