#!/usr/bin/env bash
# scripts/supabase-cli.sh
#
# Wrapper para `supabase` CLI cuando no podemos usar `supabase link` (token sin
# privilegios sobre el Management API). Carga las vars de apps/web/.env.local,
# construye la URL del proyecto remoto y la inyecta como `--db-url` en cada
# subcomando relevante.
#
# Uso (a través de pnpm scripts):
#   pnpm db:push        → aplica migraciones a la BD remota
#   pnpm db:types       → genera packages/core/src/supabase/database.ts
#   pnpm db:reset       → ⚠️  borra el schema público remoto (pide confirmación)
#
# Doc: docs/architecture/supabase-cli-without-link.md

set -euo pipefail

CMD="${1:-}"
shift || true

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/web/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE no encontrado. Configura las vars de Supabase primero." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${SUPABASE_DB_PASSWORD:?falta SUPABASE_DB_PASSWORD en apps/web/.env.local}"
: "${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF en apps/web/.env.local}"

# La password puede tener caracteres reservados de URL (@, :, /, etc.).
# Codificamos vía Node para no depender de python.
ENC_PW=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SUPABASE_DB_PASSWORD")
REMOTE_DB_URL="postgresql://postgres:${ENC_PW}@db.${SUPABASE_PROJECT_REF}.supabase.co:5432/postgres"

SUPABASE_VERSION="2.98.2"

case "$CMD" in
  push)
    exec npx "supabase@${SUPABASE_VERSION}" db push --db-url "$REMOTE_DB_URL" "$@"
    ;;
  types)
    OUT="$REPO_ROOT/packages/core/src/supabase/database.ts"
    echo "Generando types desde BD remota → $OUT"
    npx "supabase@${SUPABASE_VERSION}" gen types typescript --db-url "$REMOTE_DB_URL" "$@" > "$OUT"
    echo "OK"
    ;;
  reset)
    echo "⚠️  db:reset apunta al proyecto REMOTO (ref=$SUPABASE_PROJECT_REF)." >&2
    echo "   Esto borra TODO el schema public. Solo usar en proyectos vacíos o de prueba." >&2
    echo "   Confirma escribiendo exactamente: reset $SUPABASE_PROJECT_REF" >&2
    read -r CONFIRM
    if [[ "$CONFIRM" != "reset $SUPABASE_PROJECT_REF" ]]; then
      echo "Abortado." >&2
      exit 1
    fi
    exec npx "supabase@${SUPABASE_VERSION}" db reset --db-url "$REMOTE_DB_URL" "$@"
    ;;
  *)
    echo "Uso: $0 {push|types|reset} [args adicionales pasados al CLI]" >&2
    echo "Ver docs/architecture/supabase-cli-without-link.md" >&2
    exit 1
    ;;
esac
