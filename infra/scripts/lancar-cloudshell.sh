#!/usr/bin/env bash
# Lançamento do Librax pelo AWS CloudShell (passo a passo em docs/lancamento.md).
#
# Numa sessão do CloudShell em us-east-1, com o repositório clonado em /tmp:
#   bash infra/scripts/lancar-cloudshell.sh                 primeiro lançamento (pergunta o que faltar)
#   bash infra/scripts/lancar-cloudshell.sh --so-publicar   só build e upload do app, do painel e da landing
#   bash infra/scripts/lancar-cloudshell.sh --admin EMAIL   coloca uma conta no grupo admin do Cognito
#   bash infra/scripts/lancar-cloudshell.sh --dono EMAIL    admin e dono do painel (promove outros admins)
#   bash infra/scripts/lancar-cloudshell.sh --configurar-ci prepara o CI/CD no CodeBuild (uma vez; docs/ci-cd.md)
#   bash infra/scripts/lancar-cloudshell.sh --so-publicar --com-notificacoes  liga as notificações (Web Push)
#
# No CodeBuild (CI/CD, infra/ci/buildspec.yml) roda com --ci: sem perguntas, com os valores do
# lançamento lidos do SSM (/librax/cdk-context, gravado aqui no fim de cada deploy pelo CloudShell).
#
# Pode rodar de novo quantas vezes precisar: cada passo confere o que já está feito e segue dali.
# Usa o login do próprio CloudShell (infra/scripts/aws.sh) e a trava da conta
# (infra/scripts/conferir-conta.mjs) antes de qualquer escrita na AWS. Não mostra segredos.
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA="$RAIZ/infra"
AWS_SH="$INFRA/scripts/aws.sh"
CONTEXTO="$INFRA/cdk.context.json"
COPIA_CONTEXTO="${HOME:-/tmp}/.librax/cdk.context.json"
WEB="$RAIZ/apps/web-poc"
ADMIN="$RAIZ/apps/admin-web"
LANDING="$RAIZ/apps/landing"
API="$RAIZ/services/api"
REGIAO=us-east-1
STACK=LibraxStack
# 22, a mesma versão das Lambdas e do CodeBuild: o Node 20 do CloudShell saiu do suporte em 2026-04-30
NODE_MINIMO=22
NODE_VERSAO=22.20.0
NODE_DIR=${LIBRAX_NODE_DIR:-/tmp/librax-node}
ESPACO_MINIMO_MB=2500
# Cache-Control dos arquivos de ML no S3 (os mesmos de infra/lib/web-headers.ts: IMMUTABLE e ML_REVALIDATE)
CACHE_IMUTAVEL='public, max-age=31536000, immutable'
CACHE_REVALIDA='no-cache'
# Soma da concorrência reservada das Lambdas da API com librax:lambdaReservedConcurrency ligado
# (RESERVED_CONCURRENCY_TOTAL em infra/lib/cost-guards.ts; o teste confere que os dois batem). A AWS
# exige 100 execuções sem reserva na conta, então a cota precisa ser pelo menos a soma mais 100.
RESERVA_LAMBDA=180
LAMBDA_SEM_RESERVA=100
COTA_LAMBDA_PEDIR=1000
# CI/CD (infra/lib/ci-stack.ts; o teste confere que os nomes batem)
PARAM_CONTEXTO=/librax/cdk-context
STACK_CI=LibraxCiStack
PROJETO_CI=librax-lancamento
CONEXAO_CI=librax-github
REPOSITORIO_CI=alissonjr/librax
TAMANHO_MAXIMO_PARAMETRO=4096
# Chaves das notificações e cliente OAuth do Google (os padrões de infra/lib/config.ts; o teste confere)
PARAM_VAPID_PUBLICA=/librax/vapid/public-key
PARAM_VAPID_PRIVADA=/librax/vapid/private-key
PARAM_GOOGLE_ID=/librax/google/client-id
SEGREDO_GOOGLE=librax/google/client-secret

# ---------------------------------------------------------------------------------------------
# Opções
# ---------------------------------------------------------------------------------------------

ajuda() {
  cat <<'FIM'
Uso: bash infra/scripts/lancar-cloudshell.sh [opções]

Sem opções faz o lançamento completo: Node, dependências, contexto do CDK, trava da conta,
bootstrap (só se faltar), deploy da stack, build e upload do app, do painel e da landing.

  --conta NUMERO            conta AWS do Librax (12 dígitos)
  --zona ID                 id da zona do Route 53 (ex.: Z0123456789ABCDEFGHIJ)
  --certificado ARN         certificado do ACM em us-east-1 (librax.online e *.librax.online)
  --email-alarmes EMAIL     e-mail dos alarmes e do orçamento mensal
  --orcamento DOLARES       valor do orçamento mensal (padrão 10)
  --com-google              liga o login com Google (precisa do cliente OAuth criado no Google Cloud; se o
                            id e o segredo ainda não estiverem na AWS, o script pede e guarda)
  --sem-google              desliga o login com Google (padrão no primeiro lançamento)
  --com-lembretes-email     liga os lembretes por e-mail (precisa do domínio verificado no SES)
  --sem-lembretes-email     desliga os lembretes por e-mail (padrão)
  --com-email-ses           códigos do login (cadastro e nova senha) pelo SES do domínio, sem o limite
                            de 50 e-mails por dia do Cognito (precisa do domínio verificado no SES)
  --sem-email-ses           códigos do login pelo envio padrão do Cognito (padrão)
  --com-concorrencia-reservada  limita quantas cópias de cada Lambda da API rodam juntas (precisa da cota
                            de concorrência do Lambda na conta em 1000; o script confere antes)
  --sem-concorrencia-reservada  sem esse limite por Lambda (padrão)
  --com-notificacoes        liga as notificações (Web Push): gera as chaves VAPID uma vez, direto no SSM,
                            sem mostrar a privada; chaves que já existem nunca são trocadas
  --so-publicar             pula bootstrap e deploy: só build e upload do app, do painel e da landing
  --vlibras-opcional        publica mesmo se o download do avatar VLibras falhar (cai no texto)
  --ignorar-dns             não confere se o domínio já aponta para o Route 53
  --admin EMAIL             só coloca a conta (já criada no app) no grupo admin e sai
  --dono EMAIL              como --admin, e a conta vira a dona do painel: só ela torna outras contas
                            admin ou tira do admin, pela tela Contas do painel
  --configurar-ci           prepara o CI/CD (CodeBuild a cada tag v1.2.3): conexão com o GitHub, projeto
                            e aviso por e-mail; uma vez, depois do primeiro lançamento (docs/ci-cd.md)
  --ci                      modo do CodeBuild: sem perguntas, valores do SSM; não use no CloudShell
  --ajuda                   mostra esta ajuda

Os valores ficam em infra/cdk.context.json (local, fora do git). Numa segunda rodada o script
usa o que já está lá e só pergunta o que faltar. Depois de cada deploy da stack, uma cópia vai
para o SSM (/librax/cdk-context), de onde o CI/CD lê.
FIM
}

OPT_CONTA=""
OPT_ZONA=""
OPT_CERT=""
OPT_EMAIL=""
OPT_ORCAMENTO=""
OPT_GOOGLE=""
OPT_LEMBRETES=""
OPT_EMAIL_SES=""
OPT_RESERVA=""
OPT_NOTIFICACOES=false
SO_PUBLICAR=false
VLIBRAS_OPCIONAL=false
IGNORAR_DNS=false
ADMIN_EMAIL=""
DONO=false
MODO_CI=false
CONFIGURAR_CI=false

valor_da_opcao() {
  if [[ $# -lt 2 || -z "$2" || "$2" == --* ]]; then
    echo "A opção $1 precisa de um valor (veja --ajuda)." >&2
    exit 2
  fi
}

ler_opcoes() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --conta) valor_da_opcao "$@"; OPT_CONTA=$2; shift 2 ;;
      --zona) valor_da_opcao "$@"; OPT_ZONA=$2; shift 2 ;;
      --certificado) valor_da_opcao "$@"; OPT_CERT=$2; shift 2 ;;
      --email-alarmes) valor_da_opcao "$@"; OPT_EMAIL=$2; shift 2 ;;
      --orcamento) valor_da_opcao "$@"; OPT_ORCAMENTO=$2; shift 2 ;;
      --com-google) OPT_GOOGLE=true; shift ;;
      --sem-google) OPT_GOOGLE=false; shift ;;
      --com-lembretes-email) OPT_LEMBRETES=true; shift ;;
      --sem-lembretes-email) OPT_LEMBRETES=false; shift ;;
      --com-email-ses) OPT_EMAIL_SES=true; shift ;;
      --sem-email-ses) OPT_EMAIL_SES=false; shift ;;
      --com-concorrencia-reservada) OPT_RESERVA=true; shift ;;
      --sem-concorrencia-reservada) OPT_RESERVA=false; shift ;;
      --com-notificacoes) OPT_NOTIFICACOES=true; shift ;;
      --so-publicar) SO_PUBLICAR=true; shift ;;
      --vlibras-opcional) VLIBRAS_OPCIONAL=true; shift ;;
      --ignorar-dns) IGNORAR_DNS=true; shift ;;
      --admin) valor_da_opcao "$@"; ADMIN_EMAIL=$2; shift 2 ;;
      --dono) valor_da_opcao "$@"; ADMIN_EMAIL=$2; DONO=true; shift 2 ;;
      --ci) MODO_CI=true; shift ;;
      --configurar-ci) CONFIGURAR_CI=true; shift ;;
      -h | --ajuda | --help) ajuda; exit 0 ;;
      *) echo "Opção desconhecida: $1 (veja --ajuda)." >&2; exit 2 ;;
    esac
  done
  if [[ "$MODO_CI" == true && ( "$CONFIGURAR_CI" == true || -n "$ADMIN_EMAIL" || "$OPT_NOTIFICACOES" == true ) ]]; then
    echo "--ci é só o lançamento pelo CodeBuild: não combina com --configurar-ci, --admin, --dono nem --com-notificacoes." >&2
    exit 2
  fi
}

