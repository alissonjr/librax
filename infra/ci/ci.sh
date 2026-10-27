#!/usr/bin/env bash
# Passos do CI/CD do Librax no CodeBuild (infra/ci/buildspec.yml, docs/ci-cd.md).
#
#   bash infra/ci/ci.sh conferir-tag   para se o build não veio de uma tag de versão (v1.2.3)
#   bash infra/ci/ci.sh instalar       npm ci em cada pacote
#   bash infra/ci/ci.sh testar         todas as suítes de teste; para na primeira que falhar
#
# O "testar" também roda fora da AWS, no seu computador, antes de criar a tag:
#   bash infra/ci/ci.sh instalar && bash infra/ci/ci.sh testar
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Mesma ordem do lançamento; as mais rápidas testam primeiro
PACOTES=(services/api apps/landing apps/admin-web infra apps/web-poc)
# O mesmo padrão do webhook (infra/lib/ci-stack.ts, CI_TAG_REF_PATTERN), sem o refs/tags/
RE_VERSAO='^v[0-9]+\.[0-9]+\.[0-9]+$'

titulo() { printf '\n=== %s ===\n' "$1"; }
falha() {
  printf '\nERRO: %s\n' "$1" >&2
  exit 1
}

# De onde veio o build: o push da tag (webhook) ou um build iniciado no console com a versão da origem
# igual a uma tag (re-rodar). Qualquer outra origem (branch, commit avulso) para aqui, antes de gastar
# minutos.
conferir_tag() {
  local gatilho=${CODEBUILD_WEBHOOK_TRIGGER:-} origem=${CODEBUILD_SOURCE_VERSION:-} evento=${CODEBUILD_WEBHOOK_EVENT:-}
  local commit=${CODEBUILD_RESOLVED_SOURCE_VERSION:-} tag=""
  if [[ -n "$evento" && "$evento" != PUSH ]]; then
    falha "Evento $evento do GitHub: o CI/CD do Librax só roda com o push de uma tag de versão."
  fi
  if [[ "$gatilho" == tag/* ]]; then
    tag=${gatilho#tag/}
  elif [[ -z "$gatilho" ]]; then
    tag=${origem#refs/tags/}
  fi
  [[ "$tag" =~ $RE_VERSAO ]] ||
    falha "Este build não veio de uma tag de versão (gatilho: ${gatilho:-nenhum}, versão da origem: ${origem:-nenhuma}). Publique com: git tag v1.2.3 && git push origin v1.2.3 (docs/ci-cd.md)."
  [[ ! "$commit" =~ ^0+$ ]] || falha "A tag $tag foi apagada no GitHub: nada a publicar."
  printf 'Versão %s (commit %s)\n' "$tag" "${commit:-desconhecido}"
}

instalar() {
  local dir
  for dir in "${PACOTES[@]}"; do
    titulo "npm ci em $dir"
    (cd "$RAIZ/$dir" && npm ci --no-audit --no-fund --loglevel=error)
  done
}

# Os mesmos comandos dos package.json de cada pacote
testar() {
  titulo "services/api: node --test"
  (cd "$RAIZ/services/api" && npm test)
  titulo "apps/landing: vitest"
  (cd "$RAIZ/apps/landing" && npm test)
  titulo "apps/admin-web: vitest"
  (cd "$RAIZ/apps/admin-web" && npm test)
  titulo "infra: vitest"
  (cd "$RAIZ/infra" && npm test)
  titulo "infra: tsc"
  (cd "$RAIZ/infra" && npx tsc --noEmit)
  titulo "apps/web-poc: conteúdo das lições (content:check)"
  (cd "$RAIZ/apps/web-poc" && npm run content:check)
  titulo "apps/web-poc: tsc -b"
  (cd "$RAIZ/apps/web-poc" && npx tsc -b)
  titulo "apps/web-poc: vitest"
  (cd "$RAIZ/apps/web-poc" && npm test)
  titulo "Todos os testes passaram"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    conferir-tag) conferir_tag ;;
    instalar) instalar ;;
    testar) testar ;;
    *)
      echo "Uso: bash infra/ci/ci.sh conferir-tag | instalar | testar" >&2
      exit 2
      ;;
  esac
fi
