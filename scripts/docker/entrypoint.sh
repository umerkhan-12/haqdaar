#!/bin/sh
# Container start for every Haqdaar service.
# Hosted Postgres hands out one DATABASE_URL; each service keeps its own schema in it.
set -e

if [ -n "$DATABASE_URL" ]; then
  export BUS_DATABASE_URL="${BUS_DATABASE_URL:-$DATABASE_URL}"
  case "$SERVICE" in
    identity|cases|payments|audit|knowledge)
      var="$(echo "$SERVICE" | tr '[:lower:]' '[:upper:]')_DATABASE_URL"
      eval "current=\${$var:-}"
      case "$DATABASE_URL" in *\?*) sep='&' ;; *) sep='?' ;; esac
      [ -n "$current" ] || export "$var=${DATABASE_URL}${sep}schema=${SERVICE}"
      ;;
  esac
fi

# First boot on an empty schema: create the tables (SQL generated from the Prisma schema at build time).
if [ -f dist/schema.sql ]; then node /app/scripts/docker/db-init.mjs; fi
# Demo data: the seeds are upserts, safe to run on every boot.
if [ "$DEMO_MODE" = "1" ] && [ -f dist/seed.js ]; then node dist/seed.js; fi

exec node dist/main.js