# ---------------------------------------------------------------------------------------------
# Mensagens, progresso e erros
# ---------------------------------------------------------------------------------------------

PASSO_ATUAL="início"
PASSO_N=0
TICKER_PID=""

passo() {
  PASSO_N=$((PASSO_N + 1))
  PASSO_ATUAL=$1
  printf '\n[%s] Passo %d: %s\n' "$(date +%H:%M)" "$PASSO_N" "$1"
}
ok() { printf '   ok: %s\n' "$1"; }
info() { printf '   %s\n' "$1"; }
aviso() { printf '   ATENÇÃO: %s\n' "$1"; }
falha() {
  printf '\n   ERRO: %s\n' "$1" >&2
  exit 1
}

parar_ticker() {
  if [[ -n "$TICKER_PID" ]]; then
    kill "$TICKER_PID" 2>/dev/null || true
    wait "$TICKER_PID" 2>/dev/null || true
    TICKER_PID=""
  fi
}

# Roda um comando demorado e avisa a cada 2 minutos que continua trabalhando. O CloudShell fecha a
# sessão depois de 20 a 30 minutos sem teclado ou mouse (processo rodando não conta), daí o lembrete.
demorado() {
  local rotulo=$1 inicio status=0
  shift
  # No CodeBuild ninguém precisa mexer no terminal: roda direto, sem o lembrete
  if [[ "$MODO_CI" == true ]]; then
    "$@" || status=$?
    return "$status"
  fi
  inicio=$(date +%s)
  (
    # O sleep fica em segundo plano para o kill do parar_ticker encerrar também ele: sem isso, o sleep
    # órfão segura a saída do terminal por até 2 minutos depois do passo
    trap 'kill "$espera" 2>/dev/null; exit 0' TERM
    while sleep 120 & espera=$! && wait "$espera"; do
      printf '   ... ainda em "%s" (%d min). Clique no terminal ou aperte Shift de vez em quando para o CloudShell não fechar.\n' \
        "$rotulo" $((($(date +%s) - inicio) / 60))
    done
  ) &
  TICKER_PID=$!
  "$@" || status=$?
  parar_ticker
  return "$status"
}

PID_PRINCIPAL=$$
ao_falhar() {
  local status=$?
  # Com set -E o trap também vale nos subshells; a mensagem sai uma vez só, no script principal
  [[ "$BASHPID" == "$PID_PRINCIPAL" ]] || return 0
  parar_ticker
  if [[ "$MODO_CI" == true ]]; then
    printf '\n   Parou no passo "%s" (código %d). Veja a mensagem acima e docs/ci-cd.md (Quando falha).\n' \
      "$PASSO_ATUAL" "$status" >&2
    return 0
  fi
  printf '\n   Parou no passo "%s" (código %d). Corrija o que a mensagem acima diz e rode o script de novo:\n' \
    "$PASSO_ATUAL" "$status" >&2
  printf '   ele confere o que já foi feito e continua dali.\n' >&2
}

# Comandos da AWS sempre pelo aws.sh: login do CloudShell (ou perfil librax) e nada do terminal
aws_l() { "$AWS_SH" aws "$@"; }

em_cloudshell() { [[ "${AWS_EXECUTION_ENV:-}" == CloudShell* ]]; }
# Terminal de verdade para perguntar (no teste, trocada para simular quem digita)
tem_terminal() { [[ -t 0 ]]; }

mascarar_email() {
  local email=$1
  [[ -n "$email" ]] || { printf '(nenhum)'; return; }
  printf '%s***@%s' "${email:0:1}" "${email#*@}"
}

# ---------------------------------------------------------------------------------------------
# Contexto do CDK (cdk.json do projeto e cdk.context.json local)
# ---------------------------------------------------------------------------------------------

# Valor de uma chave librax:* na ordem do CDK: o cdk.json vale mais que o cdk.context.json
contexto() {
  node -e '
    const fs = require("fs");
    const [infra, chave] = process.argv.slice(1);
    const ler = (f, ctx) => { try { const j = JSON.parse(fs.readFileSync(`${infra}/${f}`, "utf8")); return ctx ? j.context ?? {} : j; } catch { return {}; } };
    for (const [f, ctx] of [["cdk.json", true], ["cdk.context.json", false]]) {
      const v = ler(f, ctx)[chave];
      if (v !== undefined && v !== null) { process.stdout.write(String(v)); break; }
    }' "$INFRA" "librax:$1"
}

