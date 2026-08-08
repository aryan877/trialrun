# Builds the @trialrun/web Next.js standalone output on Linux so native
# bindings (e.g. @node-rs/argon2, @img/sharp) match the alpine/nodejs@24
# runtime instead of the host's macOS platform.
#
# Usage: docker build --output type=local,dest=.deploy/web-linux \
#   -f ops/web-artifact.Dockerfile .
# The exported tree keeps the layout the Zerops start command expects:
#   node .deploy/web/apps/web/server.js

# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

ARG TRIALRUN_WEB_SOURCE_DIGEST

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cloud-executor/package.json apps/cloud-executor/package.json
COPY apps/runner/package.json apps/runner/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/executor/package.json packages/executor/package.json
COPY packages/github/package.json packages/github/package.json

RUN corepack prepare pnpm@9.15.5 --activate && pnpm --version
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY packages/github packages/github

RUN pnpm --filter @trialrun/web build

# Assemble the exact tree deployed by ops/web-artifact.zerops.yaml.
RUN rm -rf /deploy \
  && mkdir -p /deploy/apps/web/.next \
  && cp -R apps/web/.next/standalone/. /deploy/ \
  && cp -R apps/web/.next/static /deploy/apps/web/.next/static \
  && cp -R apps/web/public /deploy/apps/web/public \
  && printf '%s\n' "$TRIALRUN_WEB_SOURCE_DIGEST" | grep -Eq '^[0-9a-f]{64}$' \
  && printf '%s\n' "$TRIALRUN_WEB_SOURCE_DIGEST" > /deploy/.trialrun-source-sha256

FROM scratch AS artifact

COPY --from=builder /deploy /
