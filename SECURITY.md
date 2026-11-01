# Política de segurança

## Versões cobertas

O Librax tem uma única versão em uso: a que está no ar em <https://librax.online> e <https://app.librax.online>,
publicada a partir do `main`. Reportes sobre ela e sobre o código atual do `main` são bem-vindos. Versões antigas
não recebem correção à parte.

## Como reportar uma vulnerabilidade

**Não abra issue, pull request nem discussão pública** sobre uma falha de segurança. Reporte de forma privada por
um destes caminhos:

1. **GitHub**: na aba [Security](https://github.com/alissonjr/librax/security) do repositório, use
   "Report a vulnerability" (reporte privado de vulnerabilidade), quando a opção estiver disponível.
2. **E-mail**: <alisson.coj@hotmail.com>, com o assunto começando por `[Librax segurança]`.

Ajuda muito incluir:

- o que é a falha e o impacto que você enxerga (por exemplo, ler dados de outra conta);
- onde ela está: app, API, painel, landing, infraestrutura ou código do repositório;
- os passos para reproduzir, com a URL, a rota ou o arquivo e a linha;
- aparelho e navegador, se a falha depender deles.

O Librax é mantido por uma pessoa só e não tem prazo fixo de resposta. O reporte é lido e respondido assim que
possível. Combine com o mantenedor antes de divulgar a falha publicamente.

## Ao investigar

- Use uma conta sua. Não acesse, altere nem apague dados de outras pessoas; se esbarrar em dados de alguém, pare
  e reporte.
- Não faça testes de carga, negação de serviço ou varreduras automáticas em massa contra o site no ar: o projeto
  roda numa conta AWS pequena, com limites de uso e custo.
- Não use engenharia social nem phishing contra o mantenedor ou as pessoas que usam o app.
- Para testar à vontade, prefira o ambiente local, que simula a AWS na sua máquina
  ([`docs/ambiente-local.md`](docs/ambiente-local.md)).

## Segredos no repositório

Se encontrar uma chave, senha ou token versionado, reporte pelos mesmos caminhos acima, sem copiar o valor para
lugares públicos. As senhas das contas de teste do ambiente local (`services/api/local/config.mjs`) são só de
desenvolvimento e não valem em produção.