# Grava chave=valor no cdk.context.json, mantendo o resto; valor vazio apaga a chave
gravar_contexto() {
  node -e '
    const fs = require("fs");
    const [arquivo, ...pares] = process.argv.slice(1);
    let json = {};
    try { json = JSON.parse(fs.readFileSync(arquivo, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
    for (const par of pares) {
      const i = par.indexOf("=");
      const chave = `librax:${par.slice(0, i)}`;
      const valor = par.slice(i + 1);
      if (valor === "") delete json[chave];
      else if (valor === "true" || valor === "false") json[chave] = valor === "true";
      else json[chave] = valor;
    }
    fs.writeFileSync(arquivo, JSON.stringify(json, null, 2) + "\n");' "$CONTEXTO" "$@"
  # O /tmp some quando a sessão do CloudShell acaba; uma cópia (alguns bytes, sem segredo) fica na
  # pasta pessoal, que é permanente, para a próxima rodada não perguntar tudo de novo
  if em_cloudshell; then
    mkdir -p "$HOME/.librax"
    cp "$CONTEXTO" "$COPIA_CONTEXTO"
  fi
}

restaurar_contexto() {
  if em_cloudshell && [[ ! -f "$CONTEXTO" && -f "$COPIA_CONTEXTO" ]]; then
    cp "$COPIA_CONTEXTO" "$CONTEXTO"
    ok "valores da rodada anterior recuperados de ~/.librax/cdk.context.json"
  fi
}

# perguntar VAR "texto" "padrão" "regex" "dica"; sem terminal (ou no CI), usa o padrão ou para
perguntar() {
  local __var=$1 texto=$2 padrao=$3 regex=$4 dica=$5 resposta
  if [[ "$MODO_CI" == true ]]; then
    dica="Falta no $PARAM_CONTEXTO do SSM: rode o lançamento completo no CloudShell uma vez (ele atualiza o parâmetro) e rode o CI de novo."
  fi
  while true; do
    if tem_terminal && [[ "$MODO_CI" == false ]]; then
      read -r -p "   $texto${padrao:+ [$padrao]}: " resposta || true
      resposta=${resposta:-$padrao}
    else
      resposta=$padrao
    fi
    resposta="${resposta#"${resposta%%[![:space:]]*}"}"
    resposta="${resposta%"${resposta##*[![:space:]]}"}"
    if [[ "$resposta" =~ $regex ]]; then
      printf -v "$__var" '%s' "$resposta"
      return 0
    fi
    { tem_terminal && [[ "$MODO_CI" == false ]]; } || falha "$texto: valor ausente ou inválido. $dica"
    aviso "Valor inválido. $dica"
  done
}

RE_CONTA='^[0-9]{12}$'
RE_ZONA='^Z[A-Z0-9]{5,32}$'
RE_CERT='^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[0-9a-f-]{36}$'
RE_GOOGLE_ID='^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$'
RE_EMAIL='^[^@[:space:]"]+@[^@[:space:]"]+\.[^@[:space:]"]+$'
RE_EMAIL_OU_VAZIO='^$|^[^@[:space:]"]+@[^@[:space:]"]+\.[^@[:space:]"]+$'
RE_DOLARES='^[0-9]+(\.[0-9]+)?$'

# ---------------------------------------------------------------------------------------------
# Passos
# ---------------------------------------------------------------------------------------------

conferir_ambiente() {
  passo "Conferindo o ambiente"
  if [[ "$MODO_CI" == true ]]; then
    # O CI só roda no CodeBuild do Librax: login pelo papel do projeto, sem perguntas
    [[ -n "${CODEBUILD_BUILD_ID:-}" ]] ||
      falha "--ci é o modo do CodeBuild (infra/ci/buildspec.yml). No CloudShell, rode sem --ci."
    ok "AWS CodeBuild (build ${CODEBUILD_BUILD_NUMBER:-?}): usa o papel do projeto $PROJETO_CI"
  elif em_cloudshell; then
    ok "AWS CloudShell: usa o login do console (credenciais do contêiner)"
    [[ -n "${AWS_CONTAINER_CREDENTIALS_FULL_URI:-}" ]] ||
      falha "O CloudShell está sem as credenciais do contêiner. Feche a aba e abra o CloudShell de novo."
    case "$RAIZ/" in
      "$HOME"/*)
        falha "O repositório está em $RAIZ, dentro da pasta pessoal do CloudShell (só 1 GB). Clone em /tmp (docs/lancamento.md, passo 7)."
        ;;
    esac
    # Cache do npm fora da pasta pessoal (o padrão é ~/.npm)
    export npm_config_cache=${LIBRAX_NPM_CACHE:-/tmp/librax-npm-cache}
    if [[ -n "${AWS_REGION:-}" && "$AWS_REGION" != "$REGIAO" ]]; then
      aviso "A sessão está na região $AWS_REGION; o Librax fica em $REGIAO e o script usa $REGIAO."
    fi
  else
    aviso "Fora do CloudShell: usa o perfil librax deste computador (npm run aws:entrar em infra)."
  fi
  # No CloudShell o aws.sh mantém esta região; com o perfil librax, vale a região do perfil (us-east-1)
  export AWS_REGION=$REGIAO AWS_DEFAULT_REGION=$REGIAO
  export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
  export CDK_DISABLE_CLI_TELEMETRY=true

  for cmd in aws git curl tar sha256sum; do
    command -v "$cmd" >/dev/null || falha "Falta o comando $cmd neste terminal."
  done

  if [[ ! -d "$WEB/node_modules" ]]; then
    local livre
    livre=$(df -Pm "$RAIZ" | awk 'NR == 2 { print $4 }')
    if [[ "$livre" =~ ^[0-9]+$ ]] && ((livre < ESPACO_MINIMO_MB)); then
      falha "Só ${livre} MB livres em $(df -P "$RAIZ" | awk 'NR == 2 { print $6 }'); o lançamento precisa de cerca de ${ESPACO_MINIMO_MB} MB."
    fi
    ok "espaço livre: ${livre} MB"
  fi
}

garantir_node() {
  passo "Node.js (precisa da versão $NODE_MINIMO ou mais nova)"
  if [[ -x "$NODE_DIR/bin/node" ]]; then
    export PATH="$NODE_DIR/bin:$PATH"
  fi
  local major=0
  if command -v node >/dev/null; then
    major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  fi
  if ((major >= NODE_MINIMO)); then
    ok "Node $(node -v) em $(command -v node)"
    return
  fi

  local arq nome tmp atual=nenhum
  ((major == 0)) || atual="versão $major"
  case "$(uname -m)" in
    x86_64) arq=x64 ;;
    aarch64 | arm64) arq=arm64 ;;
    *) falha "Processador $(uname -m) sem Node pronto; instale o Node $NODE_MINIMO ou mais novo." ;;
  esac
  nome="node-v$NODE_VERSAO-linux-$arq.tar.gz"
  info "Node do terminal: $atual. Baixando o Node $NODE_VERSAO para $NODE_DIR (fora da pasta pessoal)."
  tmp=$(mktemp -d "$NODE_DIR-download.XXXXXX")
  curl -fsSL --retry 3 -o "$tmp/$nome" "https://nodejs.org/dist/v$NODE_VERSAO/$nome"
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSAO/SHASUMS256.txt"
  if ! (cd "$tmp" && grep " $nome\$" SHASUMS256.txt | sha256sum -c --status); then
    rm -rf "$tmp"
    falha "O arquivo do Node baixado não confere com o SHA-256 publicado. Rode de novo."
  fi
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$tmp/$nome" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
  export PATH="$NODE_DIR/bin:$PATH"
  ok "Node $(node -v) em $NODE_DIR"
}

npm_ci_em() { (cd "$1" && npm ci --no-audit --no-fund --loglevel=error); }

instalar_dependencias() {
  passo "Dependências (npm ci só onde falta ou mudou)"
  local pastas=("$WEB" "$ADMIN" "$LANDING")
  if [[ "$SO_PUBLICAR" == false ]]; then pastas=("$INFRA" "$API" "${pastas[@]}"); fi
  local dir rel
  for dir in "${pastas[@]}"; do
    rel=${dir#"$RAIZ"/}
    if [[ -f "$dir/node_modules/.package-lock.json" && ! "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]]; then
      ok "$rel em dia"
      continue
    fi
    info "$rel: npm ci"
    demorado "npm ci em $rel" npm_ci_em "$dir"
    ok "$rel instalado"
  done
}

ler_conta() {
  local atual
  atual=$(contexto accountId)
  if [[ -n "$OPT_CONTA" ]]; then
    [[ "$OPT_CONTA" =~ $RE_CONTA ]] || falha "--conta precisa de 12 dígitos."
    CONTA=$OPT_CONTA
  elif [[ "$atual" =~ $RE_CONTA ]]; then
    CONTA=$atual
  else
    info "Número da conta AWS do Librax: 12 dígitos, no menu com o seu nome no canto superior direito do console."
    perguntar CONTA "Conta AWS do Librax" "" "$RE_CONTA" "Use os 12 dígitos, sem traços (ou --conta)."
  fi
  gravar_contexto "accountId=$CONTA"
  ok "conta fixada: $CONTA (infra/cdk.context.json)"
}

conferir_conta() {
  passo "Trava da conta"
  ler_conta
  (cd "$INFRA" && "$AWS_SH" node scripts/conferir-conta.mjs)
}

# Zona do Route 53 com o nome do domínio, se existir (só leitura)
sugerir_zona() {
  local linha
  [[ "$MODO_CI" == false ]] || return 0 # no CI não há quem aceite a sugestão: falta o valor e para
  linha=$(aws_l route53 list-hosted-zones-by-name --dns-name "$DOMINIO" --max-items 1 \
    --query 'HostedZones[0].[Id, Name]' --output text 2>/dev/null || true)
  if [[ "$linha" == */hostedzone/*"$DOMINIO." ]]; then
    linha=${linha%%[[:space:]]*}
    printf '%s' "${linha##*/}"
  fi
}

# Certificado emitido para o domínio na conta, se existir (só leitura)
sugerir_certificado() {
  [[ "$MODO_CI" == false ]] || return 0
  aws_l acm list-certificates --region "$REGIAO" --certificate-statuses ISSUED \
    --query "CertificateSummaryList[?DomainName=='$DOMINIO'].CertificateArn | [0]" --output text 2>/dev/null |
    grep -E "$RE_CERT" || true
}

ler_contexto_do_lancamento() {
  passo "Valores do lançamento (infra/cdk.context.json)"
  ok "domínio: $DOMINIO (infra/cdk.json)"

  local zona cert email orcamento google lembretes email_ses sugestao
  zona=${OPT_ZONA:-$(contexto hostedZoneId)}
  if [[ ! "$zona" =~ $RE_ZONA ]]; then
    sugestao=$(sugerir_zona)
    info "Id da zona hospedada de $DOMINIO no Route 53 (Route 53 > Zonas hospedadas, coluna \"ID da zona hospedada\")."
    perguntar zona "Id da zona do Route 53" "$sugestao" "$RE_ZONA" "Algo como Z0123456789ABCDEFGHIJ (ou --zona)."
  fi

  cert=${OPT_CERT:-$(contexto certificateArn)}
  if [[ ! "$cert" =~ $RE_CERT ]]; then
    sugestao=$(sugerir_certificado)
    info "ARN do certificado do ACM em us-east-1 para $DOMINIO e *.$DOMINIO (Certificate Manager > o certificado > ARN)."
    perguntar cert "ARN do certificado" "$sugestao" "$RE_CERT" "Começa com arn:aws:acm:us-east-1: (ou --certificado)."
  fi
  [[ "$cert" == "arn:aws:acm:$REGIAO:$CONTA:"* ]] || falha "O certificado precisa ser da conta $CONTA, em $REGIAO."

  email=${OPT_EMAIL:-$(contexto alarmEmail)}
  if [[ -z "$email" ]]; then
    info "E-mail que recebe os alarmes e os avisos do orçamento mensal (a AWS manda um pedido de confirmação)."
    perguntar email "E-mail dos alarmes (Enter para nenhum)" "" "$RE_EMAIL_OU_VAZIO" "Um e-mail válido, ou vazio."
  fi
  [[ "$email" =~ $RE_EMAIL_OU_VAZIO ]] || falha "E-mail dos alarmes inválido."

  orcamento=${OPT_ORCAMENTO:-$(contexto monthlyBudgetUsd)}
  [[ -z "$orcamento" || "$orcamento" =~ $RE_DOLARES ]] || falha "--orcamento precisa ser um número (dólares)."

  # Google, lembretes por e-mail e e-mails do login pelo SES: a opção vale; sem ela, o que já estava;
  # no primeiro lançamento, desligados
  google=${OPT_GOOGLE:-$(contexto googleEnabled)}
  [[ "$google" == true ]] || google=false
  lembretes=${OPT_LEMBRETES:-$(contexto emailRemindersEnabled)}
  [[ "$lembretes" == true ]] || lembretes=false
  email_ses=${OPT_EMAIL_SES:-$(contexto cognitoEmailSes)}
  [[ "$email_ses" == true ]] || email_ses=false

  gravar_contexto "hostedZoneId=$zona" "hostedZoneName=$DOMINIO" "certificateArn=$cert" "alarmEmail=$email" \
    "monthlyBudgetUsd=$orcamento" "googleEnabled=$google" "emailRemindersEnabled=$lembretes" \
    "cognitoEmailSes=$email_ses"
  ZONA=$zona
  CERT=$cert
  GOOGLE=$google
  LEMBRETES=$lembretes
  EMAIL_SES=$email_ses
  ALARM_EMAIL=$email
  ok "zona: $zona"
  ok "certificado: $cert"
  ok "e-mail dos alarmes: $(mascarar_email "$email")"
  ok "orçamento mensal: ${orcamento:-10} dólares"
  ok "login com Google: $([[ $google == true ]] && echo ligado || echo desligado)"
  ok "lembretes por e-mail: $([[ $lembretes == true ]] && echo ligados || echo desligados)"
  if [[ "$email_ses" == true ]]; then
    ok "códigos do login (cadastro e nova senha): pelo SES, de $(remetente_do_login)"
  else
    ok "códigos do login (cadastro e nova senha): envio padrão do Cognito (até 50 e-mails por dia)"
  fi
  [[ -n "$email" ]] || aviso "Sem e-mail dos alarmes: os alarmes não avisam ninguém e o orçamento mensal não é criado."
}

# Os nomes que a stack usa e que o certificado precisa cobrir
certificado_cobre() {
  local nome=$1 sans=",$2,"
  [[ "$sans" == *",$nome,"* ]] && return 0
  [[ "$nome" == *."$DOMINIO" && "$sans" == *",*.$DOMINIO,"* && "${nome%."$DOMINIO"}" != *.* ]]
}

conferir_pre_requisitos() {
  passo "Conferindo zona, certificado e DNS"
  local linha nome_zona ns_zona status sans nome
  linha=$(aws_l route53 get-hosted-zone --id "$ZONA" \
    --query '[HostedZone.Name, join(`,`, DelegationSet.NameServers)]' --output text) ||
    falha "Não achei a zona $ZONA nesta conta (Route 53 > Zonas hospedadas)."
  read -r nome_zona ns_zona <<<"$linha"
  [[ "$nome_zona" == "$DOMINIO." ]] || falha "A zona $ZONA é de ${nome_zona%.}, não de $DOMINIO."
  ok "zona $ZONA de $DOMINIO"

  linha=$(aws_l acm describe-certificate --region "$REGIAO" --certificate-arn "$CERT" \
    --query '[Certificate.Status, join(`,`, Certificate.SubjectAlternativeNames)]' --output text) ||
    falha "Não achei o certificado em us-east-1 nesta conta."
  read -r status sans <<<"$linha"
  [[ "$status" == ISSUED ]] ||
    falha "O certificado está como $status. Ele precisa estar \"Emitido\" (ISSUED): confira os registros de validação no Route 53 e espere (docs/lancamento.md, passo 4)."
  for nome in "$DOMINIO" "www.$DOMINIO" "app.$DOMINIO" "auth.$DOMINIO"; do
    certificado_cobre "$nome" "$sans" || falha "O certificado não cobre $nome. Peça um com $DOMINIO e *.$DOMINIO."
  done
  ok "certificado emitido e cobrindo $DOMINIO, www, app e auth"

  if [[ "$IGNORAR_DNS" == true ]]; then
    aviso "Conferência do DNS pulada (--ignorar-dns)."
  else
    local publicos
    publicos=$(curl -fsS --max-time 15 "https://dns.google/resolve?name=$DOMINIO&type=NS" 2>/dev/null |
      node -e '
        let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
          try { const j = JSON.parse(t); process.stdout.write((j.Answer ?? []).filter((a) => a.type === 2).map((a) => a.data.toLowerCase().replace(/\.$/, "")).sort().join(",")); } catch {}
        });' || true)
    local esperados
    esperados=$(tr ',' '\n' <<<"$ns_zona" | tr '[:upper:]' '[:lower:]' | sed 's/\.$//' | sort | paste -sd, -)
    if [[ -z "$publicos" ]]; then
      aviso "Não consegui consultar o DNS público agora; seguindo. Se o deploy falhar no domínio do Cognito, confira os servidores de nomes na GoDaddy."
    elif [[ "$publicos" != "$esperados" ]]; then
      info "Servidores de nomes publicados para $DOMINIO: ${publicos//,/ }"
      info "Servidores de nomes da zona no Route 53:     ${esperados//,/ }"
      falha "O domínio ainda não aponta para o Route 53. Troque os servidores de nomes na GoDaddy (docs/lancamento.md, passo 3) e espere a propagação. Para seguir assim mesmo: --ignorar-dns."
    else
      ok "$DOMINIO já responde pelos servidores do Route 53"
    fi
  fi

  if [[ "$GOOGLE" == true ]]; then
    garantir_cliente_google
  fi
  if [[ "$LEMBRETES" == true ]]; then
    local verificado
    verificado=$(aws_l sesv2 get-email-identity --email-identity "$DOMINIO" --query VerifiedForSendingStatus --output text 2>/dev/null || true)
    [[ "$verificado" == True ]] ||
      falha "Lembretes por e-mail ligados, mas $DOMINIO não está verificado no SES. Ou rode com --sem-lembretes-email."
    if [[ "$(aws_l sesv2 get-account --query ProductionAccessEnabled --output text 2>/dev/null || true)" != True ]]; then
      aviso "O SES ainda está no sandbox: os lembretes só chegam a e-mails verificados até a AWS liberar a saída."
    fi
    ok "domínio verificado no SES"
  fi
  if [[ "$EMAIL_SES" == true ]]; then
    conferir_ses_do_login
  fi
}

# Cliente OAuth do Google (--com-google): o id vai para o SSM e o segredo para o Secrets Manager. O que
# faltar o script pede no terminal (o segredo sem aparecer na tela nem no histórico) e grava por arquivo
# temporário, para o valor não passar pela linha de comando. No CI, ou sem terminal, só confere.
garantir_cliente_google() {
  local tem_id=false tem_segredo=false id segredo tmp
  aws_l ssm get-parameter --name "$PARAM_GOOGLE_ID" --query Parameter.Name --output text >/dev/null 2>&1 && tem_id=true
  aws_l secretsmanager describe-secret --secret-id "$SEGREDO_GOOGLE" --query Name --output text >/dev/null 2>&1 &&
    tem_segredo=true
  if [[ "$tem_id" == false || "$tem_segredo" == false ]]; then
    if [[ "$MODO_CI" == true ]] || ! tem_terminal; then
      [[ "$tem_id" == true ]] ||
        falha "Google ligado, mas falta o parâmetro $PARAM_GOOGLE_ID no SSM. Rode no CloudShell com --com-google (ele pede o id e o segredo) ou com --sem-google."
      falha "Google ligado, mas falta o segredo $SEGREDO_GOOGLE no Secrets Manager. Rode no CloudShell com --com-google (ele pede o segredo) ou com --sem-google."
    fi
    info "Dados do cliente OAuth do Google (Google Cloud Console > APIs e serviços > Credenciais > o cliente;"
    info "passo a passo em docs/lancamento.md, Google)."
  fi
  if [[ "$tem_id" == false ]]; then
    perguntar id "Client ID" "" "$RE_GOOGLE_ID" "Termina com .apps.googleusercontent.com."
    aws_l ssm put-parameter --name "$PARAM_GOOGLE_ID" --type String \
      --description "Client ID do OAuth do Google (login do Librax)" --value "$id" >/dev/null
    ok "Client ID guardado em $PARAM_GOOGLE_ID"
  fi
  if [[ "$tem_segredo" == false ]]; then
    while true; do
      read -r -s -p "   Client secret (não aparece na tela): " segredo || true
      echo
      [[ -z "$segredo" || "$segredo" =~ [[:space:]] ]] || break
      aviso "Cole o segredo do cliente (Client secret), sem espaços."
    done
    tmp=$(mktemp)
    chmod 600 "$tmp"
    printf '%s' "$segredo" >"$tmp"
    unset segredo
    if ! aws_l secretsmanager create-secret --name "$SEGREDO_GOOGLE" \
      --description "Client secret do OAuth do Google (login do Librax)" \
      --secret-string "file://$tmp" --query Name --output text >/dev/null; then
      rm -f "$tmp"
      falha "Não consegui guardar o segredo em $SEGREDO_GOOGLE no Secrets Manager."
    fi
    rm -f "$tmp"
    ok "Client secret guardado em $SEGREDO_GOOGLE (0,40 dólar por mês)"
  fi
  ok "cliente OAuth do Google guardado (SSM e Secrets Manager)"
}

# Chaves VAPID das notificações (--com-notificacoes), geradas no próprio CloudShell com o crypto do Node
# (P-256, o mesmo formato do web-push: pública com 65 bytes e privada com 32, em base64url) e gravadas
# por arquivo temporário, sem a privada passar pela tela nem pela linha de comando. Chaves que já
# existem ficam: trocar invalida as inscrições de quem já ativou as notificações. Sem a pública nenhum
# aparelho se inscreveu, então uma privada solta (rodada interrompida) pode ser trocada.
garantir_chaves_push() {
  passo "Chaves das notificações (Web Push)"
  local tem_publica=false tem_privada=false tmp
  aws_l ssm get-parameter --name "$PARAM_VAPID_PUBLICA" --query Parameter.Name --output text >/dev/null 2>&1 &&
    tem_publica=true
  aws_l ssm get-parameter --name "$PARAM_VAPID_PRIVADA" --query Parameter.Name --output text >/dev/null 2>&1 &&
    tem_privada=true
  if [[ "$tem_publica" == true && "$tem_privada" == true ]]; then
    ok "chaves já guardadas no SSM; ficam as mesmas"
    return 0
  fi
  if [[ "$tem_publica" == true ]]; then
    falha "Há a chave pública ($PARAM_VAPID_PUBLICA) mas falta a privada ($PARAM_VAPID_PRIVADA). Para gerar um par novo, apague a pública no SSM e rode de novo; quem já tinha ativado as notificações precisa ativar outra vez."
  fi
  tmp=$(mktemp -d)
  chmod 700 "$tmp"
  if ! node -e '
    const { createECDH } = require("crypto");
    const fs = require("fs");
    const path = require("path");
    const dir = process.argv[1];
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const tamanho = (b, n) => Buffer.concat([Buffer.alloc(Math.max(0, n - b.length)), b]);
    fs.writeFileSync(path.join(dir, "publica"), tamanho(ecdh.getPublicKey(), 65).toString("base64url"), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "privada"), tamanho(ecdh.getPrivateKey(), 32).toString("base64url"), { mode: 0o600 });' "$tmp"; then
    rm -rf "$tmp"
    falha "Não consegui gerar as chaves VAPID."
  fi
  # A privada primeiro: a pública no SSM é o sinal de que o par está completo
  if ! aws_l ssm put-parameter --name "$PARAM_VAPID_PRIVADA" --type SecureString --overwrite \
    --description "Chave privada VAPID das notificacoes do Librax" --value "file://$tmp/privada" >/dev/null ||
    ! aws_l ssm put-parameter --name "$PARAM_VAPID_PUBLICA" --type String \
      --description "Chave publica VAPID das notificacoes do Librax (vai no app)" --value "file://$tmp/publica" >/dev/null; then
    rm -rf "$tmp"
    falha "Não consegui gravar as chaves VAPID no SSM. Rode de novo com --com-notificacoes."
  fi
  rm -rf "$tmp"
  ok "chaves geradas e guardadas no SSM ($PARAM_VAPID_PUBLICA e $PARAM_VAPID_PRIVADA, a privada cifrada)"
}

# Remetente dos códigos do login: librax:cognitoEmailFrom ou o padrão da stack (infra/lib/config.ts)
remetente_do_login() {
  local remetente
  remetente=$(contexto cognitoEmailFrom)
  printf '%s' "${remetente:-nao-responda@$DOMINIO}"
}

# Códigos do login pelo SES (só leitura): o domínio do remetente precisa existir e estar verificado no
# SES em us-east-1. No sandbox o deploy segue, mas com um aviso: lá o SES só entrega para endereços
# verificados, então quem criar conta não recebe o código até a AWS liberar a conta.
conferir_ses_do_login() {
  local remetente dominio saida verificado status producao
  remetente=$(remetente_do_login)
  [[ "$remetente" =~ $RE_EMAIL ]] || falha "librax:cognitoEmailFrom inválido ($remetente) em infra/cdk.context.json."
  dominio=${remetente#*@}
  if ! saida=$(aws_l sesv2 get-email-identity --region "$REGIAO" --email-identity "$dominio" \
    --query '[VerifiedForSendingStatus, VerificationStatus]' --output text 2>&1); then
    if [[ "$saida" == *NotFoundException* ]]; then
      falha "E-mails do login pelo SES ligados, mas $dominio não está cadastrado no SES em $REGIAO. Crie a identidade em Amazon SES > Identidades > Criar identidade > Domínio, com Easy DKIM e publicando os registros no Route 53 (docs/lancamento.md, E-mails do login pelo SES). Ou rode com --sem-email-ses."
    fi
    printf '%s\n' "$saida" >&2
    falha "Não consegui consultar $dominio no SES (veja a mensagem acima)."
  fi
  read -r verificado status <<<"$saida"
  [[ "$verificado" == True ]] ||
    falha "E-mails do login pelo SES ligados, mas $dominio ainda não está verificado no SES (situação: ${status:-desconhecida}). Confira os 3 registros CNAME do DKIM no Route 53 e espere a verificação (costuma levar minutos, no máximo 72 horas). Ou rode com --sem-email-ses."
  ok "$dominio verificado no SES: os códigos do login saem de $remetente"

  producao=$(aws_l sesv2 get-account --region "$REGIAO" --query ProductionAccessEnabled --output text 2>/dev/null || true)
  if [[ "$producao" != True ]]; then
    aviso "A conta ainda está no sandbox do SES em $REGIAO. Com o envio pelo SES ligado, o código de cadastro e o de nova senha só chegam a e-mails verificados no SES: quem criar conta agora não recebe o código."
    info "Peça a liberação no console: Amazon SES > Painel da conta (Account dashboard) > Solicitar acesso de produção"
    info "(Request production access). Texto sugerido em docs/lancamento.md, E-mails do login pelo SES."
    info "Até a AWS liberar, prefira rodar com --sem-email-ses (envio padrão do Cognito, até 50 e-mails por dia)."
  else
    ok "SES fora do sandbox (acesso de produção liberado)"
  fi
}

# Cota de execuções simultâneas do Lambda (só leitura) e a opção librax:lambdaReservedConcurrency.
# Conta nova costuma vir com 10: reservar qualquer coisa faria o deploy falhar (a AWS exige 100 sem
# reserva) e, mesmo sem reserva, 10 cópias juntas seguram pouca gente. Ligar só depois de a AWS liberar.
conferir_concorrencia() {
  local cota reserva necessario
  reserva=${OPT_RESERVA:-$(contexto lambdaReservedConcurrency)}
  [[ "$reserva" == true ]] || reserva=false
  necessario=$((RESERVA_LAMBDA + LAMBDA_SEM_RESERVA))
  cota=$(aws_l lambda get-account-settings --region "$REGIAO" --query 'AccountLimit.ConcurrentExecutions' --output text 2>/dev/null || true)
  if [[ ! "$cota" =~ ^[0-9]+$ ]]; then
    aviso "Não consegui ler a cota de concorrência do Lambda (lambda get-account-settings)."
    [[ "$reserva" == false ]] ||
      falha "Concorrência reservada ligada, mas sem conferir a cota o deploy pode falhar. Rode de novo ou use --sem-concorrencia-reservada."
    gravar_contexto "lambdaReservedConcurrency=false"
    return 0
  fi
  if ((cota < COTA_LAMBDA_PEDIR)); then
    aviso "A cota de execuções simultâneas do Lambda nesta conta é $cota (o normal é $COTA_LAMBDA_PEDIR; conta nova costuma vir com 10)."
    info "Com $cota, um pico de acesso ou um abuso faz as chamadas do app falharem. Peça o aumento (grátis):"
    info "Service Quotas > Serviços da AWS > AWS Lambda > Concurrent executions (código L-B99A9384) >"
    info "Solicitar aumento no nível da conta > $COTA_LAMBDA_PEDIR."
    info "Quando a AWS liberar (costuma levar de horas a 2 dias), rode de novo com --com-concorrencia-reservada."
  fi
  if [[ "$reserva" == true ]] && ((cota < necessario)); then
    falha "Concorrência reservada pedida, mas a cota da conta é $cota e precisa de pelo menos $necessario ($RESERVA_LAMBDA reservadas + $LAMBDA_SEM_RESERVA livres que a AWS exige). Peça $COTA_LAMBDA_PEDIR no Service Quotas (acima) ou rode com --sem-concorrencia-reservada."
  fi
  gravar_contexto "lambdaReservedConcurrency=$reserva"
  if [[ "$reserva" == true ]]; then
    ok "concorrência reservada ligada: $RESERVA_LAMBDA execuções divididas entre as Lambdas da API (cota da conta: $cota)"
  else
    ok "concorrência reservada desligada (cota da conta: $cota)"
    if ((cota >= COTA_LAMBDA_PEDIR)); then
      info "A cota já permite: para limitar cada Lambda da API, rode com --com-concorrencia-reservada."
    fi
  fi
}

# Alerta de anomalia de custo (só leitura): só cabe um monitor de serviços por conta, e a AWS costuma
# criar um sozinha quando o Cost Explorer é ativado. Usa o que existir; sem nenhum, a stack cria; com o
# Cost Explorer ainda desligado (a API recusa), fica desligado até a próxima rodada. Cada leitura da
# API do Cost Explorer custa US$ 0,01; só acontece enquanto o alerta não está configurado.
conferir_anomalia_de_custo() {
  local atual monitor
  atual=$(contexto costAnomalyAlerts)
  if [[ -z "$ALARM_EMAIL" ]]; then
    gravar_contexto "costAnomalyAlerts=off"
    info "Sem e-mail dos alarmes: sem alerta de anomalia de custo."
    return 0
  fi
  if [[ "$atual" == create || "$atual" == arn:aws:ce::* ]]; then
    ok "alerta de anomalia de custo já configurado ($([[ $atual == create ]] && echo 'monitor criado pela stack' || echo 'monitor que já existia na conta'))"
    return 0
  fi
  # No CI a consulta ao Cost Explorer (US$ 0,01 por chamada) fica de fora: vale a escolha gravada pela
  # última rodada no CloudShell, e sem escolha o alerta fica desligado
  if [[ "$MODO_CI" == true ]]; then
    gravar_contexto "costAnomalyAlerts=${atual:-off}"
    info "Alerta de anomalia de custo: ${atual:-off}, como na última rodada do CloudShell (o CI não consulta o Cost Explorer, que cobra por chamada)."
    return 0
  fi
  if ! monitor=$(aws_l ce get-anomaly-monitors --region "$REGIAO" \
    --query "AnomalyMonitors[?MonitorType=='DIMENSIONAL' && MonitorDimension=='SERVICE'].MonitorArn | [0]" --output text 2>/dev/null); then
    gravar_contexto "costAnomalyAlerts=off"
    aviso "O Cost Explorer ainda não está ativo nesta conta: o alerta de anomalia de custo fica para depois."
    info "Ative em Faturamento e Gerenciamento de Custos > Cost Explorer (grátis; os dados aparecem em até 24 h) e rode o lançamento de novo."
    return 0
  fi
  if [[ "$monitor" == arn:aws:ce::* ]]; then
    gravar_contexto "costAnomalyAlerts=$monitor"
    ok "alerta de anomalia de custo: usa o monitor de serviços que a conta já tem"
  else
    gravar_contexto "costAnomalyAlerts=create"
    ok "alerta de anomalia de custo: a stack cria o monitor de serviços"
  fi
  info "O resumo diário das anomalias vai para $(mascarar_email "$ALARM_EMAIL")."
}

conferir_travas_de_custo() {
  passo "Travas de custo (cota do Lambda e alerta de anomalia)"
  conferir_concorrencia
  conferir_anomalia_de_custo
}

# Estado de uma stack do CloudFormation, ou NAO_EXISTE
estado_stack() {
  local saida
  if saida=$(aws_l cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>&1); then
    printf '%s' "$saida"
  elif [[ "$saida" == *"does not exist"* ]]; then
    printf 'NAO_EXISTE'
  else
    printf '%s\n' "$saida" >&2
    return 1
  fi
}

esperar_stack() {
  local estado
  while true; do
    estado=$(estado_stack "$STACK")
    # REVIEW_IN_PROGRESS é um changeset que nunca rodou (deploy interrompido): o próximo deploy segue dele
    [[ "$estado" == *_IN_PROGRESS && "$estado" != REVIEW_IN_PROGRESS ]] || break
    info "A stack está em $estado (uma publicação anterior ainda está rodando na AWS). Conferindo de novo em 30 s..."
    sleep 30
  done
  case "$estado" in
    ROLLBACK_COMPLETE)
      falha "A primeira criação da stack falhou e foi desfeita (ROLLBACK_COMPLETE). Veja o motivo em CloudFormation > LibraxStack > Eventos, apague a stack e a tabela DynamoDB \"librax\" que ficou (vazia) e rode de novo (docs/lancamento.md, Desfazer)."
      ;;
    *_FAILED)
      falha "A stack está em $estado. Veja o motivo em CloudFormation > LibraxStack > Eventos (docs/lancamento.md, Desfazer)."
      ;;
  esac
  ESTADO_STACK=$estado
}

