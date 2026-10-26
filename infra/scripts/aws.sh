#!/usr/bin/env bash
# Roda um comando com o login AWS do Librax: o perfil "librax" da pasta .aws/ na raiz do
# projeto (IAM Identity Center). Não lê o ~/.aws/config nem o ~/.aws/credentials da máquina
# e descarta as credenciais e endpoints que estiverem no terminal, para nunca cair em outra conta.
#
# No AWS CloudShell (AWS_EXECUTION_ENV começa com "CloudShell") não existe perfil local: o login é o
# do console, entregue pelo contêiner (AWS_CONTAINER_CREDENTIALS_FULL_URI e o token dele). Só lá ficam
# as credenciais do contêiner e a região da sessão; chaves avulsas, perfis e endpoints continuam
# descartados. A trava da conta (scripts/conferir-conta.mjs) roda igual nos dois casos.
# Uso: infra/scripts/aws.sh <comando> [args...]
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

em_cloudshell() {
  [[ "${AWS_EXECUTION_ENV:-}" == CloudShell* ]]
}

cloudshell=false
if em_cloudshell; then cloudshell=true; fi

for var in $(compgen -e); do
  case "$var" in
    AWS_CONTAINER_CREDENTIALS_* | AWS_CONTAINER_AUTHORIZATION_TOKEN* | AWS_REGION | AWS_DEFAULT_REGION)
      # No CloudShell são o login do console e a região da sessão
      if [[ "$cloudshell" == false ]]; then unset "$var"; fi
      ;;
    AWS_ACCESS_KEY_ID | AWS_SECRET_ACCESS_KEY | AWS_SESSION_TOKEN | AWS_SECURITY_TOKEN | \
      AWS_PROFILE | AWS_DEFAULT_PROFILE | AWS_ROLE_ARN | AWS_ROLE_SESSION_NAME | \
      AWS_WEB_IDENTITY_TOKEN_FILE | AWS_ENDPOINT_URL* | \
      CDK_DEFAULT_ACCOUNT | CDK_DEFAULT_REGION)
      unset "$var"
      ;;
  esac
done

mkdir -p "$raiz/.aws"
export AWS_CONFIG_FILE="$raiz/.aws/config"
export AWS_SHARED_CREDENTIALS_FILE="$raiz/.aws/credentials"
if [[ "$cloudshell" == true ]]; then
  export LIBRAX_AWS_LOGIN=cloudshell
else
  export AWS_PROFILE=librax
  export LIBRAX_AWS_LOGIN=perfil
fi

exec "$@"
