# One image recipe for every Haqdaar service.
#   docker build --build-arg SERVICE=identity -t haqdaar-identity .
# SERVICE: gateway | identity | cases | ai | payments | audit | rails-mock | judge
#
# Only the chosen service, its workspace dependencies (shared, nest-kit) and the root
# toolchain are installed. Prisma clients are generated INSIDE the image, so the query
# engine matches Alpine (linux-musl) automatically: no binaryTargets change needed.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
# openssl: Prisma engine; libc6-compat: native modules (argon2)
RUN apk add --no-cache openssl libc6-compat \
 && corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
# Hoist everything: nest-kit resolves its @nestjs/* peers from the root once dev deps are pruned.
# One shared store (BuildKit cache mount): the prod-deps stage reuses what the build stage
# downloaded instead of fetching every package twice.
ENV PNPM_FLAGS="--config.shamefully-hoist=true --store-dir=/pnpm/store --config.fetch-retries=5 --config.fetch-retry-maxtimeout=120000"

# ---------- build ----------
FROM base AS build
ARG SERVICE
RUN test -n "$SERVICE" || (echo "Missing --build-arg SERVICE=<name>" && exit 1)
COPY . .
RUN --mount=type=cache,id=haqdaar-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile $PNPM_FLAGS --filter "@haqdaar/${SERVICE}..." --filter haqdaar
RUN pnpm --filter @haqdaar/shared --filter @haqdaar/nest-kit run build
RUN mkdir -p "services/${SERVICE}/generated" \
 && if [ -f "services/${SERVICE}/prisma/schema.prisma" ]; then pnpm --filter "@haqdaar/${SERVICE}" run db:generate; fi
RUN pnpm --filter "@haqdaar/${SERVICE}" run build
# Tables for the first boot on an empty database (applied by scripts/docker/db-init.mjs).
RUN if [ -f "services/${SERVICE}/prisma/schema.prisma" ]; then cd "services/${SERVICE}" \
      && pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > dist/schema.sql; fi

# ---------- production dependencies only (no TypeScript, Nest CLI, Prisma CLI) ----------
FROM base AS prod-deps
ARG SERVICE
COPY . .
RUN --mount=type=cache,id=haqdaar-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --prefer-offline $PNPM_FLAGS --filter "@haqdaar/${SERVICE}..." --filter haqdaar \
 # pnpm auto-installs @prisma/client's optional peers (Prisma CLI, engines, TypeScript, effect: ~140 MB).
 # The generated client ships its own musl engine, so none of them are needed at runtime.
 && rm -rf node_modules/.pnpm/prisma@* node_modules/.pnpm/@prisma+engines* node_modules/.pnpm/@prisma+config* \
           node_modules/.pnpm/typescript@* node_modules/.pnpm/effect@* \
 && mkdir -p packages/shared/node_modules packages/nest-kit/node_modules "services/${SERVICE}/node_modules"

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
ARG SERVICE
RUN apk add --no-cache openssl libc6-compat tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx
ENV SERVICE=${SERVICE} \
    NODE_ENV=production \
    PORT=8080 \
    LOG_PRETTY=
WORKDIR /app
# Same layout as the repo: pnpm's node_modules symlinks are relative paths.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=prod-deps --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/nest-kit/package.json ./packages/nest-kit/package.json
COPY --from=prod-deps --chown=node:node /app/packages/nest-kit/node_modules ./packages/nest-kit/node_modules
COPY --from=prod-deps --chown=node:node /app/services/${SERVICE}/package.json ./services/${SERVICE}/package.json
COPY --from=prod-deps --chown=node:node /app/services/${SERVICE}/node_modules ./services/${SERVICE}/node_modules
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/nest-kit/dist ./packages/nest-kit/dist
COPY --from=build --chown=node:node /app/services/${SERVICE}/dist ./services/${SERVICE}/dist
COPY --from=build --chown=node:node /app/services/${SERVICE}/generated ./services/${SERVICE}/generated
COPY --chown=node:node scripts/docker ./scripts/docker
USER node
WORKDIR /app/services/${SERVICE}
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "/app/scripts/docker/entrypoint.sh"]