publicar_stack() {
  passo "Build da landing (o deploy tira dele o hash da CSP)"
  (cd "$INFRA" && demorado "build da landing" node scripts/landing.mjs build)

  passo "Bootstrap do CDK (só se faltar)"
  local estado
  estado=$(estado_stack CDKToolkit)
  case "$estado" in
    CREATE_COMPLETE | UPDATE_COMPLETE | UPDATE_ROLLBACK_COMPLETE | IMPORT_COMPLETE)
      ok "conta já preparada para o CDK ($estado)"
      ;;
    *)
      # O papel do CI não cria o bootstrap (precisa de IAM): só o primeiro lançamento, no CloudShell
      [[ "$MODO_CI" == false ]] ||
        falha "A conta não tem o bootstrap do CDK (CDKToolkit em $estado). Faça o lançamento completo pelo CloudShell (docs/lancamento.md)."
      info "Preparando a conta para o CDK (stack CDKToolkit, uma vez só)."
      (cd "$INFRA" && demorado "bootstrap do CDK" "$AWS_SH" npx cdk bootstrap "aws://$CONTA/$REGIAO")
      ok "bootstrap feito"
      ;;
  esac

  passo "Deploy da stack $STACK (de 15 a 40 minutos na primeira vez)"
  esperar_stack
  if [[ "$ESTADO_STACK" == NAO_EXISTE ]]; then
    info "Primeira criação da stack. Os eventos aparecem abaixo enquanto a AWS cria os recursos."
  else
    info "Atualizando a stack (estava em $ESTADO_STACK). Os eventos aparecem abaixo."
  fi
  (cd "$INFRA" && demorado "deploy da stack" deploy_da_stack)
  esperar_stack
  ok "stack publicada ($ESTADO_STACK)"
  # Os valores que acabaram de ir para a stack ficam no SSM para o CI/CD publicar igual
  [[ "$MODO_CI" == true ]] || sincronizar_contexto
}

