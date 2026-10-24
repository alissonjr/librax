#!/usr/bin/env bash
# Roda um comando com o login AWS do Librax: o perfil "librax" da pasta .aws/ na raiz do
# projeto (IAM Identity Center). Não lê o ~/.aws/config nem o ~/.aws/credentials da máquina
# e descarta as credenciais e endpoints que estiverem no terminal, para nunca cair em outra conta.
# Uso: infra/scripts/aws.sh <comando> [args...]
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for var in $(compgen -e); do
  case "$var" in
    AWS_ACCESS_KEY_ID | AWS_SECRET_ACCESS_KEY | AWS_SESSION_TOKEN | AWS_SECURITY_TOKEN | \
      AWS_DEFAULT_PROFILE | AWS_REGION | AWS_DEFAULT_REGION | AWS_ROLE_ARN | AWS_ROLE_SESSION_NAME | \
      AWS_WEB_IDENTITY_TOKEN_FILE | AWS_CONTAINER_CREDENTIALS_* | AWS_ENDPOINT_URL* | \
      CDK_DEFAULT_ACCOUNT | CDK_DEFAULT_REGION)
      unset "$var"
      ;;
  esac
done

mkdir -p "$raiz/.aws"
export AWS_CONFIG_FILE="$raiz/.aws/config"
export AWS_SHARED_CREDENTIALS_FILE="$raiz/.aws/credentials"
export AWS_PROFILE=librax

exec "$@"