# Deploy só da LibraxStack. No CloudShell, o npm run deploy de sempre (o app CDK do bin/librax.ts só tem
# ela); no CI, com o nome explícito: o CI nunca publica a própria stack (LibraxCiStack, outro app CDK).
deploy_da_stack() {
  if [[ "$MODO_CI" == true ]]; then
    "$AWS_SH" node scripts/conferir-conta.mjs
    "$AWS_SH" npx cdk deploy "$STACK" --require-approval never --ci
  else
    npm run deploy
  fi
}

# Cópia do infra/cdk.context.json no SSM (SecureString, nível padrão: grátis), de onde o CI lê. Não
# tem segredo (o do Google fica no Secrets Manager e a chave privada do VAPID no SSM, fora daqui), mas
# tem o e-mail dos alarmes, por isso vai cifrado.
sincronizar_contexto() {
  passo "Valores do lançamento no SSM para o CI/CD ($PARAM_CONTEXTO)"
  [[ -f "$CONTEXTO" ]] || falha "Sem infra/cdk.context.json para copiar."
  local tamanho
  tamanho=$(wc -c <"$CONTEXTO")
  ((tamanho <= TAMANHO_MAXIMO_PARAMETRO)) ||
    falha "infra/cdk.context.json tem $tamanho bytes e o parâmetro padrão do SSM aceita até $TAMANHO_MAXIMO_PARAMETRO."
  aws_l ssm put-parameter --name "$PARAM_CONTEXTO" --type SecureString --tier Standard --overwrite \
    --description "Contexto do CDK do Librax (lancar-cloudshell.sh); o CI/CD le daqui" \
    --value "file://$CONTEXTO" >/dev/null
  ok "$PARAM_CONTEXTO atualizado (SecureString; o CI/CD publica com estes valores)"
}

# No CI os valores vêm do SSM (gravados pela última rodada no CloudShell). O conteúdo nunca vai para o
# log: só o resultado da conferência.
baixar_contexto() {
  passo "Valores do lançamento ($PARAM_CONTEXTO no SSM)"
  local tmp="$CONTEXTO.baixando"
  rm -f "$tmp"
  if ! (umask 077 && aws_l ssm get-parameter --name "$PARAM_CONTEXTO" --with-decryption \
    --query Parameter.Value --output text >"$tmp" 2>/dev/null); then
    rm -f "$tmp"
    falha "Não consegui ler $PARAM_CONTEXTO no SSM. Rode o lançamento completo no CloudShell uma vez (ele grava o parâmetro) e confira o --configurar-ci (docs/ci-cd.md)."
  fi
  if ! node -e '
    const fs = require("fs");
    let json;
    try { json = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(3); }
    if (!json || typeof json !== "object" || Array.isArray(json)) process.exit(3);' "$tmp"; then
    rm -f "$tmp"
    falha "$PARAM_CONTEXTO não é um JSON válido. Rode o lançamento completo no CloudShell para gravar de novo."
  fi
  mv "$tmp" "$CONTEXTO"
  ok "valores lidos do SSM (o conteúdo não aparece no log)"
}

# ler_outputs CHAVE...: guarda os outputs da stack e confere os que o passo usa
ler_outputs() {
  OUTPUTS=$(aws_l cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output json)
  local chave
  for chave in "$@"; do
    [[ -n "$(output "$chave")" ]] || falha "A stack não tem o output $chave: rode o lançamento completo (sem --so-publicar)."
  done
}

output() {
  node -e '
    const [json, chave] = process.argv.slice(1);
    const item = (JSON.parse(json) ?? []).find((o) => o.OutputKey === chave);
    process.stdout.write(item ? item.OutputValue : "");' "$OUTPUTS" "$1"
}

escrever_envs() {
  passo "Variáveis de build do app e do painel (a partir dos outputs da stack)"
  ler_outputs AppUrl AdminUrl LandingUrl UserPoolId UserPoolClientId AuthDomain AdminClientId \
    WebBucketName ContentBucketName AdminBucketName
  local dominio_auth vapid google lembretes
  dominio_auth=$(output AuthDomain)
  dominio_auth=${dominio_auth#https://}
  vapid=$(aws_l ssm get-parameter --name "$PARAM_VAPID_PUBLICA" --query Parameter.Value --output text 2>/dev/null || true)
  [[ "$vapid" == None ]] && vapid=""
  google=$(contexto googleEnabled)
  [[ "$google" == false ]] || google=true
  # O app só oferece o lembrete por e-mail com o envio ligado na infra
  lembretes=$(contexto emailRemindersEnabled)
  [[ "$lembretes" == true ]] || lembretes=false

  {
    echo "# Gerado por infra/scripts/lancar-cloudshell.sh com os outputs da stack $STACK. Fora do git."
    echo "VITE_COGNITO_USER_POOL_ID=$(output UserPoolId)"
    echo "VITE_COGNITO_CLIENT_ID=$(output UserPoolClientId)"
    echo "VITE_COGNITO_DOMAIN=$dominio_auth"
    echo "VITE_API_BASE=/api"
    echo "VITE_VAPID_PUBLIC_KEY=$vapid"
    echo "VITE_GOOGLE_ENABLED=$google"
    echo "VITE_EMAIL_REMINDERS=$lembretes"
  } >"$WEB/.env.production.local"
  # Painel: login próprio pela API do User Pool (SRP), sem o domínio do Cognito
  {
    echo "# Gerado por infra/scripts/lancar-cloudshell.sh com os outputs da stack $STACK. Fora do git."
    echo "VITE_COGNITO_USER_POOL_ID=$(output UserPoolId)"
    echo "VITE_COGNITO_CLIENT_ID=$(output AdminClientId)"
    echo "VITE_API_BASE=/api"
  } >"$ADMIN/.env.production.local"
  ok "apps/web-poc/.env.production.local e apps/admin-web/.env.production.local"
  NOTIFICACOES=false
  if [[ -n "$vapid" ]]; then
    NOTIFICACOES=true
    ok "chave pública VAPID incluída (Web Push)"
  else
    aviso "Sem $PARAM_VAPID_PUBLICA no SSM: o app sai sem notificações. Para ligar: --com-notificacoes."
  fi
  [[ "$google" == true ]] || info "Login com Google desligado: o app mostra só e-mail e senha."
}

build_web() {
  (
    cd "$WEB"
    if [[ "$VLIBRAS_OPCIONAL" == true ]]; then export LIBRAX_VLIBRAS_OPCIONAL=1; fi
    npm run build
  )
}

construir() {
  passo "Build do app (baixa os modelos de ML e o avatar VLibras na primeira vez)"
  if ! demorado "build do app" build_web; then
    aviso "Se o erro foi no download do VLibras (vlibras-assets), rode de novo: o que já baixou fica guardado."
    aviso "Se os servidores do VLibras estiverem fora do ar, --vlibras-opcional publica sem o avatar (cai na descrição em texto)."
    falha "O build do app falhou."
  fi
  [[ -f "$WEB/dist/index.html" && -d "$WEB/dist/ml" ]] || falha "O build do app não gerou dist/index.html e dist/ml."
  if [[ "$VLIBRAS_OPCIONAL" == true && ! -d "$WEB/dist/vlibras/sinais" ]]; then
    aviso "Build sem as animações do VLibras: o avatar cai na descrição em texto até a próxima publicação."
  fi
  ok "apps/web-poc/dist"

  passo "Build do painel de administração"
  (cd "$ADMIN" && demorado "build do painel" npm run build)
  ok "apps/admin-web/dist"
}

sync_s3() { aws_l s3 sync "$@" --only-show-errors; }

enviar_app() {
  local web conteudo
  web=$(output WebBucketName)
  conteudo=$(output ContentBucketName)
  # Arquivos com hash primeiro, o app shell (index.html e sw.js) depois e só então a limpeza: quem
  # abrir o app no meio do upload nunca recebe um index.html que aponta para arquivo que ainda não subiu.
  sync_s3 "$WEB/dist" "s3://$web" --exclude 'ml/*' --exclude index.html --exclude sw.js
  sync_s3 "$WEB/dist" "s3://$web" --exclude '*' --include index.html --include sw.js
  sync_s3 "$WEB/dist" "s3://$web" --exclude 'ml/*' --delete
  # /ml/* é servido pelo bucket de conteúdo (README da API, item 11). Sem --delete: versões antigas
  # continuam para quem ainda está com o app anterior. O Cache-Control vai também como metadado,
  # com a mesma regra do CloudFront (infra/lib/web-headers.ts): só a pasta com versão no nome
  # (/ml/<versão>/ do MediaPipe) é imutável; as pastas de modelo (classifier, sinais, letras-mov,
  # numeros e outras) são republicadas no mesmo endereço e revalidam a cada pedido.
  local pasta nome cache
  sync_s3 "$WEB/dist/ml" "s3://$conteudo/ml" --exclude '*/*' --cache-control "$CACHE_REVALIDA"
  for pasta in "$WEB/dist/ml"/*/; do
    [[ -d "$pasta" ]] || continue
    nome=$(basename "$pasta")
    cache=$CACHE_REVALIDA
    [[ "$nome" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && cache=$CACHE_IMUTAVEL
    sync_s3 "$pasta" "s3://$conteudo/ml/$nome" --exclude '*.wasm' --cache-control "$cache"
    sync_s3 "$pasta" "s3://$conteudo/ml/$nome" --exclude '*' --include '*.wasm' \
      --content-type application/wasm --cache-control "$cache"
  done
}

publicar_sites() {
  passo "Upload do app (bucket do app e modelos de ML no bucket de conteúdo)"
  demorado "upload do app" enviar_app
  ok "app em $(output AppUrl)"

  passo "Upload do painel de administração"
  demorado "upload do painel" sync_s3 "$ADMIN/dist" "s3://$(output AdminBucketName)/admin" --delete
  ok "painel em $(output AdminUrl)"

  passo "Publicação da landing"
  (cd "$INFRA" && demorado "publicação da landing" npm run landing:publicar)
  ok "landing em $(output LandingUrl)"
}

dar_admin() {
  passo "Grupo admin do Cognito"
  [[ "$ADMIN_EMAIL" =~ $RE_EMAIL ]] || falha "--admin e --dono precisam de um e-mail válido."
  ler_outputs UserPoolId AppUrl
  local pool usuarios usuario
  pool=$(output UserPoolId)
  usuarios=$(aws_l cognito-idp list-users --user-pool-id "$pool" --filter "email = \"$ADMIN_EMAIL\"" \
    --query 'Users[].Username' --output text)
  [[ -n "$usuarios" && "$usuarios" != None ]] ||
    falha "Nenhuma conta com $(mascarar_email "$ADMIN_EMAIL"). Crie a conta no app ($(output AppUrl)/criar-conta) e rode de novo."
  for usuario in $usuarios; do
    aws_l cognito-idp admin-add-user-to-group --user-pool-id "$pool" --username "$usuario" --group-name admin
    if [[ "$DONO" == true ]]; then
      aws_l cognito-idp admin-add-user-to-group --user-pool-id "$pool" --username "$usuario" --group-name owner
    fi
  done
  if [[ "$DONO" == true ]]; then
    ok "$(mascarar_email "$ADMIN_EMAIL") é admin e dona do painel. Saia do painel e entre de novo para o acesso valer."
    info "Só a conta dona torna outras contas admin ou tira do admin (painel, tela Contas, na conta aberta)."
  else
    ok "$(mascarar_email "$ADMIN_EMAIL") no grupo admin. Saia do painel e entre de novo para o acesso valer."
  fi
  info "O painel exige o segundo fator (aplicativo autenticador). No primeiro acesso a $(output AppUrl)/admin/,"
  info "tenha no celular um app como Google Authenticator, Microsoft Authenticator ou 1Password: o painel mostra"
  info "um QR code, você lê com o app e digita o código de 6 dígitos. Daí em diante o login pede esse código."
  info "Use uma conta de e-mail e senha só para o painel: com o autenticador ligado, o app do Librax ainda não"
  info "pede o código e não entra com ela. Conta do Google não serve (o segundo fator fica no Google)."
}

resumo() {
  passo "Pronto"
  info "Landing: $(output LandingUrl)"
  info "App:     $(output AppUrl)"
  info "Painel:  $(output AdminUrl)"
  info "Android: $(output AppUrl)/.well-known/assetlinks.json"
  [[ "$MODO_CI" == false ]] || return 0
  echo
  info "Falta fazer (docs/lancamento.md, Depois do lançamento):"
  if [[ "$SO_PUBLICAR" == false && -n "${ALARM_EMAIL:-}" ]]; then
    info "- Confirmar as assinaturas no e-mail $(mascarar_email "$ALARM_EMAIL") (alarmes e orçamento)."
  fi
  info "- Criar a conta do painel no app (e-mail e senha, só para isso) e rodar: bash infra/scripts/lancar-cloudshell.sh --dono <e-mail>"
  info "  No primeiro acesso ao painel, configure o aplicativo autenticador (o painel guia)."
  if [[ "$SO_PUBLICAR" == false && "$(contexto lambdaReservedConcurrency)" != true ]]; then
    info "- Concorrência reservada desligada. Com a cota do Lambda em $COTA_LAMBDA_PEDIR, rode de novo com --com-concorrencia-reservada."
  fi
  if [[ "$SO_PUBLICAR" == false && -n "${ALARM_EMAIL:-}" && "$(contexto costAnomalyAlerts)" == off ]]; then
    info "- Alerta de anomalia de custo desligado: ative o Cost Explorer e rode o lançamento de novo."
  fi
  if [[ "$(contexto googleEnabled)" != true ]]; then
    info "- Login com Google desligado. Para ligar: cliente OAuth no Google e depois --com-google (o script pede o id e o segredo)."
  fi
  if [[ "$NOTIFICACOES" != true ]]; then
    info "- Notificações desligadas. Para ligar: bash infra/scripts/lancar-cloudshell.sh --so-publicar --com-notificacoes"
  fi
  if [[ "$(contexto emailRemindersEnabled)" != true ]]; then
    info "- Lembretes por e-mail desligados. Para ligar: domínio no SES e depois --com-lembretes-email."
  fi
  if [[ "$(contexto cognitoEmailSes)" != true ]]; then
    info "- Códigos do login pelo envio padrão do Cognito (até 50 e-mails por dia). Para usar o SES: domínio no SES e depois --com-email-ses."
  fi
  info "- Ativar o Cost Explorer (Faturamento > Cost Explorer) para a tela de custo do painel."
  info "- Ao terminar, apague a pasta: rm -rf $RAIZ (e revogue o token do GitHub)."
}

# ---------------------------------------------------------------------------------------------
# CI/CD (--configurar-ci): stack LibraxCiStack, com app CDK próprio (infra/bin/librax-ci.ts)
# ---------------------------------------------------------------------------------------------

# deploy_ci true|false: false cria só a conexão com o GitHub (o webhook do projeto precisa dela aprovada)
deploy_ci() {
  (
    cd "$INFRA"
    "$AWS_SH" node scripts/conferir-conta.mjs
    demorado "deploy do CI/CD" "$AWS_SH" npx cdk deploy "$STACK_CI" \
      --app "npx ts-node --prefer-ts-exts bin/librax-ci.ts" \
      --require-approval never -c "librax:ciCreateProject=$1"
  )
}

# Output da LibraxCiStack (vazio se a stack ou o output não existir)
output_ci() {
  local saida
  saida=$(aws_l cloudformation describe-stacks --stack-name "$STACK_CI" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text 2>/dev/null || true)
  [[ "$saida" == None ]] || printf '%s' "$saida"
}

# PENDING, AVAILABLE ou ERROR (só leitura)
status_da_conexao() {
  aws_l codeconnections get-connection --connection-arn "$1" --query Connection.ConnectionStatus --output text 2>/dev/null ||
    aws_l codestar-connections get-connection --connection-arn "$1" --query Connection.ConnectionStatus --output text 2>/dev/null ||
    true
}

instrucoes_da_conexao() {
  info "A conexão $CONEXAO_CI com o GitHub está criada, mas pendente. Aprove uma vez no console (2 minutos):"
  info "1. Abra https://console.aws.amazon.com/codesuite/settings/connections?region=$REGIAO"
  info "   (Ferramentas do desenvolvedor > Configurações > Conexões; em inglês: Developer Tools > Settings > Connections)."
  info "2. Clique em $CONEXAO_CI (status Pendente / Pending) e em Atualizar conexão pendente (Update pending connection)."
  info "3. Na janela do GitHub que abre: Authorize AWS Connector for GitHub."
  info "4. Em Aplicativos do GitHub (GitHub Apps): Instalar um novo aplicativo (Install a new app) > a conta"
  info "   ${REPOSITORIO_CI%%/*} > Only select repositories > $REPOSITORIO_CI > Install."
  info "   Se o app já estiver instalado, escolha a instalação que aparece na lista."
  info "5. De volta na AWS: Conectar (Connect). O status vira Disponível (Available)."
}

# Espera a aprovação no console; sem terminal, para e pede para rodar de novo
esperar_conexao() {
  local arn=$1 status resposta
  while true; do
    status=$(status_da_conexao "$arn")
    if [[ "$status" == AVAILABLE ]]; then
      ok "conexão $CONEXAO_CI disponível"
      return 0
    fi
    [[ "$status" != ERROR ]] ||
      falha "A conexão $CONEXAO_CI está em ERRO. Apague-a no console (Configurações > Conexões), apague a stack $STACK_CI no CloudFormation e rode --configurar-ci de novo."
    instrucoes_da_conexao
    [[ -t 0 ]] ||
      falha "Conexão ainda ${status:-desconhecida}. Aprove no console (acima) e rode de novo: bash infra/scripts/lancar-cloudshell.sh --configurar-ci"
    read -r -p "   Depois de clicar em Conectar, aperte Enter para conferir (Ctrl+C para sair): " resposta || true
  done
}

# A assinatura do e-mail no tópico de alarmes da LibraxStack, que recebe o resultado de cada build
conferir_assinatura_alarmes() {
  local topico assinaturas
  ler_outputs AlarmTopicArn
  topico=$(output AlarmTopicArn)
  assinaturas=$(aws_l sns list-subscriptions-by-topic --topic-arn "$topico" \
    --query "Subscriptions[?Protocol=='email'].SubscriptionArn" --output text 2>/dev/null || true)
  if [[ -z "$assinaturas" || "$assinaturas" == None ]]; then
    aviso "O tópico de alarmes não tem e-mail: o resultado dos builds não avisa ninguém. Rode o lançamento completo com --email-alarmes."
  elif [[ "$assinaturas" == *PendingConfirmation* ]]; then
    aviso "A assinatura do e-mail dos alarmes ainda não foi confirmada: procure o e-mail \"AWS Notification - Subscription Confirmation\" e clique em Confirm subscription."
  else
    ok "e-mail dos alarmes confirmado: o resultado de cada build chega nele"
  fi
}

configurar_ci() {
  passo "Dependências da infra"
  local rel=${INFRA#"$RAIZ"/}
  if [[ -f "$INFRA/node_modules/.package-lock.json" && ! "$INFRA/package-lock.json" -nt "$INFRA/node_modules/.package-lock.json" ]]; then
    ok "$rel em dia"
  else
    demorado "npm ci em $rel" npm_ci_em "$INFRA"
    ok "$rel instalado"
  fi
  conferir_conta

  passo "LibraxStack no ar (o CI/CD publica nela e avisa no tópico de alarmes dela)"
  esperar_stack
  [[ "$ESTADO_STACK" != NAO_EXISTE ]] ||
    falha "A stack $STACK ainda não existe: faça o primeiro lançamento (docs/lancamento.md) antes do CI/CD."
  ok "stack em $ESTADO_STACK"
  conferir_assinatura_alarmes
  sincronizar_contexto

  passo "Conexão com o GitHub ($CONEXAO_CI)"
  local conexao
  conexao=$(output_ci ConexaoGithubArn)
  if [[ -z "$conexao" ]]; then
    info "Criando a conexão (fica pendente até a aprovação no console)."
    deploy_ci false
    conexao=$(output_ci ConexaoGithubArn)
    [[ -n "$conexao" ]] || falha "A stack $STACK_CI não devolveu a conexão (output ConexaoGithubArn)."
  fi
  esperar_conexao "$conexao"

  passo "Projeto do CodeBuild ($PROJETO_CI), webhook das tags e aviso por e-mail"
  deploy_ci true
  ok "CI/CD pronto"
  info "Para publicar uma versão: git tag v1.2.3 && git push origin v1.2.3 (docs/ci-cd.md)."
  info "Builds e logs: $(output_ci HistoricoDosBuilds)"
}

# ---------------------------------------------------------------------------------------------

DOMINIO=""
CONTA=""
ZONA=""
CERT=""
GOOGLE=false
LEMBRETES=false
EMAIL_SES=false
NOTIFICACOES=false
ALARM_EMAIL=""
OUTPUTS=""
ESTADO_STACK=""

main() {
  ler_opcoes "$@"
  trap ao_falhar ERR
  trap parar_ticker EXIT

  printf 'Lançamento do Librax (%s)\n' "$RAIZ"
  conferir_ambiente
  garantir_node
  if [[ "$MODO_CI" == true ]]; then
    baixar_contexto
  else
    restaurar_contexto
  fi
  DOMINIO=$(contexto domainName)
  [[ -n "$DOMINIO" && "$DOMINIO" != librax.example ]] || falha "Defina librax:domainName em infra/cdk.json."

  if [[ "$CONFIGURAR_CI" == true ]]; then
    configurar_ci
    return 0
  fi

  if [[ -n "$ADMIN_EMAIL" ]]; then
    [[ "$ADMIN_EMAIL" =~ $RE_EMAIL ]] || falha "--admin e --dono precisam de um e-mail válido."
    conferir_conta
    dar_admin
    return 0
  fi

  instalar_dependencias
  conferir_conta
  if [[ "$SO_PUBLICAR" == true ]]; then
    if [[ -n "$OPT_ZONA$OPT_CERT$OPT_EMAIL$OPT_ORCAMENTO$OPT_GOOGLE$OPT_LEMBRETES$OPT_EMAIL_SES$OPT_RESERVA" ]]; then
      aviso "Com --so-publicar a stack não muda: --zona, --certificado, --email-alarmes, --orcamento, --com/--sem-google, --com/--sem-lembretes-email, --com/--sem-email-ses e --com/--sem-concorrencia-reservada ficam para o lançamento completo."
    fi
    passo "Stack publicada"
    esperar_stack
    [[ "$ESTADO_STACK" != NAO_EXISTE ]] || falha "A stack $STACK ainda não existe: rode o lançamento completo (sem --so-publicar)."
    ok "stack em $ESTADO_STACK"
  else
    ler_contexto_do_lancamento
    conferir_pre_requisitos
    conferir_travas_de_custo
    publicar_stack
  fi
  if [[ "$OPT_NOTIFICACOES" == true ]]; then
    garantir_chaves_push
  fi
  escrever_envs
  construir
  publicar_sites
  resumo
}

# Rodado direto (bash infra/scripts/lancar-cloudshell.sh); com source, só carrega as funções (testes)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
